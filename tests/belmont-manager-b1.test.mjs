// Belmont manager B-1 groundwork: SendToAgent remote hooks (job ledger), the
// SAND_DEFAULT_AGENT_ID startup default, per-agent model/reasoning selection
// (AUDIT-W1 subset), and the local-exec daemon orphan watchdog (AUDIT-W18).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadModule(relativeEntry) {
  const entry = path.join(repoRoot, relativeEntry);
  const result = await build({
    entryPoints: [entry],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    // The source uses `using` declarations (explicit resource management),
    // which this Node cannot parse — esbuild must lower them in the bundle.
    supported: { using: false },
    external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
    // The bundle runs from a data: URL, but some modules feed import.meta.url to
    // createRequire/realpath — pin it to the real entry file — and CJS deps in
    // the bundle need a live require for node builtins.
    define: { "import.meta.url": JSON.stringify(pathToFileURL(entry).href) },
    banner: { js: `import { createRequire as __belmontCreateRequire } from "node:module"; const require = __belmontCreateRequire(${JSON.stringify(pathToFileURL(entry).href)});` },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------- A2: SendToAgent remote hooks ----------

test("SendToAgent runs remote hooks like WebFetch (ledger/gating point)", () => {
  const tool = read("source/host/runner/tools/sand-agent-management-tools.ts");
  assert.match(tool, /import \{ withRemoteHooks \} from "\.\.\/\.\.\/\.\.\/packages\/agent\/tools\/core\/remote-hooks\.js"/);
  assert.match(tool, /toolName: SAND_SEND_TO_AGENT_TOOL_NAME/);
  assert.match(tool, /createRejectedResult: \(_a: unknown, reason: string\) => `Permission denied: \$\{reason\}`/);
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /createSendToAgentToolInputs: \(turn\) => \(\{/);
  assert.match(composition, /\.\.\.dependencies\.sendToAgent,[\s\S]{0,700}resourceAccessor: turn\.remoteBoxResourceAccessor,/);
});

// ---------- A5: default agent at startup ----------

test("SAND_DEFAULT_AGENT_ID opens that agent's session first at startup", () => {
  const runtime = read("source/host/extensions/transcript/session-runtime.ts");
  assert.match(runtime, /const defaultId = process\.env\.SAND_DEFAULT_AGENT_ID\?\.trim\(\);/);
  assert.match(runtime, /\.\.\.\(defaultRestorable && defaultId != null \? \[defaultId\] : \[\]\),\s*\.\.\.\(restorable && persistedId != null \? \[persistedId\] : \[\]\),/);
});

// ---------- A6: per-agent model/reasoning selection ----------

test("settings store persists and normalizes per-agent model selections", async () => {
  const { SandSettingsStore } = await loadModule("source/shared/node/settings/sand-settings-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-b1-settings-"));
  try {
    const store = new SandSettingsStore(path.join(root, "settings.json"));
    store.setAgentModelForAgentId("agent-1", { modelId: "gpt-5.5", maxMode: false, parameters: [{ id: "effort", value: "low" }] });
    assert.equal(store.getAgentModelForAgentId("agent-1")?.parameters[0]?.value, "low");
    // Round-trips through a fresh store instance (disk persistence).
    const reloaded = new SandSettingsStore(path.join(root, "settings.json"));
    assert.equal(reloaded.getAgentModelForAgentId("agent-1")?.modelId, "gpt-5.5");
    assert.equal(reloaded.getAgentModelForAgentId("agent-2"), undefined);
    // Clearing removes the map entry (and the key entirely when empty).
    reloaded.setAgentModelForAgentId("agent-1", undefined);
    assert.equal(reloaded.getAgentModelForAgentId("agent-1"), undefined);
    assert.doesNotMatch(await readFile(path.join(root, "settings.json"), "utf8"), /agentModelsByAgentId/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("top-level turns consult the per-agent selection ahead of the global default, and CreateAgent can set it", () => {
  const shell = read("source/host/runner/turn-run-shell.ts");
  assert.match(shell, /: settingsStore\.getAgentModelForAgentId\(input\.conversationId\) \?\? settingsStore\.getAgentDefaultModel\(\);/);
  const tool = read("source/host/runner/tools/sand-agent-management-tools.ts");
  assert.match(tool, /reasoning: z\.enum\(\["minimal", "low", "medium", "high", "xhigh"\]\)\.optional\(\)/);
  assert.match(tool, /resolved\.setAgentModelSelection\?\.\(created\.id, \{/);
  const composition = read("source/host/host-runner-composition.ts");
  // rev 2 (external review #4): reasoning-only selections inherit the CURRENT
  // global default model instead of hardcoding gpt-5.5.
  assert.match(tool, /modelId: "",/);
  assert.match(composition, /selection\.modelId\.length > 0\s*\? selection\.modelId\s*: store\.getAgentDefaultModel\(\)\?\.modelId \?\? process\.env\.SAND_CODEX_MODEL\?\.trim\(\) \?\? "gpt-5\.5";/);
  assert.match(composition, /store\.setAgentModelForAgentId\(agentId, \{ modelId, maxMode: selection\.maxMode/);
});

// ---------- B1 / AUDIT-W18: local-exec daemon orphan watchdog ----------

test("the local-exec daemon shuts itself down when its parent dies", async () => {
  const { runLocalExecDaemonMain } = await loadModule("source/local-exec-daemon/main.ts");
  let closed = false;
  let exitCode = null;
  const logs = [];
  let parentPid = 4242;
  await runLocalExecDaemonMain({
    runDaemon: async () => ({ close: async () => { closed = true; } }),
    process: { pid: 777, on: () => {}, exit: (code) => { exitCode = code ?? 0; } },
    log: (message) => logs.push(message),
    holdProcessOpen: () => ({ release: () => {} }),
    getParentPid: () => parentPid,
    orphanPollMs: 40,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(closed, false, "daemon stays up while the parent lives");
  parentPid = 15; // reparented to the WSL init subreaper — the supervisor died
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(closed, true, "orphaned daemon closes itself");
  assert.equal(exitCode, 0);
  assert.ok(logs.some((line) => line.includes("parent process exited")), logs.join(" | "));
});
