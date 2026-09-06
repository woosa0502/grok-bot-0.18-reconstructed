import assert from "node:assert/strict";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const files = ["mcp.json", "plugin-installs.json"];
const journal = ".local-mcp-transaction.json";
const compiled = build({ entryPoints: [path.join(repoRoot, "source/shared/node/mcp/local-mcp-store.ts")], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" }).then((result) => result.outputFiles[0].text);
const modulePromise = compiled.then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));
const entry = (id, command) => ({ pluginId: id, name: `plugin-${id}`, displayName: id, description: "test", category: "Local", install: { mcpServers: { [`server-${id}`]: { command } } } });

function readPair(root) {
  return Object.fromEntries(files.map((file) => { try { return [file, fs.readFileSync(path.join(root, file), "utf8")]; } catch (error) { if (error.code === "ENOENT") return [file, null]; throw error; } }));
}
function temporaryStore(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "belmont-mcp-transaction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
async function withFsFault(method, replacement, action) {
  const original = fs[method];
  fs[method] = (...args) => replacement(original, ...args);
  syncBuiltinESMExports();
  try { return await action(); } finally { fs[method] = original; syncBuiltinESMExports(); }
}
const ioError = (code) => Object.assign(new Error(`injected ${code}`), { code });

for (const operation of ["install", "update", "uninstall"]) {
  test(`${operation}: failure staging the second file changes neither file and retry remains usable`, async (t) => {
    const store = await modulePromise;
    const root = temporaryStore(t);
    store.writeLocalMcpConfig(root, { mcpServers: { manual: { command: "keep-manual" } } });
    let command = "initial";
    const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", command)] });
    if (operation !== "install") await writer.installPlugin({ pluginId: 1n });
    command = "updated";
    const run = () => operation === "install" ? writer.installPlugin({ pluginId: 1n }) : operation === "update" ? writer.updatePluginInstall({ pluginId: 1n, variables: {} }) : writer.uninstallPlugin({ pluginId: 1n });
    const before = readPair(root);
    await withFsFault("openSync", (original, target, ...args) => {
      if (target === path.join(root, "plugin-installs.json.tmp")) throw ioError("ENOSPC");
      return original(target, ...args);
    }, () => assert.rejects(run(), /injected ENOSPC/));
    assert.deepEqual(readPair(root), before, "raw original bytes, including file absence, survive");
    assert.equal(fs.existsSync(path.join(root, journal)), false);
    await run();
    assert.equal(store.readLocalMcpConfig(root).mcpServers.manual.command, "keep-manual");
    assert.equal(store.readLocalMcpConfig(root).mcpServers["server-1"]?.command, operation === "uninstall" ? undefined : "updated");
  });

  test(`${operation}: second replacement failure rolls back the first replacement exactly`, async (t) => {
    const store = await modulePromise;
    const root = temporaryStore(t);
    let command = "first";
    const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", command)] });
    if (operation !== "install") await writer.installPlugin({ pluginId: 1n });
    const before = readPair(root);
    command = "second";
    const run = () => operation === "install" ? writer.installPlugin({ pluginId: 1n }) : operation === "update" ? writer.updatePluginInstall({ pluginId: 1n, variables: {} }) : writer.uninstallPlugin({ pluginId: 1n });
    await withFsFault("renameSync", (original, source, destination) => {
      if (source === path.join(root, "plugin-installs.json.tmp")) throw ioError("EIO");
      return original(source, destination);
    }, () => assert.rejects(run(), /injected EIO/));
    assert.deepEqual(readPair(root), before);
    assert.equal(fs.existsSync(path.join(root, journal)), false);
    await run();
    assert.equal(store.readLocalPluginInstalls(root).installs["1"] !== undefined, operation !== "uninstall");
  });
}

test("rollback failure retains a journal and the next read restores ownership before retry", async (t) => {
  const store = await modulePromise;
  const root = temporaryStore(t);
  let command = "before";
  const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", command)] });
  await writer.installPlugin({ pluginId: 1n });
  const before = readPair(root);
  command = "after";
  await withFsFault("renameSync", (original, source, destination) => {
    if (source === path.join(root, "plugin-installs.json.tmp") || source.startsWith(path.join(root, "mcp.json.rollback."))) throw ioError("EACCES");
    return original(source, destination);
  }, () => assert.rejects(writer.updatePluginInstall({ pluginId: 1n, variables: {} }), /recovery is pending/));
  assert.notDeepEqual(readPair(root), before, "failure left a detectable partial commit");
  assert.equal(fs.existsSync(path.join(root, journal)), true);
  assert.equal(store.readLocalMcpConfig(root).mcpServers["server-1"].command, "before");
  assert.deepEqual(readPair(root), before, "read repaired both files from raw journal snapshots");
  assert.equal(fs.existsSync(path.join(root, journal)), false);
  await writer.updatePluginInstall({ pluginId: 1n, variables: {} });
  assert.equal(store.readLocalMcpConfig(root).mcpServers["server-1"].command, "after");
});

test("recovery refuses to overwrite a manual edit made after a partial transaction", async (t) => {
  const store = await modulePromise;
  const root = temporaryStore(t);
  const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", "plugin")] });
  store.writeLocalMcpConfig(root, { mcpServers: { manual: { command: "before" } } });
  await withFsFault("renameSync", (original, source, destination) => {
    if (source === path.join(root, "plugin-installs.json.tmp") || source.startsWith(path.join(root, "mcp.json.rollback."))) throw ioError("EIO");
    return original(source, destination);
  }, () => assert.rejects(writer.installPlugin({ pluginId: 1n }), /recovery is pending/));
  const manual = '{"mcpServers":{"manual":{"command":"edited-after-failure"}}}\n';
  fs.writeFileSync(path.join(root, "mcp.json"), manual);
  assert.throws(() => store.readLocalMcpConfig(root), /external change/);
  assert.equal(fs.readFileSync(path.join(root, "mcp.json"), "utf8"), manual);
  assert.equal(fs.existsSync(path.join(root, journal)), true);
});

test("malformed or structurally corrupt ownership ledgers reject all writer mutations without replacing data", async (t) => {
  const store = await modulePromise;
  const corrupt = ['{"installs":{"1":', "null", '{"installs":[]}', '{"installs":{"1":{"serverNames":"server-1"}}}', '{"installs":{"1":{"serverNames":["server-1"],"serverConfigHashes":{"server-1":42}}}}'];
  for (const text of corrupt) {
    const root = temporaryStore(t);
    store.writeLocalMcpConfig(root, { mcpServers: { "server-1": { command: "must-survive" } } });
    fs.writeFileSync(path.join(root, "plugin-installs.json"), text);
    const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", "overwrite"), entry("2", "unrelated")] });
    const before = readPair(root);
    for (const action of [() => writer.installPlugin({ pluginId: 2n }), () => writer.updatePluginInstall({ pluginId: 1n, variables: {} }), () => writer.uninstallPlugin({ pluginId: 1n }), () => writer.setConfig({ mcpServers: {} }, {})]) {
      await assert.rejects(action(), /Invalid.*plugin-installs\.json/);
      assert.deepEqual(readPair(root), before);
      assert.equal(fs.existsSync(path.join(root, journal)), false);
    }
  }
});

test("unreadable ledger and malformed config are reported instead of treated as empty stores", async (t) => {
  const store = await modulePromise;
  const root = temporaryStore(t);
  store.writeLocalMcpConfig(root, { mcpServers: { manual: { command: "preserve" } } });
  const before = fs.readFileSync(path.join(root, "mcp.json"), "utf8");
  fs.mkdirSync(path.join(root, "plugin-installs.json"));
  const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", "new")] });
  await assert.rejects(writer.installPlugin({ pluginId: 1n }), /Cannot read.*plugin-installs\.json/);
  assert.equal(fs.readFileSync(path.join(root, "mcp.json"), "utf8"), before);
  fs.rmdirSync(path.join(root, "plugin-installs.json"));
  fs.writeFileSync(path.join(root, "mcp.json"), '{"mcpServers":');
  await assert.rejects(writer.installPlugin({ pluginId: 1n }), /Invalid JSON.*mcp\.json/);
  assert.equal(fs.readFileSync(path.join(root, "mcp.json"), "utf8"), '{"mcpServers":');
});

test("a staging symlink cannot rewrite the committed configuration before validation", async (t) => {
  const store = await modulePromise;
  const root = temporaryStore(t);
  store.writeLocalMcpConfig(root, { mcpServers: { manual: { command: "preserve" } } });
  const before = readPair(root);
  fs.symlinkSync(path.join(root, "mcp.json"), path.join(root, "mcp.json.tmp"));
  const writer = store.createLocalMcpWriter(root, { catalog: () => [entry("1", "new")] });
  await assert.rejects(writer.installPlugin({ pluginId: 1n }), { code: "EEXIST" });
  assert.deepEqual(readPair(root), before);
  assert.equal(fs.lstatSync(path.join(root, "mcp.json.tmp")).isSymbolicLink(), true, "do not delete a staging object this transaction did not create");
});

test("another live writer cannot replace the active journal or mutate a half-committed store", async (t) => {
  const store = await modulePromise;
  const root = temporaryStore(t);
  store.writeLocalMcpConfig(root, { mcpServers: { manual: { command: "keep" } } });
  const before = readPair(root);
  fs.writeFileSync(path.join(root, "store.mjs"), await compiled);
  const release = path.join(root, "release-writer");
  const childPath = path.join(root, "hold-writer.mjs");
  fs.writeFileSync(childPath, `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { createLocalMcpWriter } from "./store.mjs";
    const link = fs.linkSync;
    fs.linkSync = (from, to) => {
      link(from, to);
      if (to === ${JSON.stringify(path.join(root, journal))}) {
        fs.writeSync(1, "journal-ready\\n");
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(${JSON.stringify(release)})) {
          if (Date.now() > deadline) throw new Error("test release timed out");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
    };
    syncBuiltinESMExports();
    await createLocalMcpWriter(${JSON.stringify(root)}, { catalog: () => [${JSON.stringify(entry("1", "owner"))}] }).installPlugin({ pluginId: 1n });
  `);
  const child = spawn(process.execPath, [childPath], { stdio: ["ignore", "pipe", "pipe"] });
  const done = once(child, "close");
  try {
    const [ready] = await once(child.stdout, "data");
    assert.equal(ready.toString(), "journal-ready\n");
    const competing = store.createLocalMcpWriter(root, { catalog: () => [entry("2", "competing")] });
    await assert.rejects(competing.installPlugin({ pluginId: 2n }), /Another process is updating/);
    assert.deepEqual(readPair(root), before);
  } finally { fs.writeFileSync(release, "continue"); }
  assert.equal((await done)[0], 0);
  assert.equal(store.readLocalMcpConfig(root).mcpServers["server-1"].command, "owner");
  assert.equal(store.readLocalPluginInstalls(root).installs["2"], undefined);
});

for (const crashAfter of ["mcp.json", "plugin-installs.json"]) {
  test(`process exit after replacing ${crashAfter} is recovered without orphan ownership`, async (t) => {
    const store = await modulePromise;
    const root = temporaryStore(t);
    store.writeLocalMcpConfig(root, { mcpServers: { manual: { command: "keep" } } });
    const before = readPair(root);
    const modulePath = path.join(root, "store.mjs");
    fs.writeFileSync(modulePath, await compiled);
    const childPath = path.join(root, "crash.mjs");
    fs.writeFileSync(childPath, `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      import { createLocalMcpWriter } from "./store.mjs";
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => { rename(from, to); if (to === ${JSON.stringify(path.join(root, crashAfter))}) process.exit(73); };
      syncBuiltinESMExports();
      await createLocalMcpWriter(${JSON.stringify(root)}, { catalog: () => [${JSON.stringify(entry("1", "installed"))}] }).installPlugin({ pluginId: 1n });
    `);
    await assert.rejects(execFileAsync(process.execPath, [childPath], { timeout: 10_000 }), (error) => error.code === 73);
    assert.equal(fs.existsSync(path.join(root, journal)), true);
    const installs = store.readLocalPluginInstalls(root);
    if (crashAfter === "mcp.json") assert.deepEqual(readPair(root), before, "partial commit rolls back after its writer exits");
    else {
      assert.equal(installs.installs["1"].serverNames[0], "server-1");
      assert.equal(store.readLocalMcpConfig(root).mcpServers["server-1"].command, "installed", "fully committed pair survives journal cleanup interruption");
    }
    assert.equal(fs.existsSync(path.join(root, journal)), false);
  });
}
