import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function modules() {
  // A single bundle is essential: all real entrypoints share the same AsyncLocalStorage instance.
  const code = [
    "export { SandPendingWakeStore } from './source/host/extensions/transcript/sand-pending-wake-store.ts';",
    "export { PendingWakeRearm } from './source/host/extensions/transcript/pending-wake-rearm.ts';",
    "export { AgentToAgentMessaging } from './source/host/extensions/transcript/agent-to-agent-messaging.ts';",
    "export { CompletionRevivals } from './source/host/extensions/transcript/completion-revivals.ts';",
    "export { withPendingWakeWorkflow, agentMessageWorkflowFields } from './source/host/extensions/transcript/pending-wake-workflow.ts';",
  ].join("\n");
  const stubs = {
    "turn-runtime.js": "export const classifyAgentError = () => 'test';",
    "agent-run-error.js": "export const describeAgentRunError = () => ({detail:'test'});",
    "telemetry.js": "export const sandErrorDetail = String;",
    "transcript-store.js": "export const getTranscript = () => [];",
    "send-message-shaping.js": "export const loadAgentInboundImages = async () => [];",
  };
  if (process.env.TEST_WAKE_WORKFLOW_BASELINE === "1") stubs["pending-wake-workflow.js"] = `
    export const pendingWakeWorkflowFields = () => ({});
    export const agentMessageWorkflowFields = () => ({});
    export const withPendingWakeWorkflow = (_tm, _id, _sources, run) => run();
    export const settlePendingWakeWorkflow = (tm, source) => tm.pendingWakes.clearSettledPendingWake(source);
  `;
  const built = await build({ absWorkingDir: root, stdin: { contents: code, resolveDir: root }, bundle: true,
    platform: "node", format: "esm", target: "node26", write: false,
    plugins: [{ name: "isolated-boundaries", setup(b) {
      b.onResolve({ filter: /\.js$/ }, (args) => {
        const name = path.basename(args.path);
        return name in stubs ? { path: name, namespace: "boundary" } : null;
      });
      b.onLoad({ filter: /.*/, namespace: "boundary" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
}
const loaded = modules();
const open = [{ id: "task", content: "Finish report after child evidence", status: "in_progress" }];
const settled = (extra = {}) => ({ aborted: false, sentMessageCount: 0, reacted: false, openTodos: [], workToolCalls: 0, ...extra });
const inbound = (id) => ({ id, from: { id: "manager", name: "Manager" }, text: `Finish ${id}`, timestampMs: 1, isDisplayed: true });
const child = (id) => ({ parentAgentId: "agent", subagentAgentId: id, subagentType: "generalPurpose", title: id, status: "completed", result: `${id} evidence` });

test("batched inbound and child completion preserve independent workflows across chained handoff and restart", async () => {
  const m = await loaded;
  const directory = await mkdtemp(path.join(tmpdir(), "belmont-workflow-"));
  try {
    const store = new m.SandPendingWakeStore(directory);
    const calls = [], errors = [];
    const session = { id: "agent", db: { getTranscriptEntries: () => [] } };
    const tm = {
      pendingWakeStore: store, execution: { canExecute: true },
      sessions: { resolveBackgroundSession: async () => session, deletedAgentIds: new Set(), isAgentGone: () => false },
      groupChat: { isGroupSession: () => false, isRemoteRoomSession: () => false },
      turnRuntime: { activeRequestPrompts: new Map(), activeRequestSources: new Map() },
      runLifecycle: { beginSessionRun() {}, endSessionRun() {}, enqueueExclusiveRun: async (_id, work) => work(), lastRequestIdBySession: new Map() },
      sendPipeline: { currentTurnEpoch: () => 1 }, backgroundWakes: { dmPreemptedWakeAgentIds: new Set() },
      widgetResponses: { collectUnansweredQuestionPrompts: () => ({}) },
      roster: { emitAgentUpdate: async () => {}, emitAsyncTasksForAgent() {} },
      telemetry: { reportPendingWake() {}, reportSubagentRevival() {}, reportAgentError: (error) => errors.push(error) },
      trayErrors: { pushError: (error) => errors.push(error) },
    };
    tm.pendingWakes = new m.PendingWakeRearm(tm);
    const arm = (id) => tm.pendingWakes.persistPendingWake({ parentAgentId: "agent", kind: "subagent", workId: id, title: id, taskPrompt: `Work on ${id}` });
    const runner = { run: async (prompt) => {
      calls.push(prompt);
      await setImmediate(); // An actual asynchronous boundary between wake entry and child dispatch.
      if (calls.length === 1) { arm("child-A"); return settled({ openTodos: open, workToolCalls: 1, handedOff: true }); }
      if (calls.length === 2) { arm("child-B"); return settled({ openTodos: open, workToolCalls: 1, handedOff: true }); }
      if (calls.length === 3) { arm("grandchild-A"); return settled({ openTodos: open, workToolCalls: 1, handedOff: true }); }
      return settled({ workToolCalls: 1 });
    } };
    tm.runnerRegistry = { getRunner: () => runner };
    const messaging = new m.AgentToAgentMessaging(tm);
    for (const id of ["request-A", "request-B"]) {
      assert.equal(messaging.persistInboundMarker("agent", inbound(id)), true);
    }
    messaging.pendingAgentInbound.set("agent", [inbound("request-A"), inbound("request-B")]);
    await messaging.reviveForAgentInbound("agent");
    assert.equal(calls.length, 2, "request-A waiting on child-A cannot strand the unstarted request-B");
    const revivals = new m.CompletionRevivals(tm);
    async function complete(id) {
      revivals.handleBackgroundSubagentCompletion(child(id));
      for (let i = 0; i < 50 && revivals.revivingSubagentAgentIds.has("agent"); i += 1) await setImmediate();
      assert.equal(revivals.revivingSubagentAgentIds.has("agent"), false);
      assert.deepEqual(errors, []);
    }
    await complete("child-A");
    await complete("grandchild-A");
    // Simulate a new process reading the durable file, rather than trusting in-memory removals.
    const restartedStore = new m.SandPendingWakeStore(directory);
    assert.deepEqual(restartedStore.listPending().map((marker) => marker.workId).sort(), ["child-B", "request-B"],
      "A and its consumed child completion must not redispatch after restart; unrelated B remains pending");
    await complete("child-B");
    assert.deepEqual(restartedStore.listPending(), []);
    await new m.PendingWakeRearm({ ...tm, pendingWakeStore: restartedStore }).rearmPendingWakes();
    await setImmediate();
    assert.equal(calls.length, 5, "restart cannot dispatch the completed original requests again");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("workflow metadata survives payload-less rearming and peer replies point to the requesting source only", async () => {
  const m = await loaded;
  const directory = await mkdtemp(path.join(tmpdir(), "belmont-workflow-"));
  try {
    const store = new m.SandPendingWakeStore(directory);
    const request = { agentId: "manager", kind: "agent-message", workId: "root" };
    const message = { agentId: "worker", kind: "agent-message", workId: "delegation", markedAtMs: 1, replyToWorkflow: [request] };
    store.markPending(message);
    store.markPending({ agentId: "worker", kind: "agent-message", workId: "delegation", markedAtMs: 2 });
    const persisted = new m.SandPendingWakeStore(directory).listPending()[0];
    assert.deepEqual(persisted.replyToWorkflow, [request]);
    await m.withPendingWakeWorkflow({ pendingWakeStore: store }, "worker", [message], async () => {
      await setImmediate();
      assert.deepEqual(m.agentMessageWorkflowFields("worker", "manager").workflowParents, [request]);
      assert.equal(m.agentMessageWorkflowFields("worker", "unrelated").workflowParents, undefined);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restart rearms the unfinished leaf and keeps its ancestry instead of replaying the original inbound request", async () => {
  const m = await loaded;
  const directory = await mkdtemp(path.join(tmpdir(), "belmont-workflow-"));
  try {
    const store = new m.SandPendingWakeStore(directory);
    const source = { agentId: "agent", kind: "agent-message", workId: "original", markedAtMs: Date.now(),
      agentMessage: { from: { id: "manager", name: "Manager" }, text: "Create report", displayed: true } };
    store.markPending(source);
    store.markPending({ agentId: "agent", kind: "subagent", workId: "child", markedAtMs: Date.now(), workflowParents: [source] });
    const rearmed = [];
    const rearm = new m.PendingWakeRearm({ pendingWakeStore: store, execution: { canExecute: true },
      sessions: { isAgentGone: () => false }, telemetry: { reportPendingWake() {} } });
    rearm.rearmPendingWake = async (marker) => { rearmed.push(marker.workId); };
    await rearm.rearmPendingWakes();
    assert.deepEqual(rearmed, ["child"]);
    assert.deepEqual(new m.SandPendingWakeStore(directory).listPending().map((marker) => marker.workId).sort(), ["child", "original"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
