import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "belmont-turn-ownership-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"), "dir");
const output = join(scratch, "target.cjs");
await build({
  stdin: {
    contents: [
      'export { createProductionTurnRunShellAdapter } from "./source/host/runner/production-turn-run-shell-adapter.ts";',
      'export { createTurnAgentRunContext } from "./source/host/runner/turn-run-shell.ts";',
      'export { SandSettingsStore } from "./source/shared/node/settings/sand-settings-store.ts";',
      'export { createContext } from "./source/packages/context/core.ts";',
      'export { ConversationAction, ConversationStateStructure } from "./source/packages/proto/generated/agent/v1/agent_pb.ts";',
    ].join("\n"),
    resolveDir: root, loader: "ts",
  },
  outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external",
  nodePaths: [join(root, "node_modules")], logLevel: "silent",
});
// The target is in a temporary tree; dependencies resolve from this checkout.
const bundle = createRequire(import.meta.url)(output);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const state = tag => Object.assign(new bundle.ConversationStateStructure(), { auditTag: tag });

function world(options = {}) {
  const owners = [], writes = [], updates = [], disposed = [];
  const rootContext = bundle.createContext();
  let nextOwner;
  const madeOwner = () => nextOwner ??= deferred();
  const adapter = bundle.createProductionTurnRunShellAdapter({
    createOwner: async input => {
      const owner = {
        index: owners.length, requestId: input.requestId, input, entered: deferred(), result: deferred(),
        runContext: { privacyMode: 1, commitDiskPressureReminder() {} },
        dispose: () => disposed.push(owner.index),
      };
      owner.built = { agent: { runStream: async (ctx, _state, _action, _tools, persist) => {
        owner.ctx = ctx;
        owner.persist = value => persist(ctx, value);
        owner.entered.resolve();
        return owner.result.promise;
      } } };
      owners.push(owner);
      nextOwner?.resolve(owner);
      nextOwner = undefined;
      return owner;
    },
    createRunInput: async ({ owner }) => {
      await options.prepare?.(owner);
      return { action: new bundle.ConversationAction(), baseState: state("base"), mcpTools: [] };
    },
    promptOptions: () => ({}), createSession: () => ({ getModelId: () => "fixture", getExecutor: () => ({}) }),
    context: () => rootContext,
    createSettleHost: () => ({
      isSubagentRunner: false, getTranscriptId: () => "fixture", getBlobStore: () => ({}),
      agentStore: () => ({ handleCheckpoint: async (_ctx, checkpoint) => {
        await options.persist?.(checkpoint);
        writes.push(checkpoint.auditTag);
      }, getMetadata: () => undefined }),
      setLocalState() {}, ownsRunner: () => true, isRunSuperseded: () => false,
      latestPromptMessages: () => [], persistAnnouncedAgentProfile() {},
    }),
    profilePromptSnapshots: () => ({}), isSubagentRunner: false, subagents: { sessions: new Map() },
    getConversationId: () => "fixture", runGeneration: () => 1,
    setActiveTurnRequestSource() {}, beginAutoReviewUserMessageEpoch() {}, setActiveRunInterrupted() {},
    setAwaitingUserSelection() {}, isAwaitingUserSelection: () => false, emitRunLifecycle() {},
    emitUpdate: update => updates.push(update), cancelThisRun() {},
  });
  return {
    adapter, owners, writes, updates, disposed, rootContext,
    async start(id) {
      const creation = madeOwner().promise;
      const result = adapter.run("fixture prompt", { inferenceRequestId: id });
      void result.catch(() => {});
      return { owner: await creation, result };
    },
  };
}

test("escaped turns with a repeated request id cannot overwrite or emit into the replacement", { timeout: 5000 }, async () => {
  const target = world();
  const old = await target.start("same-id");
  await old.owner.entered.promise;
  target.adapter.interrupt("watchdog");
  const current = await target.start("same-id");
  await current.owner.entered.promise;
  old.owner.input.emitUpdate({ type: "text-delta", text: "obsolete output" });
  old.owner.input.cancelThisRun({ intentional: true, reason: "late old cancellation" });
  assert.equal(current.owner.ctx.signal.aborted, false);
  current.owner.result.resolve(state("new"));
  await current.result;
  await old.owner.persist(state("stale"));
  old.owner.result.resolve(state("old-final"));
  assert.equal((await old.result).aborted, true);
  assert.deepEqual(target.writes, ["new"]);
  assert.deepEqual(target.updates, []);
  assert.deepEqual(target.disposed, [1, 0]);
});

test("a checkpoint already inside asynchronous persistence completes before a newer checkpoint", { timeout: 5000 }, async () => {
  const entered = deferred(), release = deferred();
  const target = world({ persist: async checkpoint => {
    if (checkpoint.auditTag === "old-in-flight") { entered.resolve(); await release.promise; }
  } });
  const old = await target.start("old");
  await old.owner.entered.promise;
  const saving = old.owner.persist(state("old-in-flight"));
  await entered.promise;
  const current = await target.start("new");
  await current.owner.entered.promise;
  current.owner.result.resolve(state("new"));
  await tick();
  assert.equal(target.adapter.hasActiveRun(), true, "final persistence retains the current owner");
  assert.deepEqual(target.disposed, []);
  release.resolve();
  await saving;
  await current.result;
  old.owner.result.resolve(state("old-final"));
  await old.result;
  assert.deepEqual(target.writes, ["old-in-flight", "new"]);
  assert.deepEqual(target.disposed, [1, 0]);
});

test("late preparation completion disposes its own owner without replacing the newer owner", { timeout: 5000 }, async () => {
  const release = deferred();
  const target = world({ prepare: owner => owner.index === 0 ? release.promise : undefined });
  const old = await target.start("old");
  const current = await target.start("new");
  await current.owner.entered.promise;
  release.resolve();
  assert.equal((await old.result).aborted, true);
  assert.deepEqual(target.disposed, [0]);
  assert.equal(target.adapter.hasActiveRun(), true);
  current.owner.input.emitUpdate({ type: "text-delta", text: "current" });
  current.owner.result.resolve(state("new"));
  assert.equal((await current.result).text, "current");
  assert.deepEqual(target.disposed, [0, 1]);
});

test("owners are disposed when preparation or final persistence rejects", { timeout: 5000 }, async () => {
  const prepare = world({ prepare: () => { throw new Error("fixture preparation failure"); } });
  const failed = await prepare.start("prepare");
  await assert.rejects(failed.result, /fixture preparation failure/);
  assert.deepEqual(prepare.disposed, [0]);
  assert.equal(prepare.adapter.hasActiveRun(), false);

  const persist = world({ persist: () => { throw new Error("fixture persistence failure"); } });
  const ended = await persist.start("persist");
  await ended.owner.entered.promise;
  ended.owner.result.resolve(state("final"));
  await assert.rejects(ended.result, /fixture persistence failure/);
  assert.deepEqual(persist.disposed, [0]);
  assert.equal(persist.adapter.hasActiveRun(), false);
});

test("completed turns release listeners on the long-lived context", { timeout: 5000 }, async () => {
  const target = world();
  const baseline = getEventListeners(target.rootContext.signal, "abort").length;
  for (let index = 0; index < 3; index++) {
    const turn = await target.start(`turn-${index}`);
    await turn.owner.entered.promise;
    turn.owner.result.resolve(state(`state-${index}`));
    await turn.result;
  }
  assert.equal(getEventListeners(target.rootContext.signal, "abort").length, baseline);
  assert.deepEqual(target.disposed, [0, 1, 2]);
});

test("summarization keeps the selected provider model namespace", { timeout: 5000 }, async () => {
  const previousRoot = process.env.SAND_DATA_ROOT;
  process.env.SAND_DATA_ROOT = join(scratch, "settings-fixture");
  try {
    const settings = new bundle.SandSettingsStore(join(process.env.SAND_DATA_ROOT, "settings.json"));
    for (const [provider, modelId, expected] of [
      ["codex", "gpt-5.5", process.env.SAND_CODEX_SUMMARY_MODEL?.trim() || "gpt-5.6-luna"],
      ["claude-code", "claude-sonnet-fixture", "claude-sonnet-fixture"],
      ["openrouter", "anthropic/claude-fixture", "anthropic/claude-fixture"],
      ["codex", "nvidia/vendor/model-fixture", "nvidia/vendor/model-fixture"],
    ]) {
      settings.setInferenceProvider(provider);
      const context = await bundle.createTurnAgentRunContext({
        context: {}, conversationId: "fixture", requestId: "fixture-request", modelId,
        inference: { resolvePrivacyMode: () => 1, createSession: () => { throw new Error("unexpected Cursor route"); } },
        onRequestId() {}, isSubagentRunner: false, isSilenceAllowed: true,
        canUseSelfSummary: () => true, cancelThisRun() {}, emittedConnectorCards: new Set(),
      });
      assert.equal(context.sessions.summarization.getModelId(), expected, provider);
      context.dispose();
    }
  } finally {
    if (previousRoot === undefined) delete process.env.SAND_DATA_ROOT;
    else process.env.SAND_DATA_ROOT = previousRoot;
  }
});
