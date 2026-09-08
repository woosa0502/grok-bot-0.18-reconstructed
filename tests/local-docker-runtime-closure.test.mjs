import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { transform } from "esbuild";

const sourcePath = fileURLToPath(new URL("../source/electron-main/box/local-docker-host-connector.ts", import.meta.url));
const { code } = await transform(await readFile(sourcePath, "utf8"), { loader: "ts", format: "esm", target: "es2024" });
const { stageCurrentHostBundle, localDockerRuntimeMountArguments } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const execFileAsync = promisify(execFile);
const packageRelativePath = path.join("@earendil-works", "pi-coding-agent");

async function writeFixtureFile(file, bytes, mode = 0o644) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { mode });
}

async function fixture(t, { asar = false, asarLookalike = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "belmont-docker-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, asar ? "app.asar" : asarLookalike ? "app.asar.backup" : "app", "dist");
  const moduleDirectory = path.join(runtime, "electron-main");
  const dependencies = path.join(asar ? runtime.replace("app.asar", "app.asar.unpacked") : runtime, "host", "node_modules");
  const packageDirectory = path.join(dependencies, packageRelativePath);
  await mkdir(moduleDirectory, { recursive: true });
  await writeFixtureFile(path.join(runtime, "host", "host-main.cjs"), 'import("@earendil-works/pi-coding-agent").then(({ value }) => console.log(value));\n');
  await writeFixtureFile(path.join(runtime, "box-exec-daemon", "main.cjs"), "// fixture daemon\n");
  await writeFixtureFile(path.join(packageDirectory, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", exports: "./index.mjs" }));
  await writeFixtureFile(path.join(packageDirectory, "index.mjs"), 'export { default as value } from "fixture-shared";\n');
  for (const [directory, value] of [[dependencies, "root-version"], [path.join(packageDirectory, "node_modules"), "nested-version"]]) {
    const shared = path.join(directory, "fixture-shared");
    await writeFixtureFile(path.join(shared, "package.json"), JSON.stringify({ name: "fixture-shared", type: "module", exports: "./index.mjs" }));
    await writeFixtureFile(path.join(shared, "index.mjs"), `export default ${JSON.stringify(value)};\n`);
  }
  const resource = path.join(packageDirectory, "resources", "theme.json");
  const binary = path.join(packageDirectory, "prebuilds", "linux-x64", "fixture.node");
  const executable = path.join(packageDirectory, "bin", "fixture-cli");
  await writeFixtureFile(resource, '{"fixture":"theme"}\n');
  await writeFixtureFile(binary, Buffer.from([0, 1, 255, 127, 69, 76, 70]));
  await writeFixtureFile(executable, "#!/bin/sh\nexit 0\n", 0o755);
  await mkdir(path.join(dependencies, ".bin"));
  await symlink(path.join("..", packageRelativePath, "bin", "fixture-cli"), path.join(dependencies, ".bin", "fixture-cli"));
  return { root, runtime, moduleDirectory, dependencies, packageDirectory, resource, binary, executable, settingsPath: path.join(root, "settings", "settings.json") };
}

test("Docker staging preserves a relocated closure, nested resolution, binary bytes, and daemon layout", async (t) => {
  const input = await fixture(t);
  const staged = await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory);
  const directory = path.dirname(staged.path);
  const stagedPackage = path.join(directory, "node_modules", packageRelativePath);
  assert.deepEqual(await readFile(path.join(stagedPackage, "prebuilds", "linux-x64", "fixture.node")), await readFile(input.binary));
  assert.equal(await readFile(path.join(stagedPackage, "resources", "theme.json"), "utf8"), await readFile(input.resource, "utf8"));
  assert.equal((await stat(path.join(stagedPackage, "bin", "fixture-cli"))).mode & 0o777, 0o755);
  assert.equal(await readlink(path.join(directory, "node_modules", ".bin", "fixture-cli")), path.join("..", packageRelativePath, "bin", "fixture-cli"));
  assert.deepEqual(await readdir(path.dirname(staged.boxExecDaemonPath)), ["main.cjs"]);
  assert.equal(await readFile(staged.boxExecDaemonPath, "utf8"), "// fixture daemon\n");
  await rm(path.dirname(input.runtime), { recursive: true });
  const executed = await execFileAsync(process.execPath, [staged.path], { cwd: directory, env: { ...process.env, NODE_PATH: "" } });
  assert.equal(executed.stdout.trim(), "nested-version");
  assert.equal(executed.stderr, "");
  assert.deepEqual(localDockerRuntimeMountArguments(staged), [
    "--mount", `type=bind,src=${directory},dst=/home/box/sand-host,readonly`,
    "--mount", `type=bind,src=${path.dirname(staged.boxExecDaemonPath)},dst=/home/box/box-exec-daemon,readonly`,
  ]);
});

test("Docker runtime identity changes on dependency-only byte, path, mode, deletion, and daemon drift", async (t) => {
  const input = await fixture(t);
  let previous = await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory);
  assert.deepEqual(await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), previous);
  const edits = [
    () => writeFile(input.resource, '{"fixture":"changed"}\n'),
    () => rename(input.resource, `${input.resource}.renamed`),
    () => chmod(input.executable, 0o744),
    () => rm(`${input.resource}.renamed`),
    () => writeFile(path.join(input.runtime, "box-exec-daemon", "main.cjs"), "// changed daemon\n"),
  ];
  for (const edit of edits) {
    await edit();
    const next = await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory);
    assert.notEqual(next.sha256, previous.sha256);
    assert.notEqual(next.path, previous.path);
    assert.equal(await readFile(previous.path, "utf8"), await readFile(next.path, "utf8"));
    previous = next;
  }
});

test("Docker staging requires the host-relative Pi package even if another ancestor has it", async (t) => {
  const input = await fixture(t);
  await rename(input.dependencies, path.join(input.root, "node_modules"));
  await assert.rejects(stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), /host dependency closure is unavailable/);
});

test("Docker staging reads physical ASAR-unpacked dependencies and leaves lookalike parent names alone", async (t) => {
  for (const options of [{ asar: true }, { asarLookalike: true }]) {
    const input = await fixture(t, options);
    const staged = await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory);
    assert.deepEqual(await readFile(path.join(path.dirname(staged.path), "node_modules", packageRelativePath, "prebuilds", "linux-x64", "fixture.node")), await readFile(input.binary));
  }
});

test("Docker staging refuses changed or incomplete cached dependencies", async (t) => {
  const input = await fixture(t);
  const staged = await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory);
  const stagedResource = path.join(path.dirname(staged.path), "node_modules", packageRelativePath, "resources", "theme.json");
  await writeFile(stagedResource, "corrupt");
  await assert.rejects(stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), /unexpected bytes or permissions/);
  await rm(stagedResource);
  await assert.rejects(stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), /unexpected bytes or permissions/);
});

test("Docker staging rejects escaping and dangling dependency symlinks", async (t) => {
  const input = await fixture(t);
  const outside = path.join(input.root, "outside.txt");
  const link = path.join(input.dependencies, "external");
  await writeFile(outside, "outside");
  await symlink(path.relative(input.dependencies, outside), link);
  await assert.rejects(stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), /symlink escapes/);
  await rm(outside);
  await assert.rejects(stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), { code: "ENOENT" });
});

test("Docker staging rejects byte-identical external links at every cached runtime boundary", async (t) => {
  const boundaries = ["host-main.cjs", path.join("box-exec-daemon", "main.cjs"), "box-exec-daemon", "node_modules", "."];
  for (const boundary of boundaries) {
    const input = await fixture(t);
    const staged = await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory);
    const replaced = path.join(path.dirname(staged.path), boundary);
    const outside = path.join(input.root, "outside-runtime-entry");
    await rename(replaced, outside);
    await symlink(path.relative(path.dirname(replaced), outside), replaced);
    assert.equal(await readFile(staged.path, "utf8"), await readFile(path.join(input.runtime, "host", "host-main.cjs"), "utf8"));
    assert.equal(await readFile(staged.boxExecDaemonPath, "utf8"), await readFile(path.join(input.runtime, "box-exec-daemon", "main.cjs"), "utf8"));
    await assert.rejects(stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), /unexpected file layout/, boundary);
  }
});

test("concurrent Docker staging publishes one complete content-addressed tree", async (t) => {
  const input = await fixture(t);
  const results = await Promise.all([
    stageCurrentHostBundle(input.settingsPath, input.moduleDirectory),
    stageCurrentHostBundle(input.settingsPath, input.moduleDirectory),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await readdir(path.join(path.dirname(input.settingsPath), "local-docker-runtime"))).length, 1);
  assert.deepEqual(await stageCurrentHostBundle(input.settingsPath, input.moduleDirectory), results[0]);
});
