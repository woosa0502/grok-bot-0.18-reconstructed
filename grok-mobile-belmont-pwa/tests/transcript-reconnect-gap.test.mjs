import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiled = await build({ absWorkingDir: root, bundle: true, entryPoints: ["src/transcript-store.ts"], format: "esm", platform: "node", target: "node26", write: false });
const { TranscriptStore } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const message = (seq) => ({ id: `m-${seq}`, type: "text", role: "assistant", content: String(seq), timestampMs: seq });

function fixture(initialCount) {
  let count = initialCount;
  let failBefore;
  const calls = [];
  const store = new TranscriptStore(async (before) => {
    calls.push(before);
    if (before === failBefore) { failBefore = undefined; throw new Error("fixture disconnected"); }
    const end = before == null ? count : Math.min(count, before - 1);
    const start = Math.max(1, end - 59);
    return { entries: Array.from({ length: end - start + 1 }, (_, index) => message(start + index)), nextBeforeSeq: start > 1 ? start : null };
  });
  return { store, calls, append: (amount) => { count += amount; }, failOnce: (before) => { failBefore = before; }, count: () => count };
}

test("reconnect catches up a disjoint latest page without losing exhausted history", async () => {
  const { store, append } = fixture(60);
  await store.refresh();
  append(120);
  await store.refresh();
  assert.deepEqual(store.getSnapshot().entries.map((entry) => entry.id), Array.from({ length: 180 }, (_, index) => `m-${index + 1}`));
  assert.equal(store.getSnapshot().nextBeforeSeq, null);
  store.dispose();
});

test("an interrupted catch-up retains its continuation and original older-history cursor", async () => {
  const { store, append, failOnce, calls } = fixture(120);
  await store.refresh();
  append(180);
  failOnce(181);
  await store.refresh();
  assert.match(store.getSnapshot().error, /disconnected/);
  assert.equal(store.getSnapshot().nextBeforeSeq, 181);
  const failedCalls = calls.length;
  await store.refresh();
  assert.deepEqual(calls.slice(failedCalls), [null, 181, 121]);
  assert.equal(store.getSnapshot().error, "");
  assert.equal(store.getSnapshot().nextBeforeSeq, 61);
  await store.loadOlder();
  assert.equal(store.getSnapshot().entries.length, 300);
  assert.equal(store.getSnapshot().nextBeforeSeq, null);
  store.dispose();
});

test("bounded catch-up resumes through a second offline gap without duplicates", async () => {
  const { store, append, calls, count } = fixture(60);
  await store.refresh();
  append(1200);
  await store.refresh();
  assert.equal(calls.length, 10, "initial read plus latest and eight catch-up pages");
  assert.notEqual(store.getSnapshot().nextBeforeSeq, null);
  append(120);
  for (let attempt = 0; store.getSnapshot().nextBeforeSeq != null && attempt < 8; attempt++) {
    const before = calls.length;
    await store.refresh();
    assert.ok(calls.length - before <= 9);
  }
  assert.equal(store.getSnapshot().nextBeforeSeq, null);
  assert.deepEqual(store.getSnapshot().entries.map((entry) => entry.id), Array.from({ length: count() }, (_, index) => `m-${index + 1}`));
  store.dispose();
});

test("manual older loading also closes an interrupted gap", async () => {
  const { store, append, failOnce } = fixture(60);
  await store.refresh();
  append(120);
  failOnce(121);
  await store.refresh();
  assert.equal(store.getSnapshot().nextBeforeSeq, 121);
  await store.loadOlder();
  await store.loadOlder();
  assert.equal(store.getSnapshot().entries.length, 180);
  assert.equal(store.getSnapshot().nextBeforeSeq, null);
  store.dispose();
});

test("catch-up refreshes fetched old approval statuses while preserving refreshed head copies", async () => {
  let total = 120;
  let status = "pending";
  const store = new TranscriptStore(async (before) => {
    const end = before == null ? total : before - 1;
    const start = Math.max(1, end - 59);
    const entries = Array.from({ length: end - start + 1 }, (_, index) => {
      const seq = start + index;
      return seq === 110 ? { id: "m-110", type: "approval", role: "assistant", timestampMs: seq, agentId: "bot", requestId: "approval", surface: "shell", summary: "Run", reason: "", command: "true", status } : message(seq);
    });
    if (before === 341) entries.push({ ...message(390), content: "stale duplicated head" });
    return { entries, nextBeforeSeq: start > 1 ? start : null };
  });
  await store.refresh();
  total = 400;
  status = "approved";
  await store.refresh();
  assert.equal(store.getSnapshot().entries.find((entry) => entry.id === "m-110").status, "approved");
  assert.equal(store.getSnapshot().entries.find((entry) => entry.id === "m-390").content, "390");
  store.dispose();
});
