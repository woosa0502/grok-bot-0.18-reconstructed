// The model only sees a ToolSetHandle's static tools; dynamic-mode partitioning
// ("final" profile) offloads every tool without a recognized toolIdentifier to
// the dynamic registry. Browser tools carry an `id` but no `toolIdentifier`, so
// when local browser-use pushed them into a dynamic-tools main agent they all
// vanished from the model's tool list — the driver worked, the wiring worked,
// and the model never saw browser_navigate. The fix pins the browser tool names
// in SAND_FORCED_STATIC_TOOL_NAMES; this test walks the real placement and
// partition code to prove all fifteen stay model-visible.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadToolsetExports() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "browser-static-placement-entry.ts",
      contents: `
        export {
          SAND_FORCED_STATIC_TOOL_NAMES,
          withDynamicToolPlacement,
        } from "./source/host/runner/tools/turn-toolset.js";
        export {
          createSandBrowserTools,
          SAND_BROWSER_TOOL_NAMES,
        } from "./source/host/runner/tools/sand-browser-tools.js";
        export { createSandBrowserTurnTools } from "./source/host/runner/tools/sand-browser-turn-tools.js";
        export {
          createComputerTool,
          createScreenshotTool,
        } from "./source/host/runner/tools/sand-computer-tool.js";
        export { partitionDynamicTools } from "./source/packages/agent/tools/exclude-tools.js";
        export { toAgentTools } from "./source/packages/agent/tools/core.js";
        export { toolsToPi } from "./source/host/extensions/inference/pi-codex-projection.js";
        export { createLocalBrowserDriverDependencies } from "./source/host/box/local-browser-use.js";
      `,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    supported: { using: false },
    // Only the repo's own TS gets bundled. Dependencies stay external and are
    // resolved from the real node_modules — bundling them relocates their
    // internal dynamic requires, which cannot survive in a data: URL or /tmp.
    packages: "external",
    banner: {
      js: 'import { createRequire as __belmontCreateRequire } from "node:module";\nconst require = __belmontCreateRequire(import.meta.url);',
    },
  });
  // The bundle must live under the repo so its external bare specifiers walk
  // up into the repo's node_modules.
  const dir = path.join(repoRoot, "node_modules", ".cache", "belmont-tests");
  await mkdir(dir, { recursive: true });
  const bundlePath = path.join(dir, `toolset-exports-${process.pid}.mjs`);
  await writeFile(bundlePath, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(bundlePath, { force: true });
  }
}

const exportsPromise = loadToolsetExports();

// The driver is never run here; the stub only has to satisfy construction.
const stubDriverDependencies = {
  resourceAccessor: { get: () => undefined },
  box: {
    ensureReady: async () => undefined,
    getAgentWindowIndex: () => 0,
    uploadFile: async () => undefined,
    downloadFile: async () => new Uint8Array(),
  },
  getBoxId: () => "test-agent",
  getDefaultViewId: () => "test-agent",
  executeShell: async () => ({ output: "", exitCode: 0 }),
};

test("every browser tool name is pinned in the forced-static set", async () => {
  const { SAND_FORCED_STATIC_TOOL_NAMES, SAND_BROWSER_TOOL_NAMES } = await exportsPromise;
  assert.equal(SAND_BROWSER_TOOL_NAMES.length, 15);
  for (const name of SAND_BROWSER_TOOL_NAMES) {
    assert.ok(SAND_FORCED_STATIC_TOOL_NAMES.has(name), `${name} missing from SAND_FORCED_STATIC_TOOL_NAMES`);
  }
});

test("dynamic-mode placement and partition keep all browser turn tools model-visible", async () => {
  const {
    createSandBrowserTurnTools,
    SAND_BROWSER_TOOL_NAMES,
    withDynamicToolPlacement,
    partitionDynamicTools,
  } = await exportsPromise;

  const browserTools = createSandBrowserTurnTools(stubDriverDependencies);
  assert.equal(browserTools.length, SAND_BROWSER_TOOL_NAMES.length);
  // The BROWSER_* identifiers are not in the base static set, so the "final"
  // offload profile would still hide them; only the name pin keeps them
  // model-visible.
  const placed = browserTools.map(withDynamicToolPlacement);
  const { staticTools, dynamicTools } = partitionDynamicTools(placed, "final");
  const staticNames = new Set(staticTools.map((tool) => tool.name));
  for (const name of SAND_BROWSER_TOOL_NAMES) {
    assert.ok(staticNames.has(name), `${name} was offloaded to the dynamic registry`);
  }
  assert.equal(dynamicTools.length, 0);
});

test("the browser turn tools survive definition building and the Pi projection", async () => {
  // The cliff the live probe fell off: toAgentTools copies `parameters` into
  // the model definitions, and toolsToPi silently drops any definition without
  // one. The raw driver definitions carry no parameters, so all 15 vanished
  // between tools.push and the model's tool list.
  const {
    createSandBrowserTools,
    createSandBrowserTurnTools,
    SAND_BROWSER_TOOL_NAMES,
    toAgentTools,
    toolsToPi,
  } = await exportsPromise;

  const adapted = createSandBrowserTurnTools(stubDriverDependencies);
  const projected = toolsToPi(toAgentTools(adapted)) ?? [];
  assert.deepEqual(projected.map((tool) => tool.name).sort(), [...SAND_BROWSER_TOOL_NAMES].sort());
  for (const tool of projected) {
    assert.ok(tool.description.length > 0, `${tool.name} lost its description`);
    // pi-ai sends tool.parameters verbatim to the Codex API. A raw ZodObject
    // serializes to zod internals ({_def: ...}, no type/properties) — Codex
    // rejected a live request over exactly that — so what reaches the
    // provider must already be a plain JSON schema.
    const serialized = JSON.parse(JSON.stringify(tool.parameters));
    assert.equal(serialized.type, "object", `${tool.name} parameters did not serialize to a JSON schema`);
    assert.equal(serialized._def, undefined, `${tool.name} parameters leaked zod internals`);
    assert.ok(serialized.properties && typeof serialized.properties === "object", `${tool.name} parameters lost properties`);
  }
  const navigate = projected.find((tool) => tool.name === "browser_navigate");
  assert.deepEqual(JSON.parse(JSON.stringify(navigate.parameters)).required, ["url"]);

  // Control: the raw definitions really are dropped — proves the projection
  // assertion above can fail and the adapter is what saves them.
  const rawProjected = toolsToPi(toAgentTools(createSandBrowserTools(stubDriverDependencies)));
  assert.equal(rawProjected, undefined);
});

test("the Computer and Screenshot tools stay model-visible the same way", async () => {
  // Same identifierless shape, same hazard: the shipped offload rules pin
  // OPENAI_COMPUTER_USE static by toolIdentifier, but these tool objects only
  // carry `id`, so without the name pin the dynamic gate hides them too.
  const {
    createComputerTool,
    createScreenshotTool,
    SAND_FORCED_STATIC_TOOL_NAMES,
    withDynamicToolPlacement,
    partitionDynamicTools,
  } = await exportsPromise;
  const tools = [
    createComputerTool(stubDriverDependencies),
    createScreenshotTool(stubDriverDependencies),
  ];
  assert.deepEqual(tools.map((tool) => tool.name), ["Computer", "Screenshot"]);
  for (const tool of tools) {
    assert.ok(SAND_FORCED_STATIC_TOOL_NAMES.has(tool.name), `${tool.name} missing from SAND_FORCED_STATIC_TOOL_NAMES`);
  }
  const { staticTools, dynamicTools } = partitionDynamicTools(tools.map(withDynamicToolPlacement), "final");
  assert.deepEqual(staticTools.map((tool) => tool.name), ["Computer", "Screenshot"]);
  assert.equal(dynamicTools.length, 0);
});

test("the local driver shell executor runs in-host and maps results", async () => {
  // The driver invocation must not route through the user-computer exec
  // gateway: that gate only runs requests it can describe on an approval card
  // and rejected every driver call ("could not describe that request"). The
  // local dependencies therefore execute the command argv-style in-host.
  const { createLocalBrowserDriverDependencies } = await exportsPromise;
  const deps = createLocalBrowserDriverDependencies({
    resourceAccessor: { get: () => undefined },
    agentId: "test-agent",
  });
  const ok = await deps.executeShell({}, {
    command: "/bin/echo driver-executor-ok",
    name: "node",
    workingDirectory: "/workspace",
    toolCallId: "t1",
  });
  assert.equal(ok.case, "success");
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /driver-executor-ok/);

  const missing = await deps.executeShell({}, {
    command: "/nonexistent-belmont-driver-binary arg",
    name: "node",
    workingDirectory: "/workspace",
    toolCallId: "t2",
  });
  assert.equal(missing.case, "success");
  assert.notEqual(missing.exitCode, 0);
  assert.ok(missing.stderr.length > 0, "spawn failure must surface a message");
});

test("the partition still offloads an unpinned identifierless tool", async () => {
  // Control: proves the assertions above can fail — without the pin, a tool
  // shaped like a browser tool goes to the dynamic side and out of model view.
  const { withDynamicToolPlacement, partitionDynamicTools } = await exportsPromise;
  const unpinned = withDynamicToolPlacement({
    name: "browser_navigate_unpinned",
    execute: async () => undefined,
  });
  const { staticTools, dynamicTools } = partitionDynamicTools([unpinned], "final");
  assert.equal(staticTools.length, 0);
  assert.equal(dynamicTools.length, 1);
});
