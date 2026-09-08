import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMobileSendLedger, unwrapMobileNonce } from "../mobile-send-ledger.mjs";
import { createMobileServer, projectAgent, projectTranscriptEntries } from "../server.mjs";

const sendBody = { text: "Review this", clientNonce: "fixed-nonce", attachments: [{ name: "brief.txt", bytesBase64: "aGVsbG8=" }], replyToId: "parent", isFork: true };

test("concurrent retries upload and dispatch once, but payload conflicts reject while pending", async () => {
  let release;
  let entered;
  const uploadStarted = new Promise((resolve) => { entered = resolve; });
  const uploadGate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const gateway = { async call(method, args) {
    calls.push({ method, args });
    if (method === "uploadAttachment") { entered(); await uploadGate; return { path: "/fixture/brief.txt" }; }
    return { accepted: true };
  } };
  const ledger = createMobileSendLedger();
  const attempts = Array.from({ length: 20 }, () => ledger.send("device-a", "bot-a", sendBody, gateway));
  await uploadStarted;
  await assert.rejects(ledger.send("device-a", "bot-a", { ...sendBody, text: "changed" }, gateway), { status: 409 });
  release();
  const results = await Promise.all(attempts);
  assert.equal(results.length, 20);
  assert.deepEqual(results[0], { accepted: true, clientNonce: "fixed-nonce" });
  assert.deepEqual(calls.map((item) => item.method), ["uploadAttachment", "sendPrompt"]);
  assert.deepEqual(calls[1].args.attachmentPaths, ["/fixture/brief.txt"]);
  assert.equal(unwrapMobileNonce(calls[1].args.clientNonce), "fixed-nonce");
  await ledger.send("device-a", "bot-a", sendBody, gateway);
  assert.equal(calls.length, 2, "acknowledged repeat is served from the receipt");
  await assert.rejects(ledger.send("device-a", "bot-a", { ...sendBody, attachments: [{ name: "brief.txt", bytesBase64: "bmV3" }] }, gateway), { status: 409 });
});

test("staged uploads and host nonce survive a lost accepted response and a server recreation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "belmont-mobile-send-"));
  try {
    const file = join(directory, "ledger.json");
    const uploads = [];
    const sends = [];
    const accepted = new Set();
    let loseResponse = true;
    const gateway = { async call(method, args) {
      if (method === "uploadAttachment") { uploads.push(args); return { path: "/fixture/content-addressed.txt" }; }
      if (method === "promptAcceptanceStatus") return accepted.has(args.clientNonce) ? { outcome: "found", record: { status: "accepted", agentId: "bot-a" } } : { outcome: "not-found" };
      sends.push(args);
      accepted.add(args.clientNonce);
      if (loseResponse) { loseResponse = false; throw new Error("gateway response lost after acceptance"); }
      return { accepted: true };
    } };
    await assert.rejects(createMobileSendLedger({ file }).send("device-a", "bot-a", sendBody, gateway), /response lost/u);
    const second = createMobileSendLedger({ file });
    await second.send("device-a", "bot-a", sendBody, gateway);
    assert.equal(uploads.length, 1);
    assert.equal(sends.length, 1, "the durable accepted receipt resolves the lost response without redispatch");
    assert.equal(accepted.size, 1, "the host sees the exact same receipt key on the retry");
    await createMobileSendLedger({ file }).send("device-a", "bot-a", sendBody, gateway);
    assert.equal(sends.length, 1, "accepted receipt remains durable");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a partial attachment failure retries only the missing attachment", async () => {
  const calls = [];
  let fail = true;
  const gateway = { async call(method, args) {
    calls.push({ method, args });
    if (method === "uploadAttachment") {
      if (args.filename === "second.txt" && fail) { fail = false; throw new Error("interrupted upload"); }
      return { path: `/fixture/${args.filename}` };
    }
  } };
  const ledger = createMobileSendLedger();
  const body = { ...sendBody, attachments: [...sendBody.attachments, { name: "second.txt", bytesBase64: "aGk=" }] };
  await assert.rejects(ledger.send("device", "bot", body, gateway), /interrupted upload/u);
  await ledger.send("device", "bot", body, gateway);
  assert.deepEqual(calls.filter((item) => item.method === "uploadAttachment").map((item) => item.args.filename), ["brief.txt", "second.txt", "second.txt"]);
  assert.deepEqual(calls.at(-1).args.attachmentPaths, ["/fixture/brief.txt", "/fixture/second.txt"]);
});

test("a definitively unaccepted send retries with identical host nonce and staged paths", async () => {
  const sends = [];
  let uploads = 0;
  let fail = true;
  const ledger = createMobileSendLedger();
  const gateway = { async call(method, args) {
    if (method === "uploadAttachment") { uploads++; return { path: "/fixture/brief.txt" }; }
    if (method === "promptAcceptanceStatus") return { outcome: "not-found" };
    sends.push(args);
    if (fail) { fail = false; throw new Error("request did not reach host"); }
    return { accepted: true };
  } };
  await assert.rejects(ledger.send("device", "bot", sendBody, gateway), /did not reach/u);
  await ledger.send("device", "bot", sendBody, gateway);
  assert.equal(uploads, 1);
  assert.equal(sends.length, 2);
  assert.equal(sends[0].clientNonce, sends[1].clientNonce);
  assert.deepEqual(sends[0].attachmentPaths, sends[1].attachmentPaths);
});

test("evicted or pending host receipts never trigger blind redispatch; transcript evidence can settle an evicted receipt", async () => {
  for (const scenario of ["pending", "unknown", "transcript-found"]) {
    let sends = 0;
    let nonce;
    const ledger = createMobileSendLedger();
    const gateway = { async call(method, args) {
      if (method === "uploadAttachment") return { path: "/fixture/brief.txt" };
      if (method === "promptAcceptanceStatus") return scenario === "pending" ? { outcome: "found", record: { status: "pending", agentId: "bot" } } : { outcome: "unknown-durability" };
      if (method === "getAgentTranscriptTail") return { entries: scenario === "transcript-found" ? [{ role: "user", clientNonce: nonce }] : [], nextBeforeSeq: null };
      sends++; nonce = args.clientNonce; throw new Error("lost response");
    } };
    await assert.rejects(ledger.send("device", "bot", sendBody, gateway), /lost response/u);
    if (scenario === "transcript-found") assert.deepEqual(await ledger.send("device", "bot", sendBody, gateway), { accepted: true, clientNonce: sendBody.clientNonce });
    else await assert.rejects(ledger.send("device", "bot", sendBody, gateway), { status: 409 });
    assert.equal(sends, 1, scenario);
  }
});

test("device and bot ownership scope the host nonce without leaking the pairing token", async () => {
  const sends = [];
  const gateway = { async call(method, args) { if (method === "sendPrompt") sends.push(args); else return { path: "/fixture/brief.txt" }; } };
  const ledger = createMobileSendLedger();
  for (const [device, bot] of [["secret-device-a", "bot-a"], ["secret-device-a", "bot-b"], ["secret-device-b", "bot-a"]]) await ledger.send(device, bot, sendBody, gateway);
  assert.equal(new Set(sends.map((item) => item.clientNonce)).size, 3);
  assert.ok(sends.every((item) => !item.clientNonce.includes("secret-device")));
  const entries = projectTranscriptEntries([{ id: "entry", role: "user", content: "Review this", clientNonce: sends[0].clientNonce }], "bot-a");
  assert.equal(entries[0].clientNonce, sendBody.clientNonce);
});

test("send validation rejects truncation and empty uploads before invoking the host", async () => {
  const ledger = createMobileSendLedger();
  const gateway = { call() { assert.fail("invalid payload must never invoke gateway"); } };
  for (const body of [{ ...sendBody, attachments: Array(9).fill(sendBody.attachments[0]) }, { ...sendBody, attachments: [{ name: "a", bytesBase64: "?" }] }, { text: "", attachments: [] }, { ...sendBody, clientNonce: "" }]) {
    await assert.rejects(ledger.send("device", "bot", body, gateway), { status: 400 });
  }
});

test("HTTP stop forwards the public selected-bot interrupt contract and preserves actual draining state", async (context) => {
  const calls = [];
  const gateway = { async call(method, args) { calls.push({ method, args }); return { id: args.id, interrupted: true }; } };
  const app = createMobileServer({ sessionFile: null, gateway, skipPairing: true, pushPollIntervalMs: 0 });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/bots/selected/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedStopGuard: "run-selected" }) });
  assert.deepEqual(await response.json(), { ok: true, id: "selected", interrupted: true });
  assert.deepEqual(calls, [{ method: "interruptAgent", args: { id: "selected", expectedStopGuard: "run-selected" } }]);
  const unguarded = await fetch(`http://127.0.0.1:${app.server.address().port}/api/bots/selected/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unguarded.status, 409);
  assert.equal(calls.length, 1);
  const agent = projectAgent({ id: "selected", isRunning: true, isUserStopped: true, awaitingUserResponse: { reason: "Approval required" } });
  assert.equal(agent.isRunning, true);
  assert.equal(agent.isUserStopped, true);
  assert.equal(agent.awaitingUserResponse, true);
});

test("guarded stop preserves stale response and never substitutes a newer run token", async () => {
  const calls = [];
  const ledger = createMobileSendLedger();
  const gateway = { async call(method, args) { calls.push({ method, args }); return { id: args.id, interrupted: false, stale: true, stopGuard: "new-run", userIntentRevision: 3 }; } };
  const result = await ledger.stop("device", "bot", { expectedStopGuard: "old-run" }, gateway);
  assert.equal(result.stale, true);
  assert.deepEqual(calls, [{ method: "interruptAgent", args: { id: "bot", expectedStopGuard: "old-run" } }]);
});

test("stop can overtake the initial send and its durable tombstone cancels the delayed upload after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "belmont-mobile-cancel-"));
  try {
    const file = join(directory, "ledger.json");
    const gateway = { call() { assert.fail("a cancelled unsent intent must never contact the host"); } };
    const first = createMobileSendLedger({ file });
    assert.deepEqual(await first.stop("device", "bot", { expectedClientNonce: sendBody.clientNonce }, gateway), { id: "bot", interrupted: false, cancelledSubmission: true });
    const restored = createMobileSendLedger({ file });
    await assert.rejects(restored.send("device", "bot", sendBody, gateway), { status: 409 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("stop during attachment staging prevents dispatch and does not interrupt an unrelated active bot intent", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const gateway = { async call(method, args) { calls.push({ method, args }); assert.equal(method, "uploadAttachment"); await gate; return { path: "/fixture/brief.txt" }; } };
  const ledger = createMobileSendLedger();
  const sending = ledger.send("device", "bot", sendBody, gateway);
  const stopped = await ledger.stop("device", "bot", { expectedClientNonce: sendBody.clientNonce }, gateway);
  assert.equal(stopped.cancelledSubmission, true);
  release();
  await assert.rejects(sending, { status: 409 });
  assert.deepEqual(calls.map((item) => item.method), ["uploadAttachment"]);
});

test("stop racing host admission retries only the captured intent after acceptance", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const enteredHost = new Promise((resolve) => { entered = resolve; });
  let activeNonce = "old-intent";
  const stops = [];
  const gateway = { async call(method, args) {
    if (method === "sendPrompt") { entered(); await gate; activeNonce = args.clientNonce; return { accepted: true }; }
    if (method === "interruptAgent") { stops.push(args); return { id: "bot", interrupted: activeNonce === args.expectedClientNonce, stale: activeNonce !== args.expectedClientNonce }; }
    throw new Error(`unexpected ${method}`);
  } };
  const ledger = createMobileSendLedger();
  const sending = ledger.send("device", "bot", { ...sendBody, attachments: [] }, gateway);
  await enteredHost;
  const stopping = ledger.stop("device", "bot", { expectedClientNonce: sendBody.clientNonce }, gateway);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stops.length, 1);
  release();
  await sending;
  assert.equal((await stopping).interrupted, true);
  assert.equal(stops.length, 2);
  assert.deepEqual(stops[0], stops[1]);
  assert.equal(unwrapMobileNonce(stops[0].expectedClientNonce), sendBody.clientNonce);
});
