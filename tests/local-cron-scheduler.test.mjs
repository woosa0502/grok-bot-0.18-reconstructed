// Local clock for cron routines (AUDIT-7): due routines fire through the
// server-scheduled entry point, stale misses re-anchor, cloud-owned routines are
// skipped, and the extension wires the scheduler beside the trigger hub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadScheduler() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/automations/local-cron-scheduler.ts")],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const MINUTE = 60_000;
const manualPolling = () => {
  let tick;
  return { name: "manual", start(fn) { tick = fn; return { dispose() { tick = undefined; } }; }, run: () => tick?.() };
};

test("decideLocalCronRun: wait / fire / stale / none", async () => {
  const { decideLocalCronRun } = await loadScheduler();
  const anchor = Date.UTC(2026, 7, 31, 8, 0, 0);
  const every = { schedules: ["@every 30m"], anchorMs: anchor, timeZone: "UTC", staleAfterMs: 6 * 60 * MINUTE };
  assert.deepEqual(decideLocalCronRun({ ...every, now: anchor + 10 * MINUTE }), { kind: "wait", dueAt: anchor + 30 * MINUTE });
  assert.deepEqual(decideLocalCronRun({ ...every, now: anchor + 31 * MINUTE }), { kind: "fire", dueAt: anchor + 30 * MINUTE });
  assert.deepEqual(decideLocalCronRun({ ...every, now: anchor + 12 * 60 * MINUTE }), { kind: "stale", dueAt: anchor + 30 * MINUTE });
  assert.deepEqual(decideLocalCronRun({ ...every, schedules: ["not a schedule"], now: anchor }), { kind: "none" });
  // 5-field cron in a time zone: 09:00 Asia/Seoul is 00:00 UTC.
  const seoul = decideLocalCronRun({ schedules: ["0 9 * * *"], anchorMs: Date.UTC(2026, 7, 30, 12, 0), now: Date.UTC(2026, 7, 31, 0, 1), timeZone: "Asia/Seoul", staleAfterMs: 6 * 60 * MINUTE });
  assert.deepEqual(seoul, { kind: "fire", dueAt: Date.UTC(2026, 7, 31, 0, 0) });
});

test("scheduler fires due cron routines once, skips cloud-owned and disabled ones, and re-anchors stale misses", async () => {
  const { LocalCronScheduler } = await loadScheduler();
  const polling = manualPolling();
  let now = Date.UTC(2026, 7, 31, 8, 31, 0);
  const created = Date.UTC(2026, 7, 31, 8, 0, 0);
  const fired = [];
  const log = [];
  const automations = [
    { agentId: "a", automation: { id: "r1", isEnabled: true, trigger: { type: "cron", schedule: "@every 30m" }, createdAt: created, lastRunAt: null } },
    { agentId: "a", automation: { id: "r2", isEnabled: false, trigger: { type: "cron", schedule: "@every 30m" }, createdAt: created, lastRunAt: null } },
    { agentId: "b", automation: { id: "cloud", isEnabled: true, trigger: { type: "cron", schedule: "@every 30m" }, createdAt: created, lastRunAt: null } },
    { agentId: "c", automation: { id: "event-only", isEnabled: true, trigger: { type: "slack", channel: "#x" }, createdAt: created, lastRunAt: null } },
    { agentId: "d", automation: { id: "stale", isEnabled: true, trigger: { type: "cron", schedule: "@every 30m" }, createdAt: created - 24 * 60 * MINUTE, lastRunAt: null } },
  ];
  const scheduler = new LocalCronScheduler({
    polling,
    listAutomations: async () => automations,
    fire: async (agentId, automation, dueAt) => { fired.push([agentId, automation.id, dueAt]); },
    isReady: () => true,
    shouldScheduleLocally: ({ agentId }) => agentId !== "b",
    getTimeZone: () => "UTC",
    now: () => now,
    log: (m) => log.push(m),
  });
  scheduler.start();
  await polling.run();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(fired, [["a", "r1", created + 30 * MINUTE]]);
  assert.ok(log.some((m) => m.includes("d:stale") && m.includes("re-anchoring")));
  // Same tick again: nothing new (local anchor advanced; lastRunAt not yet persisted).
  await polling.run();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fired.length, 1);
  // The run path persisted lastRunAt; 31 minutes later the next slot fires, and the
  // re-anchored stale routine fires 30 minutes after its re-anchor (created+31m+30m).
  automations[0].automation.lastRunAt = created + 30 * MINUTE;
  now = created + 61 * MINUTE;
  await polling.run();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(fired.filter(([agentId]) => agentId === "a"), [["a", "r1", created + 30 * MINUTE], ["a", "r1", created + 60 * MINUTE]]);
  assert.deepEqual(fired.filter(([agentId]) => agentId === "d"), [["d", "stale", created + 61 * MINUTE]]);
  assert.ok(!fired.some(([, id]) => id === "r2" || id === "cloud" || id === "event-only"));
  await scheduler.stop();
});

test("scheduler waits for turn execution readiness", async () => {
  const { LocalCronScheduler } = await loadScheduler();
  const polling = manualPolling();
  const fired = [];
  const created = Date.UTC(2026, 7, 31, 8, 0, 0);
  let ready = false;
  const scheduler = new LocalCronScheduler({
    polling,
    listAutomations: async () => [{ agentId: "a", automation: { id: "r", isEnabled: true, trigger: { type: "cron", schedule: "@every 1m" }, createdAt: created, lastRunAt: null } }],
    fire: async (...args) => { fired.push(args); },
    isReady: async () => ready,
    shouldScheduleLocally: () => true,
    getTimeZone: () => undefined,
    now: () => created + 5 * MINUTE,
  });
  scheduler.start();
  await polling.run();
  assert.equal(fired.length, 0);
  ready = true;
  await polling.run();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fired.length, 1);
  await scheduler.stop();
});

test("automations extension wires the local cron scheduler next to the trigger hub", () => {
  const extension = read("source/host/extensions/automations/extension.ts");
  assert.match(extension, /new LocalCronScheduler\(\{/);
  assert.match(extension, /shouldScheduleLocally: \(args\) => cloudSync\.shouldScheduleCronLocally\(args\)/);
  assert.match(extension, /runServerScheduledAutomation\(\{ agentId, automation, runUuid: randomUUID\(\), scheduledForMs: dueAt \}\)/);
  assert.match(extension, /localCron\.start\(\)/);
  const cloudSync = read("source/host/extensions/automations/sand-automation-cloud-sync.ts");
  assert.match(cloudSync, /shouldScheduleCronLocally\(\{ agentId, automation \}/);
});
