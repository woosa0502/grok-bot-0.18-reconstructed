import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const archive = path.join(repo, "research-archives/aside");

/** Pinned upstream Aside inputs (see research-archives/aside/artifacts.json). */
export const ASIDE_ORIGINALS = {
  "1.26.906.1714": { archived: "original/AsideDaemon-mac-x64-1.26.906.1714.mjs", legacy: "data/artifacts/aside-restoration_20260907T041632Z/raw/AsideDaemon-mac-x64-1.26.906.1714.mjs" },
  "1.26.907.1712": { archived: "original/AsideDaemon-mac-x64-1.26.907.1712.mjs", legacy: "data/artifacts/aside-full-restoration_20260907T225545Z/raw/AsideDaemon-mac-x64-1.26.907.1712.mjs" },
};

function isLfsPointer(file) {
  const head = readFileSync(file, { encoding: "utf8", flag: "r" }).slice(0, 64);
  return head.startsWith("version https://git-lfs.github.com/spec/");
}

function pinnedSha256(relative) {
  const sums = readFileSync(path.join(archive, "SHA256SUMS"), "utf8");
  const line = sums.split("\n").find((entry) => entry.trim().endsWith(`  ${relative}`));
  return line?.trim().split(/\s+/)[0] ?? null;
}

/**
 * Resolves the untouched original daemon bundle for a pinned version: the LFS-hydrated archive copy
 * (checksum verified) first, then the historical campaign path kept on the maintainer's machine.
 * Missing inputs fail loudly with the bootstrap instruction instead of silently skipping.
 */
export function resolveAsideOriginal(version) {
  const entry = ASIDE_ORIGINALS[version];
  if (entry === undefined) throw new Error(`unknown pinned Aside version ${version}`);
  const archived = path.join(archive, entry.archived);
  if (existsSync(archived) && !isLfsPointer(archived)) {
    const expected = pinnedSha256(entry.archived);
    const actual = createHash("sha256").update(readFileSync(archived)).digest("hex");
    if (expected !== null && expected !== actual) throw new Error(`${archived} does not match research-archives/aside/SHA256SUMS (${actual} != ${expected})`);
    return archived;
  }
  const legacy = path.join(repo, entry.legacy);
  if (existsSync(legacy)) return legacy;
  throw new Error(`pinned Aside original ${entry.archived} is missing: run \`git lfs pull\` (or \`npm run bootstrap:aside\`) so research-archives/aside is hydrated`);
}
