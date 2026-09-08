import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const moduleCache = new Map();
async function load(entry) {
  if (!moduleCache.has(entry)) moduleCache.set(entry, (async () => {
    const result = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", target: "node26" });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  })());
  return moduleCache.get(entry);
}
const workspace = "frontend/src/recovered/features/conversation/workspace/";
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

test("composer reset cancels old queued and pending work and fences late failures", async () => {
  const { createComposerSubmissionQueue } = await load(`${workspace}submission.ts`);
  const old = deferred();
  let down = false;
  const sends = [], failures = [];
  const queue = createComposerSubmissionQueue({
    isTransportDown: () => down,
    send: async (input) => { sends.push(input.nonce); if (input.nonce === "old-active") await old.promise; },
    onFailure: (input) => failures.push(input.nonce),
  });
  const input = (nonce) => ({ nonce, agentId: "same-bot", prompt: nonce, attachments: [], createdAtMs: 1 });
  const active = queue.submit(input("old-active"));
  down = true;
  const queued = queue.submit(input("old-queued"));
  queue.reset();
  assert.equal(await active.completion, "cancelled");
  assert.equal(await queued.completion, "cancelled");
  down = false;
  queue.flush();
  old.reject(new Error("late old-account failure"));
  const next = queue.submit(input("new-account"));
  assert.equal(await next.completion, "sent");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sends, ["old-active", "new-account"]);
  assert.deepEqual(failures, []);
  assert.deepEqual(queue.snapshot(), []);
  queue.dispose();
});

test("committed attachment retry works after the real staging bridge deletes its source", async () => {
  const { createAttachmentEdgePort } = await load("source/electron-main/attachments/attachments.ts");
  const { commitComposerAttachments } = await load(`${workspace}desktop.ts`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "strict-ui-attachment-"));
  let uploads = 0;
  try {
    const edge = createAttachmentEdgePort({
      onEdgeFailure: () => {}, byteLimitForName: () => 1024,
      getStagingDir: () => dir, isWithinStagingDir: (value) => value.startsWith(`${dir}${path.sep}`),
      legs: { uploadAttachment: async ({ bytesBase64 }) => { uploads += 1; assert.equal(Buffer.from(bytesBase64, "base64").toString(), "payload"); return { path: "/host/attachments/durable.txt" }; } },
    });
    const staged = await edge.stageBytes("sample.txt", Buffer.from("payload"));
    assert.equal(staged.ok, true);
    const bridge = { commitStagedAttachments: (paths, names) => edge.commitStaged(paths, names) };
    const committed = await commitComposerAttachments(bridge, [{ path: staged.path, name: "sample.txt" }]);
    await assert.rejects(readFile(staged.path), { code: "ENOENT" });
    assert.equal(await edge.commitStaged([committed[0].path], ["sample.txt"]), null);
    assert.deepEqual(await commitComposerAttachments(bridge, committed), committed);
    assert.equal(uploads, 1);
    assert.equal(committed[0].committed, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("upload normalization survives persistence and preserves newer draft identity", async () => {
  const { createComposerDraftStateStore } = await load(`${workspace}draft-state.ts`);
  const persistence = new Map();
  const port = { read: async (slot) => persistence.get(slot) ?? null, write: async (slot, value) => persistence.set(slot, JSON.stringify({ schemaVersion: 1, value })), clear: async (slot) => persistence.delete(slot) };
  const store = createComposerDraftStateStore(port);
  await store.restore("fixture-account");
  const original = { prompt: "old", attachments: [{ path: "/stage/payload", name: "payload", mimeType: "text/plain" }] };
  store.setDraft("a", original);
  const identity = store.identifyDraft({ agentId: "a", draft: original });
  const uploaded = [{ path: "/host/durable", name: "payload", mimeType: "text/plain", committed: true }];
  store.commitAttachments("a", original.attachments, uploaded);
  assert.equal(store.clearDraftIfCurrent(identity), true);
  store.setDraft("a", original);
  const sentIdentity = store.identifyDraft({ agentId: "a", draft: original });
  store.setDraft("a", { ...original, prompt: "newer user text" });
  store.commitAttachments("a", original.attachments, uploaded);
  assert.equal(store.clearDraftIfCurrent(sentIdentity), false);
  const expected = { prompt: "newer user text", attachments: uploaded };
  assert.deepEqual(store.snapshotsFor("a").get().draft, expected);
  await store.restore("fixture-account");
  assert.deepEqual(store.snapshotsFor("a").get().draft, expected);
  store.dispose();
});

test("mixed staged and committed files retain order and reject invalid upload replies", async () => {
  const { commitComposerAttachments } = await load(`${workspace}desktop.ts`);
  const already = { path: "/host/a", name: "a", committed: true };
  const staged = { path: "/stage/b", name: "b" };
  const calls = [];
  const value = await commitComposerAttachments({ commitStagedAttachments: async (...args) => { calls.push(args); return ["/host/b"]; } }, [already, staged]);
  assert.deepEqual(calls, [[["/stage/b"], ["b"]]]);
  assert.deepEqual(value, [already, { path: "/host/b", name: "b", committed: true }]);
  await assert.rejects(commitComposerAttachments({ commitStagedAttachments: async () => [""] }, [staged]), /could not commit/);
});
