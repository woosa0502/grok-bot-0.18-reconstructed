#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_VERSION = "1.26.907.1712";
export const COMPONENTS = Object.freeze([
  Object.freeze({ token: "agent-manager", publicKeySha256: "5937f713b59e6e13e5e006dbdae813645ecc89b0c557b1ce78a2173c2a3ef059", extensionId: "fjdhphbdlfjogobdofoaagnlnkoibdge" }),
  Object.freeze({ token: "password-manager", publicKeySha256: "2b23680c486cb921aa2198b98dc5ad2ba6b256323517ed001ee92678d42a6e4b", extensionId: "clcdgiameigmljcbkkcbjiljinmfkncl" }),
]);

function validVersion(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value)
    && value.split(".").every((part) => Number(part) <= 65535);
}
function compareVersions(left, right) {
  const a = left.split(".").map(Number), b = right.split(".").map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
async function plainDirectory(directory, create = false) {
  if (create) await mkdir(directory, { recursive: true });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Not a plain directory: ${directory}`);
}
const execFileAsync = promisify(execFile);
// Node rename() can overwrite a concurrently created empty directory. Linux's
// RENAME_NOREPLACE closes that race; use the existing system Python standard
// library rather than building or installing a native dependency.
const RENAME_NOREPLACE = `import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
try:
    renameat2 = libc.renameat2
except AttributeError:
    sys.exit("renameat2 is unavailable; refusing an unsafe replacement")
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
if renameat2(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1):
    number = ctypes.get_errno()
    sys.exit("Atomic install refused (errno %d): %s" % (number, os.strerror(number)))
`;
async function renameWithoutReplacement(source, target) {
  try {
    await execFileAsync("/usr/bin/python3", ["-c", RENAME_NOREPLACE, source, target]);
  } catch (error) {
    throw new Error(`Could not install; target preserved: ${target}: ${error.stderr?.trim() || error.code || "atomic rename failed"}`);
  }
}
async function exists(target) {
  try { await lstat(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function fileHash(filename) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(filename)) hash.update(data);
  return hash.digest("hex");
}
async function inventory(directory) {
  await plainDirectory(directory);
  const entries = [];
  let fileCount = 0;
  async function walk(current, prefix = "") {
    for (const name of (await readdir(current)).sort()) {
      const filename = path.join(current, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = await lstat(filename);
      if (stat.isSymbolicLink()) throw new Error(`Symlink is not a component payload: ${filename}`);
      if (stat.isDirectory()) { entries.push([relative, "directory"]); await walk(filename, relative); }
      else if (stat.isFile()) { entries.push([relative, "file", await fileHash(filename)]); fileCount++; }
      else throw new Error(`Unsupported component payload: ${filename}`);
    }
  }
  await walk(directory);
  return { fileCount, treeSha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}
async function validateSource(source, component, version) {
  await plainDirectory(path.dirname(source));
  await plainDirectory(source);
  const manifestPath = path.join(source, "manifest.json");
  const stat = await lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid manifest file: ${manifestPath}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== version) throw new Error(`Manifest version mismatch: ${source}`);
  const key = manifest.key;
  if (typeof key !== "string" || Buffer.from(key, "base64").toString("base64") !== key) throw new Error(`Invalid public key encoding: ${source}`);
  const publicKeySha256 = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex");
  const extensionId = [...publicKeySha256.slice(0, 32)].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
  if (publicKeySha256 !== component.publicKeySha256 || extensionId !== component.extensionId) throw new Error(`Original component identity mismatch: ${source}`);
  return inventory(source);
}

/** Install complete local payloads; never modify manifests, installed versions, or user storage. */
export async function prepareNativeComponents({ sourceRoot, profileDir, version = DEFAULT_VERSION } = {}) {
  if (!sourceRoot || !profileDir) throw new Error("sourceRoot and profileDir are required");
  if (!validVersion(version)) throw new Error("Invalid component version");
  sourceRoot = path.resolve(sourceRoot);
  profileDir = path.resolve(profileDir);
  await plainDirectory(sourceRoot);
  // Validate both sources before writing any profile-side component payload.
  const plans = [];
  for (const component of COMPONENTS) {
    const source = path.join(sourceRoot, component.token, version);
    plans.push({ ...component, source, ...(await validateSource(source, component, version)) });
  }
  await plainDirectory(profileDir, true);
  const componentRoot = path.join(profileDir, "aside_component");
  await plainDirectory(componentRoot, true);
  const locks = [], stages = [];
  try {
    for (const plan of plans) {
      plan.parent = path.join(componentRoot, plan.token);
      plan.target = path.join(plan.parent, version);
      await plainDirectory(plan.parent, true);
      const lock = path.join(plan.parent, `.prepare-${version}.lock`);
      await mkdir(lock); // Exclusive: a concurrent preparation must retry, never overwrite.
      locks.push(lock);
      plan.higherVersions = (await readdir(plan.parent, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && validVersion(entry.name) && compareVersions(entry.name, version) > 0)
        .map((entry) => entry.name).sort(compareVersions);
      if (await exists(plan.target)) {
        const existing = await inventory(plan.target);
        if (existing.treeSha256 !== plan.treeSha256) throw new Error(`Existing version differs; preserved: ${plan.target}`);
        plan.status = "unchanged";
      }
    }
    for (const plan of plans) {
      if (plan.status === "unchanged") continue;
      const staging = await mkdtemp(path.join(plan.parent, `.prepare-${version}-`));
      stages.push(staging);
      const payload = path.join(staging, "payload");
      await cp(plan.source, payload, { recursive: true, dereference: false, errorOnExist: true, force: false });
      const copied = await validateSource(payload, plan, version);
      if (copied.treeSha256 !== plan.treeSha256) throw new Error(`Component changed during copy: ${plan.source}`);
      plan.payload = payload;
    }
    for (const plan of plans) {
      if (plan.status === "unchanged") continue;
      // A component updater is not covered by this tool's lock: preserve any target it creates.
      if (await exists(plan.target)) throw new Error(`Target appeared during preparation; preserved: ${plan.target}`);
      await renameWithoutReplacement(plan.payload, plan.target);
      plan.status = "installed";
    }
    return { profileDir, version, components: plans.map(({ token, target, fileCount, treeSha256, publicKeySha256, extensionId, higherVersions, status }) => ({ token, path: target, version, status, fileCount, treeSha256, publicKeySha256, extensionId, higherVersions })) };
  } finally {
    for (const stage of stages.reverse()) await rm(stage, { recursive: true, force: true });
    for (const lock of locks.reverse()) await rm(lock, { recursive: true, force: true });
  }
}

export function parseArgs(args) {
  const options = {};
  const names = { "--source-root": "sourceRoot", "--profile-dir": "profileDir", "--version": "version" };
  for (let index = 0; index < args.length; index++) {
    const name = names[args[index]];
    if (!name || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Usage: prepare-native-components.mjs --source-root PATH --profile-dir PATH [--version VERSION]");
    options[name] = args[++index];
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareNativeComponents(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
