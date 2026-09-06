import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { repoRoot } from "./lib/config.mjs";
import { verifyMobileSourceInputs } from "./lib/mobile-source-inputs.mjs";
import { assertSupportedNodeRuntime } from "./lib/wsl-runtime.mjs";

// Validation always owns a fresh output directory. It never replaces the dist
// served by a mobile process or loads the user's pairing/profile state.
assertSupportedNodeRuntime();
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--tests-only") || args.length > 1) throw new Error("Supported option: --tests-only");
const testsOnly = args.includes("--tests-only");
const mobileRoot = path.join(repoRoot, "grok-mobile-belmont-pwa");
const inputs = await verifyMobileSourceInputs(mobileRoot);
async function servingDistSnapshot() {
  const root = path.join(mobileRoot, "dist");
  if (!await lstat(root).catch(error => { if (error.code === "ENOENT") return null; throw error; })) return null;
  const hash = createHash("sha256");
  async function visit(target) {
    const info = await lstat(target);
    hash.update(`${path.relative(root, target)}\0`);
    if (info.isSymbolicLink()) hash.update(`link:${await readlink(target)}`);
    else if (info.isDirectory()) {
      for (const name of (await readdir(target)).sort()) await visit(path.join(target, name));
    } else if (info.isFile()) hash.update(await readFile(target));
    hash.update("\0");
  }
  await visit(root);
  return hash.digest("hex");
}
const servingDistBefore = await servingDistSnapshot();
const validationRoot = path.join(repoRoot, ".build", "mobile-validation");
await mkdir(validationRoot, { recursive: true });
const outputRoot = await mkdtemp(path.join(validationRoot, "run-"));
const environment = {
  ...process.env,
  GROK_MOBILE_SESSION_FILE: "",
  BELMONT_PROFILE_DIR: path.join(outputRoot, "test-profile"),
};
async function node(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: mobileRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Mobile check failed: ${args[0]} (${signal ?? code})`)));
  });
}
const tests = (await readdir(path.join(mobileRoot, "tests"))).filter(name => name.endsWith(".test.mjs")).sort();
await node(["--test", ...tests.map(name => path.join("tests", name))]);
if (!testsOnly) {
  await node([path.join(repoRoot, "node_modules/typescript/bin/tsc"), "--noEmit"]);
  await node([path.join(repoRoot, "node_modules/vite/bin/vite.js"), "build", "--outDir", path.join(outputRoot, "dist")]);
}
const servingDistAfter = await servingDistSnapshot();
if (servingDistBefore !== servingDistAfter) throw new Error("The serving dist changed during validation; do not treat this run as isolated.");
await writeFile(path.join(outputRoot, "validation.json"), `${JSON.stringify({ ...inputs, testFiles: tests.length, node: process.version, outputRoot, testsOnly, servingDistBefore, servingDistAfter, servingDistUnchanged: true }, null, 2)}\n`);
console.log(`Mobile source validation passed: ${outputRoot}`);
