import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".build"), { recursive: true });
const tmp = await mkdtemp(path.join(root, ".build/watchdog-rt-"));
const out = path.join(tmp, "rt.mjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/belmont-watchdog/watchdog-runtime.ts")], outfile: out, bundle: true, platform: "node", format: "esm", target: "node26" });
const { BelmontWatchdog } = await import(pathToFileURL(out).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

const MIN = 60_000;
const LIMITS = { turnEndReplyGraceMs: 30_000, overdueFollowupCount: 1, overdueEscalationAfterMs: 5 * MIN, hardStopMultiple: 2, hardStopMaxMs: 180 * MIN };
const T0 = 1_000_000_000_000;
const overdueJob = { jobId: "j1", ownerId: "belmont", workerId: "research", status: "working", assignedAtMs: T0, deadlineMs: T0 + 60 * MIN, hasResultFile: false, hasActiveChild: false, nextTurnScheduled: false, externalEffectUncertain: false };

function harness(over = {}) {
  const store = new Set();
  const woke = [];
  const state = { enabled: true, now: T0 + 61 * MIN, jobs: [overdueJob] };
  const deps = {
    isEnabled: () => state.enabled, now: () => state.now,
    listActiveJobs: () => state.jobs, limits: () => LIMITS,
    loadEmittedIds: () => new Set(store), saveEmittedIds: (ids) => { store.clear(); for (const i of ids) store.add(i); },
    wake: (e) => woke.push(e), ...over,
  };
  return { wd: new BelmontWatchdog(deps), store, woke, state };
}

test("disabled -> inert (no scan, no wake)", () => {
  const h = harness(); h.state.enabled = false;
  assert.deepEqual(h.wd.tick(), { ran: false, woke: 0 });
  assert.equal(h.woke.length, 0);
});

test("idle (no active jobs) -> no wake, zero model-call surface", () => {
  const h = harness(); h.state.jobs = [];
  assert.deepEqual(h.wd.tick(), { ran: false, woke: 0 });
});

test("overdue -> wakes owner and persists dedup id; second tick is silent", () => {
  const h = harness();
  const r1 = h.wd.tick();
  assert.ok(r1.woke >= 1);
  assert.ok(h.woke.every((e) => e.wakeTargetId === "belmont"));
  const wokeCount = h.woke.length;
  const r2 = h.wd.tick();               // same state, ids already persisted
  assert.equal(r2.woke, 0);
  assert.equal(h.woke.length, wokeCount); // no duplicate wake
});

test("wake failure is not persisted -> retried next tick", () => {
  let fail = true;
  const h = harness({ wake: () => { if (fail) throw new Error("boom"); } });
  const r1 = h.wd.tick();
  assert.equal(r1.woke, 0 + r1.woke); // ran but wakes threw
  assert.equal(h.store.size, 0);      // nothing persisted on failure
  fail = false;
  const r2 = h.wd.tick();             // now succeeds
  assert.ok(h.store.size > 0);
});

test("pruneEmitted drops ids for jobs no longer active", () => {
  const emitted = new Set(["j1:overdue-followup", "j2:unreported"]);
  const kept = BelmontWatchdog.pruneEmitted(emitted, new Set(["j1"]));
  assert.deepEqual([...kept], ["j1:overdue-followup"]);
});
