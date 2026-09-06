import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Execute the real wake classes against in-memory runners/stores. No host, provider, DB, timers,
// or live service is started. The replaced imports are UI/telemetry/environment boundaries only.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
async function load(entry) {
  if (!cache.has(entry)) cache.set(entry, (async () => {
    const stubs = {
      "turn-runtime.js": "export const classifyAgentError = () => 'test';",
      "agent-run-error.js": "export const describeAgentRunError = () => ({detail:'test error'}); export const findBackendConnectError = () => undefined; export const PROVIDER_OVERLOAD_ERROR_TITLE = 'test';",
      "telemetry.js": "export const sandErrorDetail = String;",
      "transcript-store.js": "export const getTranscript = () => []; export const updateEntry = () => null; export const appendEntry = () => {}; export const removeEntry = () => false;",
      "send-message-shaping.js": "export const loadAgentInboundImages = async () => []; export const createUserMessage = () => ({}); export const createSendMessageEntry = () => ({}); export const describeRepliedMessageQuote = () => ''; export const isUserMessageEntry = () => false; export const stampBoxRequestEntry = x => x;",
      "provider-session.js": "export const openAiCompatibleHostForModel = () => undefined;",
      "group-store.js": "export const readSandGroupConfig = () => ({memberIds:['member']}); export const GROUP_CONFIG_VERSION = 1; export const GROUP_MAX_MEMBERS = 8; export const writeSandGroupConfig = () => {throw Error('unexpected group file write')}; export const isSandGroupDir = () => false;",
      "agent-profile.js": "export const readSandProfileFile = () => null; export const getSandProfilePath = x => x;",
      "session-runtime.js": "export class AgentGoneError extends Error {}",
    };
    const result = await build({
      absWorkingDir: root, bundle: true, entryPoints: [entry], format: "esm",
      platform: "node", target: "node26", write: false,
      plugins: [{ name: "isolated-wake-boundaries", setup(b) {
        b.onResolve({ filter: /\.js$/ }, (args) => {
          const name = path.basename(args.path);
          return name in stubs ? { path: name, namespace: "test-boundary" } : null;
        });
        b.onLoad({ filter: /.*/, namespace: "test-boundary" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
      } }],
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  })());
  return cache.get(entry);
}
const open = [{ id: "remaining", content: "Verify the delegated result", status: "in_progress" }];
const result = (extra = {}) => ({ sentMessageCount: 0, reacted: false, aborted: false, openTodos: [], workToolCalls: 0, ...extra });
function fixture(runs) {
  const calls = [], cleared = [], reports = [], failures = [];
  const runner = { run: async (prompt, options) => {
    calls.push({ prompt, options });
    assert.ok(calls.length <= 26, "a wake cannot loop without a bound");
    return typeof runs === "function" ? runs(calls.length) : runs[calls.length - 1] ?? runs.at(-1);
  } };
  const automation = { id: "routine", name: "Quiet routine", prompt: "Work quietly; only report actionable changes.", trigger: { type: "cron", schedule: "@every 15m" }, schedule: "@every 15m", enabled: true, isEnabled: true, notices: [], runs: [], nextRunAt: null, lastRunAt: null, createdAt: 0 };
  const session = { id: "agent", db: { getTranscriptEntries: () => [] }, automations: { listDefinitions: () => [automation], get: () => automation, markNoticeRaised() {} } };
  const tm = {
    execution: { canExecute: true },
    sessions: { resolveBackgroundSession: async () => session, isAgentGone: () => false, deletedAgentIds: new Set() },
    groupChat: { isGroupSession: () => false, isRemoteRoomSession: () => false },
    runnerRegistry: { getRunner: () => runner },
    runLifecycle: { beginSessionRun() {}, endSessionRun() {}, enqueueExclusiveRun: async (_id, fn) => fn(), lastRequestIdBySession: new Map() },
    turnRuntime: { activeRequestPrompts: new Map(), activeRequestSources: new Map() },
    sendPipeline: { currentTurnEpoch: () => 1 },
    backgroundWakes: { dmPreemptedWakeAgentIds: new Set() },
    pendingWakes: { clearSettledPendingWake: (marker) => cleared.push(marker) },
    pendingWakeStore: { markPending: () => true, listPending: () => [] },
    widgetResponses: { collectUnansweredQuestionPrompts: () => ({}) },
    upgradeResume: { markAgentResumePending() {}, markAgentResumePendingForQuiescedRevival() {} },
    roster: { emitAgentUpdate: async () => {} },
    telemetry: { reportAgentError: (e) => failures.push(e), reportPendingWake: (e) => reports.push(e), reportSubagentRevival: (e) => reports.push(e), reportShellRevival: (e) => reports.push(e), reportAutomationRun: (e) => reports.push(e) },
    trayErrors: { pushError: (e) => failures.push(e) },
    sessionStore: { getUserTimeZone: () => "UTC" },
    automationRuntime: { enqueueAutomationLifecycleMutation: async ({ mutation }) => mutation(), recordInactiveAutomationChanges() {}, emitAutomations() {} },
  };
  return { tm, session, automation, runner, calls, cleared, reports, failures };
}

test("delegated inbound work continues before its durable message marker settles", async () => {
  const { AgentToAgentMessaging } = await load("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  const f = fixture([result({ openTodos: open, workToolCalls: 2 }), result({ workToolCalls: 1 })]);
  const messaging = new AgentToAgentMessaging(f.tm);
  await messaging.runAgentInboundWake("agent", [{ id: "inbound", from: { id: "manager", name: "Manager" }, text: "Check and finish", timestampMs: 1, isDisplayed: true }]);
  assert.deepEqual(f.failures, []);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.isSilenceAllowed, true);
  assert.equal(f.calls[1].options.taskContinuation, true);
  assert.equal(f.cleared.length, 1);
});

for (const kind of ["subagent", "shell"]) {
  async function wake(f) {
    const { CompletionRevivals } = await load("source/host/extensions/transcript/completion-revivals.ts");
    const revivals = new CompletionRevivals(f.tm);
    if (kind === "subagent") {
      revivals.pendingSubagentCompletions.set("agent", [{ parentAgentId: "agent", subagentAgentId: "child", subagentType: "generalPurpose", title: "Check", status: "completed", result: "child evidence" }]);
      await revivals.reviveForSubagentCompletions("agent");
    } else {
      revivals.pendingShellCompletions.set("agent", [{ agentId: "agent", shellId: "shell", title: "Check", status: "success" }]);
      await revivals.reviveForShellCompletions("agent");
    }
  }
  test(`${kind} completion is followed through until the parent's remaining work settles`, async () => {
    const f = fixture([result({ openTodos: open, workToolCalls: 1 }), result({ workToolCalls: 1 })]);
    await wake(f);
    assert.deepEqual(f.failures, []);
    assert.equal(f.calls.length, 2);
    assert.equal(f.cleared.length, 1);
    assert.equal(f.reports.at(-1).outcome, "delivered");
  });
  for (const [name, partial] of [
    ["idle partial", { openTodos: open }],
    ["superseded", { aborted: true }],
    ["upgrade", { aborted: true, quiescedForUpgrade: true }],
    ["async handoff without todos", { handedOff: true }],
    ["user selection without todos", { awaitingUserSelection: true }],
  ]) test(`${kind} ${name} preserves its durable marker instead of claiming delivery`, async () => {
    const f = fixture([result(partial)]);
    await wake(f);
    assert.deepEqual(f.failures, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.cleared.length, 0);
    assert.notEqual(f.reports.at(-1).outcome, "delivered");
  });
}

for (const partial of [false, true]) test(`automation ${partial ? "retains incomplete status" : "continues to completion"}`, async () => {
  const { AutomationRunPath } = await load("source/host/extensions/transcript/automation-run-path.ts");
  const f = fixture([result({ openTodos: open, workToolCalls: 1 }), result(partial ? { openTodos: open } : { workToolCalls: 1 })]);
  const finishes = [];
  const automation = new AutomationRunPath(f.tm, {}, {});
  automation.recordAutomationRun = () => {};
  automation.beginAutomationRun = () => "run";
  automation.finishAutomationRun = (...args) => finishes.push(args);
  const outcome = await automation.fireAutomation({ agentId: "agent", automation: f.automation, trigger: "manual" });
  assert.deepEqual(f.failures, []);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.automationWake.id, "routine");
  assert.equal(f.calls[1].options.requestSource, "automation");
  assert.equal(outcome, partial ? "interrupted" : "ok");
  assert.equal(finishes.at(-1)[3], partial ? "error" : "ok");
  if (partial) assert.match(finishes.at(-1)[4], /unfinished/);
});

test("a wake that keeps producing work still stops after 24 continuations", async () => {
  const { AgentToAgentMessaging } = await load("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  const f = fixture(() => result({ openTodos: open, workToolCalls: 1 }));
  await new AgentToAgentMessaging(f.tm).runAgentInboundWake("agent", [{ id: "inbound", from: { id: "manager", name: "Manager" }, text: "Check", timestampMs: 1, isDisplayed: true }]);
  assert.deepEqual(f.failures, []);
  assert.equal(f.calls.length, 25);
  assert.equal(f.cleared.length, 0);
});

test("user settlement respects a verified handoff even if it owes a reply", async () => {
  const { TurnRuntime } = await load("source/host/extensions/transcript/turn-runtime.ts");
  const f = fixture([result()]);
  const runtime = new TurnRuntime(f.tm);
  const settled = await runtime.ensureUserReply(f.runner, result({ handedOff: true }), f.session, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(settled.result.taskStopReason, "handed_off");
});

test("an idle unfinished user task cannot bypass the stop through closing-send nudges", async () => {
  const { TurnRuntime } = await load("source/host/extensions/transcript/turn-runtime.ts");
  const f = fixture([result({ openTodos: open, endedOnSilentToolCalls: true })]);
  const settled = await new TurnRuntime(f.tm).ensureUserReply(f.runner, result({ sentMessageCount: 1, openTodos: open, workToolCalls: 1 }), f.session, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(settled.result.taskStopReason, "idle");
});

test("work started by a closing-send nudge goes through the same continuation budget", async () => {
  const { TurnRuntime } = await load("source/host/extensions/transcript/turn-runtime.ts");
  const f = fixture([result({ sentMessageCount: 1, openTodos: open, workToolCalls: 1 }), result({ sentMessageCount: 1, workToolCalls: 1 })]);
  f.tm.telemetry.reportClosingSendNudge = () => {};
  const settled = await new TurnRuntime(f.tm).ensureUserReply(f.runner, result({ sentMessageCount: 1, workToolCalls: 1, endedOnSilentToolCalls: true }), f.session, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.closingNudge, true);
  assert.equal(f.calls[1].options.taskContinuation, true);
  assert.equal(settled.result.taskStopReason, "done");
});

test("a reply-only nudge does not erase the unfinished work from the initial user run", async () => {
  const { TurnRuntime } = await load("source/host/extensions/transcript/turn-runtime.ts");
  const f = fixture([result({ sentMessageCount: 1, openTodos: open }), result({ sentMessageCount: 1, workToolCalls: 1 })]);
  const settled = await new TurnRuntime(f.tm).ensureUserReply(f.runner, result({ openTodos: open, workToolCalls: 1 }), f.session, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.taskContinuation, true);
  assert.equal(settled.result.taskStopReason, "done");
});

test("explicit stop prevents a new background call and halts post-run continuation", async () => {
  const { runBackgroundTask } = await load("source/host/extensions/transcript/background-task-continuation.ts");
  const f = fixture([result({ openTodos: open, workToolCalls: 1 })]);
  let stopped = true;
  f.tm.isAgentUserStopped = () => stopped;
  assert.equal((await runBackgroundTask(f.tm, f.session, f.runner, "work", {})).completed, false);
  assert.equal(f.calls.length, 0);
  stopped = false;
  const original = f.runner.run;
  f.runner.run = async (...args) => { const value = await original(...args); stopped = true; return value; };
  const settled = await runBackgroundTask(f.tm, f.session, f.runner, "work", {});
  assert.equal(settled.reason, "aborted");
  assert.equal(settled.completed, false);
  assert.equal(f.calls.length, 1);
});

test("missing follow-up todo metadata cannot turn a partial background task into success", async () => {
  const { runBackgroundTask } = await load("source/host/extensions/transcript/background-task-continuation.ts");
  const unknown = result();
  delete unknown.openTodos;
  const f = fixture([result({ openTodos: open, workToolCalls: 1 }), unknown]);
  const settled = await runBackgroundTask(f.tm, f.session, f.runner, "work", {});
  assert.equal(settled.completed, false);
  assert.equal(settled.reason, "idle");
  assert.deepEqual(settled.result.openTodos, open);
});

test("unreadable task evidence does not become a successful background settlement or a retry loop", async () => {
  const { runBackgroundTask } = await load("source/host/extensions/transcript/background-task-continuation.ts");
  const f = fixture([result({ taskCompletionUnknown: true })]);
  const settled = await runBackgroundTask(f.tm, f.session, f.runner, "work", {});
  assert.equal(settled.completed, false);
  assert.equal(settled.reason, "unknown");
  assert.equal(f.calls.length, 1);
});

test("group automation member work continues with the same task policy instead of returning a partial pass", async () => {
  const { GroupChatGlue, createGroupMemberStream } = await load("source/host/extensions/transcript/group-chat-glue.ts");
  const f = fixture([result({ openTodos: open, workToolCalls: 1 }), result({ workToolCalls: 1 })]);
  f.tm.execution.canExecuteGroupMember = true;
  f.tm.execution.createGroupMemberRunner = () => f.runner;
  f.tm.sharedRooms = { sharedRoomConfigOf: () => null };
  f.tm.runnerRegistry.runnerHooksFor = () => ({});
  f.tm.runnerRegistry.activeGroupMemberRunners = new Map();
  f.tm.runnerRegistry.wireRunnerLifecycle = () => {};
  const glue = new GroupChatGlue(f.tm);
  glue.pinMemberSessionForGroupTurn = async () => f.session;
  const outcome = await glue.runGroupMemberTurn({ id: "room" }, {
    member: { id: "member", name: "Member", description: "" }, systemPrompt: "Work for the group", prompt: "Finish the routine",
  }, createGroupMemberStream(), () => true, undefined, "background", "automation");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.taskContinuation, true);
  assert.equal(outcome.completed, true);
});

test("group automations cannot report ok after a member is interrupted or fails to finish", async () => {
  const { AutomationRunPath } = await load("source/host/extensions/transcript/automation-run-path.ts");
  const f = fixture([result()]);
  f.session.dbPath = "/isolated/fake-room/conversation.db";
  f.session.db.appendTranscriptEntry = () => {};
  f.tm.sessionStore.markSessionActivity = () => {};
  f.tm.sharedRooms = { publishSharedRoomEntryIfNeeded() {} };
  f.tm.groupChat.isGroupSession = () => true;
  f.tm.groupChat.groupIdentityFor = () => ({ name: "Room", description: "" });
  f.tm.groupChat.groupOrchestratorDeps = () => ({
    resolveMembers: async () => [{ id: "member", name: "Member", description: "" }], readHistory: () => [],
    isCurrent: () => false, runMemberTurn: async () => [], postMemberMessage() {},
  });
  const finishes = [];
  const automation = new AutomationRunPath(f.tm, {}, {});
  automation.recordAutomationRun = () => {};
  automation.beginAutomationRun = () => "run";
  automation.finishAutomationRun = (...args) => finishes.push(args);
  const outcome = await automation.fireAutomation({ agentId: "agent", automation: f.automation, trigger: "manual" });
  assert.deepEqual(f.failures, []);
  assert.equal(outcome, "interrupted");
  assert.equal(finishes.at(-1)[3], "error");
});

test("group orchestration distinguishes settled, unknown and pending members and preserves its call cap", async () => {
  const { GroupChatOrchestrator } = await load("source/host/extensions/transcript/group-chat-orchestrator.ts");
  const member = { id: "member", name: "Member", description: "" };
  async function run(value, memberCount = 1) {
    let calls = 0;
    const deps = { resolveMembers: async () => Array.from({ length: memberCount }, (_, i) => ({ ...member, id: `member-${i}` })),
      readHistory: () => [], isCurrent: () => true, runMemberTurn: async () => { calls += 1; return value; }, postMemberMessage() {} };
    const outcome = await new GroupChatOrchestrator(deps).run({ group: { name: "Room", description: "" }, memberIds: [] });
    return { outcome, calls };
  }
  assert.equal((await run({ messages: ["(pass)"], completed: true })).outcome.completed, true);
  assert.equal((await run([])).outcome.reason, "unknown", "remote message-only result has no completion evidence");
  assert.equal((await run({ messages: [], completed: false, reason: "handed_off" })).outcome.reason, "member_pending");
  const capped = await run({ messages: [], completed: true }, 20);
  assert.equal(capped.calls, 10);
  assert.equal(capped.outcome.reason, "cap");
  assert.equal(capped.outcome.completed, false);
});

test("a group stop during a member run cannot publish a stale reply", async () => {
  const { GroupChatOrchestrator } = await load("source/host/extensions/transcript/group-chat-orchestrator.ts");
  let current = true;
  const posted = [];
  const outcome = await new GroupChatOrchestrator({
    resolveMembers: async () => [{ id: "member", name: "Member", description: "" }], readHistory: () => [],
    isCurrent: () => current,
    runMemberTurn: async () => { await Promise.resolve(); current = false; return { messages: ["stale reply"], completed: true }; },
    postMemberMessage: (_member, message) => posted.push(message),
  }).run({ group: { name: "Room", description: "" }, memberIds: [] });
  assert.equal(outcome.reason, "aborted");
  assert.deepEqual(posted, []);
});

test("late child and shell completions after user stop neither persist nor queue cancelled work", async () => {
  const { CompletionRevivals } = await load("source/host/extensions/transcript/completion-revivals.ts");
  const f = fixture([result()]);
  f.tm.isAgentUserStopped = () => true;
  let writes = 0;
  f.tm.pendingWakeStore.markPending = () => { writes += 1; return true; };
  const revivals = new CompletionRevivals(f.tm);
  revivals.handleBackgroundSubagentCompletion({ parentAgentId: "agent", subagentAgentId: "child", subagentType: "generalPurpose", title: "Child", status: "completed", result: "stale" });
  revivals.handleBackgroundShellCompletion({ agentId: "agent", shellId: "shell", title: "Shell", status: "success" });
  assert.equal(writes, 0);
  assert.equal(revivals.pendingSubagentCompletions.size, 0);
  assert.equal(revivals.pendingShellCompletions.size, 0);
  assert.equal(f.calls.length, 0);
});

test("an inbound wake cancelled during session preparation cannot revive after a later explicit resume", async () => {
  const { AgentToAgentMessaging } = await load("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  const f = fixture([result()]);
  let generation = 0;
  f.tm.captureAgentStopGuard = () => { const captured = generation; return () => generation !== captured; };
  f.tm.isAgentUserStopped = () => false; // The later user prompt has already resumed the agent.
  f.tm.sessions.resolveBackgroundSession = async () => { await Promise.resolve(); generation += 1; return f.session; };
  await new AgentToAgentMessaging(f.tm).runAgentInboundWake("agent", [{ id: "old", from: { id: "manager", name: "Manager" }, text: "stale work", timestampMs: 1, isDisplayed: true }]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.cleared.length, 0);
});

test("a waiting first inbound message does not strand its unstarted batch tail or replay itself", async () => {
  const { AgentToAgentMessaging } = await load("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  const f = fixture([result({ openTodos: open, workToolCalls: 1, handedOff: true }), result({ workToolCalls: 1 })]);
  const messaging = new AgentToAgentMessaging(f.tm);
  const message = (id) => ({ id, from: { id: "manager", name: "Manager" }, text: `work ${id}`, timestampMs: 1, isDisplayed: true });
  messaging.pendingAgentInbound.set("agent", [message("first"), message("second")]);
  await messaging.reviveForAgentInbound("agent");
  assert.deepEqual(f.failures, []);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].prompt, /work first/);
  assert.match(f.calls[1].prompt, /work second/);
  assert.deepEqual(f.cleared.map((marker) => marker.workId), ["second"]);
  assert.equal(messaging.pendingAgentInbound.size, 0);
});

test("a durable group wake retains its marker after an incomplete room run and settles after explicit completion", async () => {
  const { PendingWakeRearm } = await load("source/host/extensions/transcript/pending-wake-rearm.ts");
  const f = fixture([result()]);
  const pending = [];
  const cleared = [];
  f.tm.sendPipeline.nextTurnEpoch = () => 1;
  f.tm.runLifecycle.enqueueExclusiveRun = (_id, work) => { const task = work(); pending.push(task); return task; };
  f.tm.pendingWakeStore.clearOne = (...args) => { cleared.push(args); return true; };
  f.tm.roster.emitAsyncTasksForAgent = () => {};
  let completed = false;
  f.tm.groupChat.runGroupTurn = async () => ({ completed, reason: completed ? "done" : "member_pending", memberTurns: 1 });
  const rearm = new PendingWakeRearm(f.tm);
  const marker = { agentId: "room", kind: "agent-message", workId: "group-post", markedAtMs: 1 };
  rearm.rerunGroupTurnWake({ id: "room" }, marker, () => {});
  await Promise.all(pending);
  assert.equal(cleared.length, 0);
  completed = true;
  rearm.rerunGroupTurnWake({ id: "room" }, marker, () => {});
  await Promise.all(pending);
  assert.equal(cleared.length, 1);
});

test("ordinary group turn returns its incomplete outcome instead of dropping it", async () => {
  const { GroupChatGlue } = await load("source/host/extensions/transcript/group-chat-glue.ts");
  const f = fixture([result()]);
  const glue = new GroupChatGlue(f.tm);
  glue.groupIdentityFor = () => ({ name: "Room", description: "" });
  glue.groupOrchestratorDeps = () => ({
    resolveMembers: async () => [{ id: "member", name: "Member", description: "" }], readHistory: () => [], isCurrent: () => true,
    runMemberTurn: async () => ({ messages: [], completed: false, reason: "handed_off" }), postMemberMessage() {},
  });
  const outcome = await glue.runGroupTurn({ id: "room", dbPath: "/isolated/room/db" }, 1);
  assert.equal(outcome?.completed, false);
  assert.equal(outcome?.reason, "member_pending");
});

test("a new group post clears its durable marker only when members completed processing it", async () => {
  const { SharedRooms } = await load("source/host/extensions/transcript/shared-rooms.ts");
  const f = fixture([result()]);
  const queued = [];
  f.session.dbPath = "/isolated/group/db";
  f.tm.sendPipeline.nextTurnEpoch = () => 1;
  f.tm.groupChat.groupIdentityFor = () => ({ name: "Room" });
  f.tm.groupChat.resolveGroupMembers = async () => [{ id: "member", name: "Member" }];
  f.tm.groupChat.postGroupMemberMessage = () => {};
  f.tm.backgroundWakes.appendAgentOutboundEntry = () => {};
  f.tm.productAnalytics = { trackEvent() {} };
  f.tm.runLifecycle.enqueueExclusiveRun = (_id, work) => { const promise = work(); queued.push(promise); return promise; };
  let completed = false;
  f.tm.groupChat.runGroupTurn = async () => ({ completed, reason: completed ? "done" : "cap", memberTurns: 1 });
  const rooms = new SharedRooms(f.tm);
  assert.match(await rooms.postToGroup("member", "room", "Discuss the result"), /^Posted/);
  await Promise.all(queued);
  assert.equal(f.cleared.length, 0);
  completed = true;
  await rooms.postToGroup("member", "room", "Finished result");
  await Promise.all(queued);
  assert.equal(f.cleared.length, 1);
});
