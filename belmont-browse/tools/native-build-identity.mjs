#!/usr/bin/env node
/**
 * Binds the native Aside browser binary the launcher runs to the source snapshot it was built from.
 *
 *   record --chrome <binary> [--engine 907]   writes aside-fork/snapshot/build-identity.json after a build
 *   verify --chrome <binary> [--engine 907]   refuses a binary that does not match the recorded build, or a
 *                                             snapshot that changed after that build (stale binary), or a daemon
 *                                             bundle that differs from the pinned archive
 *
 * Exit 0 = verified. Exit 3 = mismatch. Exit 2 = usage/missing input. BELMONT_BROWSE_ALLOW_UNVERIFIED_NATIVE=1
 * downgrades a verify failure to a loud warning (exit 0) for deliberate local experiments only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BROWSE_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(BROWSE_ROOT, "..");
export const SNAPSHOT_DIR = path.join(BROWSE_ROOT, "aside-fork/snapshot");
export const IDENTITY_FILE = path.join(SNAPSHOT_DIR, "build-identity.json");
const SNAPSHOT_INPUTS = ["manifest.json", "chromium.patch", "args.gn", "dependencies.json"];
const ENGINE_BUNDLES = { "824": "aside-824", "902": "aside-902", "906": "aside-906", "907": "aside-907" };

export async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

function snapshotInputs(snapshotDir) {
  const inputs = {};
  for (const name of SNAPSHOT_INPUTS) {
    const file = path.join(snapshotDir, name);
    if (existsSync(file)) inputs[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  return inputs;
}

function pinnedDaemon(engine, repoRoot) {
  const bundle = ENGINE_BUNDLES[engine];
  if (bundle === undefined) return null;
  const target = `belmont-browse/vendor/${bundle}/apps/daemon/build/daemon.mjs`;
  const manifestFile = path.join(repoRoot, "research-archives/aside/artifacts.json");
  if (!existsSync(manifestFile)) return { target, sha256: null };
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const pinned = (manifest.artifacts ?? []).find((item) => item.kind === "patched-daemon-bundle" && item.target === target);
  return { target, sha256: pinned?.sha256 ?? null };
}

export async function recordIdentity({ chrome, engine = "907", snapshotDir = SNAPSHOT_DIR, repoRoot = REPO_ROOT, identityFile = IDENTITY_FILE, now = () => new Date() }) {
  if (!existsSync(chrome)) throw new Error(`chrome binary not found: ${chrome}`);
  const stat = statSync(chrome, { bigint: true });
  const manifest = existsSync(path.join(snapshotDir, "manifest.json")) ? JSON.parse(readFileSync(path.join(snapshotDir, "manifest.json"), "utf8")) : {};
  const daemon = pinnedDaemon(engine, repoRoot);
  const identity = {
    schemaVersion: 1,
    recordedAt: now().toISOString(),
    note: "Identity of the native Aside browser build the launcher may run. run-fork.sh verifies the binary and the snapshot inputs against this record before starting; re-record after every native build.",
    chromium: { baseCommit: manifest.baseCommit ?? null, localHead: manifest.localHead ?? null, snapshotCapturedAt: manifest.capturedAt ?? null },
    snapshotInputs: snapshotInputs(snapshotDir),
    chrome: { path: chrome, bytes: Number(stat.size), mtimeNs: String(stat.mtimeNs), sha256: await sha256File(chrome) },
    engine,
    daemonBundle: daemon === null ? null : { target: daemon.target, pinnedSha256: daemon.sha256 },
  };
  const temporary = `${identityFile}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(identity, null, 2) + "\n");
  renameSync(temporary, identityFile);
  return identity;
}

export async function verifyIdentity({ chrome, engine = "907", snapshotDir = SNAPSHOT_DIR, repoRoot = REPO_ROOT, identityFile = IDENTITY_FILE, hashBinary = "auto" }) {
  const problems = [];
  if (!existsSync(identityFile)) return { ok: false, problems: [`no recorded build identity at ${identityFile}; run \`node tools/native-build-identity.mjs record --chrome <binary>\` after building`], identity: null };
  const identity = JSON.parse(readFileSync(identityFile, "utf8"));
  // 1. The snapshot the launcher's source tree carries must be the one the binary was built from.
  const current = snapshotInputs(snapshotDir);
  for (const [name, sha] of Object.entries(identity.snapshotInputs ?? {})) {
    if (current[name] === undefined) problems.push(`snapshot input ${name} is missing`);
    else if (current[name] !== sha) problems.push(`snapshot input ${name} changed after the recorded build (stale binary): rebuild the native browser and re-record`);
  }
  for (const name of Object.keys(current)) if (!(name in (identity.snapshotInputs ?? {}))) problems.push(`snapshot input ${name} was not part of the recorded build`);
  // 2. The binary itself must be the recorded build. Size+mtime is a fast exact-file check; any difference hashes.
  if (!existsSync(chrome)) problems.push(`chrome binary not found: ${chrome}`);
  else {
    const stat = statSync(chrome, { bigint: true });
    const fastMatch = Number(stat.size) === identity.chrome?.bytes && typeof identity.chrome?.mtimeNs === "string" && identity.chrome.mtimeNs !== "undefined" && String(stat.mtimeNs) === identity.chrome.mtimeNs;
    if (hashBinary === "always" || (hashBinary === "auto" && !fastMatch)) {
      const sha = await sha256File(chrome);
      if (sha !== identity.chrome?.sha256) problems.push(`chrome binary ${chrome} (sha256 ${sha.slice(0, 16)}…) is not the recorded build (${String(identity.chrome?.sha256).slice(0, 16)}…)`);
    }
  }
  // 3. The daemon bundle the engine will load must be the pinned patched bundle.
  const daemon = pinnedDaemon(engine, repoRoot);
  if (daemon !== null && daemon.sha256 !== null) {
    const file = path.join(repoRoot, daemon.target);
    if (!existsSync(file)) problems.push(`daemon bundle ${daemon.target} is missing (run npm run bootstrap:aside)`);
    else {
      const sha = await sha256File(file);
      if (sha !== daemon.sha256) problems.push(`daemon bundle ${daemon.target} (sha256 ${sha.slice(0, 16)}…) differs from the pinned archive bundle (${daemon.sha256.slice(0, 16)}…)`);
    }
  }
  return { ok: problems.length === 0, problems, identity };
}

function parseArgs(argv) {
  const args = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--chrome") args.chrome = argv[++i];
    else if (argv[i] === "--engine") args.engine = argv[++i];
    else if (argv[i] === "--identity") args.identityFile = argv[++i];
    else if (argv[i] === "--snapshot") args.snapshotDir = argv[++i];
    else if (argv[i] === "--hash") args.hashBinary = "always";
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.chrome || !["record", "verify"].includes(args.command)) { console.error("usage: native-build-identity.mjs record|verify --chrome <binary> [--engine 907] [--hash]"); process.exit(2); }
  if (args.command === "record") {
    const identity = await recordIdentity(args);
    console.log(`[native-identity] recorded ${identity.chrome.sha256.slice(0, 16)}… (${identity.chrome.bytes} bytes) for engine ${identity.engine} in ${args.identityFile ?? IDENTITY_FILE}`);
    process.exit(0);
  }
  const result = await verifyIdentity(args);
  if (result.ok) { console.log(`[native-identity] verified: binary matches the recorded build of snapshot ${result.identity?.chromium?.localHead ?? "?"}`); process.exit(0); }
  const bypass = process.env.BELMONT_BROWSE_ALLOW_UNVERIFIED_NATIVE === "1";
  for (const problem of result.problems) console.error(`[native-identity] ${bypass ? "WARNING" : "REFUSED"}: ${problem}`);
  if (bypass) { console.error("[native-identity] BELMONT_BROWSE_ALLOW_UNVERIFIED_NATIVE=1: launching an unverified native binary; parity claims from this run are invalid"); process.exit(0); }
  process.exit(3);
}
