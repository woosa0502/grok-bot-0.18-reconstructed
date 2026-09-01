// A7: the MCP management tool surface must be honest in local Codex mode —
// the catalog is local (plugin-catalog.json / mcp.json), execution is
// stdio-only, and there is no Cursor account or per-server account slots.
// AddMcpServer (remote-url only, stored-but-never-run locally) is not offered,
// account-slot tools stay off regardless of the multi-account gate, and no
// offered description advertises the Cursor account.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadFactory() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "mcp-surface-entry.ts",
      contents: 'export { createMcpManagementTools } from "./source/host/runner/tools/sand-mcp-management-tools.js";',
    },
    // zod (and friends) get bundled in — a data: URL module cannot resolve
    // bare specifiers, so nothing may stay external here.
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const management = {}; // descriptions and the offered set are decided at build time

test("local mode: no AddMcpServer, no account-slot tools, no Cursor-account wording", async () => {
  const { createMcpManagementTools } = await loadFactory();
  const tools = createMcpManagementTools(
    management, undefined, undefined,
    () => true, // even with the multi-account gate ON
    undefined,
    { localMode: true },
  );
  const names = tools.map((tool) => tool.name);
  assert.ok(!names.includes("AddMcpServer"), "AddMcpServer must not be offered locally");
  assert.ok(!names.includes("RemoveMcpAccount"), "account-slot tools stay off locally");
  assert.ok(!names.includes("RenameMcpAccount"), "account-slot tools stay off locally");
  const describe = (tool) => String(tool.descriptionGenerator?.() ?? tool.description ?? "");
  for (const tool of tools) {
    assert.ok(!/Cursor account/i.test(describe(tool)), `${tool.name} must not advertise a Cursor account locally`);
    assert.ok(!/user's team/i.test(describe(tool)), `${tool.name} must not advertise team policy locally`);
  }
  const search = tools.find((tool) => tool.name === "SearchPlugins");
  assert.match(describe(search), /local plugin catalog/);
  const install = tools.find((tool) => tool.name === "InstallPlugin");
  assert.match(describe(install), /local MCP configuration/);
});

test("cloud mode surface is unchanged: AddMcpServer offered, account tools follow the gate", async () => {
  const { createMcpManagementTools } = await loadFactory();
  const gated = createMcpManagementTools(management, undefined, undefined, () => true, undefined);
  const gatedNames = gated.map((tool) => tool.name);
  assert.ok(gatedNames.includes("AddMcpServer"));
  assert.ok(gatedNames.includes("RemoveMcpAccount"));
  assert.ok(gatedNames.includes("RenameMcpAccount"));
  const ungated = createMcpManagementTools(management, undefined, undefined, () => false, undefined);
  const ungatedNames = ungated.map((tool) => tool.name);
  assert.ok(ungatedNames.includes("AddMcpServer"));
  assert.ok(!ungatedNames.includes("RemoveMcpAccount"));
});
