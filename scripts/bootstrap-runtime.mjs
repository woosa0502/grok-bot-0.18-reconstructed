import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { archivedDmg, cachedDmg, cachedRuntimeApp, dmgBytes, dmgLfsBatchUrl, dmgSha256, dmgUrl } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";
import { cacheRuntimeFromApp, hydrateSourcePayloadFromAsar, hydrateSourcePayloadFromRuntime, validateRuntimeApp } from "./lib/runtime.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

async function isGitLfsPointer(target) {
  const bytes = await readFile(target);
  return bytes.byteLength < 1024
    && bytes.toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1\n");
}

async function resolveGitLfsDownload() {
  const response = await fetch(dmgLfsBatchUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.git-lfs+json",
      "content-type": "application/vnd.git-lfs+json",
    },
    body: JSON.stringify({
      operation: "download",
      transfers: ["basic"],
      objects: [{ oid: dmgSha256, size: dmgBytes }],
    }),
  });
  if (!response.ok) throw new Error(`Git LFS batch request failed: HTTP ${response.status}`);
  const payload = await response.json();
  const object = payload?.objects?.[0];
  const action = object?.actions?.download;
  if (object?.oid !== dmgSha256 || object?.size !== dmgBytes || typeof action?.href !== "string") {
    throw new Error("Git LFS batch response did not contain the checksum-pinned DMG");
  }
  const url = new URL(action.href);
  if (url.protocol !== "https:" || (url.hostname !== "githubusercontent.com" && !url.hostname.endsWith(".githubusercontent.com"))) {
    throw new Error(`Git LFS download host is not trusted: ${url.hostname}`);
  }
  return { url, headers: action.header ?? {} };
}

async function downloadDmg() {
  await mkdir(path.dirname(cachedDmg), { recursive: true });
  if (await exists(cachedDmg)) {
    const digest = await sha256(cachedDmg);
    if (digest === dmgSha256) return;
    await rm(cachedDmg, { force: true });
  }

  if (await exists(archivedDmg)) {
    const archivedDigest = await sha256(archivedDmg);
    if (archivedDigest === dmgSha256) {
      console.log(`Using archived release ${archivedDmg}`);
      await copyFile(archivedDmg, cachedDmg);
      return;
    }
    if (!(await isGitLfsPointer(archivedDmg))) {
      throw new Error(`Archived DMG checksum mismatch: expected ${dmgSha256}, got ${archivedDigest}. Run git lfs pull before bootstrapping.`);
    }
    console.log("Archived release is a Git LFS pointer; downloading the checksum-pinned DMG instead.");
  }

  console.log(`Downloading ${dmgUrl}`);
  let response = await fetch(dmgUrl, { redirect: "follow" });
  if (response.status === 403 || response.status === 404) {
    await response.body?.cancel();
    console.log("The vendor archive is unavailable; using the public Git LFS object with the same pinned SHA-256.");
    const fallback = await resolveGitLfsDownload();
    response = await fetch(fallback.url, { headers: fallback.headers, redirect: "error" });
  }
  if (!response.ok || response.body == null) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const partial = `${cachedDmg}.partial`;
  await rm(partial, { force: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { mode: 0o600 }));
  const digest = await sha256(partial);
  if (digest !== dmgSha256) {
    await rm(partial, { force: true });
    throw new Error(`DMG checksum mismatch: expected ${dmgSha256}, got ${digest}`);
  }
  await rename(partial, cachedDmg);
}

async function findFile(root, basename) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isFile() && entry.name === basename) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, basename);
      if (nested != null) return nested;
    }
  }
  return null;
}

async function hydrateSourcePayloadOnLinux() {
  const extractionRoot = await mkdtemp(path.join(tmpdir(), "grok-bot-018-dmg-"));
  try {
    await run(SYSTEM_TOOLS.sevenZip, ["x", "-y", `-o${extractionRoot}`, cachedDmg]);
    const archive = await findFile(extractionRoot, "app.asar");
    if (archive == null || !archive.includes(`${path.sep}Grok Bot.app${path.sep}Contents${path.sep}Resources${path.sep}`)) {
      throw new Error("The checksum-pinned DMG did not contain Grok Bot.app/Contents/Resources/app.asar");
    }
    return await hydrateSourcePayloadFromAsar(archive);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function extractRuntime() {
  const mountRoot = await mkdtemp(path.join(tmpdir(), "grok-bot-018-mount-"));
  let attached = false;
  try {
    await run(SYSTEM_TOOLS.hdiutil, ["attach", "-readonly", "-nobrowse", "-mountpoint", mountRoot, cachedDmg]);
    attached = true;
    await cacheRuntimeFromApp(path.join(mountRoot, "Grok Bot.app"));
  } finally {
    if (attached) await run(SYSTEM_TOOLS.hdiutil, ["detach", mountRoot]);
    await rm(mountRoot, { recursive: true, force: true });
  }
}

const configuredApp = process.env.GROK_BOT_018_APP?.trim();
let runtimeApp;
let hydrated;
if (configuredApp) {
  runtimeApp = await cacheRuntimeFromApp(configuredApp);
} else if (await exists(cachedRuntimeApp)) {
  runtimeApp = await validateRuntimeApp(cachedRuntimeApp);
} else {
  await downloadDmg();
  if (process.platform === "darwin") {
    await extractRuntime();
    runtimeApp = await validateRuntimeApp(cachedRuntimeApp);
  } else if (process.platform === "linux") {
    hydrated = await hydrateSourcePayloadOnLinux();
  } else {
    throw new Error(`Bootstrap is not implemented for ${process.platform}; use macOS or WSL/Linux.`);
  }
}

hydrated ??= await hydrateSourcePayloadFromRuntime(runtimeApp);

if (runtimeApp != null) console.log(`Runtime ready: ${cachedRuntimeApp}`);
console.log(`Checksum-pinned source payload ready: ${hydrated.destination} (${hydrated.sha256})`);
console.log(process.platform === "linux"
  ? "WSL/Linux bootstrap extracted immutable source evidence only; the native runtime will use Linux npm/Electron dependencies."
  : "The checksum-pinned app supplies only the Electron shell, ABI-matched native dependencies, and explicitly documented build fallbacks.");
