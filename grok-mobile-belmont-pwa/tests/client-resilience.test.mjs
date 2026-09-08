import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
async function load(file) {
  if (!cache.has(file)) cache.set(file, build({ absWorkingDir: root, bundle: true, entryPoints: [file], format: "esm", platform: "node", target: "node22", write: false }).then((result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`)));
  return cache.get(file);
}
const message = (id, timestampMs = 1) => ({ id, type: "text", role: "assistant", content: id, timestampMs });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("quiet refresh keeps the oldest page cursor and never resurrects exhausted pagination", async () => {
  const { TranscriptStore } = await load("src/transcript-store.ts");
  const responses = [
    { entries: [message("new", 3)], nextBeforeSeq: 60 },
    { entries: [message("older", 2)], nextBeforeSeq: 20 },
    { entries: [message("new", 3), message("newest", 4)], nextBeforeSeq: 70 },
    { entries: [message("oldest", 1)], nextBeforeSeq: null },
    { entries: [message("newest", 4)], nextBeforeSeq: 70 },
  ];
  const cursors = [];
  const store = new TranscriptStore(async (before) => { cursors.push(before); return responses.shift(); });
  await store.refresh(); await store.loadOlder(); await store.refresh();
  assert.equal(store.getSnapshot().nextBeforeSeq, 20);
  await store.loadOlder(); await store.refresh(); await store.loadOlder();
  assert.equal(store.getSnapshot().nextBeforeSeq, null);
  assert.deepEqual(cursors, [null, 60, null, 20, null]);
  assert.deepEqual(store.getSnapshot().entries.map((entry) => entry.id), ["oldest", "older", "new", "newest"]);
  store.dispose();
});

test("reconnect bursts serialize requests and schedule one trailing refresh", async () => {
  const { TranscriptStore } = await load("src/transcript-store.ts");
  const first = deferred(); const second = deferred(); let calls = 0;
  const store = new TranscriptStore(() => ++calls === 1 ? first.promise : second.promise);
  const pending = store.refresh();
  await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
  assert.equal(calls, 1);
  first.resolve({ entries: [message("before-reconnect")] });
  await pending; assert.equal(calls, 2);
  second.resolve({ entries: [message("missed-event", 2)] });
  await tick();
  assert.deepEqual(store.getSnapshot().entries.map((entry) => entry.id), ["before-reconnect", "missed-event"]);
  store.dispose();
});

test("late responses from an old bot cannot publish after navigation, even if transport ignores abort", async () => {
  const { TranscriptStore } = await load("src/transcript-store.ts");
  const old = deferred(); let oldSignal;
  const store = new TranscriptStore((_before, signal) => { oldSignal = signal; return old.promise; });
  const pending = store.refresh(); store.dispose();
  const current = new TranscriptStore(async () => ({ entries: [message("bot-B")] }));
  await current.refresh(); old.resolve({ entries: [message("bot-A")] }); await pending;
  assert.equal(oldSignal.aborted, true);
  assert.deepEqual(store.getSnapshot().entries, []);
  assert.deepEqual(current.getSnapshot().entries.map((entry) => entry.id), ["bot-B"]);
  current.dispose();
});

test("a hung transport times out and allows the next refresh to recover", async () => {
  const { TranscriptStore } = await load("src/transcript-store.ts");
  let attempts = 0; let signal;
  const store = new TranscriptStore((_before, nextSignal) => { signal = nextSignal; return ++attempts === 1 ? new Promise(() => {}) : Promise.resolve({ entries: [message("recovered")] }); }, 10);
  await store.refresh();
  assert.equal(signal.aborted, true);
  assert.equal(store.getSnapshot().loading, false);
  assert.ok(store.getSnapshot().error);
  await store.refresh();
  assert.equal(store.getSnapshot().error, "");
  assert.equal(store.getSnapshot().entries[0].id, "recovered");
  store.dispose();
});

test("a lost response retry preserves exact send identity including attachment bytes and reply root", async () => {
  const { prepareSendIntent } = await load("src/send-intent.ts");
  const input = { botId: "B", text: "검토", replyToId: "root-1", attachments: [{ id: "local-1", name: "evidence.txt", size: 1, bytesBase64: "YQ==" }] };
  const first = prepareSendIntent(null, input);
  const retried = prepareSendIntent(first, { ...input, attachments: [{ ...input.attachments[0], id: "reselected-file" }] });
  assert.equal(retried.clientNonce, first.clientNonce);
  for (const changed of [{ ...input, botId: "C" }, { ...input, text: "다른 검토" }, { ...input, replyToId: "root-2" }, { ...input, attachments: [{ ...input.attachments[0], bytesBase64: "Yg==" }] }]) assert.notEqual(prepareSendIntent(first, changed).clientNonce, first.clientNonce);
  assert.notEqual(prepareSendIntent(null, input).clientNonce, first.clientNonce, "a later intentional identical send is a new operation");
});

test("same text with different explicit nonces or reply roots represents separate sends", async () => {
  const { reconcileEntries } = await load("src/entries.ts");
  const pending = { id: "p", type: "text", role: "user", content: "네", timestampMs: 1, clientNonce: "new-intent", optimistic: true };
  const confirmed = { ...pending, id: "c", timestampMs: 2, optimistic: false, clientNonce: "older-intent" };
  assert.equal(reconcileEntries([pending, confirmed]).length, 2);
  const noNonce = { ...confirmed, clientNonce: undefined, replyToId: "different-thread" };
  assert.equal(reconcileEntries([pending, noNonce]).length, 2);
});

test("client sends an actual stop request and resyncs when EventSource reconnects", async () => {
  const { api, subscribeToEvents } = await load("src/api.ts");
  const original = { fetch: globalThis.fetch, EventSource: globalThis.EventSource, window: globalThis.window };
  const requests = []; let source; let resyncs = 0;
  try {
    globalThis.fetch = async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ ok: true, id: "bot/a", interrupted: true })); };
    globalThis.window = { location: { href: "https://isolated.test/" } };
    globalThis.EventSource = class { constructor() { source = this; } close() { this.closed = true; } };
    const disconnect = subscribeToEvents(() => resyncs++, () => undefined);
    source.onopen(); source.onmessage(); source.onopen();
    assert.equal(resyncs, 3);
    const stopped = await api.stop("bot/a", { expectedStopGuard: "observed-run" });
    assert.equal(stopped.interrupted, true);
    assert.equal(requests[0].url, "/api/bots/bot%2Fa/stop");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), { expectedStopGuard: "observed-run" });
    disconnect(); assert.equal(source.closed, true);
  } finally { Object.assign(globalThis, original); }
});
