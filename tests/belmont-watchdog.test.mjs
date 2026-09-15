import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".build"), { recursive: true });
const tmp = await mkdtemp(path.join(root, ".build/watchdog-test-"));
const out = path.join(tmp, "core.mjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/belmont-watchdog/watchdog-core.ts")], outfile: out, bundle: true, platform: "node", format: "esm", target: "node26" });
const { evaluateWatchdog, watchdogLimitsFromControl } = await import(pathToFileURL(out).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

const MIN = 60_000;
const LIMITS = watchdogLimitsFromControl({
  host_watch: { turn_end_reply_grace_seconds: 30 },
  on_overdue: { followup: 1, then_after_minutes: 5 },
  hard_stop: { multiple_of_deadline: 2, max_minutes: 180 },
});
const T0 = 1_000_000_000_000;
// A baseline healthy job: assigned at T0, 60-min deadline, worker still working, nothing wrong.
function job(over = {}) {
  return {
    jobId: "j1", ownerId: "belmont", workerId: "research", status: "working",
    assignedAtMs: T0, deadlineMs: T0 + 60 * MIN,
    hasResultFile: false, hasActiveChild: false, nextTurnScheduled: false,
    externalEffectUncertain: false, ...over,
  };
}
const evalAt = (nowMs, jobs, emitted = new Set()) =>
  evaluateWatchdog({ nowMs, jobs: Array.isArray(jobs) ? jobs : [jobs], limits: LIMITS, emittedEventIds: emitted });
const kinds = (events) => events.map((e) => e.kind).sort();

test("cond1: a normally-replied job produces no event", () => {
  const j = job({ status: "replied", lastTurnEndedMs: T0 + 10 * MIN, lastReplyMs: T0 + 10 * MIN });
  assert.deepEqual(evalAt(T0 + 11 * MIN, j), []);
});

test("cond2: result file present but no reply -> one result-pending-review", () => {
  const j = job({ hasResultFile: true, lastTurnEndedMs: T0 + 5 * MIN });
  const e = evalAt(T0 + 6 * MIN, j);
  assert.deepEqual(kinds(e), ["result-pending-review"]);
});

test("cond3: turn ended past grace, no result, no reply -> unreported", () => {
  const j = job({ lastTurnEndedMs: T0 + 5 * MIN }); // 5 min ago >> 30s grace
  const e = evalAt(T0 + 6 * MIN, j);
  assert.ok(e.some((x) => x.kind === "unreported"));
  assert.equal(e.find((x) => x.kind === "unreported").wakeTargetId, "belmont");
});

test("cond3b: within the 30s grace after turn end -> no unreported yet", () => {
  const j = job({ lastTurnEndedMs: T0 + 5 * MIN });
  const e = evalAt(T0 + 5 * MIN + 20_000, j); // 20s < 30s grace
  assert.ok(!e.some((x) => x.kind === "unreported"));
});

test("cond4: waiting-approval / active child / next-turn are never unreported", () => {
  for (const over of [{ status: "waiting-approval" }, { hasActiveChild: true }, { nextTurnScheduled: true }]) {
    const j = job({ lastTurnEndedMs: T0 + 5 * MIN, ...over });
    const e = evalAt(T0 + 6 * MIN, j);
    assert.ok(!e.some((x) => x.kind === "unreported"), JSON.stringify(over));
  }
});

test("cond5: a cancelled job produces no event even with a late result", () => {
  const j = job({ status: "cancelled", hasResultFile: true, lastTurnEndedMs: T0 + 5 * MIN });
  assert.deepEqual(evalAt(T0 + 200 * MIN, j), []);
});

test("cond6: an already-emitted event id is not raised again (idempotent)", () => {
  const j = job({ hasResultFile: true, lastTurnEndedMs: T0 + 5 * MIN });
  const first = evalAt(T0 + 6 * MIN, j);
  const emitted = new Set(first.map((e) => e.eventId));
  assert.deepEqual(evalAt(T0 + 7 * MIN, j, emitted), []);
});

test("cond7: before the deadline there is no overdue event", () => {
  const j = job({ lastReplyMs: T0 + 1 * MIN, status: "working" });
  const e = evalAt(T0 + 30 * MIN, j); // 30 < 60 min deadline
  assert.ok(!e.some((x) => x.kind.startsWith("overdue")));
});

test("cond8: overdue -> followup once; after +5min grace -> escalation; each one-shot", () => {
  const j = job();
  const atFollowup = evalAt(T0 + 61 * MIN, j);
  assert.ok(atFollowup.some((x) => x.kind === "overdue-followup"));
  assert.ok(!atFollowup.some((x) => x.kind === "overdue-escalation"));
  const atEsc = evalAt(T0 + 66 * MIN, j);
  assert.ok(atEsc.some((x) => x.kind === "overdue-escalation"));
  // one-shot: replay with those ids emits nothing new
  const emitted = new Set(atEsc.map((e) => e.eventId));
  assert.deepEqual(evalAt(T0 + 70 * MIN, j, emitted), []);
});

test("cond9: restart recovery — persisted ids survive and prevent duplicate wakes", () => {
  const j = job({ lastTurnEndedMs: T0 + 5 * MIN });
  const before = evalAt(T0 + 6 * MIN, j);
  assert.ok(before.length > 0);
  // simulate host restart: reload persisted emitted ids, re-evaluate same still-open job
  const persisted = new Set(before.map((e) => e.eventId));
  assert.deepEqual(evalAt(T0 + 6 * MIN, j, persisted), []);
});

test("cond10: uncertain external effect -> unknown-effect-hold only, no nudge/retry", () => {
  const j = job({ externalEffectUncertain: true, lastTurnEndedMs: T0 + 5 * MIN, hasResultFile: true });
  const e = evalAt(T0 + 200 * MIN, j);
  assert.deepEqual(kinds(e), ["unknown-effect-hold"]);
});

test("cond11: normal state (no jobs, or all replied) -> zero events (=> zero model calls)", () => {
  assert.deepEqual(evalAt(T0 + 10 * MIN, []), []);
  const healthy = job({ status: "replied", lastReplyMs: T0 + 1 * MIN });
  assert.deepEqual(evalAt(T0 + 10 * MIN, healthy), []);
});

test("cond12: event-storm suppression — repeated ticks yield one event per kind", () => {
  const j = job({ hasResultFile: true, lastTurnEndedMs: T0 + 5 * MIN });
  const emitted = new Set();
  let total = 0;
  for (let t = 6; t <= 40; t++) {
    const e = evalAt(T0 + t * MIN, j, emitted);
    for (const x of e) emitted.add(x.eventId);
    total += e.length;
  }
  // over 35 ticks: at most one result-pending + one followup + one escalation for the single job
  assert.ok(total <= 3, `expected <=3 distinct events, got ${total}`);
  assert.equal(new Set([...emitted]).size, total);
});

test("hard-stop: past 2x deadline -> hard-stop (not an endless nudge)", () => {
  const j = job(); // deadline 60m -> hard stop at 120m
  const e = evalAt(T0 + 121 * MIN, j);
  assert.ok(e.some((x) => x.kind === "hard-stop"));
  assert.ok(!e.some((x) => x.kind === "overdue-followup")); // hard-stop supersedes
});
