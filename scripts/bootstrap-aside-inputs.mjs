#!/usr/bin/env node
/**
 * Hydrates the checksum-pinned Aside inputs that the repository checks need but git ignores:
 *  - verifies the untouched original daemon bundles under research-archives/aside/original (Git LFS), and
 *  - places the pinned patched daemon bundles at their belmont-browse/vendor targets when the archive carries them,
 *  - extracts the pinned extension/vendor archives the browser-harness suites read from fixed paths (only when absent),
 *  - copies the originals to the historical campaign paths some tests still use (only when absent).
 * Nothing else under belmont-browse/vendor is touched. Fails loudly (exit 1) when an input is missing or
 * mismatched instead of letting a later test skip or fail on ENOENT.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = path.join(repo, "research-archives/aside");
const manifest = JSON.parse(await readFile(path.join(archive, "artifacts.json"), "utf8"));

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
async function isLfsPointer(file) {
  const handle = await readFile(file, { encoding: "utf8" });
  return handle.startsWith("version https://git-lfs.github.com/spec/");
}
async function verified(relative, expected) {
  const file = path.join(archive, relative);
  const info = await stat(file).catch(() => null);
  if (info === null) throw new Error(`${relative} is missing from research-archives/aside`);
  if (info.size < 1024 && await isLfsPointer(file)) throw new Error(`${relative} is an un-hydrated Git LFS pointer: run \`git lfs pull\` (CI: actions/checkout with lfs: true)`);
  const actual = await sha256(file);
  if (actual !== expected) throw new Error(`${relative} sha256 ${actual} does not match the pinned ${expected}`);
  return file;
}

const report = [];
for (const item of manifest.artifacts) {
  const file = await verified(item.path, item.sha256);
  if (item.kind === "patched-daemon-bundle") {
    const target = path.join(repo, item.target);
    const current = await stat(target).catch(() => null);
    if (current !== null && await sha256(target) === item.sha256) { report.push({ path: item.path, status: "target already pinned", target: item.target }); continue; }
    if (current !== null && process.env.BELMONT_ASIDE_BOOTSTRAP_OVERWRITE !== "1") {
      // A locally modified vendor bundle is the maintainer's working copy; never clobber it silently.
      report.push({ path: item.path, status: "target differs from the pinned bundle; left untouched (set BELMONT_ASIDE_BOOTSTRAP_OVERWRITE=1 to replace)", target: item.target });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
    if (await sha256(target) !== item.sha256) throw new Error(`copy of ${item.path} to ${item.target} did not verify`);
    report.push({ path: item.path, status: "placed", target: item.target });
  } else if (item.kind === "archive") {
    // Pinned upstream/derived trees the browser-harness suites read from fixed paths: extract once, never overwrite.
    const check = path.join(repo, item.check);
    if (await stat(check).catch(() => null)) { report.push({ path: item.path, status: "already extracted", target: item.extractTo }); continue; }
    const target = path.join(repo, item.extractTo);
    await mkdir(target, { recursive: true });
    const extracted = spawnSync("tar", ["-xzf", file, "-C", target], { encoding: "utf8" });
    if (extracted.status !== 0) throw new Error(`extracting ${item.path} into ${item.extractTo} failed: ${extracted.stderr}`);
    if (!(await stat(check).catch(() => null))) throw new Error(`${item.path} extracted but ${item.check} is still missing`);
    report.push({ path: item.path, status: "extracted", target: item.extractTo });
  } else {
    report.push({ path: item.path, status: "verified" });
    // Tests written against the historical campaign layout read the originals there; provide that path too.
    if (typeof item.legacyPath === "string") {
      const legacy = path.join(repo, item.legacyPath);
      if (await stat(legacy).catch(() => null)) { report.push({ path: item.path, status: "legacy path present", target: item.legacyPath }); continue; }
      await mkdir(path.dirname(legacy), { recursive: true });
      await copyFile(file, legacy);
      if (await sha256(legacy) !== item.sha256) throw new Error(`copy of ${item.path} to ${item.legacyPath} did not verify`);
      report.push({ path: item.path, status: "placed at legacy path", target: item.legacyPath });
    }
  }
}
// Explicit derived build, separate from checksum-pinned hydration. Example:
// BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE=909 npm run bootstrap:aside
// The selected archive is verified above, and the pinned target is never
// replaced by this transform. Canonical runtime loads its sibling artifact.
const canonicalMemoryEngine = process.env.BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE?.trim();
if (canonicalMemoryEngine) {
  if (!/^[0-9]{3}$/.test(canonicalMemoryEngine)) throw new Error("BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE must be a three-digit engine identifier");
  const item = manifest.artifacts.find((entry) => entry.kind === "patched-daemon-bundle" && entry.target?.includes(`/aside-${canonicalMemoryEngine}/`));
  if (!item) throw new Error(`No pinned patched daemon for canonical memory engine ${canonicalMemoryEngine}`);
  const source = await verified(item.path, item.sha256);
  const generatorRelative = "belmont-browse/tools/patch-daemon-canonical-memory.py";
  const generator = path.join(repo, generatorRelative);
  const targetRelative = item.target.replace(/daemon\.mjs$/, "daemon.memory-2.1.mjs");
  if (targetRelative === item.target) throw new Error("Canonical memory output must be separate from the pinned daemon");
  const target = path.join(repo, targetRelative);
  await mkdir(path.dirname(target), { recursive: true });
  const generated = spawnSync("python3", [generator, source, target], { encoding: "utf8" });
  if (generated.status !== 0) throw new Error(`Canonical memory daemon transform failed: ${generated.stderr || generated.error?.message || "unknown failure"}`);
  const lineage = { schemaVersion: 1, engine: canonicalMemoryEngine, authority: "belmont", protocolVersion: 1,
    input: { path: item.path, sha256: item.sha256 }, generator: { path: generatorRelative, sha256: await sha256(generator) },
    output: { path: targetRelative, sha256: await sha256(target) } };
  await writeFile(`${target}.lineage.json`, `${JSON.stringify(lineage, null, 2)}\n`, { mode: 0o600 });
  report.push({ path: item.path, status: "derived canonical memory daemon", target: targetRelative });
}
for (const row of report) console.log(`[bootstrap-aside] ${row.status}: ${row.path}${row.target ? ` -> ${row.target}` : ""}`);
