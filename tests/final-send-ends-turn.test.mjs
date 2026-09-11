// Final delivery closes the turn (2026-09-11). Measured on the phone PWA: after Belmont's last
// SendMessage the character stayed in "응답 후 처리 중" for ~7s (test bot, 07:41:06.7 reply →
// 07:41:14.1 run end) because the model had to come back once more to emit an empty closing
// message ("Preparing final invisible assistant message"). That round trip delivers nothing.
// Now the model marks the closing SendMessage with final: true; the run shell cuts the stream
// at the next persisted checkpoint (the one carrying the tool result) and settles the turn as
// completed — memory evidence recorded, final state persisted, no abort, no nudge.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");
const scratch = mkdtempSync(join(tmpdir(), "belmont-final-send-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"), "dir");
const output = join(scratch, "target.cjs");
await build({
  stdin: {
    contents: [
      'export { createProductionTurnRunShellAdapter } from "./source/host/runner/production-turn-run-shell-adapter.ts";',
      'export { createContext } from "./source/packages/context/core.ts";',
      'export { ConversationAction, ConversationStateStructure } from "./source/packages/proto/generated/agent/v1/agent_pb.ts";',
      'export { sendMessageParameters } from "./source/host/runner/tools/send-message-schema.ts";',
      'export { buildSandSendMessage, createSendMessageTool } from "./source/host/runner/tools/send-message-tool.ts";',
    ].join("\n"),
    resolveDir: root, loader: "ts",
  },
  outfile: output, bundle: true, platform: "node", format: "cjs", packages: "external",
  nodePaths: [join(root, "node_modules")], logLevel: "silent",
});
const bundle = createRequire(import.meta.url)(output);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const state = tag => Object.assign(new bundle.ConversationStateStructure(), { auditTag: tag });

function world() {
  const owners = [], writes = [], updates = [], evidence = [];
  const rootContext = bundle.createContext();
  let nextOwner;
  const madeOwner = () => nextOwner ??= deferred();
  const adapter = bundle.createProductionTurnRunShellAdapter({
    createOwner: async input => {
      const owner = {
        index: owners.length, input, entered: deferred(), result: deferred(),
        runContext: { privacyMode: 1, commitDiskPressureReminder() {} },
        dispose() {},
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
    createRunInput: async () => ({ action: new bundle.ConversationAction(), baseState: state("base"), mcpTools: [] }),
    promptOptions: () => ({}), createSession: () => ({ getModelId: () => "fixture", getExecutor: () => ({}) }),
    context: () => rootContext,
    createSettleHost: () => ({
      isSubagentRunner: false, getTranscriptId: () => "fixture", getBlobStore: () => ({}),
      agentStore: () => ({ handleCheckpoint: async (_ctx, checkpoint) => { writes.push(checkpoint.auditTag); }, getMetadata: () => undefined }),
      setLocalState() {}, ownsRunner: () => true, isRunSuperseded: () => false,
      latestPromptMessages: () => [], persistAnnouncedAgentProfile() {},
    }),
    // Dreaming-style store: settle records evidence for every completed user turn.
    memoryStore: () => ({
      recordMemoryEvidence: item => evidence.push(item),
      recall: () => ({ profile: [], recent: [] }), listMemories: () => [], addMemory: () => null,
    }),
    profilePromptSnapshots: () => ({}), isSubagentRunner: false, subagents: { sessions: new Map() },
    getConversationId: () => "fixture", runGeneration: () => 1,
    setActiveTurnRequestSource() {}, beginAutoReviewUserMessageEpoch() {}, setActiveRunInterrupted() {},
    setAwaitingUserSelection() {}, isAwaitingUserSelection: () => false, emitRunLifecycle() {},
    emitUpdate: update => updates.push(update), cancelThisRun() {},
  });
  return {
    adapter, owners, writes, updates, evidence,
    async start(prompt = "오늘 온 메일은?") {
      const creation = madeOwner().promise;
      const result = adapter.run(prompt, { inferenceRequestId: "req-1" });
      void result.catch(() => {});
      return { owner: await creation, result };
    },
  };
}
const sent = (content) => ({ type: "send-message", message: { type: "text", content }, timestampMs: 1 });

test("final delivery: the run is cut at the next persisted checkpoint and settles as a completed turn", { timeout: 5000 }, async () => {
  const target = world();
  const { owner, result } = await target.start();
  await owner.entered.promise;
  owner.input.emitUpdate(sent("오늘 온 메일은 2개야."));
  owner.input.emitUpdate({ type: "final-delivery" });
  assert.equal(owner.ctx.signal.aborted, false, "the cut waits for the checkpoint that carries the delivery");
  await owner.persist(state("after-final-send"));
  assert.equal(owner.ctx.signal.aborted, true);
  assert.equal(owner.ctx.signal.reason?.reason, "final message delivered");
  assert.equal(owner.ctx.signal.reason?.intentional, true);
  // The real Agent stream rejects once its context is cancelled; that is not an abort here.
  owner.result.reject(new Error("stream cancelled"));
  const settled = await result;
  assert.equal(settled.aborted, false);
  assert.equal(settled.completedOnFinalDelivery, true);
  assert.equal(settled.awaitingUserSelection, undefined);
  assert.equal(settled.sentMessageCount, 1);
  assert.deepEqual(target.writes, ["after-final-send", "after-final-send"], "step checkpoint, then the same state finalized");
  assert.deepEqual(target.evidence.map(item => [item.user, item.assistant]), [["오늘 온 메일은?", "오늘 온 메일은 2개야."]]);
  assert.deepEqual(target.updates.map(update => update.type), ["send-message"], "the owner-internal signal never reaches the transport");
  assert.equal(target.adapter.hasActiveRun(), false);
});

test("final delivery: a stream that returns normally after the cut also settles as completed", { timeout: 5000 }, async () => {
  const target = world();
  const { owner, result } = await target.start();
  await owner.entered.promise;
  owner.input.emitUpdate(sent("done"));
  owner.input.emitUpdate({ type: "final-delivery" });
  await owner.persist(state("after-final-send"));
  owner.result.resolve(state("returned"));
  const settled = await result;
  assert.equal(settled.aborted, false);
  assert.equal(settled.completedOnFinalDelivery, true);
  assert.deepEqual(target.writes, ["after-final-send", "returned"]);
  assert.equal(target.evidence.length, 1);
});

test("without final, a delivery and its checkpoint leave the run going", { timeout: 5000 }, async () => {
  const target = world();
  const { owner, result } = await target.start();
  await owner.entered.promise;
  owner.input.emitUpdate(sent("확인해볼게."));
  await owner.persist(state("after-ack"));
  assert.equal(owner.ctx.signal.aborted, false);
  owner.result.resolve(state("final"));
  const settled = await result;
  assert.equal(settled.aborted, false);
  assert.equal(settled.completedOnFinalDelivery, undefined);
  assert.deepEqual(target.writes, ["after-ack", "final"]);
});

test("a user interrupt after final was requested but before its checkpoint is still an abort", { timeout: 5000 }, async () => {
  const target = world();
  const { owner, result } = await target.start();
  await owner.entered.promise;
  owner.input.emitUpdate(sent("done"));
  owner.input.emitUpdate({ type: "final-delivery" });
  target.adapter.interrupt("user stop");
  owner.result.reject(new Error("stream cancelled"));
  const settled = await result;
  assert.equal(settled.aborted, true);
  assert.equal(settled.completedOnFinalDelivery, undefined);
  assert.deepEqual(target.writes, []);
  assert.deepEqual(target.evidence, []);
});

test("schema: final rides text/attachment deliveries only, and never leaks into the outgoing message", async () => {
  const ok = bundle.sendMessageParameters.safeParse({ type: "text", content: "done", final: true });
  assert.equal(ok.success, true);
  const widget = bundle.sendMessageParameters.safeParse({ type: "widget", widget: { prompt: "Deploy?", options: [{ label: "Yes" }] }, final: true });
  assert.equal(widget.success, false);
  assert.match(widget.error.issues.map(issue => issue.message).join("\n"), /final is not needed with type:widget/);
  const message = await bundle.buildSandSendMessage({}, { type: "text", content: "done", final: true }, { getIngestAttachment: () => undefined, onSendMessage: () => undefined });
  assert.deepEqual(message, { type: "text", content: "done" });
});

test("tool: onFinalDelivery fires after the send, and only for final: true", async () => {
  const calls = [];
  const deps = { getIngestAttachment: () => undefined, onSendMessage: message => { calls.push(["send", message.content]); return "t9s0"; }, onFinalDelivery: () => calls.push(["final"]) };
  const tool = bundle.createSendMessageTool(deps);
  const handler = { emitPartialToolCall() {}, executeToolCall: async (_ctx, _initial, _id, run) => run() };
  const ctx = bundle.createContext();
  const args = value => (async function* () { yield JSON.stringify(value); })();
  const first = await tool.execute(ctx, handler, args({ type: "text", content: "done", final: true }), { toolCallId: "c1" });
  assert.equal(first.result.case, "success");
  const second = await tool.execute(ctx, handler, args({ type: "text", content: "more" }), { toolCallId: "c2" });
  assert.equal(second.result.case, "success");
  assert.deepEqual(calls, [["send", "done"], ["final"], ["send", "more"]]);
});

test("wiring: the per-turn SendMessage dependencies raise the owner-internal signal and the prompt teaches final", () => {
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /onFinalDelivery: \(\) => \{\s*turn\.emitUpdate\?\.\(\{ type: "final-delivery" \}\);/);
  const relay = read("source/host/runner/production-turn-run-shell-adapter.ts");
  assert.match(relay, /update\.type === "final-delivery"[\s\S]*?callbacks\?\.completeAfterDelivery\(\);\s*return;/);
  assert.match(read("source/host/runner/system-prompt.ts"), /Mark that closing SendMessage with final: true/);
  assert.match(read("source/host/runner/tools/send-message-tool.ts"), /set final: true on the SendMessage that carries the result/);
});
