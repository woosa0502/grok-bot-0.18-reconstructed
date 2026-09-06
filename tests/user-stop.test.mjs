import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const built = await build({ absWorkingDir: repoRoot, entryPoints: [entry], bundle: true,
    platform: "node", format: "esm", target: "node22", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
}
const { AgentUserStopController, interruptTranscriptAgent, runExplicitTranscriptPrompt } = await load("source/host/extensions/transcript/agent-user-stop.ts");
const { createHostGatewayApi } = await load("source/host/host-gateway-api.ts");
const { SAND_GATEWAY_COMMANDS } = await load("source/host/gateway-protocol.ts");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeManager(userStops, runners = new Map()) {
  const pending = () => new Map([["a", ["cancelled work"]], ["b", ["keep work"]]]);
  const reports = [];
  const tm = {
    userStops,
    sessions: { deletedAgentIds: new Set(), isAgentGone: (id) => !["a", "b", "idle"].includes(id) },
    runLifecycle: { runningAgentIds: () => new Set(["a", "b"]) },
    runnerRegistry: { runners, activeGroupMemberRunners: new Map() },
    ackObligations: { clearAckRedriveTimer: (id) => reports.push(["timer", id]), ackRunTokens: pending() },
    ackObligationStore: { clear: (id) => reports.push(["ack", id]) },
    pendingWakeStore: { clearAgent: (id) => reports.push(["wake", id]) },
    sendPipeline: { latestRecoverySends: pending(), recoveryBreakEpochs: new Map(), nextTurnEpoch: () => 1 },
    groupChat: { dmPreemptedGroupMemberIds: new Set(["a", "b"]) },
    backgroundWakes: Object.fromEntries([
      "pendingSubagentCompletions", "pendingShellCompletions", "pendingInbound",
      "pendingAgentInbound", "pendingChannelFailures", "pendingEventWakes",
    ].map((key) => [key, pending()])),
    telemetry: { reportTurnInterrupt: (event) => reports.push(["interrupt", event]) },
    roster: { emitAgentUpdate: async (id) => reports.push(["roster", id]) },
  };
  tm.backgroundWakes.dmPreemptedWakeAgentIds = new Set(["a", "b"]);
  tm.interruptAgent = (id, expected) => interruptTranscriptAgent(tm, id, expected);
  return { tm, reports };
}

test("public stop interrupts only the selected bot, cancels its children, and is idempotent", async () => {
  const stops = new AgentUserStopController();
  const calls = [];
  const active = new Map();
  const runner = (id) => ({
    run: () => { const turn = deferred(); active.set(id, turn); return turn.promise; },
    interrupt: (reason) => { calls.push([id, "interrupt", reason]); active.get(id)?.resolve({ aborted: true }); return active.delete(id); },
    interruptAll: (reason) => { calls.push([id, "children", reason]); return false; },
    cancelBackgroundShellRewatches: () => calls.push([id, "rewatches"]),
  });
  const a = stops.guardRunner("a", runner("a"));
  const b = stops.guardRunner("b", runner("b"));
  const aResult = a.run("work a");
  const bResult = b.run("work b");
  const { tm, reports } = fakeManager(stops, new Map([["a", a], ["b", b]]));
  const api = createHostGatewayApi({ extensions: { api: (name) => name === "transcript" ? tm : name === "telemetry" ? { analytics: { markActive() {} } } : {} } });
  const stopped = await SAND_GATEWAY_COMMANDS.interruptAgent(api, '{"id":"a"}');
  assert.deepEqual(stopped, { id: "a", interrupted: true, ...stops.getState("a") });
  assert.equal((await aResult).aborted, true);
  assert.equal(active.has("b"), true);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [["a", "interrupt"], ["a", "children"], ["a", "rewatches"]]);
  assert.equal(tm.sessions.deletedAgentIds.size, 0);
  assert.deepEqual(tm.backgroundWakes.pendingInbound.get("b"), ["keep work"]);
  assert.equal(tm.backgroundWakes.pendingInbound.has("a"), false);
  assert.deepEqual(await tm.interruptAgent("a"), { id: "a", interrupted: false, ...stops.getState("a") });
  const idleStop = await tm.interruptAgent("idle");
  assert.deepEqual(idleStop, { id: "idle", interrupted: false, ...stops.getState("idle") });
  assert.equal(calls.length, 3);
  assert.ok(reports.some(([kind, event]) => kind === "interrupt" && event.reason === "user_stop"));
  assert.throws(() => api.interruptAgent({}), /Malformed/);
  await assert.rejects(tm.interruptAgent("missing"), /no longer exists/);
  active.get("b").resolve({ aborted: false });
  await bResult;
});

test("queued and in-flight old work stays cancelled after a later explicit new prompt", async () => {
  const stops = new AgentUserStopController();
  const runs = [];
  const runner = stops.guardRunner("a", { run: async (prompt) => { runs.push(prompt); return { aborted: false }; } });
  let cleanup = 0;
  const queued = stops.bindQueuedWork("a", async () => {
    try { return await runner.run("stale queued turn"); }
    finally { cleanup += 1; }
  });
  const pause = deferred();
  const staleContinuation = stops.runUserPrompt("a", async () => {
    await pause.promise;
    assert.equal(stops.isStopped("a"), true, "old async continuation keeps its cancelled generation");
    return runner.run("stale continuation");
  });
  stops.stop("a");
  assert.equal((await runner.run("automatic recovery")).aborted, true);
  const queuedWhileStopped = stops.bindQueuedWork("a", () => runner.run("queued while stopped"));
  assert.equal((await stops.runUserPrompt("a", () => runner.run("new explicit prompt"))).aborted, false);
  pause.resolve();
  assert.equal((await staleContinuation).aborted, true);
  assert.equal((await queued()).aborted, true);
  assert.equal((await queuedWhileStopped()).aborted, true);
  assert.equal(cleanup, 1, "cancelled queue callbacks retain normal cleanup");
  assert.deepEqual(runs, ["new explicit prompt"]);
});

test("stop state survives process recreation and only explicit new work clears it", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "belmont-user-stop-"));
  try {
    const file = path.join(root, "stops.json");
    const initial = new AgentUserStopController(file);
    initial.runUserPrompt("a", () => {}, "client-1");
    initial.stop("a");
    const originalState = initial.getState("a");
    const restarted = new AgentUserStopController(file);
    assert.deepEqual(restarted.getState("a"), originalState);
    assert.equal(restarted.isStopped("a"), true);
    assert.equal(restarted.isStopped("b"), false);
    await restarted.runUserPrompt("a", async () => {});
    assert.equal(new AgentUserStopController(file).isStopped("a"), false);
    assert.ok(restarted.getState("a").userIntentRevision > originalState.userIntentRevision);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("delayed stop tokens and old client nonces cannot interrupt a newer admitted intent", async () => {
  const stops = new AgentUserStopController();
  let interrupted = 0;
  const { tm } = fakeManager(stops, new Map([["a", { interrupt: () => { interrupted += 1; return true; } }]]));
  const api = createHostGatewayApi({ extensions: { api: (name) => name === "transcript" ? tm : name === "telemetry" ? { analytics: { markActive() {} } } : {} } });
  stops.runUserPrompt("a", () => {}, "device-a:bot-a:old");
  const old = stops.getState("a");
  stops.runUserPrompt("a", () => {}, "device-a:bot-a:new");
  const current = stops.getState("a");
  assert.notEqual(old.stopGuard, current.stopGuard);
  assert.ok(current.userIntentRevision > old.userIntentRevision);
  for (const expected of [{ expectedStopGuard: old.stopGuard }, { expectedClientNonce: "device-a:bot-a:old" }]) {
    assert.deepEqual(await api.interruptAgent({ id: "a", ...expected }), { id: "a", interrupted: false, stale: true, ...current });
    assert.equal(stops.isStopped("a"), false);
    assert.deepEqual(stops.getState("a"), current, "stale stop mutates neither token nor revision");
  }
  assert.equal(interrupted, 0);
  const result = await api.interruptAgent({ id: "a", expectedStopGuard: current.stopGuard, expectedClientNonce: "device-a:bot-a:new" });
  assert.equal(result.interrupted, true);
  assert.equal(result.stopGuard, current.stopGuard, "the same stop token remains retryable");
  assert.ok(result.userIntentRevision > current.userIntentRevision);
  assert.equal(interrupted, 1);
  const repeat = await api.interruptAgent({ id: "a", expectedStopGuard: current.stopGuard });
  assert.equal(repeat.interrupted, false);
  assert.equal(repeat.userIntentRevision, result.userIntentRevision);
  assert.equal(interrupted, 1);
  assert.throws(() => api.interruptAgent({ id: "a", expectedStopGuard: "" }), /Malformed/);
});

test("a delayed successful stop response carries the stopped revision, not a later resume revision", async () => {
  const stops = new AgentUserStopController();
  const { tm } = fakeManager(stops);
  const gate = deferred();
  tm.roster.emitAgentUpdate = () => gate.promise;
  stops.runUserPrompt("a", () => {}, "old");
  const expectedStopGuard = stops.getState("a").stopGuard;
  const response = tm.interruptAgent("a", { expectedStopGuard });
  const stoppedState = stops.getState("a");
  stops.runUserPrompt("a", () => {}, "new");
  const resumedState = stops.getState("a");
  gate.resolve();
  const result = await response;
  assert.equal(result.userIntentRevision, stoppedState.userIntentRevision);
  assert.equal(result.stopGuard, stoppedState.stopGuard);
  assert.ok(resumedState.userIntentRevision > result.userIntentRevision);
});

test("a stop still interrupts when persistence fails, while reporting the save failure", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "belmont-user-stop-failure-"));
  try {
    const blocked = path.join(root, "blocked");
    const stops = new AgentUserStopController(path.join(blocked, "stops.json"));
    writeFileSync(blocked, "not a directory");
    let interrupts = 0;
    const { tm } = fakeManager(stops, new Map([["a", { interrupt: () => { interrupts += 1; return true; } }]]));
    await assert.rejects(tm.interruptAgent("a"));
    assert.equal(interrupts, 1);
    assert.equal(stops.isStopped("a"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("explicit resume verifies cancelled wake markers were cleared before opening the stop gate", async () => {
  const stops = new AgentUserStopController();
  const { tm } = fakeManager(stops);
  let markers = [{ agentId: "a", workId: "old-child" }, { agentId: "b", workId: "keep-child" }];
  tm.pendingWakeStore = { clearAgent() {}, listPending: () => markers };
  stops.stop("a");
  let started = 0;
  assert.throws(() => runExplicitTranscriptPrompt(tm, "a", () => { started += 1; }), /could not be cleared/);
  assert.equal(stops.isStopped("a"), true);
  assert.equal(started, 0);
  tm.pendingWakeStore.clearAgent = (id) => { markers = markers.filter((item) => item.agentId !== id); };
  runExplicitTranscriptPrompt(tm, "a", () => { started += 1; });
  assert.equal(stops.isStopped("a"), false);
  assert.equal(started, 1);
  assert.deepEqual(markers, [{ agentId: "b", workId: "keep-child" }]);
});

test("failed autonomous intent persistence blocks execution but retains queued cleanup", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "belmont-user-intent-failure-"));
  try {
    const blocked = path.join(root, "blocked");
    const stops = new AgentUserStopController(path.join(blocked, "stops.json"));
    writeFileSync(blocked, "not a directory");
    let ran = 0;
    let cleaned = 0;
    const runner = stops.guardRunner("a", { run: async () => { ran += 1; return { aborted: false }; } });
    const queued = stops.bindQueuedWork("a", async () => {
      try { assert.equal((await runner.run()).aborted, true); }
      finally { cleaned += 1; }
    });
    await assert.rejects(queued());
    assert.equal(ran, 0);
    assert.equal(cleaned, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("actual execution factories guard normal and group-member runners without creating them on stop", async () => {
  const { TranscriptManager } = await load("source/host/extensions/transcript/transcript-manager.ts");
  const controller = new AgentUserStopController();
  const manager = { userStops: controller };
  const calls = [];
  const factory = (kind) => (session) => ({ run: async () => { calls.push([kind, session.id]); return { aborted: false }; } });
  TranscriptManager.prototype.setTurnExecution.call(manager, {
    canExecute: true, canExecuteGroupMember: true, isRunReady: async () => true,
    createRunner: factory("normal"), createGroupMemberRunner: factory("group"),
  });
  const normal = manager.execution.createRunner({ id: "a" });
  const groupMember = manager.execution.createGroupMemberRunner({ id: "a" });
  const other = manager.execution.createRunner({ id: "b" });
  controller.stop("a");
  assert.equal((await normal.run()).aborted, true);
  assert.equal((await groupMember.run()).aborted, true);
  assert.equal((await other.run()).aborted, false);
  assert.deepEqual(calls, [["normal", "b"]]);
});

test("actual queued run scopes retain cancellation after resume and roster exposes persistent stop", async () => {
  const { RunLifecycle } = await load("source/host/extensions/transcript/run-lifecycle.ts");
  const stops = new AgentUserStopController();
  const lifecycle = Object.create(RunLifecycle.prototype);
  lifecycle.tm = {
    userStops: stops, sendPipeline: { sendAttachmentBatchIds: new Map() },
    roster: { liveSubagentParentIds: () => new Set() },
    groupChat: { remoteTurnMemberIdsByRoom: new Map() },
  };
  lifecycle.runScheduler = null;
  lifecycle.runChains = new Map();
  lifecycle.inFlightRunCounts = new Map();
  lifecycle.composingMessageSessionIds = new Set();
  lifecycle.retryingSessionIds = new Set();
  lifecycle.sessionActivities = new Map();
  const gate = deferred();
  lifecycle.runChains.set("a", gate.promise);
  let ran = 0;
  let finalized = 0;
  const runner = stops.guardRunner("a", { run: async () => { ran += 1; return { aborted: false }; } });
  const queued = lifecycle.enqueueExclusiveRun("a", async () => {
    try { assert.equal((await runner.run()).aborted, true); }
    finally { finalized += 1; }
  }, { lane: "user", source: "test" });
  stops.stop("a");
  assert.equal(lifecycle.withRunStates([{ id: "a" }])[0].isUserStopped, true);
  stops.runUserPrompt("a", () => {});
  gate.resolve();
  await queued;
  assert.equal(ran, 0);
  assert.equal(finalized, 1);
});

test("recovery and connector preparation cannot resurrect an old wake after stop then resume", async () => {
  const [{ PendingWakeRearm }, { UpgradeRecreateResume }, { BoxHandoffResume }, { BackgroundWakes }, { AckObligations }] = await Promise.all([
    load("source/host/extensions/transcript/pending-wake-rearm.ts"),
    load("source/host/extensions/transcript/upgrade-recreate-resume.ts"),
    load("source/host/extensions/transcript/box-handoff-resume.ts"),
    load("source/host/extensions/transcript/background-wakes.ts"),
    load("source/host/extensions/transcript/ack-obligations.ts"),
  ]);
  const cases = [
    [PendingWakeRearm, "rearmPendingWake", [{ agentId: "a", kind: "shell", workId: "shell-1", markedAtMs: 0 }, 1]],
    [UpgradeRecreateResume, "resumeUpgradeAgent", [{ agentId: "a", markedAtMs: 0 }]],
    [BoxHandoffResume, "resumeWithHiddenPrompt", ["a", "resume the old job", "error"]],
    [BackgroundWakes, "runInboundWake", ["a", [{ text: "old connector message" }]]],
    [BackgroundWakes, "runEventWake", ["a", [{ type: "old-event" }]]],
    [BackgroundWakes, "runChannelFailureWake", ["a", [{ reason: "old failure" }]]],
    [BackgroundWakes, "scheduleBroadcast", ["a", "old broadcast"]],
    [AckObligations, "redriveAckObligation", ["a", "idle"]],
  ];
  for (const [Owner, method, args] of cases) {
    const gate = deferred();
    const stops = new AgentUserStopController();
    let staleMutation = 0;
    const tm = {
      captureAgentStopGuard: (id) => stops.captureStopGuard(id),
      isAgentUserStopped: (id) => stops.isStopped(id),
      sessions: { resolveBackgroundSession: () => gate.promise, isAgentGone: () => false },
      execution: { canExecute: true },
      runLifecycle: { runScheduler: {}, beginSessionRun: () => { staleMutation += 1; } },
      runnerRegistry: { getRunner: () => { staleMutation += 1; throw new Error(`${method} started stale work`); } },
      groupChat: { isGroupSession: () => false, isRemoteRoomSession: () => false },
      upgradeResume: { quiescingForUpgrade: false },
      ackObligationStore: {
        get: () => ({ redriveAttempts: 0, createdAtMs: 0, coalescedCount: 1 }),
        recordRedriveAttempt: () => ({ redriveAttempts: 1, createdAtMs: 0, coalescedCount: 1 }),
        clear: () => { staleMutation += 1; },
      },
      telemetry: { reportAckObligation() {} },
    };
    const pending = new Owner(tm)[method](...args);
    stops.stop("a");
    stops.runUserPrompt("a", () => {});
    gate.resolve({ id: "a" });
    await pending;
    assert.equal(staleMutation, 0, method);
  }
});

test("an Aside-style proxy and its underlying runner both receive selected-bot cancellation", async () => {
  const calls = [];
  const base = { run: async () => ({ aborted: false }), interruptAll: () => { calls.push("ordinary children"); return false; } };
  const aside = new Proxy(base, { get: (target, key) => key === "interrupt" ? () => { calls.push("aside remote stop"); return true; } : target[key] });
  const stops = new AgentUserStopController();
  const { tm } = fakeManager(stops, new Map([["a", stops.guardRunner("a", aside)]]));
  await tm.interruptAgent("a");
  assert.deepEqual(calls, ["aside remote stop", "ordinary children"]);
});

test("same nonce coalesces dispatch but conflicting concurrent bot/payload is rejected", async () => {
  const { SendPipeline } = await load("source/host/extensions/transcript/send-pipeline.ts");
  const { PromptAcceptanceLedger } = await load("source/host/extensions/transcript/prompt-acceptance-ledger.ts");
  const stops = new AgentUserStopController();
  const tm = { sessions: {}, userStops: stops, acceptanceLedger: new PromptAcceptanceLedger(null) };
  const pipeline = new SendPipeline(tm);
  const hold = deferred();
  const calls = [];
  pipeline.sendPromptOnce = async (prompt, options, acceptance) => {
    calls.push([prompt, options.agentId]);
    await hold.promise;
    tm.acceptanceLedger.recordPending({ accountSlot: "host", clientNonce: options.clientNonce,
      inputDigest: acceptance.digest, agentId: options.agentId, echoEntryId: "user-1" });
    tm.acceptanceLedger.markAccepted({ accountSlot: "host", clientNonce: options.clientNonce });
  };
  const first = pipeline.sendPrompt("hello", { agentId: "a", clientNonce: "nonce-1" });
  const repeat = pipeline.sendPrompt("hello", { agentId: "a", clientNonce: "nonce-1" });
  await assert.rejects(pipeline.sendPrompt("different", { agentId: "a", clientNonce: "nonce-1" }), /NONCE_DIGEST_MISMATCH/);
  await assert.rejects(pipeline.sendPrompt("hello", { agentId: "b", clientNonce: "nonce-1" }), /NONCE_DIGEST_MISMATCH/);
  hold.resolve();
  await Promise.all([first, repeat]);
  stops.stop("a");
  const stoppedState = stops.getState("a");
  await pipeline.sendPrompt("hello", { agentId: "a", clientNonce: "nonce-1" });
  assert.equal(stops.isStopped("a"), true, "replaying an accepted nonce must not resume a stopped bot");
  assert.deepEqual(stops.getState("a"), stoppedState, "accepted replay preserves the intended stop target and revision");
  assert.equal(calls.length, 1);
  await pipeline.sendPrompt("hello", { agentId: "a", clientNonce: "nonce-2" });
  assert.equal(stops.isStopped("a"), false);
  assert.equal(calls.length, 2);
  assert.ok(stops.getState("a").userIntentRevision > stoppedState.userIntentRevision);
  assert.equal(stops.matchesExpectation("a", { expectedClientNonce: "nonce-2" }), true);
});
