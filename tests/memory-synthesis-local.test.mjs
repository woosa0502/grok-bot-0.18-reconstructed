// Memory synthesis ("dreaming") in local Codex mode: the gate pin no longer
// waits for a Cursor Statsig bootstrap that never comes, the synthesis executor
// uses the provider-aware summarization channel instead of forwarding the
// cursor-only gemini model id to Pi, and the launcher turns the gate on by
// default (explicit SAND_FEATURE_GATE_OVERRIDES values still win).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { mergeGateOverrides, wslHostEnvironment } from "../scripts/lib/wsl-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadModules() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "memory-synthesis-entry.ts",
      contents: `
        export { MemorySynthesisService } from "./source/host/extensions/memory/memory-synthesis-service.js";
        export { FileMemoryStore } from "./source/host/extensions/memory/memory-service.js";
        export { pinGateWithLocalFallback, localGatePinValue } from "./source/host/extensions/experiments/extension.js";
        export { createHostInference } from "./source/host/extensions/inference/inference-service.js";
        export { createRealDebouncePolicy } from "./source/internal/scheduling.js";
        export { SandSettingsStore } from "./source/shared/node/settings/sand-settings-store.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    // The agent-package graph uses `using`/`await using` declarations, which the
    // data:-URL ESM loader rejects; have esbuild lower them to try/finally.
    supported: { using: false },
    define: { "import.meta.url": JSON.stringify(pathToFileURL(path.join(repoRoot, "tests/memory-synthesis-entry.ts")).href) },
    banner: { js: `import { createRequire as __belmontCreateRequire } from "node:module"; const require = __belmontCreateRequire(${JSON.stringify(pathToFileURL(path.join(repoRoot, "tests/")).href)});` },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------- 1. launcher gate default ----------

test("mergeGateOverrides appends the default only when the gate is not mentioned", () => {
  assert.equal(mergeGateOverrides(undefined, "sand_memory_dreaming", "1"), "sand_memory_dreaming=1");
  assert.equal(mergeGateOverrides("", "sand_memory_dreaming", "1"), "sand_memory_dreaming=1");
  assert.equal(mergeGateOverrides("other_gate=0", "sand_memory_dreaming", "1"), "other_gate=0,sand_memory_dreaming=1");
  // An explicit user value — on OR off — always wins over the launcher default.
  assert.equal(mergeGateOverrides("sand_memory_dreaming=0", "sand_memory_dreaming", "1"), "sand_memory_dreaming=0");
  assert.equal(mergeGateOverrides(" sand_memory_dreaming = 0 ,other=1", "sand_memory_dreaming", "1"), " sand_memory_dreaming = 0 ,other=1");
});

test("the host launcher environment enables sand_memory_dreaming by default", async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), "belmont-launcher-"));
  try {
    const byDefault = wslHostEnvironment({ profileDir, env: {} });
    assert.equal(byDefault.SAND_FEATURE_GATE_OVERRIDES, "sand_memory_dreaming=1");
    const optedOut = wslHostEnvironment({ profileDir, env: { SAND_FEATURE_GATE_OVERRIDES: "sand_memory_dreaming=0" } });
    assert.equal(optedOut.SAND_FEATURE_GATE_OVERRIDES, "sand_memory_dreaming=0");
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

// ---------- 2. gate pin in local mode ----------

test("pinGateWithLocalFallback pins immediately from the local evaluation in local mode", async () => {
  const { pinGateWithLocalFallback } = await loadModules();
  const pins = [];
  pinGateWithLocalFallback({
    isLocalMode: true,
    evaluateLocalPin: (name) => name === "sand_memory_dreaming",
    pinOnAuthenticatedBootstrap: () => { throw new Error("must not wait for an authenticated bootstrap in local mode"); },
  }, "sand_memory_dreaming", (value) => pins.push(value));
  assert.deepEqual(pins, [true], "the pin fires synchronously with the locally evaluated value");

  const deferred = [];
  pinGateWithLocalFallback({
    isLocalMode: false,
    evaluateLocalPin: () => { throw new Error("cursor mode must defer to the authenticated bootstrap"); },
    pinOnAuthenticatedBootstrap: (name, pin) => deferred.push({ name, pin }),
  }, "sand_memory_dreaming", () => {});
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].name, "sand_memory_dreaming");
});

test("local pin evaluation is explicit-only: persisted override, then env, otherwise OFF", async () => {
  const { localGatePinValue } = await loadModules();
  // The critical property (adversarial review #1): a gate that nobody enabled
  // explicitly pins OFF — never from the cached anonymous Statsig client or a
  // bundled default. This keeps unrelated pinned gates (stale-root GC,
  // conversation GC, legacy blob retirement) at their pre-reroute
  // never-enabled behavior, deterministically.
  assert.equal(localGatePinValue({ storedOverride: undefined, env: {} }, "sand_stale_root_gc"), false);
  assert.equal(localGatePinValue({ storedOverride: undefined, env: { SAND_FEATURE_GATE_OVERRIDES: "other=1" } }, "grok_bot_conversation_gc"), false);
  assert.equal(localGatePinValue({ storedOverride: undefined, env: { SAND_FEATURE_GATE_OVERRIDES: "sand_memory_dreaming=1" } }, "sand_memory_dreaming"), true);
  assert.equal(localGatePinValue({ storedOverride: undefined, env: { SAND_FEATURE_GATE_OVERRIDES: "sand_memory_dreaming=0" } }, "sand_memory_dreaming"), false);
  assert.equal(localGatePinValue({ storedOverride: false, env: { SAND_FEATURE_GATE_OVERRIDES: "sand_memory_dreaming=1" } }, "sand_memory_dreaming"), false, "a persisted override wins over the env default");
  assert.equal(localGatePinValue({ storedOverride: true, env: {} }, "sand_memory_dreaming"), true);
});

test("the experiments extension routes the pin API through the local fallback with the explicit-only evaluator", () => {
  const ext = read("source/host/extensions/experiments/extension.ts");
  assert.match(ext, /pinGateOnAuthenticatedBootstrap: \(name[\s\S]{0,220}pinGateWithLocalFallback\(\{ isLocalMode: isLocalCodexMode\(process\.env\)/);
  assert.match(ext, /evaluateLocalPin: \(gate\) => localGatePinValue\(\{ storedOverride: service\.getFeatureFlagOverridesRecord\(\)\[gate as typeof name\], env: process\.env \}/);
});

// ---------- 3. provider-aware summarization channel ----------

test("createSummarizationSession substitutes the local provider model where createSession forwards the gemini id", async () => {
  const { createHostInference, SandSettingsStore } = await loadModules();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-inference-"));
  const savedRoot = process.env.SAND_DATA_ROOT, savedModel = process.env.SAND_CODEX_MODEL;
  try {
    new SandSettingsStore(path.join(root, "settings.json")).setInferenceProvider("codex");
    process.env.SAND_DATA_ROOT = root;
    delete process.env.SAND_CODEX_MODEL;
    const api = createHostInference({
      auth: { getAccessToken: async () => "unused", getMachineId: () => "machine" },
      experiments: { checkFeatureGate: () => false, getComputerUseModelOverride: () => undefined, getBrowserUseModelOverride: () => undefined, getSandModelExperimentState: () => undefined, hasHydratedStatsigUserId: () => false, getConfiguredDefaultModel: () => undefined, getConfiguredAutomationsModel: () => undefined },
      settings: { getAgentDefaultModel: () => undefined, getComputerUseModel: () => undefined, getInferenceProvider: () => "codex", recordInferenceUsage: () => {} },
      onModelExperimentApplied: () => {},
    });
    // The raw session channel forwards the requested model verbatim — this is the
    // path that made Pi throw "Unknown Pi Codex model: gemini-2.5-flash".
    assert.equal(api.createSession(() => {}, { modelId: "gemini-2.5-flash" }).getModelId(), "gemini-2.5-flash");
    // The summarization channel is provider-aware and lands on the configured local model.
    assert.equal(api.createSummarizationSession(() => {}).getModelId(), "gpt-5.5");
  } finally {
    if (savedRoot == null) delete process.env.SAND_DATA_ROOT; else process.env.SAND_DATA_ROOT = savedRoot;
    if (savedModel == null) delete process.env.SAND_CODEX_MODEL; else process.env.SAND_CODEX_MODEL = savedModel;
    await rm(root, { recursive: true, force: true });
  }
});

test("memory synthesis builds its executor on the summarization channel", () => {
  const production = read("source/host/extensions/memory/production.ts");
  assert.match(production, /port\.createSummarizationSession != null/);
  assert.match(production, /port\.createSummarizationSession\(\(\) => \{\}, \{\s*modelId: SAND_SUMMARIZATION_MODEL_ID,\s*skipLabeling: true\s*\}\)/);
});

// ---------- 4. synthesis end-to-end with a scripted model ----------

function scriptedExecutor(respond) {
  const requests = [];
  return {
    requests,
    executorFor: (stage) => ({
      appendMessages(messages) { requests.push({ stage, messages }); return this; },
      stream: () => ({
        fullStream: (async function* () { yield { type: "text-delta", textDelta: respond(stage) }; })(),
      }),
    }),
  };
}

test("recorded turn evidence synthesizes into a committed memory (propose → verify → apply)", async () => {
  const { MemorySynthesisService, FileMemoryStore, createRealDebouncePolicy } = await loadModules();
  const dir = await mkdtemp(path.join(tmpdir(), "belmont-dreaming-"));
  try {
    const store = new FileMemoryStore(dir, createRealDebouncePolicy({ name: "test", delayMs: 0 }));
    const scripted = scriptedExecutor((stage) => stage === "synthesis"
      ? JSON.stringify({ changes: [{ action: "create", content: "User ships the weekly report on Fridays", kind: "log", sourceEvidenceIds: ["e1"] }] })
      : JSON.stringify({ approved: true }));
    const service = new MemorySynthesisService({
      getTarget: () => store,
      listTargets: () => [],
      createExecutor: (stage) => scripted.executorFor(stage),
    });
    service.start();
    service.recordTurn("agent-1", { id: "e1", user: "매주 금요일에 주간 보고를 보낸다", assistant: "알겠습니다. 기억해 둘게요.", occurredAt: 1_000 });
    const outcomes = await service.runNow();
    service.dispose();
    assert.deepEqual(outcomes, ["committed"]);
    assert.deepEqual(scripted.requests.map((request) => request.stage), ["synthesis", "verification"], "the proposal is verified before it is applied");
    const memories = store.listMemories();
    assert.equal(memories.length, 1);
    assert.equal(memories[0].content, "User ships the weekly report on Fridays");
    const origins = store.prepareSynthesis().memories;
    assert.equal(origins[0]?.origin, "synthesis", "committed facts carry the synthesis origin marker");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a rejected verification leaves the memory state untouched", async () => {
  const { MemorySynthesisService, FileMemoryStore, createRealDebouncePolicy } = await loadModules();
  const dir = await mkdtemp(path.join(tmpdir(), "belmont-dreaming-reject-"));
  try {
    const store = new FileMemoryStore(dir, createRealDebouncePolicy({ name: "test", delayMs: 0 }));
    const scripted = scriptedExecutor((stage) => stage === "synthesis"
      ? JSON.stringify({ changes: [{ action: "create", content: "Fabricated fact", kind: "profile", sourceEvidenceIds: ["e1"] }] })
      : JSON.stringify({ approved: false }));
    const reports = [];
    const service = new MemorySynthesisService({
      getTarget: () => store,
      listTargets: () => [],
      createExecutor: (stage) => scripted.executorFor(stage),
      report: (event) => reports.push(event),
    });
    service.start();
    service.recordTurn("agent-1", { id: "e1", user: "hello", assistant: "hi", occurredAt: 1_000 });
    const outcomes = await service.runNow();
    service.dispose();
    assert.deepEqual(outcomes, ["rejected"]);
    assert.equal(store.listMemories().length, 0);
    assert.equal(reports.at(-1)?.outcome, "rejected");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a transient transport failure keeps the evidence pending and a later pass commits it", async () => {
  const { MemorySynthesisService, FileMemoryStore, createRealDebouncePolicy } = await loadModules();
  const dir = await mkdtemp(path.join(tmpdir(), "belmont-dreaming-retry-"));
  try {
    const store = new FileMemoryStore(dir, createRealDebouncePolicy({ name: "test", delayMs: 0 }));
    let synthesisCalls = 0;
    const executorFor = (stage) => ({
      appendMessages() { return this; },
      stream: () => ({
        fullStream: (async function* () {
          if (stage === "verification") { yield { type: "text-delta", textDelta: JSON.stringify({ approved: true }) }; return; }
          synthesisCalls += 1;
          // First attempt: a transport error (transient, SAND-E0413 retryable:true). Before the fix this
          // dropped the evidence in the catch; now it must be kept for a later pass.
          if (synthesisCalls === 1) { yield { type: "error", error: new Error("simulated transport failure") }; return; }
          yield { type: "text-delta", textDelta: JSON.stringify({ changes: [{ action: "create", content: "User lives in Seoul", kind: "profile", sourceEvidenceIds: ["e1"] }] }) };
        })(),
      }),
    });
    const reports = [];
    const service = new MemorySynthesisService({ getTarget: () => store, listTargets: () => [], createExecutor: executorFor, report: (event) => reports.push(event) });
    service.start();
    service.recordTurn("agent-1", { id: "e1", user: "서울에 삽니다", assistant: "기억할게요", occurredAt: 1_000 });
    const first = await service.runNow();
    assert.deepEqual(first, ["failed"], "a transport failure reports failed");
    assert.equal(store.listMemories().length, 0, "nothing is committed on the failed pass");
    // The defect: a transient failure permanently dropped the pending evidence. The kept evidence must
    // retry and commit on the next pass instead of being lost.
    const second = await service.runNow();
    assert.deepEqual(second, ["committed"], "the retained evidence is retried and commits on a later pass");
    service.dispose();
    assert.deepEqual(store.listMemories().map((memory) => memory.content), ["User lives in Seoul"]);
    assert.equal(reports.at(-1)?.outcome, "committed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- 5. the turn-end write path is actually wired ----------

test("the settle scope receives the memory store, episode progress, and the memorable-exchange heuristic", () => {
  // Reconstruction gap found live: the runner stored session.memory via
  // setMemoryStore but never handed it to the turn shell, so the settle scope
  // had NO memory store — neither dreaming evidence nor legacy extraction ever
  // ran after a turn (recall worked; writes were dead).
  const runner = read("source/host/runner/sand-agent-runner.ts");
  assert.match(runner, /memoryStore: \(\(\) => this\.#memoryStore \?\? null\)/);
  assert.match(runner, /episodeProgress: \(\(\) => this\.#episodeProgress\)/);
  assert.match(runner, /isMemorableExchange,/);
  const adapter = read("source/host/runner/production-turn-run-shell-adapter.ts");
  assert.match(adapter, /\.\.\.\(input\.memoryStore == null \? \{\} : \{ memoryStore: input\.memoryStore \}\)/);
  assert.match(adapter, /\.\.\.\(input\.episodeProgress == null \? \{\} : \{ episodeProgress: input\.episodeProgress \}\)/);
  assert.match(adapter, /\.\.\.\(input\.isMemorableExchange == null \? \{\} : \{ isMemorableExchange: input\.isMemorableExchange \}\)/);
});

// ---------- 6. adversarial-review fixes (wave 16) ----------

test("applySynthesis removes the RIGHT facts when a batch holds two removals in one file", async () => {
  const { FileMemoryStore, createRealDebouncePolicy } = await loadModules();
  const dir = await mkdtemp(path.join(tmpdir(), "belmont-apply-"));
  try {
    const store = new FileMemoryStore(dir, createRealDebouncePolicy({ name: "test", delayMs: 0 }));
    store.addMemory("Fact one about the user", 1_000, "profile");
    store.addMemory("Fact two about the user", 2_000, "profile");
    store.addMemory("Fact three about the user", 3_000, "profile");
    const snapshot = store.prepareSynthesis();
    const idFor = (content) => snapshot.memories.find((memory) => memory.content === content)?.id;
    // "Merge duplicates" batches (create one, remove several) are the synthesis
    // prompt's intended steady state; before the fix the second removal spliced
    // a STALE line index and deleted the wrong fact while reporting committed.
    const result = store.applySynthesis(snapshot, [
      { action: "remove", id: idFor("Fact one about the user"), sourceEvidenceIds: ["e1"] },
      { action: "remove", id: idFor("Fact three about the user"), sourceEvidenceIds: ["e1"] },
    ], 4_000);
    assert.equal(result, "committed");
    assert.deepEqual(store.listMemories().map((memory) => memory.content), ["Fact two about the user"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an invalid change anywhere in the batch leaves the store completely untouched", async () => {
  const { FileMemoryStore, createRealDebouncePolicy } = await loadModules();
  const dir = await mkdtemp(path.join(tmpdir(), "belmont-apply-invalid-"));
  try {
    const store = new FileMemoryStore(dir, createRealDebouncePolicy({ name: "test", delayMs: 0 }));
    store.addMemory("Existing fact", 1_000, "profile");
    const snapshot = store.prepareSynthesis();
    const result = store.applySynthesis(snapshot, [
      { action: "create", content: "A new synthesized fact", kind: "profile", sourceEvidenceIds: ["e1"] },
      { action: "remove", id: "hallucinated-memory-id", sourceEvidenceIds: ["e1"] },
    ], 2_000);
    assert.equal(result, "invalid");
    assert.deepEqual(store.listMemories().map((memory) => memory.content), ["Existing fact"], "the valid-looking create earlier in the batch was NOT applied");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remaining review fixes are pinned: subagent settle guard, evidence try/catch, no rejected-retry, lifetime abort", () => {
  const settle = read("source/host/runner/turn-settle.ts");
  assert.match(settle, /const shouldRemember =\s*!host\.isSubagentRunner/);
  const turnMemory = read("source/host/runner/turn-memory.ts");
  assert.match(turnMemory, /try \{\s*episodeProgress\?\.clearPendingEpisodeTurns\(\);/);
  const production = read("source/host/extensions/memory/production.ts");
  assert.match(production, /error instanceof MemorySynthesisAttemptError\s*&& error\.outcome === "rejected"/);
  const synthesis = read("source/host/extensions/memory/memory-synthesis-service.ts");
  assert.match(synthesis, /AbortSignal\.any\(\[signal, this\.lifetime\.signal\]\)/);
  const inference = read("source/host/extensions/inference/inference-service.ts");
  assert.match(inference, /createProviderPromptSession\(provider, undefined, "low"\)/);
});
