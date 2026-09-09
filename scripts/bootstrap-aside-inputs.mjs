#!/usr/bin/env node
/**
 * Hydrates the checksum-pinned Aside inputs that the repository checks need but git ignores:
 *  - verifies the untouched original daemon bundles under research-archives/aside/original (Git LFS), and
 *  - places the pinned patched daemon bundles at their belmont-browse/vendor targets when the archive carries them.
 * Nothing else under belmont-browse/vendor is touched. Fails loudly (exit 1) when an input is missing or
 * mismatched instead of letting a later test skip or fail on ENOENT.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
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
  } else {
    report.push({ path: item.path, status: "verified" });
  }
}
for (const row of report) console.log(`[bootstrap-aside] ${row.status}: ${row.path}${row.target ? ` -> ${row.target}` : ""}`);
