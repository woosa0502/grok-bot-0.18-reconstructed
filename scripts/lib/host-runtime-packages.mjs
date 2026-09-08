import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./config.mjs";

export const hostRuntimePackageSpecs = Object.freeze([
  Object.freeze({
    name: "@earendil-works/pi-coding-agent",
    version: "0.84.3",
    lockPath: "node_modules/@earendil-works/pi-coding-agent",
    path: "dist/host/node_modules/@earendil-works/pi-coding-agent",
    integrity: "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==",
  }),
]);

const sha256 = value => createHash("sha256").update(value).digest("hex");
const normalize = value => value.split(path.sep).join("/");
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const dependencyEntries = value => JSON.stringify(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));

async function inventory(root, current = root) {
  const entries = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    const relative = normalize(path.relative(root, target));
    if (entry.isDirectory()) {
      entries.push(...await inventory(root, target));
    } else if (entry.isFile()) {
      const bytes = await readFile(target);
      entries.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    } else if (entry.isSymbolicLink()) {
      const link = await readlink(target);
      const resolved = await realpath(target);
      if (path.isAbsolute(link) || !inside(root, resolved)) {
        throw new Error(`Host runtime package symlink escapes its package: ${relative}`);
      }
      entries.push({ path: relative, link });
    } else {
      throw new Error(`Unsupported host runtime package entry: ${relative}`);
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function validateEmbeddedLock(source, spec, lockfile, metadata) {
  const shrinkwrapBytes = await readFile(path.join(source, "npm-shrinkwrap.json"));
  const shrinkwrap = JSON.parse(shrinkwrapBytes);
  if (shrinkwrap.packages?.[""]?.name !== spec.name || shrinkwrap.packages[""].version !== spec.version) {
    throw new Error(`Host runtime shrinkwrap drifted: ${spec.name}@${spec.version}.`);
  }
  const rootLock = lockfile.packages[spec.lockPath];
  for (const field of ["dependencies", "optionalDependencies"]) {
    if (dependencyEntries(metadata[field]) !== dependencyEntries(rootLock[field])
      || dependencyEntries(shrinkwrap.packages[""][field]) !== dependencyEntries(rootLock[field])) {
      throw new Error(`Host runtime dependency declarations drifted: ${spec.name} ${field}`);
    }
  }
  const lockPrefix = `${spec.lockPath}/`;
  const outerPaths = Object.keys(lockfile.packages).filter(relative => relative.startsWith(lockPrefix)).map(relative => relative.slice(lockPrefix.length)).sort();
  const embeddedPaths = Object.keys(shrinkwrap.packages).filter(relative => relative !== "").sort();
  if (JSON.stringify(outerPaths) !== JSON.stringify(embeddedPaths)) throw new Error(`Host runtime embedded lock inventory drifted: ${spec.name}`);
  const packages = [];
  for (const [relative, expected] of Object.entries(shrinkwrap.packages)) {
    if (relative === "") continue;
    if (!relative.startsWith("node_modules/") || path.posix.normalize(relative) !== relative || relative.includes("\\")) {
      throw new Error(`Invalid embedded host runtime package path: ${relative}`);
    }
    const locked = lockfile.packages?.[`${spec.lockPath}/${relative}`];
    if (locked?.version !== expected.version || locked?.integrity !== expected.integrity) {
      throw new Error(`Embedded host runtime package lock drifted: ${relative}`);
    }
    let metadata;
    try {
      metadata = JSON.parse(await readFile(path.join(source, relative, "package.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" && expected.optional === true && locked.optional === true) {
        packages.push({ path: relative, version: expected.version, optional: true, installed: false });
        continue;
      }
      throw new Error(`Missing or invalid embedded host runtime package: ${relative}`, { cause: error });
    }
    if (metadata.version !== expected.version) throw new Error(`Installed embedded host runtime package drifted: ${relative}`);
    packages.push({ path: relative, version: metadata.version, integrity: locked.integrity, installed: true });
  }
  return { shrinkwrapSha256: sha256(shrinkwrapBytes), embeddedPackages: packages };
}

/** Preserve Pi's shrinkwrapped nested tree instead of flattening its runtime versions. */
export async function materializeHostRuntimePackages({ outputRoot, sourceRoot = repoRoot } = {}) {
  if (typeof outputRoot !== "string" || outputRoot.length === 0) throw new TypeError("An explicit host runtime outputRoot is required.");
  const packageJson = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  const lockfile = JSON.parse(await readFile(path.join(sourceRoot, "package-lock.json"), "utf8"));
  const packages = [];
  const files = [];
  const roots = [];
  for (const spec of hostRuntimePackageSpecs) {
    const locked = lockfile.packages?.[spec.lockPath];
    if (packageJson.dependencies?.[spec.name] !== spec.version
      || locked?.version !== spec.version
      || locked.integrity !== spec.integrity
      || locked.hasShrinkwrap !== true) {
      throw new Error(`Clean host requires the locked ${spec.name}@${spec.version} dependency.`);
    }
    const source = path.resolve(sourceRoot, spec.lockPath);
    if ((await lstat(source)).isSymbolicLink()) throw new Error(`Host runtime package must be installed locally: ${spec.name}`);
    const metadata = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    if (metadata.name !== spec.name || metadata.version !== spec.version) throw new Error(`Installed host runtime package drifted: ${spec.name}`);
    const embedded = await validateEmbeddedLock(source, spec, lockfile, metadata);
    const sourceEntries = await inventory(source);
    const destination = path.resolve(outputRoot, spec.path);
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true });
    const entries = await inventory(destination);
    if (JSON.stringify(entries) !== JSON.stringify(sourceEntries)) throw new Error(`Host runtime package copy drifted: ${spec.name}`);
    const packageFiles = entries.filter(entry => entry.link === undefined).map(entry => path.posix.join(spec.path, entry.path));
    files.push(...packageFiles);
    roots.push(spec.path);
    packages.push({
      name: spec.name,
      version: spec.version,
      integrity: spec.integrity,
      path: spec.path,
      ...embedded,
      files: packageFiles.length,
      symlinks: entries.filter(entry => entry.link !== undefined),
      inventorySha256: sha256(JSON.stringify(entries)),
    });
  }
  return { packages, files: files.sort(), roots: roots.sort() };
}
