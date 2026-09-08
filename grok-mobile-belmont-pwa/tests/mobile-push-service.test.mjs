import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMobilePushService } from "../mobile-push-service.mjs";
import { createMobileServer } from "../server.mjs";

const subscription = { endpoint: "https://push.example.net/device-a", expirationTime: null, keys: { auth: "BTBZMqHH6r4Tts7J_aSIgg", p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4" } };
const makeAgent = (overrides = {}) => ({ id: "worker", name: "Worker", isRunning: false, isUserStopped: false, userIntentRevision: 0, awaitingUserResponse: null, notificationsEnabled: false, notifyOnUpdatesEnabled: true, ...overrides });

test("old empty SSE cannot discard a newer failed push, but confirmed current deletion retires it", async () => {
  for (const deleted of [false, true]) {
    let agents = [];
    let fail = true;
    const attempts = [], delivered = [];
    const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000, gateway: { async call() { return agents; } }, sender: async (_, payload) => { attempts.push(payload.id); if (fail) throw new Error("outage"); delivered.push(payload.id); } });
    await push.subscribe("device", 10_000, subscription);
    agents = [makeAgent({ isRunning: true, snapshotEpoch: "A", snapshotSeq: 7, lastMessageId: "old" })]; await push.observe();
    agents = [{ ...agents[0], isRunning: false, snapshotSeq: 10, lastMessageId: "answer" }]; await push.observe();
    assert.equal(attempts.length, 1);
    if (deleted) agents = [];
    await push.handleEvent({ channel: "agents", payload: { agents: [], ordered: { replicaKey: "roster", epoch: "A", sequence: 2 }, coverage: { kind: "complete-roster" } } });
    fail = false;
    if (!deleted) agents = [{ ...agents[0], snapshotSeq: 11 }];
    await push.observe();
    assert.equal(delivered.length, deleted ? 0 : 1);
    assert.ok(attempts.every((id) => id === attempts[0]));
    push.close();
  }
});

test("full SSE confirms current deletion before retrying a pending push after transport recovery", async () => {
  for (const deleted of [false, true]) {
    let agents = [];
    let fail = true;
    const operations = [], delivered = [];
    const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000,
      gateway: { async call() { operations.push("poll"); return agents; } },
      sender: async (_, payload) => { operations.push("send"); if (fail) throw new Error("outage"); delivered.push(payload.id); },
    });
    await push.subscribe("device", 10_000, subscription);
    agents = [makeAgent({ isRunning: true, snapshotEpoch: "A", snapshotSeq: 7, lastMessageId: "old" })]; await push.observe();
    agents = [{ ...agents[0], isRunning: false, snapshotSeq: 10, lastMessageId: "answer" }]; await push.observe();
    assert.equal(delivered.length, 0);
    agents = deleted ? [] : [{ ...agents[0], snapshotSeq: 11 }];
    fail = false;
    operations.length = 0;
    await push.handleEvent({ channel: "agents", payload: { agents: [], ordered: { replicaKey: "roster", epoch: "A", sequence: 2 }, coverage: { kind: "complete-roster" } } });
    assert.deepEqual(operations, deleted ? ["poll"] : ["poll", "send"]);
    assert.equal(delivered.length, deleted ? 0 : 1);
    push.close();
  }
});

test("completion and needs-input events are deduped per paired endpoint and survive service recreation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "belmont-mobile-push-"));
  try {
    const file = join(directory, "push.json");
    let clock = 1000;
    let agent = makeAgent({ lastMessageId: "old" });
    const delivered = [];
    const options = { file, pollIntervalMs: 0, now: () => clock, gateway: { async call() { return [agent]; } }, sender: async (target, payload) => { delivered.push({ target, payload }); } };
    let push = createMobilePushService(options);
    const key = push.config("device").publicKey;
    await push.subscribe("device", 10_000, subscription);
    assert.equal(delivered.length, 0, "historical roster seeds a baseline, not notifications");
    agent = makeAgent({ isRunning: true, lastMessageId: "old" }); await push.observe();
    agent = makeAgent({ isRunning: false, lastMessageId: "new", lastActivityAt: 1100 }); clock = 1100;
    await Promise.all([push.observe(), push.observe()]);
    await push.handleEvent({ channel: "agent-upserted", payload: { agent } });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].payload.kind, "completed");
    assert.match(delivered[0].payload.url, /surface=ChatScreen&botId=worker/u);
    push.close();
    push = createMobilePushService(options);
    assert.equal(push.config("device").publicKey, key, "the application server key stays stable across restarts");
    await push.observe();
    assert.equal(delivered.length, 1, "a replayed completed roster does not notify again");
    agent = makeAgent({ isRunning: true, lastMessageId: "new" }); await push.observe();
    agent = makeAgent({ isRunning: false, lastMessageId: "new" }); await push.observe();
    assert.equal(delivered.length, 1, "a busy pulse without a new message is not another completion");
    agent = makeAgent({ awaitingUserResponse: { reason: "approval" }, lastMessageId: "question" }); await push.observe();
    await push.observe();
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1].payload.kind, "needs-input");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(JSON.parse(readFileSync(file)).devices.device.subscriptions.length === 1);
    push.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("global/device bot preferences, host bot preference and explicit stop suppress delivery", async () => {
  let agent = makeAgent();
  const sent = [];
  const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000, gateway: { async call() { return [agent]; } }, sender: async (_, payload) => sent.push(payload) });
  await push.subscribe("device", 10_000, subscription);
  async function cycle(overrides = {}) { agent = makeAgent({ isRunning: true, ...overrides }); await push.observe(); agent = makeAgent(overrides); await push.observe(); }
  push.setPreferences("device", 10_000, { enabled: false }); await cycle();
  push.setPreferences("device", 10_000, { enabled: true, bots: { worker: false } }); await cycle();
  push.setPreferences("device", 10_000, { bots: { worker: true } }); await cycle({ notifyOnUpdatesEnabled: false });
  await cycle({ isUserStopped: true });
  assert.equal(sent.length, 0);
  await cycle({ userIntentRevision: 1 });
  assert.equal(sent.length, 1, "desktop OS notifications false does not suppress enabled phone notifications");
  push.close();
});

test("transport failure retries one stable event, while gone subscriptions and logout remove pending delivery", async () => {
  let agent = makeAgent();
  let status = 503;
  const attempts = [];
  const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000, gateway: { async call() { return [agent]; } }, sender: async (_, payload) => { attempts.push(payload); if (status !== 201) throw Object.assign(new Error("fake transport"), { statusCode: status }); } });
  await push.subscribe("device", 10_000, subscription);
  agent = makeAgent({ isRunning: true }); await push.observe();
  agent = makeAgent(); await push.observe();
  status = 201; await push.observe();
  await push.observe();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].id, attempts[1].id);
  agent = makeAgent({ awaitingUserResponse: true }); status = 410; await push.observe();
  assert.equal(push.config("device").subscribed, false);
  status = 503;
  await push.subscribe("device", 10_000, subscription);
  agent = makeAgent({ isRunning: true }); await push.observe();
  agent = makeAgent(); await push.observe();
  const beforeLogout = attempts.length;
  push.logout("device"); status = 201; await push.observe();
  assert.equal(attempts.length, beforeLogout);
  assert.equal(push.config("device").subscribed, false);
  push.close();
});

test("expired pairing sessions and subscription expiry are removed before sending", async () => {
  let clock = 1000;
  let agent = makeAgent({ isRunning: true });
  const sent = [];
  const push = createMobilePushService({ pollIntervalMs: 0, now: () => clock, gateway: { async call() { return [agent]; } }, sender: async (...args) => sent.push(args) });
  await push.subscribe("pair-expired", 1500, subscription);
  await push.subscribe("subscription-expired", 10_000, { ...subscription, endpoint: `${subscription.endpoint}-b`, expirationTime: 1500 });
  clock = 2000; agent = makeAgent(); await push.observe();
  assert.equal(sent.length, 0);
  assert.equal(push.config("pair-expired").subscribed, false);
  assert.equal(push.config("subscription-expired").subscribed, false);
  push.close();
});

test("paired HTTP subscription lifecycle separates devices and rejects unauthenticated mutations", async (context) => {
  let agent = makeAgent();
  const sent = [];
  const app = createMobileServer({ sessionFile: null, pairingCode: "314159", skipPairing: false, now: () => 1000, pushPollIntervalMs: 0, gateway: { async call() { return [agent]; } }, pushSender: async (target, payload) => sent.push({ endpoint: target.endpoint, payload }) });
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  context.after(() => app.server.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, { cookie, method = "GET", body } = {}) { return await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  const unauthenticated = await request("/api/push/subscriptions", { method: "POST", body: { subscription } });
  assert.equal(unauthenticated.status, 401);
  const pair = await request("/api/pair", { method: "POST", body: { code: "314159" } });
  const cookie = pair.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("/api/push/subscriptions", { cookie, method: "POST", body: { subscription } })).status, 201);
  assert.equal((await (await request("/api/push/config", { cookie })).json()).subscribed, true);
  agent = makeAgent({ isRunning: true }); await app.push.observe();
  agent = makeAgent(); await app.push.observe(); assert.equal(sent.length, 1);
  await request("/api/push/preferences", { cookie, method: "PUT", body: { enabled: false } });
  assert.equal((await (await request("/api/push/preferences", { cookie })).json()).enabled, false);
  await request("/api/push/subscriptions", { cookie, method: "DELETE", body: {} });
  assert.equal((await (await request("/api/push/config", { cookie })).json()).subscribed, false);
  await request("/api/push/subscriptions", { cookie, method: "POST", body: { subscription } });
  await request("/api/logout", { cookie, method: "POST", body: {} });
  assert.equal((await request("/api/push/config", { cookie })).status, 401);
  agent = makeAgent({ isRunning: true }); await app.push.observe();
  agent = makeAgent(); await app.push.observe(); assert.equal(sent.length, 1);
});

test("background SSE observes short turns with no open phone event stream", async () => {
  let stream;
  let cancelled = false;
  const notifications = [];
  let delivered;
  const delivery = new Promise((resolve) => { delivered = resolve; });
  const push = createMobilePushService({ pollIntervalMs: 60_000, now: () => 1000, gateway: {
    async call() { return [makeAgent()]; },
    async events() { return new Response(new ReadableStream({ start(controller) { stream = controller; }, cancel() { cancelled = true; } })); },
  }, sender: async (_, payload) => { notifications.push(payload); delivered(); } });
  try {
    push.start();
    await push.subscribe("device", 10_000, subscription);
    const encoder = new TextEncoder();
    for (const agent of [makeAgent({ isRunning: true }), makeAgent()]) stream.enqueue(encoder.encode(`data: ${JSON.stringify({ channel: "agent-upserted", payload: { agent } })}\n\n`));
    await Promise.race([delivery, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error("SSE did not deliver")), 1000); timeout.unref(); })]);
    assert.equal(notifications.length, 1);
  } finally { push.close(); await new Promise((resolve) => setImmediate(resolve)); }
  assert.equal(cancelled, true, "close cancels only this service-owned observer stream");
});

test("stale SSE and polled snapshots cannot clear a stopped intent; a newer explicit intent can resume notifications", async () => {
  const directory = mkdtempSync(join(tmpdir(), "belmont-mobile-push-order-"));
  try {
    const file = join(directory, "push.json");
    let agent = makeAgent({ isRunning: true, userIntentRevision: 1, updatedAt: 1, lastActivityAt: 1, lastMessageId: "old", snapshotEpoch: "host-a", snapshotSeq: 1 });
    const sent = [];
    const options = { file, pollIntervalMs: 0, now: () => 1000, gateway: { async call() { return [agent]; } }, sender: async (_, payload) => sent.push(payload) };
    let push = createMobilePushService(options);
    await push.subscribe("device", 10_000, subscription);
    const stopped = { ...agent, isRunning: false, isUserStopped: true, userIntentRevision: 2, updatedAt: 3, lastActivityAt: 3, snapshotSeq: 3 };
    await push.handleEvent({ channel: "agent-upserted", payload: { agent: stopped } });
    const stale = { ...agent, snapshotSeq: 2, updatedAt: 2, lastActivityAt: 2 };
    for (const update of [stale, { ...stale, isRunning: false, lastMessageId: "late-answer" }]) await push.handleEvent({ channel: "agent-upserted", payload: { agent: update } });
    agent = { ...stale, isRunning: false, lastMessageId: "late-answer" }; await push.observe();
    push.close(); push = createMobilePushService(options);
    await push.observe();
    // Same transcript time cannot defeat the host's snapshot sequence. Missing
    // intent revision/timestamp cannot be interpreted as an explicit resume.
    for (const update of [{ ...stopped, isUserStopped: false, isRunning: true, snapshotSeq: 2 }, { ...stopped, isUserStopped: false, isRunning: false, snapshotSeq: 4 }, { id: "worker", isRunning: true, isUserStopped: false }, { id: "worker", isRunning: false, lastMessageId: "unknown-version" }]) {
      await push.handleEvent({ channel: "agent-upserted", payload: { agent: update } });
    }
    assert.equal(sent.length, 0);
    agent = { ...stopped, isUserStopped: false, isRunning: true, userIntentRevision: 3, updatedAt: 5, lastActivityAt: 5, snapshotSeq: 5 }; await push.observe();
    agent = { ...agent, isRunning: false, lastMessageId: "new-intent-answer", updatedAt: 6, lastActivityAt: 6, snapshotSeq: 6 }; await push.observe();
    assert.equal(sent.length, 1, "a genuinely new guarded user intent can complete normally");
    push.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a new host epoch is accepted only from the current polled roster; retired connections cannot switch it back", async () => {
  let agent = makeAgent({ isRunning: true, isUserStopped: true, userIntentRevision: 2, snapshotEpoch: "old-host", snapshotSeq: 100, lastMessageId: "old" });
  const sent = [];
  const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000, gateway: { async call() { return [agent]; } }, sender: async (_, payload) => sent.push(payload) });
  await push.subscribe("device", 10_000, subscription);
  agent = { ...agent, snapshotEpoch: "new-host", snapshotSeq: 1, isRunning: false };
  await push.observe();
  for (const update of [{ ...agent, snapshotEpoch: "old-host", snapshotSeq: 101, isUserStopped: false, isRunning: true }, { ...agent, snapshotEpoch: "old-host", snapshotSeq: 102, isUserStopped: false, isRunning: false, lastMessageId: "stale-answer" }]) {
    await push.handleEvent({ channel: "agent-upserted", payload: { agent: update } });
  }
  assert.equal(sent.length, 0);
  agent = { ...agent, isRunning: true, isUserStopped: false, userIntentRevision: 3, snapshotSeq: 2 }; await push.observe();
  agent = { ...agent, isRunning: false, lastMessageId: "new-answer", snapshotSeq: 3 }; await push.observe();
  assert.equal(sent.length, 1);
  push.close();
});

test("legacy snapshots with no epoch are still monotonic by activity and cannot erase a stop without a newer intent revision", async () => {
  const sent = [];
  const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000, gateway: { async call() { return [{ id: "worker", isRunning: true, lastActivityAt: 1 }]; } }, sender: async (_, payload) => sent.push(payload) });
  await push.subscribe("device", 10_000, subscription);
  await push.observe([{ id: "worker", isRunning: false, isUserStopped: true, lastActivityAt: 3 }]);
  for (const update of [{ id: "worker", isRunning: true, isUserStopped: false, lastActivityAt: 2 }, { id: "worker", isRunning: false, isUserStopped: false, lastActivityAt: 2, lastMessageId: "late" }, { id: "worker", isRunning: true }, { id: "worker", isRunning: false, lastMessageId: "missing-time" }]) await push.handleEvent({ channel: "agent-upserted", payload: { agent: update } });
  assert.equal(sent.length, 0);
  push.close();
});

test("a pending old poll and buffered newer SSE stop serialize without allowing subsequent old deltas to revive work", async () => {
  const sent = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let pollCalls = 0;
  const base = makeAgent({ isRunning: true, userIntentRevision: 1, snapshotEpoch: "host", snapshotSeq: 1, lastMessageId: "old" });
  const push = createMobilePushService({ pollIntervalMs: 0, now: () => 1000, gateway: { async call() {
    if (++pollCalls > 1) { const captured = { ...base, snapshotSeq: 2 }; await gate; return [captured]; }
    return [base];
  } }, sender: async (_, payload) => sent.push(payload) });
  await push.subscribe("device", 10_000, subscription);
  const polling = push.observe();
  const stopping = push.handleEvent({ channel: "agent-upserted", payload: { agent: { ...base, isRunning: false, isUserStopped: true, userIntentRevision: 2, snapshotSeq: 3 } } });
  release();
  await Promise.all([polling, stopping]);
  for (const isRunning of [true, false]) await push.handleEvent({ channel: "agent-upserted", payload: { agent: { ...base, isRunning, snapshotSeq: 2, lastMessageId: "late" } } });
  assert.equal(sent.length, 0);
  push.close();
});
