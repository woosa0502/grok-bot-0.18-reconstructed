// ⚠ SCOPE (AUDIT-F1/F2): every module exercised here is RECOVERED reference code
// that is intentionally NOT wired into the production composition (stream retry
// runs through stream-attempt.ts; video subagents are dormant in local mode).
// These tests pin the recovered sources against drift — they are NOT evidence
// that the features work in the product. Product evidence lives in the live
// verification ledgers (docs/testing/belmont-full-test-report.md).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "belmont-restoration-"));
  try {
    await symlink(path.join(repoRoot, "node_modules"), path.join(temporary, "node_modules"), "dir");
    const output = path.join(temporary, "module.mjs");
    await build({
      entryPoints: [path.join(repoRoot, entry)],
      outfile: output,
      bundle: true,
      format: "esm",
      packages: "external",
      platform: "node",
      target: "node22",
    });
    const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
    return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

test("recovered video configs retain the shipped types, models, and isolation", async () => {
  const original = await readFile(
    path.join(repoRoot, "src/app/dist/host/host-main.cjs"),
    "utf8",
  );
  assert.ok(original.includes("../packages/agent/dist/tools/cloud-agents/subagent/video-review-subagent.js"));
  assert.ok(original.includes("../packages/agent/dist/tools/cloud-agents/subagent/watch-video-subagent.js"));

  const loaded = await loadModule("source/host/runner/recovered-video-subagent-configs.ts");
  try {
    const [review, watch] = loaded.module.createRecoveredVideoSubagentConfigs();
    assert.equal(review.subagent_type.type.case, "mediaReview");
    assert.equal(watch.subagent_type.type.case, "watchVideo");
    assert.equal(review.permissionMode, 2);
    assert.equal(watch.permissionMode, 2);
    assert.deepEqual(review.defaultModelIds, ["gemini-3.1-pro"]);
    assert.deepEqual(watch.defaultModelIds, [
      "gemini-3.1-pro",
      "gemini-3-flash",
      "gemini-2.5-flash",
    ]);
    assert.equal(review.forceDefaultModel, true);
    assert.equal(watch.forceDefaultModel, true);
    assert.deepEqual(review.toolsOverride(), []);
    assert.deepEqual(watch.toolsOverride(), []);
    assert.match(watch.description, /prefer VideoReview/);
    assert.ok(original.includes(review.systemReminder().trim()));
    assert.ok(original.includes(watch.systemReminder().trim()));
    assert.ok(original.includes(review.description));
    for (const sentence of [
      "Describe or analyze videos with an expert video description and analysis model.",
      "Use WatchVideo for user-inputted videos; if you generate a video artifact, prefer VideoReview.",
      "When resuming, you need not re-attach the videos.",
    ]) {
      assert.ok(original.includes(sentence));
      assert.ok(watch.description.includes(sentence));
    }
  } finally {
    await loaded.dispose();
  }
});

test("recovered production stream retries from an accepted checkpoint", async () => {
  const [retryLoaded, protoLoaded, contextLoaded] = await Promise.all([
    loadModule("source/host/runner/recovered-production-stream-retry.ts"),
    loadModule("source/packages/proto/generated/agent/v1/agent_pb.ts"),
    loadModule("source/packages/context/core.ts"),
  ]);
  try {
    const { ConversationAction, ConversationStateStructure } = protoLoaded.module;
    const context = contextLoaded.module.createContext();
    const baseState = new ConversationStateStructure({ activeBranchName: "base" });
    const checkpoint = new ConversationStateStructure({ activeBranchName: "checkpoint" });
    const finalState = new ConversationStateStructure({ activeBranchName: "final" });
    let attempts = 0;
    let outputProduced = false;
    let persisted = 0;
    let accepted = 0;
    let retrying = 0;
    const reports = [];
    const runner = retryLoaded.module.createRecoveredProductionStreamRetry({
      agent: {
        agent: {
          async runStream(attemptContext, state, _action, _mcpTools, persist) {
            attempts += 1;
            if (attempts === 1) {
              await persist(attemptContext, checkpoint);
              outputProduced = true;
              const error = new Error("socket hang up");
              error.code = "ECONNRESET";
              throw error;
            }
            assert.equal(state.activeBranchName, "checkpoint");
            return finalState;
          },
        },
      },
      baseState,
      action: new ConversationAction(),
      privacyMode: 0,
      mcpTools: [],
      attempt: {
        ctx: context,
        hidden: false,
        transientStreamRetry: {
          maxAttempts: 2,
          baseDelayMs: 0,
          maxDelayMs: 0,
          sleep: async () => {},
          random: () => 0,
        },
        setStreamOutputProduced(value) { outputProduced = value; },
        getStreamOutputProduced() { return outputProduced; },
        createDeadlineTimer() { return { cancel() {}, restart() {} }; },
        setDeadlineHooks() {},
        clearDeadlineHookIf() {},
        setTraceAttributes() {},
        emitRetrying() { retrying += 1; },
        reportTurnRetry(info) { reports.push(info); },
      },
      async persistCheckpoint(_context, value) {
        assert.equal(value.activeBranchName, "checkpoint");
        persisted += 1;
      },
      onCheckpointAccepted(value) {
        assert.equal(value.activeBranchName, "checkpoint");
        accepted += 1;
      },
    });
    const result = await runner.run();
    assert.equal(result.activeBranchName, "final");
    assert.equal(attempts, 2);
    assert.equal(persisted, 1);
    assert.equal(accepted, 1);
    assert.equal(retrying, 1);
    assert.equal(reports[0].outcome, "retried");
  } finally {
    await Promise.all([
      retryLoaded.dispose(),
      protoLoaded.dispose(),
      contextLoaded.dispose(),
    ]);
  }
});

test("recovered production stream refuses a stale checkpoint after new output", async () => {
  const [retryLoaded, protoLoaded, contextLoaded] = await Promise.all([
    loadModule("source/host/runner/recovered-production-stream-retry.ts"),
    loadModule("source/packages/proto/generated/agent/v1/agent_pb.ts"),
    loadModule("source/packages/context/core.ts"),
  ]);
  try {
    const { ConversationAction, ConversationStateStructure } = protoLoaded.module;
    const context = contextLoaded.module.createContext();
    const checkpoint = new ConversationStateStructure({ activeBranchName: "accepted-a" });
    let attempts = 0;
    let outputProduced = false;
    const reports = [];
    const runner = retryLoaded.module.createRecoveredProductionStreamRetry({
      agent: {
        agent: {
          async runStream(attemptContext, state, _action, _mcpTools, persist) {
            attempts += 1;
            outputProduced = true;
            if (attempts === 1) {
              await persist(attemptContext, checkpoint);
              throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
            }
            assert.equal(state.activeBranchName, "accepted-a");
            throw new Error("automation-only retry candidate");
          },
        },
      },
      baseState: new ConversationStateStructure({ activeBranchName: "base" }),
      action: new ConversationAction(),
      privacyMode: 0,
      mcpTools: [],
      attempt: {
        ctx: context,
        hidden: false,
        transientStreamRetry: {
          maxAttempts: 3,
          baseDelayMs: 0,
          maxDelayMs: 0,
          sleep: async () => {},
          isRetryable: () => true,
        },
        setStreamOutputProduced(value) { outputProduced = value; },
        getStreamOutputProduced() { return outputProduced; },
        createDeadlineTimer() { return { cancel() {}, restart() {} }; },
        setDeadlineHooks() {},
        clearDeadlineHookIf() {},
        setTraceAttributes() {},
        emitRetrying() {},
        reportTurnRetry(info) { reports.push(info); },
      },
      persistCheckpoint: async () => {},
    });
    await assert.rejects(runner.run(), /automation-only retry candidate/);
    assert.equal(attempts, 2, "new output without a new checkpoint must stop retrying");
    assert.deepEqual(reports.map((report) => report.outcome), [
      "retried",
      "gave_up_ineligible",
    ]);
  } finally {
    await Promise.all([
      retryLoaded.dispose(),
      protoLoaded.dispose(),
      contextLoaded.dispose(),
    ]);
  }
});

test("recovered model catalog filters routed models and repairs an invalid default", async () => {
  const loaded = await loadModule(
    "frontend/src/recovered/runtime/model-catalog-reconciliation.ts",
  );
  try {
    const payload = {
      models: [
        { name: "default", defaultOn: true, visibleInRoutedModelView: true },
        { name: "alpha", variants: [] },
        {
          name: "beta",
          defaultOn: true,
          variants: [{
            isMaxMode: true,
            isDefaultMaxConfig: true,
            parameterValues: [{ id: "effort", value: "high" }],
          }],
        },
        { name: "migrated", cloudMigrateToModel: "beta" },
      ],
    };
    const projection = loaded.module.projectAvailableModelCatalog(
      payload,
      ["default", "alpha", "beta", "migrated"],
    );
    assert.deepEqual([...projection.allowedModelIds], ["alpha", "beta"]);
    assert.deepEqual(projection.fallback, {
      modelId: "beta",
      maxMode: true,
      parameters: [{ id: "effort", value: "high" }],
    });

    const writes = [];
    const result = await loaded.module.reconcileDefaultModelCatalog({
      bridge: {
        getAvailableModels: async () => payload,
        getDefaultModel: async () => ({ modelId: "removed", maxMode: false, parameters: [] }),
        setDefaultModel: async (model) => { writes.push(model); return model; },
      },
      modelFilterAllowedIds: ["alpha", "beta"],
    });
    assert.equal(result.didReplaceDefault, true);
    assert.equal(result.storedModel.modelId, "beta");
    assert.equal(writes.length, 1);

    const passthrough = loaded.module.projectAvailableModelCatalog(payload, []);
    assert.equal(passthrough.payload, payload);
    assert.equal(passthrough.fallback, undefined);

    const duplicates = loaded.module.projectAvailableModelCatalog({
      models: [
        {
          name: "dup",
          defaultOn: true,
          cloudAgentEffortMode: 2,
          variants: [{ isMaxMode: true, parameterValues: [{ id: "tier", value: "grind" }] }],
        },
        {
          name: "dup",
          cloudAgentEffortMode: 1,
          variants: [{ isMaxMode: true, parameterValues: [{ id: "tier", value: "standard" }] }],
        },
        { name: "later", defaultOn: true, variants: [] },
      ],
    }, ["dup", "later"]);
    assert.deepEqual([...duplicates.allowedModelIds], ["dup", "later"]);
    assert.equal(duplicates.fallback.modelId, "later");
    assert.equal(duplicates.payload.models[0].namedModelSectionIndex, undefined);
    assert.equal(duplicates.payload.models[1].namedModelSectionIndex, 0);
    assert.equal(duplicates.payload.models[2].namedModelSectionIndex, 1);
  } finally {
    await loaded.dispose();
  }
});

test("every new restoration source stays below the 500-line limit", async () => {
  const files = [
    "source/packages/agent/tools/cloud-agents/subagent/video-review-subagent.ts",
    "source/packages/agent/tools/cloud-agents/subagent/watch-video-subagent.ts",
    "source/host/runner/recovered-video-subagent-configs.ts",
    "source/host/runner/recovered-production-stream-retry.ts",
    "frontend/src/recovered/runtime/model-catalog-reconciliation.ts",
    "tests/unimplemented-restoration-code.test.mjs",
  ];
  for (const file of files) {
    const contents = await readFile(path.join(repoRoot, file), "utf8");
    assert.ok(contents.split("\n").length - 1 < 500, `${file} must stay below 500 lines`);
  }
});
