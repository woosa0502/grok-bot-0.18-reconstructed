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
  assert.match(desktop, /status: "not-configured"/);
  const host = read("source/host/extensions/mcp/mcp-service.ts");
  assert.match(host, /return localMcpServersFromConfig\(readLocalMcpConfig\(sandRootDir\), readLocalPluginInstalls\(sandRootDir\)\)/);
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
    assert.deepEqual(installs.installs["900001"], { serverNames: ["filesystem"], variables: { ROOT: "/workspace/data" }, installedAt: 42 });

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
