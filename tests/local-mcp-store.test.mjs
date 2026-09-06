// Local plugin / MCP store (parity A7): mcp.json + plugin-catalog.json +
// plugin-installs.json replace the Cursor account backend for the Plugins page,
// the agent's MCP management tools and the box runtime.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadStore() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/shared/node/mcp/local-mcp-store.ts")],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("reads mcp.json (stdio with cwd and url entries), assigns stable numeric ids, attributes plugin installs", async () => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-"));
  try {
    await writeFile(path.join(root, "mcp.json"), JSON.stringify({ mcpServers: {
      "belmont-test": { command: "node", args: ["server.mjs"], env: { PORT: 1234 }, cwd: "/workspace/.cursor" },
      remote: { url: "https://example.test/mcp", type: "http", headers: { Authorization: "Bearer x" } },
      broken: { nope: true },
    } }));
    await writeFile(path.join(root, "plugin-installs.json"), JSON.stringify({ installs: { "900001": { serverNames: ["belmont-test"], variables: {}, installedAt: 1 } } }));
    const config = store.readLocalMcpConfig(root);
    assert.deepEqual(Object.keys(config.mcpServers), ["belmont-test", "remote"]);
    assert.deepEqual(config.mcpServers["belmont-test"], { command: "node", args: ["server.mjs"], env: { PORT: "1234" }, cwd: "/workspace/.cursor" });
    const servers = store.localMcpServersFromConfig(config, store.readLocalPluginInstalls(root));
    assert.equal(servers.length, 2);
    assert.match(servers[0].id, /^[1-9]\d*$/);
    assert.equal(servers[0].id, store.localMcpServerId("belmont-test"));
    assert.equal(servers[0].pluginId, "900001");
    assert.equal(servers[0].isTeamServer, false);
    assert.equal(servers[1].pluginId, undefined);
    assert.equal(store.readLocalMcpConfig(path.join(root, "missing")).mcpServers.constructor, Object);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local catalog merges the user's file over the built-in entries and converts to marketplace plugins", async () => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-"));
  try {
    assert.ok(store.DEFAULT_LOCAL_PLUGIN_CATALOG.length >= 3);
    await writeFile(path.join(root, "plugin-catalog.json"), JSON.stringify({ plugins: [
      { pluginId: "900001", name: "filesystem", displayName: "My FS", description: "override", category: "Files", install: { mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "${ROOT}"] } } }, variableFields: [{ key: "ROOT", label: "Root", isRequired: true }] },
      { pluginId: "not-numeric", name: "bad", install: { mcpServers: { x: { command: "x" } } } },
      { pluginId: "123", name: "no-servers", install: { mcpServers: {} } },
    ] }));
    const catalog = store.readLocalPluginCatalog(root);
    assert.equal(catalog[0].displayName, "My FS");
    assert.equal(catalog.filter((entry) => entry.pluginId === "900001").length, 1, "user entry overrides the built-in with the same id");
    assert.ok(!catalog.some((entry) => entry.name === "bad" || entry.name === "no-servers"));
    const plugin = store.localCatalogEntryToMarketplacePlugin(catalog[0]);
    assert.equal(plugin.marketplace.ownership, "user");
    assert.equal(plugin.publisher.isUserOwned, true);
    assert.deepEqual(plugin.variableFields.map((f) => [f.key, f.isRequired]), [["ROOT", true]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop and host MCP managers use the local store in local Codex mode", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
  const desktop = read("source/electron-main/mcp/desktop-mcp-manager.ts");
  assert.match(desktop, /const localMode = isLocalCodexMode\(process\.env\)/);
  assert.match(desktop, /accountMcpWriter: createLocalMcpWriter\(localSandRoot\)/);
  assert.match(desktop, /effectivePluginsProvider: async \(\) => localEffectivePlugins\(localSandRoot\)/);
  assert.match(desktop, /fetchMarketplace: async \(\) => \(\{ plugins: readLocalPluginCatalog\(localSandRoot\)\.map\(localCatalogEntryToMarketplacePlugin\), includesPrivateMarketplaces: false \}\)/);
  assert.match(desktop, /cacheScope: localCodexAccountCacheScope\(\)/);
  assert.match(desktop, /if \(hasKickedInstallBackfill \|\| localMode\) return;/);
  assert.match(desktop, /createLocalMcpExec\(localSandRoot\)/);
  assert.match(desktop, /withLocalMcpAccounts\(localSandRoot, localMcpServersFromConfig\(readLocalMcpConfig\(localSandRoot\), readLocalPluginInstalls\(localSandRoot\)\)\)/);
  assert.match(desktop, /authenticateServer: \(serverId, accountKey, trigger\) => manager\.authenticateServer\(/);
  const host = read("source/host/extensions/mcp/mcp-service.ts");
  assert.match(host, /return withLocalMcpAccounts\(sandRootDir, localMcpServersFromConfig\(readLocalMcpConfig\(sandRootDir\), readLocalPluginInstalls\(sandRootDir\)\)\)/);
  assert.match(host, /accountMcpWriter: createLocalMcpWriter\(deps\.sandRootDir\)/);
  assert.match(host, /effectivePluginsProvider: async \(\) => localEffectivePlugins\(deps\.sandRootDir!\)/);
  const manager = read("source/shared/node/mcp/mcp-manager.ts");
  assert.match(manager, /\.\.\.\(options\.catalog \?\? \{\}\)/);
  const display = read("source/shared/node/mcp/mcp-display-runtime.ts");
  assert.match(display, /command: string; args\?: string\[\]; env\?: Record<string, string>; cwd\?: string/);
  const oauth = read("source/electron-main/adapters/mcp-oauth.ts");
  assert.match(oauth, /fetchTeamPopularity: isLocalCodexMode\(context\.env\) \? async \(\) => new Map\(\) : createTeamPopularityFetcher\(context\)/);
});

test("local writer installs, updates and uninstalls catalog plugins into mcp.json with variable substitution", async () => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-"));
  try {
    await writeFile(path.join(root, "mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "node", args: ["x.mjs"] } } }));
    const writer = store.createLocalMcpWriter(root, { now: () => 42 });
    await writer.installPlugin({ pluginId: 900001n, variables: { ROOT: "/workspace/data" } });
    let config = store.readLocalMcpConfig(root);
    assert.deepEqual(config.mcpServers.filesystem, { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace/data"] });
    assert.ok(config.mcpServers.existing, "unrelated servers are kept");
    assert.deepEqual(store.localEffectivePlugins(root), [{ pluginId: "900001", installMode: "user", isEnabled: true }]);
    const installs = store.readLocalPluginInstalls(root);
    assert.deepEqual(installs.installs["900001"], { serverNames: ["filesystem"], serverConfigHashes: { filesystem: installs.installs["900001"].serverConfigHashes.filesystem }, variables: { ROOT: "/workspace/data" }, installedAt: 42 });
    assert.match(installs.installs["900001"].serverConfigHashes.filesystem, /^[a-f0-9]{64}$/);

    // Optional variable left blank: the env entry is dropped instead of leaking "${...}".
    await writer.installPlugin({ pluginId: 900002n });
    config = store.readLocalMcpConfig(root);
    assert.deepEqual(config.mcpServers.memory, { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] });

    // Update re-renders with the new values.
    await writer.updatePluginInstall({ pluginId: 900001n, variables: { ROOT: "/workspace/other" } });
    assert.deepEqual(store.readLocalMcpConfig(root).mcpServers.filesystem.args.at(-1), "/workspace/other");

    // getConfigForEdit/setConfig implement the account-writer contract (used by removeServer/addServer).
    const edit = await writer.getConfigForEdit();
    assert.equal(edit.serverIdsByName.filesystem, BigInt(store.localMcpServerId("filesystem")));
    const trimmed = { mcpServers: Object.fromEntries(Object.entries(edit.config.mcpServers).filter(([name]) => name !== "existing")) };
    await writer.setConfig(trimmed, edit.serverIdsByName);
    assert.equal(store.readLocalMcpConfig(root).mcpServers.existing, undefined);

    await writer.uninstallPlugin({ pluginId: 900001n });
    assert.equal(store.readLocalMcpConfig(root).mcpServers.filesystem, undefined);
    assert.deepEqual(store.localEffectivePlugins(root), [{ pluginId: "900002", installMode: "user", isEnabled: true }]);
    await assert.rejects(writer.installPlugin({ pluginId: 1n }), /Unknown local plugin "1"/);
    assert.match(await readFile(path.join(root, "mcp.json"), "utf8"), /"mcpServers"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const catalogPlugin = (pluginId, mcpServers) => ({ pluginId, name: `plugin-${pluginId}`, displayName: `Plugin ${pluginId}`, description: "test", category: "Local", install: { mcpServers } });

test("install rejects another plugin's server name before changing either file", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog = [catalogPlugin("1", { shared: { command: "owner" } }), catalogPlugin("2", { fresh: { command: "new" }, shared: { command: "intruder" } })];
  const writer = store.createLocalMcpWriter(root, { catalog: () => catalog });
  await writer.installPlugin({ pluginId: 1n });
  const paths = ["mcp.json", "plugin-installs.json"].map((name) => path.join(root, name));
  const before = await Promise.all(paths.map((file) => readFile(file, "utf8")));
  await assert.rejects(writer.installPlugin({ pluginId: 2n }), /MCP server "shared".*claimed by plugin 1/);
  assert.deepEqual(await Promise.all(paths.map((file) => readFile(file, "utf8"))), before, "rejection writes neither configuration nor install metadata");
  await writer.uninstallPlugin({ pluginId: 2n });
  assert.deepEqual(store.readLocalMcpConfig(root).mcpServers, { shared: { command: "owner" } });
});

test("manual servers cannot be adopted by a matching plugin installation", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-manual-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { mcpServers: { shared: { command: "same-command" }, unrelated: { url: "https://example.test/mcp", type: "http" } } };
  store.writeLocalMcpConfig(root, config);
  const writer = store.createLocalMcpWriter(root, { catalog: () => [catalogPlugin("1", { shared: { command: "same-command" } })] });
  await assert.rejects(writer.installPlugin({ pluginId: 1n }), /MCP server "shared".*manual, modified, or legacy/);
  assert.deepEqual(store.readLocalMcpConfig(root), config);
  assert.deepEqual(store.readLocalPluginInstalls(root).installs, {});
});

test("plugin updates validate catalog name changes before removing previous servers", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let catalog = [catalogPlugin("1", { old: { command: "node", args: ["${ROOT}"] } })];
  const writer = store.createLocalMcpWriter(root, { catalog: () => catalog });
  await writer.installPlugin({ pluginId: 1n, variables: { ROOT: "before" } });
  const edit = await writer.getConfigForEdit();
  await writer.setConfig({ mcpServers: { ...edit.config.mcpServers, taken: { command: "manual" } } }, edit.serverIdsByName);
  catalog = [catalogPlugin("1", { taken: { command: "new" } })];
  const before = await readFile(path.join(root, "mcp.json"), "utf8");
  await assert.rejects(writer.updatePluginInstall({ pluginId: 1n, variables: {} }), /MCP server "taken"/);
  assert.equal(await readFile(path.join(root, "mcp.json"), "utf8"), before);
  assert.deepEqual(store.readLocalPluginInstalls(root).installs["1"].serverNames, ["old"]);
});

test("manual replacement detaches ownership and survives update rejection and uninstall", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writer = store.createLocalMcpWriter(root, { catalog: () => [catalogPlugin("1", { replaced: { command: "plugin" }, owned: { command: "plugin-other" } })] });
  await writer.installPlugin({ pluginId: 1n });
  const edit = await writer.getConfigForEdit();
  await writer.setConfig({ mcpServers: { ...edit.config.mcpServers, replaced: { command: "manual" } } }, edit.serverIdsByName);
  const rows = store.localMcpServersFromConfig(store.readLocalMcpConfig(root), store.readLocalPluginInstalls(root));
  assert.equal(rows.find((row) => row.name === "replaced").pluginId, undefined);
  assert.equal(rows.find((row) => row.name === "owned").pluginId, "1");
  await assert.rejects(writer.updatePluginInstall({ pluginId: 1n, variables: {} }), /MCP server "replaced"/);
  await writer.uninstallPlugin({ pluginId: 1n });
  assert.deepEqual(store.readLocalMcpConfig(root).mcpServers, { replaced: { command: "manual" } });
  assert.deepEqual(store.readLocalPluginInstalls(root).installs, {});
});

test("legacy collisions never choose the last claimant or delete its shared server", async (t) => {
  const store = await loadStore();
  for (const order of [[1n, 2n], [2n, 1n]]) {
    const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-legacy-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    store.writeLocalMcpConfig(root, { mcpServers: { shared: { command: "unknown-owner" } } });
    store.writeLocalPluginInstalls(root, { installs: {
      "1": { serverNames: ["shared"], variables: {}, installedAt: 1 },
      "2": { serverNames: ["shared"], variables: {}, installedAt: 2 },
    } });
    assert.equal(store.localMcpServersFromConfig(store.readLocalMcpConfig(root), store.readLocalPluginInstalls(root))[0].pluginId, undefined);
    const writer = store.createLocalMcpWriter(root, { catalog: () => [catalogPlugin("1", { shared: { command: "replacement" } })] });
    await assert.rejects(writer.updatePluginInstall({ pluginId: 1n, variables: {} }), /claimed by plugin 2/);
    for (const pluginId of order) await writer.uninstallPlugin({ pluginId });
    assert.deepEqual(store.readLocalMcpConfig(root).mcpServers, { shared: { command: "unknown-owner" } });
  }
});

test("legacy single-claim records cannot authorize overwrite even if the catalog matches", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-legacy-single-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  store.writeLocalMcpConfig(root, { mcpServers: { shared: { command: "same" } } });
  store.writeLocalPluginInstalls(root, { installs: { "1": { serverNames: ["shared"], variables: {}, installedAt: 1 } } });
  const writer = store.createLocalMcpWriter(root, { catalog: () => [catalogPlugin("1", { shared: { command: "same" } })] });
  await assert.rejects(writer.updatePluginInstall({ pluginId: 1n, variables: {} }), /ownership cannot be verified/);
  await writer.uninstallPlugin({ pluginId: 1n });
  assert.deepEqual(store.readLocalMcpConfig(root).mcpServers, { shared: { command: "same" } });
});

test("ownership survives reordered JSON object keys while configuration edits do not", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-key-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const writer = store.createLocalMcpWriter(root, { catalog: () => [catalogPlugin("1", { shared: { command: "node", env: { A: "1", B: "2" }, args: ["${ROOT}"] } })] });
  await writer.installPlugin({ pluginId: 1n, variables: { ROOT: "before" } });
  await writeFile(path.join(root, "mcp.json"), JSON.stringify({ mcpServers: { shared: { args: ["before"], env: { B: "2", A: "1" }, command: "node" } } }));
  await writer.updatePluginInstall({ pluginId: 1n, variables: { ROOT: "after" } });
  assert.deepEqual(store.readLocalMcpConfig(root).mcpServers.shared.args, ["after"]);
  await writer.uninstallPlugin({ pluginId: 1n });
  assert.deepEqual(store.readLocalMcpConfig(root).mcpServers, {});
});

test("plugin mutations preserve manual remote auth and TLS metadata, including ownership edits", async (t) => {
  const store = await loadStore();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mcp-remote-metadata-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = { url: "https://example.test/mcp", auth: { CLIENT_ID: "public-client", scopes: ["read"] }, tls: { caBundle: "/test/ca.pem" } };
  store.writeLocalMcpConfig(root, { mcpServers: { manual: remote } });
  const writer = store.createLocalMcpWriter(root, { catalog: () => [catalogPlugin("1", { managed: remote })] });
  await writer.installPlugin({ pluginId: 1n });
  assert.deepEqual(store.readLocalMcpConfig(root).mcpServers.manual, remote);
  const edit = await writer.getConfigForEdit();
  await writer.setConfig({ mcpServers: { ...edit.config.mcpServers, managed: { ...remote, tls: { caBundle: "/test/replacement-ca.pem" } } } }, edit.serverIdsByName);
  await assert.rejects(writer.updatePluginInstall({ pluginId: 1n, variables: {} }), /MCP server "managed"/);
  await writer.uninstallPlugin({ pluginId: 1n });
  const after = store.readLocalMcpConfig(root).mcpServers;
  assert.deepEqual(after.manual, remote);
  assert.equal(after.managed.tls.caBundle, "/test/replacement-ca.pem");
});
