import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getRawHeader, statFile } from "@electron/asar";

import { compositionAuditPath } from "../scripts/audit-runtime-composition.mjs";
import { overlayAuditMetadata } from "../scripts/clean-build.mjs";
import { hostBindingProvenancePath } from "../scripts/host-production-activation.mjs";
import { packStagedAppWithIntegrity, verifyStagedPackageIntegrity } from "../scripts/lib/asar-integrity.mjs";
import { hostRuntimePackageSpecs, materializeHostRuntimePackages } from "../scripts/lib/host-runtime-packages.mjs";

const spec = hostRuntimePackageSpecs[0];

async function temporary(t) {
  const root = await mkdtemp(path.join(process.env.BELMONT_RUNTIME_PACKAGE_TEST_ROOT ?? tmpdir(), "belmont-host-packages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function put(root, relative, contents) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function fixture(root) {
  const sourceRoot = path.join(root, "source");
  const packageRoot = path.join(sourceRoot, spec.lockPath);
  const dependency = { version: "1.2.3", integrity: "sha512-test-fixture" };
  const metadata = { name: spec.name, version: spec.version, type: "module", exports: { ".": { import: "./dist/index.js" } }, dependencies: { leaf: "1.2.3" } };
  const lock = {
    packages: {
      [spec.lockPath]: { version: spec.version, integrity: spec.integrity, hasShrinkwrap: true, dependencies: metadata.dependencies },
      [`${spec.lockPath}/node_modules/leaf`]: dependency,
    },
  };
  await put(sourceRoot, "package.json", JSON.stringify({ dependencies: { [spec.name]: spec.version } }));
  await put(sourceRoot, "package-lock.json", JSON.stringify(lock));
  await put(packageRoot, "package.json", JSON.stringify(metadata));
  await put(packageRoot, "npm-shrinkwrap.json", JSON.stringify({ packages: { "": metadata, "node_modules/leaf": dependency } }));
  await put(packageRoot, "dist/index.js", 'export { version } from "leaf";\n');
  await put(packageRoot, "node_modules/leaf/package.json", JSON.stringify({ name: "leaf", version: "1.2.3", type: "module", exports: "./index.js" }));
  await put(packageRoot, "node_modules/leaf/index.js", 'export const version = "1.2.3";\n');
  await put(packageRoot, "node_modules/leaf/native/addon.node", Buffer.from([1, 2, 3, 4]));
  await put(packageRoot, "node_modules/leaf/model.wasm", Buffer.from([0, 97, 115, 109]));
  await mkdir(path.join(packageRoot, "node_modules/.bin"), { recursive: true });
  await symlink("../leaf/index.js", path.join(packageRoot, "node_modules/.bin/leaf"));
  return { sourceRoot, packageRoot, lock };
}

test("host staging preserves nested runtime versions, native resources, and relative links through the shared overlay", async t => {
  const root = await temporary(t);
  const { sourceRoot } = await fixture(root);
  const outputRoot = path.join(root, "output");
  const runtime = await materializeHostRuntimePackages({ outputRoot, sourceRoot });
  assert.deepEqual(runtime.roots, [spec.path]);
  assert.equal(runtime.packages[0].embeddedPackages[0].version, "1.2.3");
  assert.deepEqual(runtime.packages[0].symlinks, [{ path: "node_modules/.bin/leaf", link: "../leaf/index.js" }]);
  for (const relative of [compositionAuditPath, "dist/reconstruction-build.json", hostBindingProvenancePath]) await put(outputRoot, relative, "{}\n");
  await put(outputRoot, "dist/host/host-main.cjs", "// fixture host\n");
  const stageRoot = path.join(root, "stage");
  await overlayAuditMetadata({
    outputRoot,
    hostActivation: { clean: true, runtimePackageFiles: runtime.files, runtimePackageRoots: runtime.roots },
    electronMainActivation: { clean: false },
  }, { stageRoot });
  assert.equal(await readlink(path.join(stageRoot, spec.path, "node_modules/.bin/leaf")), "../leaf/index.js");
  assert.deepEqual(await readFile(path.join(stageRoot, spec.path, "node_modules/leaf/model.wasm")), Buffer.from([0, 97, 115, 109]));
  assert.deepEqual(await readFile(path.join(stageRoot, spec.path, "node_modules/leaf/native/addon.node")), Buffer.from([1, 2, 3, 4]));
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", 'const packageUrl = new URL("./dist/host/node_modules/@earendil-works/pi-coding-agent/dist/index.js", `file://${process.cwd()}/`); console.log((await import(packageUrl)).version);'], { cwd: stageRoot, encoding: "utf8" });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), "1.2.3");
});

test("host package staging rejects missing required and drifted embedded lock records", async t => {
  const root = await temporary(t);
  const { sourceRoot, packageRoot, lock } = await fixture(root);
  const outputRoot = path.join(root, "output");
  await rm(path.join(packageRoot, "node_modules/leaf/package.json"));
  await assert.rejects(materializeHostRuntimePackages({ outputRoot, sourceRoot }), /Missing or invalid embedded host runtime package: node_modules\/leaf/);
  await put(packageRoot, "node_modules/leaf/package.json", JSON.stringify({ name: "leaf", version: "1.2.3" }));
  lock.packages[`${spec.lockPath}/node_modules/leaf`].version = "9.9.9";
  await put(sourceRoot, "package-lock.json", JSON.stringify(lock));
  await assert.rejects(materializeHostRuntimePackages({ outputRoot, sourceRoot }), /Embedded host runtime package lock drifted/);
});

test("host package staging rejects an escaping installed symlink", async t => {
  const root = await temporary(t);
  const { sourceRoot, packageRoot } = await fixture(root);
  await put(root, "outside.js", "export default 1;\n");
  await symlink(path.join(root, "outside.js"), path.join(packageRoot, "external.js"));
  await assert.rejects(materializeHostRuntimePackages({ outputRoot: path.join(root, "output"), sourceRoot }), /symlink escapes its package/);
});

test("host staging cannot hide a required dependency by removing its shrinkwrap record", async t => {
  const root = await temporary(t);
  const { sourceRoot, packageRoot } = await fixture(root);
  const shrinkwrap = JSON.parse(await readFile(path.join(packageRoot, "npm-shrinkwrap.json"), "utf8"));
  delete shrinkwrap.packages["node_modules/leaf"];
  await put(packageRoot, "npm-shrinkwrap.json", JSON.stringify(shrinkwrap));
  await rm(path.join(packageRoot, "node_modules/leaf"), { recursive: true, force: true });
  await assert.rejects(materializeHostRuntimePackages({ outputRoot: path.join(root, "output"), sourceRoot }), /embedded lock inventory drifted/);
});

test("macOS sidecar copy keeps runtime links readable after the build directory moves", async t => {
  const root = await temporary(t);
  const builtAsarUnpacked = path.join(root, "build.asar.unpacked");
  const packagedUnpacked = path.join(root, "packaged.asar.unpacked");
  const linkRelative = `${spec.path}/node_modules/.bin/leaf`;
  const targetRelative = `${spec.path}/node_modules/leaf/index.js`;
  const payload = 'export const version = "sidecar-copy-control";\n';
  await put(builtAsarUnpacked, targetRelative, payload);
  await mkdir(path.dirname(path.join(builtAsarUnpacked, linkRelative)), { recursive: true });
  await symlink("../leaf/index.js", path.join(builtAsarUnpacked, linkRelative));

  // Execute the production copy statement without invoking the macOS signing entrypoint.
  const source = await readFile(new URL("../scripts/package-macos.mjs", import.meta.url), "utf8");
  const copyStatement = source.match(/await cp\(builtAsarUnpacked, packagedUnpacked, \{[\s\S]*?\}\);/)?.[0];
  assert.ok(copyStatement, "macOS package sidecar copy statement must be present");
  const copySidecar = new Function("cp", "builtAsarUnpacked", "packagedUnpacked", `return (async () => { ${copyStatement} })();`);
  await copySidecar(cp, builtAsarUnpacked, packagedUnpacked);
  await rename(builtAsarUnpacked, path.join(root, "moved-build.asar.unpacked"));

  assert.equal(await readlink(path.join(packagedUnpacked, linkRelative)), "../leaf/index.js");
  assert.equal(await readFile(path.join(packagedUnpacked, linkRelative), "utf8"), payload);
  assert.equal(await readFile(path.join(packagedUnpacked, targetRelative), "utf8"), payload);
});

test("ASAR retains host closure bytes and links outside the archive and rejects later native mutation", async t => {
  const root = await temporary(t);
  const { sourceRoot } = await fixture(root);
  const stageRoot = path.join(root, "stage");
  await materializeHostRuntimePackages({ outputRoot: stageRoot, sourceRoot });
  await put(stageRoot, "package.json", '{"name":"host-runtime-fixture","version":"1.0.0"}\n');
  const archivePath = path.join(root, "app.asar");
  const unpackedRoot = `${archivePath}.unpacked`;
  const packed = await packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot });
  const nativePath = `${spec.path}/node_modules/leaf/native/addon.node`;
  const wasmPath = `${spec.path}/node_modules/leaf/model.wasm`;
  assert.equal(statFile(archivePath, nativePath).unpacked, true);
  assert.equal(statFile(archivePath, wasmPath).unpacked, true);
  assert.equal(await readlink(path.join(unpackedRoot, spec.path, "node_modules/.bin/leaf")), "../leaf/index.js");
  await put(unpackedRoot, nativePath, Buffer.from([4, 3, 2, 1]));
  await assert.rejects(verifyStagedPackageIntegrity({ stageRoot, archivePath, unpackedRoot, before: packed.before }), /unpacked-mutation/);
  await put(root, "external.node", Buffer.from([1, 2, 3, 4]));
  await rm(path.join(unpackedRoot, nativePath));
  await symlink(path.join(root, "external.node"), path.join(unpackedRoot, nativePath));
  await assert.rejects(verifyStagedPackageIntegrity({ stageRoot, archivePath, unpackedRoot, before: packed.before }), /unpacked-file-layout/);
});

test("ASAR rejects runtime links whose physical targets would remain inside the archive", async t => {
  const root = await temporary(t);
  const stageRoot = path.join(root, "stage");
  await put(stageRoot, "dist/packed-target/tool.js", "// packed fixture\n");
  await mkdir(path.join(stageRoot, "dist/host/node_modules/.bin"), { recursive: true });
  await symlink("../../../packed-target/tool.js", path.join(stageRoot, "dist/host/node_modules/.bin/tool"));
  const archivePath = path.join(root, "app.asar");
  await assert.rejects(packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot: `${archivePath}.unpacked` }), /missing-unpacked-link/);
  await rm(path.join(stageRoot, "dist/host/node_modules"), { recursive: true, force: true });
  await symlink("../packed-target", path.join(stageRoot, "dist/host/node_modules"));
  await assert.rejects(packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot: `${archivePath}.unpacked` }), /missing-unpacked-(?:link|metadata)/);
});

test("ASAR rejects changed packed payload bytes even when its header and length are unchanged", async t => {
  const root = await temporary(t);
  const stageRoot = path.join(root, "stage");
  const packedPath = "dist/host/host-main.cjs";
  const expectedBytes = Buffer.from("module.exports = 'original packed runtime';\n");
  const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
  await put(stageRoot, packedPath, expectedBytes);
  const archivePath = path.join(root, "app.asar");
  const unpackedRoot = `${archivePath}.unpacked`;
  const packed = await packStagedAppWithIntegrity({ stageRoot, archivePath, unpackedRoot });
  assert.equal(packed.before.get(packedPath).sha256, expectedHash);
  const header = getRawHeader(archivePath);
  const entry = statFile(archivePath, packedPath, false);
  const bytes = await readFile(archivePath);
  const payloadStart = 8 + header.headerSize + Number(entry.offset);
  assert.equal(createHash("sha256").update(bytes.subarray(payloadStart, payloadStart + expectedBytes.length)).digest("hex"), expectedHash);
  bytes[payloadStart] ^= 1;
  await writeFile(archivePath, bytes);
  assert.equal(getRawHeader(archivePath).headerString, header.headerString);
  assert.equal(statFile(archivePath, packedPath, false).integrity.hash, expectedHash);
  await assert.rejects(verifyStagedPackageIntegrity({ stageRoot, archivePath, unpackedRoot, before: packed.before }), /packed-payload-mutation/);
});

test("installed Pi closure imports with repository ancestry excluded", { skip: process.platform !== "linux" }, async t => {
  const root = await temporary(t);
  const runtime = await materializeHostRuntimePackages({ outputRoot: root });
  assert.equal(runtime.packages[0].version, "0.84.3");
  const nestedUndici = JSON.parse(await readFile(path.join(root, spec.path, "node_modules/undici/package.json"), "utf8"));
  assert.equal(nestedUndici.version, "8.9.0");
  const imported = spawnSync(process.execPath, ["--preserve-symlinks", "--experimental-vm-modules", "--input-type=module", "-e", `
    import { openSync, closeSync } from "node:fs";
    import vm from "node:vm";
    const descriptor = openSync(process.argv[1], "r");
    try {
      const load = vm.compileFunction('return import("@earendil-works/pi-coding-agent")', [], {
        filename: "/proc/self/fd/" + descriptor + "/dist/host/independent-import.cjs",
        importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
      });
      console.log(typeof (await load()).ModelRuntime);
    } finally { closeSync(descriptor); }
  `, root], { encoding: "utf8" });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), "function");
});
