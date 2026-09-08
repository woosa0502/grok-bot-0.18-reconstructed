import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: root,
  stdin: {
    contents: [
      "export { UpgradeRecreateResume } from './source/host/extensions/transcript/upgrade-recreate-resume.ts';",
      "export { SandUpgradeResumeStore } from './source/host/extensions/transcript/sand-upgrade-resume-store.ts';",
      "export { SandRunScheduler } from './source/host/extensions/transcript/run-scheduler.ts';",
    ].join("\n"),
    resolveDir: root,
  },
  bundle: true, platform: "node", format: "esm", target: "node26", write: false,
});
const { UpgradeRecreateResume, SandUpgradeResumeStore, SandRunScheduler } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function manualClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    schedule: (delay, callback) => {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return { dispose: () => timers.delete(id) };
    },
    advance: (duration) => {
      const until = now + duration;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (next == null || next[1].at > until) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
    },
  };
}

const success = () => ({ aborted: false, sentMessageCount: 0, reacted: false, openTodos: [] });
const input = (agentId = "routine-bot") => ({
  agentId, markedAtMs: 101, source: "automation", automationId: "routine-1", automationRunId: "run-1",
});

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "belmont-upgrade-ownership-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new SandUpgradeResumeStore(directory);
  const calls = { resolutions: 0, acquired: 0, runs: [], queue: [], begun: 0, ended: 0, retired: [], errors: [] };
  const state = { gone: new Set(), stopped: new Set(), stopRevision: 0 };
  const session = { id: "routine-bot", automations: new Map([["routine-1", { id: "routine-1", name: "Daily routine" }]]) };
  const boundary = {
    resolve: async () => session,
    run: async () => success(),
    enqueue: async (work) => work(),
    getRunner: () => runner,
  };
  const runner = {
    cancelQuiesceForUpgrade() {},
    requestQuiesceForUpgrade() {},
    run: async (prompt, options) => {
      calls.runs.push({ prompt, options });
      return boundary.run(prompt, options);
    },
  };
  const tm = {
    upgradeResumeStore: store,
    execution: { canExecute: true },
    captureAgentStopGuard: () => {
      const revision = state.stopRevision;
      return () => revision !== state.stopRevision;
    },
    isAgentUserStopped: (id) => state.stopped.has(id),
    sessions: {
      isAgentGone: (id) => state.gone.has(id),
      resolveBackgroundSession: async (id) => { calls.resolutions += 1; return boundary.resolve(id); },
    },
    groupChat: { isGroupSession: () => false },
    runnerRegistry: {
      runners: new Map([[session.id, runner]]), activeGroupMemberRunners: new Map(),
      getRunner: () => { calls.acquired += 1; return boundary.getRunner(); },
    },
    runLifecycle: {
      inFlightRunCounts: new Map(), runningAgentIds: () => new Set(), lastRequestIdBySession: new Map(),
      beginSessionRun: () => { calls.begun += 1; },
      endSessionRun: () => { calls.ended += 1; },
      enqueueExclusiveRun: async (id, work, options) => {
        calls.queue.push({ id, options });
        return boundary.enqueue(work);
      },
    },
    turnRuntime: { activeRequestSources: new Map() },
    ackObligations: {
      mintAckRunToken: () => "resume-ack",
      retireAckRunToken: (id, token) => calls.retired.push({ id, token }),
    },
    roster: { emitAgentUpdate: async () => {} },
    automationRuntime: { emitAutomations() {} },
    telemetry: { reportAgentError: (event) => calls.errors.push(event) },
    trayErrors: { pushError() {} },
    traceFlusher() {},
  };
  const resume = new UpgradeRecreateResume(tm);
  return {
    directory, store, calls, state, session, boundary, tm, resume,
    disk: () => new SandUpgradeResumeStore(directory).listPending(),
    arm: (value = input()) => store.markPending(value),
  };
}

test("startup session failure preserves the real disk marker and a later pass retries once", async (t) => {
  const f = fixture(t);
  const marker = f.arm();
  f.boundary.resolve = async () => { throw new Error("Temporary session read failure"); };
  await f.resume.resumeInterruptedUpgradeTurns();
  await setImmediate();
  assert.deepEqual(f.disk(), [marker]);
  assert.equal(f.calls.resolutions, 1);
  await setImmediate();
  assert.equal(f.calls.resolutions, 1, "retention must not create an automatic retry loop");
  f.boundary.resolve = async () => f.session;
  await f.resume.resumeInterruptedUpgradeTurns();
  await setImmediate();
  assert.equal(f.calls.resolutions, 2);
  assert.equal(f.calls.runs.length, 1);
  assert.deepEqual(f.disk(), []);
});

for (const stage of ["run", "getRunner", "enqueue"]) {
  test(`${stage} failure retains the marker, balances lifecycle, and permits another attempt`, async (t) => {
    const f = fixture(t);
    const marker = f.arm();
    const original = f.boundary[stage];
    f.boundary[stage] = () => { throw new Error(`Temporary ${stage} failure`); };
    await f.resume.resumeUpgradeAgent(marker);
    assert.deepEqual(f.disk(), [marker]);
    assert.equal(f.calls.begun, f.calls.ended);
    assert.equal(f.calls.errors.length, 1);
    f.boundary[stage] = original;
    await f.resume.resumeUpgradeAgent(marker);
    assert.deepEqual(f.disk(), []);
    assert.equal(f.calls.begun, f.calls.ended);
  });
}

for (const [name, result] of [
  ["aborted", { ...success(), aborted: true }],
  ["quiesced", { ...success(), quiescedForUpgrade: true }],
  ["awaiting approval", { ...success(), awaitingUserSelection: true }],
  ["handed off", { ...success(), handedOff: true }],
  ["unknown task state", { ...success(), taskCompletionUnknown: true }],
  ["unfinished todos", { ...success(), openTodos: [{ id: "todo", status: "pending", content: "Finish" }] }],
  ["parked", { ...success(), taskStopReason: "idle" }],
  ["missing result", undefined],
  ["null result", null],
  ["unrecognized result", {}],
]) {
  test(`${name} result keeps durable recovery without retrying inside the attempt`, async (t) => {
    const f = fixture(t);
    const marker = f.arm();
    f.boundary.run = async () => result;
    await f.resume.resumeUpgradeAgent(marker);
    assert.deepEqual(f.disk(), [marker]);
    assert.equal(f.calls.runs.length, 1);
    assert.equal(f.calls.ended, 1);
  });
}

test("successful recovery preserves quiet automation options and clears only its own bot", async (t) => {
  const f = fixture(t);
  const marker = f.arm();
  const other = f.arm(input("other-bot"));
  await f.resume.resumeUpgradeAgent(marker);
  assert.deepEqual(f.disk(), [other]);
  assert.deepEqual(f.calls.queue[0].options, { lane: "background", source: "upgrade-resume", ackToken: undefined });
  assert.deepEqual(f.calls.runs[0].options, {
    hidden: true, upgradeResume: true, ackToken: undefined, isSilenceAllowed: true,
    automationWake: { id: "routine-1", name: "Daily routine" }, requestSource: "automation",
  });
  assert.match(f.calls.runs[0].prompt, /ending with no SendMessage remains a valid outcome/);
});

test("legacy successful runner results without optional todo metadata still settle", async (t) => {
  const f = fixture(t);
  f.boundary.run = async () => ({ aborted: false, sentMessageCount: 0, reacted: false });
  await f.resume.resumeUpgradeAgent(f.arm());
  assert.deepEqual(f.disk(), []);
});

test("concurrent startup, direct, and recreate calls share one attempt per agent", async (t) => {
  const f = fixture(t);
  const marker = f.arm();
  const gate = deferred();
  f.boundary.resolve = () => gate.promise;
  const attempt = f.resume.resumeUpgradeAgent(marker);
  const duplicate = f.resume.resumeUpgradeAgent(marker);
  await f.resume.resumeInterruptedUpgradeTurns();
  assert.deepEqual(await f.resume.resumeAfterRecreate([marker.agentId, marker.agentId]), { resumed: 0 });
  assert.equal(f.calls.resolutions, 1);
  assert.deepEqual(f.disk(), [marker]);
  gate.resolve(f.session);
  await Promise.all([attempt, duplicate]);
  assert.equal(f.calls.runs.length, 1);
  assert.deepEqual(f.disk(), []);
});

test("an identically rearmed marker survives an older successful attempt and can resume later", async (t) => {
  const f = fixture(t);
  const old = f.arm();
  const gate = deferred();
  f.boundary.run = () => gate.promise;
  const attempt = f.resume.resumeUpgradeAgent(old);
  await setImmediate();
  const newer = f.arm(old);
  assert.notEqual(newer.markerId, old.markerId);
  assert.equal(newer.markedAtMs, old.markedAtMs);
  gate.resolve(success());
  await attempt;
  assert.deepEqual(f.disk(), [newer]);
  f.boundary.run = async () => success();
  await f.resume.resumeUpgradeAgent(newer);
  assert.deepEqual(f.disk(), []);
  assert.equal(f.calls.runs.length, 2);
});

for (const outcome of ["success", "failure"]) {
  test(`actual scheduler escape keeps recovery ownership until late ${outcome} settles`, async (t) => {
    const f = fixture(t);
    const marker = f.arm({ ...input(), source: "turn" });
    const clock = manualClock();
    const watchdog = [];
    const scheduler = new SandRunScheduler({
      watchdogMs: 5, watchdogGraceMs: 5,
      interruptWedgedRun: () => true,
      telemetry: { onAccepted() {}, onDequeued() {}, onWatchdog: (event) => watchdog.push(event) },
    }, clock);
    t.after(() => scheduler.dispose());
    f.tm.runLifecycle.enqueueExclusiveRun = (id, work, options) => {
      f.calls.queue.push({ id, options });
      return scheduler.enqueue(id, work, options);
    };
    const gate = deferred();
    f.boundary.run = () => gate.promise;
    let settled = false;
    const attempt = f.resume.resumeUpgradeAgent(marker).then(() => { settled = true; });
    await setImmediate();
    let userRan = false;
    const userRun = scheduler.enqueue(marker.agentId, async () => { userRan = true; }, { lane: "user", source: "turn" });
    clock.advance(10);
    await userRun;
    assert.equal(userRan, true, "watchdog lets the newer user turn proceed");
    assert.ok(watchdog.some((event) => event.stage === "escape"));
    assert.equal(settled, false, "scheduler escape does not settle the actual recovery callback");
    assert.equal(f.calls.ended, 0);
    assert.deepEqual(f.calls.retired, []);
    assert.deepEqual(f.disk(), [marker]);
    const duplicate = f.resume.resumeUpgradeAgent(marker);
    assert.deepEqual(await f.resume.resumeAfterRecreate([marker.agentId]), { resumed: 0 });
    assert.equal(f.calls.resolutions, 1, "escaped callback still owns deduplication");
    if (outcome === "success") gate.resolve(success());
    else gate.reject(new Error("Provider failure after watchdog escape"));
    await Promise.all([attempt, duplicate]);
    assert.equal(f.calls.ended, 1);
    assert.deepEqual(f.calls.retired, [{ id: marker.agentId, token: "resume-ack" }]);
    assert.equal(f.calls.errors.length, outcome === "success" ? 0 : 1);
    assert.deepEqual(f.disk(), outcome === "success" ? [] : [marker]);
    if (outcome === "failure") {
      f.boundary.run = async () => success();
      await f.resume.resumeUpgradeAgent(marker);
      assert.deepEqual(f.disk(), []);
      assert.equal(f.calls.runs.length, 2);
    }
  });
}

test("recreate persists carried IDs before async preparation and returns while it is pending", async (t) => {
  const f = fixture(t);
  const gate = deferred();
  f.boundary.resolve = () => {
    assert.deepEqual(f.disk().map((marker) => marker.agentId), [f.session.id]);
    return gate.promise;
  };
  assert.deepEqual(await f.resume.resumeAfterRecreate([f.session.id]), { resumed: 1 });
  assert.equal(f.calls.runs.length, 0);
  assert.equal(f.disk().length, 1);
  gate.reject(new Error("Recreated session is not ready"));
  await setImmediate();
  assert.equal(f.disk().length, 1);
  f.tm.upgradeResumeStore = new SandUpgradeResumeStore(f.directory);
  f.boundary.resolve = async () => f.session;
  await new UpgradeRecreateResume(f.tm).resumeInterruptedUpgradeTurns();
  await setImmediate();
  assert.equal(f.calls.runs.length, 1);
  assert.deepEqual(f.disk(), []);
});

test("recreate retains durable intent without execution authority and does not run on failed persistence", async (t) => {
  const f = fixture(t);
  f.tm.execution.canExecute = false;
  assert.deepEqual(await f.resume.resumeAfterRecreate([f.session.id]), { resumed: 0 });
  assert.equal(f.disk().length, 1);
  assert.equal(f.calls.resolutions, 0);
  f.tm.execution.canExecute = true;
  f.store.clearAll();
  // A real filesystem error: the intended store directory is a regular file.
  const blockedRoot = path.join(f.directory, "blocked-root");
  writeFileSync(blockedRoot, "not a directory");
  f.tm.upgradeResumeStore = new SandUpgradeResumeStore(blockedRoot);
  assert.deepEqual(await f.resume.resumeAfterRecreate([f.session.id]), { resumed: 0 });
  assert.equal(f.calls.resolutions, 0);
});

for (const terminal of ["gone", "stopped"]) {
  test(`${terminal} targets deliberately clear without resolving or running`, async (t) => {
    const f = fixture(t);
    const marker = f.arm();
    f.state[terminal].add(marker.agentId);
    await f.resume.resumeInterruptedUpgradeTurns();
    await setImmediate();
    assert.deepEqual(f.disk(), []);
    assert.equal(f.calls.resolutions, 0);
    assert.equal(f.calls.runs.length, 0);
  });
}

test("stop then new intent during session preparation cannot revive the old generation", async (t) => {
  const f = fixture(t);
  const old = f.arm();
  const gate = deferred();
  f.boundary.resolve = () => gate.promise;
  const attempt = f.resume.resumeUpgradeAgent(old);
  await setImmediate();
  f.state.stopRevision += 1;
  f.store.clear(old.agentId);
  const newer = f.arm();
  gate.resolve(f.session);
  await attempt;
  assert.equal(f.calls.acquired, 0);
  assert.equal(f.calls.runs.length, 0);
  assert.deepEqual(f.disk(), [newer], "old cancellation cannot erase a new recovery generation");
});

test("deletion while queued prevents runner acquisition and balances accounting", async (t) => {
  const f = fixture(t);
  const marker = f.arm();
  const gate = deferred();
  f.boundary.enqueue = async (work) => { await gate.promise; return work(); };
  const attempt = f.resume.resumeUpgradeAgent(marker);
  await setImmediate();
  assert.equal(f.calls.queue.length, 1);
  f.state.gone.add(marker.agentId);
  gate.resolve();
  await attempt;
  assert.equal(f.calls.acquired, 0);
  assert.equal(f.calls.begun, f.calls.ended);
  assert.deepEqual(f.disk(), []);
});

test("quiescing while queued retains intent without acquiring a runner", async (t) => {
  const f = fixture(t);
  const marker = f.arm();
  const gate = deferred();
  f.boundary.enqueue = async (work) => { await gate.promise; return work(); };
  const attempt = f.resume.resumeUpgradeAgent(marker);
  await setImmediate();
  await f.resume.quiesceForUpgrade();
  gate.resolve();
  await attempt;
  assert.equal(f.calls.acquired, 0);
  assert.equal(f.calls.begun, f.calls.ended);
  assert.deepEqual(f.disk(), [marker]);
});

test("legacy files still parse and their stale markers cannot clear a newly armed generation", async (t) => {
  const f = fixture(t);
  const legacy = input();
  writeFileSync(f.store.filePath, JSON.stringify({ version: 1, pending: [legacy] }));
  assert.deepEqual(f.disk(), [legacy]);
  const freshStore = new SandUpgradeResumeStore(f.directory);
  const newMarker = freshStore.markPending(legacy);
  assert.equal(f.store.clearIfPending(legacy), false);
  assert.deepEqual(f.disk(), [newMarker]);
  assert.equal(f.store.clearIfPending(newMarker), true);
  writeFileSync(f.store.filePath, JSON.stringify({ version: 1, pending: [legacy] }));
  assert.equal(f.store.clearIfPending(legacy), true);
  assert.deepEqual(f.disk(), []);
  f.arm();
  assert.equal(JSON.parse(readFileSync(f.store.filePath, "utf8")).version, 1);
});
