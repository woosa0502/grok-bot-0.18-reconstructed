import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = Date.parse("2026-09-01T00:00:00Z");
const hour = 3_600_000;
const settle = () => new Promise((done) => setImmediate(done));

async function setup(t) {
  const state = await mkdtemp(join(tmpdir(), "belmont-automation-integrity-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  const entry = join(state, "modules.mjs");
  await build({
    stdin: {
      resolveDir: repo,
      loader: "ts",
      contents: [
        'export * from "./source/host/extensions/automations/local-cron-scheduler.ts";',
        'export * from "./source/host/automations/automation-store.ts";',
        'export * from "./source/host/extensions/automations/sand-automation-cloud-sync.ts";',
        'export * from "./source/shared/automation-schedule.ts";',
      ].join("\n"),
    },
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  return { state, ...(await import(pathToFileURL(entry).href)) };
}

test("declined and thrown dispatches retry their original slot for cron and intervals", async (t) => {
  const { LocalCronScheduler } = await setup(t);
  for (const schedule of ["@every 1h", "0 * * * *"]) {
    for (const declined of [true, false]) {
      let now = origin + hour;
      const calls = [];
      const routine = { id: "digest", isEnabled: true, trigger: { type: "cron", schedule }, createdAt: origin };
      const scheduler = new LocalCronScheduler({
        polling: { name: "manual", start: () => ({ dispose() {} }) },
        listAutomations: async () => [{ agentId: "agent", automation: routine }],
        fire: async (_agent, _routine, dueAt) => {
          calls.push(dueAt);
          if (calls.length > 1) { routine.lastRunAt = now; return "ok"; }
          if (declined) return undefined;
          throw new Error("dispatch temporarily unavailable");
        },
        isReady: () => true,
        shouldScheduleLocally: () => true,
        getTimeZone: () => "UTC",
        now: () => now,
      });
      await scheduler.tick(); await settle();
      now += 59_000;
      await scheduler.tick(); await settle();
      assert.equal(calls.length, 1);
      now += 1_001;
      await scheduler.tick(); await settle();
      assert.deepEqual(calls, [origin + hour, origin + hour], `${schedule}: ${declined ? "declined" : "thrown"}`);
      now += 61_000;
      await scheduler.tick(); await settle();
      assert.equal(calls.length, 2, "accepted run must not replay");
      await scheduler.stop();
    }
  }
});

test("an accepted run ending in error consumes its slot without a dispatch retry", async (t) => {
  const { LocalCronScheduler } = await setup(t);
  let now = origin + hour;
  const calls = [];
  const scheduler = new LocalCronScheduler({
    polling: { name: "manual", start: () => ({ dispose() {} }) },
    listAutomations: async () => [{ agentId: "agent", automation: { id: "digest", isEnabled: true, trigger: { type: "cron", schedule: "@every 1h" }, createdAt: origin } }],
    fire: async (_agent, _routine, dueAt) => { calls.push(dueAt); return "error"; },
    isReady: () => true,
    shouldScheduleLocally: () => true,
    getTimeZone: () => "UTC",
    now: () => now,
  });
  await scheduler.tick(); await settle();
  now += 61_000;
  await scheduler.tick(); await settle();
  assert.deepEqual(calls, [origin + hour]);
  await scheduler.stop();
});

test("routine storage rejects invalid ranges, timezones and intervals and retains valid grammar", async (t) => {
  const { state, FileAutomationStore, isValidAutomationSchedule } = await setup(t);
  const store = new FileAutomationStore(join(state, "routines"), () => "UTC");
  const spec = (schedule) => ({ name: "Digest", prompt: "Prepare a digest", trigger: { type: "cron", schedule } });
  const original = store.upsert(spec("0 9 * * 1-5"), origin);
  for (const invalid of ["99 25 * * *", "@every 0m", "CRON_TZ=Mars/Olympus 0 9 * * *", "0-5-9 * * * *", "0,,5 * * * *", "*/0 * * * *", "0 9 * 13 *"]) {
    assert.equal(isValidAutomationSchedule(invalid), false, invalid);
    assert.equal(store.upsert(spec(invalid), origin), null, invalid);
    assert.equal(store.update(original.id, spec(invalid)), null, invalid);
    assert.equal(store.get(original.id).schedule, "0 9 * * 1-5");
  }
  for (const valid of ["@hourly", "@every 30s", "@EVERY 2H", "CRON_TZ=Asia/Seoul 30 9 * * 1-5", "TZ=UTC 0,30 8-17/2 * * 0,7", "5/15 * * * *", "0 0 29 2 *"]) {
    assert.equal(isValidAutomationSchedule(valid), true, valid);
    assert.notEqual(store.upsert(spec(valid), origin), null, valid);
  }
});

test("a valid leap-day routine finds its next slot across leap years and non-leap centuries", async (t) => {
  const { computeNextRunAt } = await setup(t);
  for (const [anchor, expected] of [
    ["2026-03-01T00:00:00Z", "2028-02-29T00:00:00Z"],
    ["2028-02-29T00:00:00Z", "2032-02-29T00:00:00Z"],
    ["2096-02-29T00:00:00Z", "2104-02-29T00:00:00Z"],
  ]) {
    assert.equal(computeNextRunAt("0 0 29 2 *", Date.parse(anchor), "UTC"), Date.parse(expected));
  }
});

test("stored trigger groups do not silently drop invalid cron members", async (t) => {
  const { parseStoredConfig, inspectAgentAutomationDefinitions, state, FileAutomationStore } = await setup(t);
  const agentDir = join(state, "agent");
  const store = new FileAutomationStore(join(agentDir, "automations"), () => "UTC");
  const listener = { type: "slack", channel: "#updates", match: { kind: "message" } };
  for (const [index, schedule] of ["", "   ", undefined, "99 * * * *"].entries()) {
    const trigger = { type: "group", listeners: [listener, { type: "cron", schedule }] };
    const raw = JSON.stringify({ name: "Digest", prompt: "Fixture", trigger, schedule: "0 9 * * *" });
    assert.equal(parseStoredConfig(raw, origin), null, `invalid member ${index}`);
    const created = store.upsert({ name: `Digest ${index}`, prompt: "Fixture", trigger: { type: "cron", schedule: "0 9 * * *" } }, origin);
    await writeFile(store.configPath(created.id), raw);
  }
  const inspection = inspectAgentAutomationDefinitions(agentDir);
  assert.equal(inspection.state, "configs_invalid");
  assert.equal(inspection.invalidDefinitionIds.length, 4);
  assert.notEqual(parseStoredConfig(JSON.stringify({ name: "Valid", prompt: "Fixture", trigger: { type: "group", listeners: [listener, { type: "cron", schedule: "@hourly" }] } }), origin), null);
});

test("remote pruning preserves corrupt or unavailable local state and honors confirmed empty state", async (t) => {
  const { state, FileAutomationStore, inspectAgentAutomationDefinitions, sandCloudDefinition, SandAutomationCloudSync } = await setup(t);
  for (const mode of ["corrupt", "mixed", "missing-dir", "empty", "healthy"]) {
    const agentDir = join(state, mode, "agent");
    const store = new FileAutomationStore(join(agentDir, "automations"), () => "UTC");
    const create = (name) => store.upsert({ name, prompt: "Fixture", trigger: { type: "cron", schedule: "0 9 * * *" } }, origin);
    const original = create("Digest");
    const cloud = sandCloudDefinition({ agentId: "agent", automation: original, timeZone: "UTC" });
    let remote = [{ workflow: { automationId: cloud.automationId, enabled: true, description: cloud.marker } }];
    const deleted = [];
    if (mode === "corrupt" || mode === "mixed") await writeFile(store.configPath(original.id), "{broken-json");
    if (mode === "mixed") {
      const good = sandCloudDefinition({ agentId: "agent", automation: create("Valid"), timeZone: "UTC" });
      remote.push({ workflow: { automationId: good.automationId, enabled: true, description: good.marker } });
      assert.deepEqual(inspectAgentAutomationDefinitions(agentDir).invalidDefinitionIds, [original.id]);
    }
    if (mode === "empty") store.remove(original.id);
    if (mode === "missing-dir") await rm(join(agentDir, "automations"), { recursive: true });
    const sync = new SandAutomationCloudSync({
      client: {
        listSandAutomations: async () => ({ workflows: remote }),
        deleteSandAutomation: async ({ automationId }) => { deleted.push(automationId); remote = remote.filter(({ workflow }) => workflow.automationId !== automationId); },
        createSandAutomation: async () => assert.fail("unexpected create"),
        updateSandAutomation: async () => assert.fail("unexpected update"),
      },
      hasCredential: () => true,
      listAgentIds: async () => ["agent"],
      listAutomations: async () => store.listDefinitions().map((automation) => ({ agentId: "agent", automation })),
      getTimeZone: () => "UTC",
      inspectLocalDefinitions: () => inspectAgentAutomationDefinitions(agentDir),
      onFailure() {}, onRecovery() {}, onSchedulingAuthorityChanged() {},
    });
    await sync.reconcileNow();
    assert.deepEqual(deleted, mode === "empty" ? [cloud.automationId] : [], mode);
    if (mode === "corrupt" || mode === "mixed") {
      store.remove(original.id);
      await sync.reconcileNow();
      assert.deepEqual(deleted, [cloud.automationId], "quarantine must re-evaluate after corruption is resolved");
    }
  }
});
