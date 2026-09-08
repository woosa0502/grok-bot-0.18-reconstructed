import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, readlink, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { extractFile, listPackage, statFile } from "@electron/asar";

import { repoRoot } from "./config.mjs";
import { run } from "./process.mjs";

const unpackedPrefixes = ["dist/deps/", "dist/native/", "dist/node-deps/", "dist/host/node_modules/"];

async function walkFiles(root, current = root) {
  const found = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(root, target));
    else if (entry.isFile() || entry.isSymbolicLink()) found.push(path.relative(root, target).split(path.sep).join("/"));
  }
  return found.sort();
}

async function sha256(target) {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}

function isUnpackedRuntimeFile(relative) {
  return unpackedPrefixes.some(prefix => relative === prefix.slice(0, -1) || relative.startsWith(prefix));
}

async function snapshotFiles(root) {
  const files = await walkFiles(root);
  return new Map(await Promise.all(files.map(async relative => {
    const target = path.join(root, relative);
    if ((await lstat(target)).isSymbolicLink()) {
      const rawLink = await readlink(target);
      const link = path.relative(root, path.resolve(path.dirname(target), rawLink)).split(path.sep).join("/");
      if (path.isAbsolute(rawLink) || link === ".." || link.startsWith("../")) throw new Error(`Staged symlink escapes package: ${relative}`);
      return [relative, { link, rawLink }];
    }
    return [relative, { bytes: (await stat(target)).size, sha256: await sha256(target) }];
  })));
}

function snapshotDiff(before, after) {
  const differences = [];
  for (const [relative, expected] of before) {
    const actual = after.get(relative);
    if (actual == null) differences.push({ relative, kind: "removed", expected });
    else if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || actual.link !== expected.link || actual.rawLink !== expected.rawLink) differences.push({ relative, kind: "staged-mutation", expected, actual });
  }
  for (const [relative, actual] of after) if (!before.has(relative)) differences.push({ relative, kind: "added", actual });
  return differences;
}

async function archiveFileEntries(archivePath) {
  const entries = new Map();
  for (const raw of listPackage(archivePath)) {
    const relative = raw.replace(/^\//, "");
    try {
      const entry = statFile(archivePath, relative, false);
      if (typeof entry.size === "number" || typeof entry.link === "string") entries.set(relative, entry);
    } catch {
      // listPackage includes directories; statFile is the file boundary.
    }
  }
  return entries;
}

export async function verifyStagedPackageIntegrity({ stageRoot, archivePath, unpackedRoot, before }) {
  const after = await snapshotFiles(stageRoot);
  const differences = snapshotDiff(before, after);
  const archive = await archiveFileEntries(archivePath);
  for (const [relative, expected] of before) {
    const entry = archive.get(relative);
    if (entry == null) {
      differences.push({ relative, kind: "missing-archive-entry", expected });
      continue;
    }
    if (isUnpackedRuntimeFile(relative) && entry.unpacked !== true) differences.push({ relative, kind: "missing-unpacked-metadata", expected, actual: entry });
    if (expected.link !== undefined) {
      if (entry.link !== expected.link) differences.push({ relative, kind: "archive-link-mutation", expected, actual: entry });
      if (isUnpackedRuntimeFile(relative)) {
        try {
          const unpackedFile = path.join(unpackedRoot, relative);
          const rawLink = await readlink(unpackedFile);
          if (rawLink !== expected.rawLink) differences.push({ relative, kind: "unpacked-link-mutation", expected, actual: { rawLink } });
          const root = await realpath(unpackedRoot);
          const resolved = await realpath(unpackedFile);
          if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) differences.push({ relative, kind: "unpacked-link-escape", expected, actual: { resolved } });
        } catch {
          differences.push({ relative, kind: "missing-unpacked-link", expected });
        }
      }
      continue;
    }
    if (entry.size !== expected.bytes || entry.integrity?.hash !== expected.sha256) {
      differences.push({ relative, kind: isUnpackedRuntimeFile(relative) ? "unpacked-archive-metadata" : "archive-mutation", expected, actual: { bytes: entry.size, sha256: entry.integrity?.hash } });
    }
    if (!isUnpackedRuntimeFile(relative)) {
      try {
        const payload = extractFile(archivePath, relative);
        const actual = { bytes: payload.byteLength, sha256: createHash("sha256").update(payload).digest("hex") };
        if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) differences.push({ relative, kind: "packed-payload-mutation", expected, actual });
      } catch (error) {
        differences.push({ relative, kind: "packed-payload-read", expected, error: String(error) });
      }
    }
    if (isUnpackedRuntimeFile(relative)) {
      const unpackedFile = path.join(unpackedRoot, relative);
      try {
        if (!(await lstat(unpackedFile)).isFile()) {
          differences.push({ relative, kind: "unpacked-file-layout", expected });
          continue;
        }
        const physicalRelative = path.relative(await realpath(unpackedRoot), await realpath(unpackedFile));
        if (path.isAbsolute(physicalRelative) || physicalRelative === ".." || physicalRelative.startsWith(`..${path.sep}`)) {
          differences.push({ relative, kind: "unpacked-file-escape", expected });
          continue;
        }
        const actual = { bytes: (await stat(unpackedFile)).size, sha256: await sha256(unpackedFile) };
        if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) differences.push({ relative, kind: "unpacked-mutation", expected, actual });
      } catch {
        differences.push({ relative, kind: "missing-unpacked-entry", expected });
      }
    }
  }
  for (const relative of archive.keys()) if (!before.has(relative)) differences.push({ relative, kind: "stale-archive-entry", actual: archive.get(relative) });
  if (differences.length > 0) throw new Error(`Staged package changed or ASAR drifted after snapshot: ${JSON.stringify(differences)}`);
  return { fileCount: before.size, archiveFileCount: archive.size };
}

export async function packStagedAppWithIntegrity({
  stageRoot,
  archivePath,
  unpackedRoot,
  asarCli = path.join(repoRoot, "node_modules", "@electron", "asar", "bin", "asar.mjs"),
} = {}) {
  if (stageRoot == null || archivePath == null || unpackedRoot == null) {
    throw new TypeError("packStagedAppWithIntegrity requires explicit stageRoot, archivePath, and unpackedRoot outputs");
  }
  const before = await snapshotFiles(stageRoot);
  const outputDirectory = path.dirname(path.resolve(archivePath));
  const temporaryDirectory = await mkdtemp(path.join(outputDirectory, `.${path.basename(archivePath)}.pack-`));
  const temporaryArchive = path.join(temporaryDirectory, path.basename(archivePath));
  const temporaryUnpacked = `${temporaryArchive}.unpacked`;
  const previousArchive = path.join(temporaryDirectory, `${path.basename(archivePath)}.previous`);
  const previousUnpacked = path.join(temporaryDirectory, `${path.basename(unpackedRoot)}.previous`);
  const exists = async target => {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  };
  const hadArchive = await exists(archivePath);
  const hadUnpacked = await exists(unpackedRoot);

  try {
    await run(process.execPath, [asarCli, "pack", stageRoot, temporaryArchive, "--unpack-dir", "dist/{deps,native,node-deps,host/node_modules}"]);
    await verifyStagedPackageIntegrity({
      stageRoot,
      archivePath: temporaryArchive,
      unpackedRoot: temporaryUnpacked,
      before,
    });

    let archivedPrevious = false;
    let unpackedPrevious = false;
    try {
      if (hadArchive) {
        await rename(archivePath, previousArchive);
        archivedPrevious = true;
      }
      if (hadUnpacked) {
        await rename(unpackedRoot, previousUnpacked);
        unpackedPrevious = true;
      }
      await rename(temporaryArchive, archivePath);
      if (await exists(temporaryUnpacked)) await rename(temporaryUnpacked, unpackedRoot);
      else await rm(unpackedRoot, { recursive: true, force: true });
      const result = await verifyStagedPackageIntegrity({ stageRoot, archivePath, unpackedRoot, before });
      await rm(previousArchive, { force: true });
      await rm(previousUnpacked, { recursive: true, force: true });
      return { ...result, before };
    } catch (error) {
      await rm(archivePath, { force: true });
      await rm(unpackedRoot, { recursive: true, force: true });
      if (unpackedPrevious && await exists(previousUnpacked)) await rename(previousUnpacked, unpackedRoot);
      if (archivedPrevious && await exists(previousArchive)) await rename(previousArchive, archivePath);
      throw error;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
