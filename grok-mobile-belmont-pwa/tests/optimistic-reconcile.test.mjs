// A sent message must not show twice: the gray optimistic bubble retires once the desktop's confirmed
// copy arrives (matched by clientNonce, falling back to same text within five minutes).
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { projectTranscriptEntries } from "../server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function loadEntries() {
  const result = await build({ absWorkingDir: root, bundle: true, entryPoints: ["src/entries.ts"], format: "esm", platform: "node", target: "node22", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const optimistic = { id: "optimistic-1", type: "text", role: "user", content: "플러그인 붙어있는게 뭐야?", timestampMs: 1000, optimistic: true, clientNonce: "n1" };

test("the optimistic bubble is retired by the confirmed entry with the same clientNonce", async () => {
  const { reconcileEntries } = await loadEntries();
  const confirmed = { id: "t9u", type: "text", role: "user", content: "플러그인 붙어있는게 뭐야?", timestampMs: 1400, clientNonce: "n1" };
  assert.deepEqual(reconcileEntries([optimistic, confirmed]).map((entry) => entry.id), ["t9u"]);
});
test("without a nonce echo, identical text from the user within five minutes still retires it", async () => {
  const { reconcileEntries } = await loadEntries();
  const confirmed = { id: "t9u", type: "text", role: "user", content: "플러그인 붙어있는게 뭐야?", timestampMs: 60_000 };
  assert.deepEqual(reconcileEntries([optimistic, confirmed]).map((entry) => entry.id), ["t9u"]);
  const later = { ...confirmed, timestampMs: 10 * 60_000 };
  assert.deepEqual(reconcileEntries([optimistic, later]).map((entry) => entry.id), ["optimistic-1", "t9u"], "an old identical message is not the same send");
});
test("an assistant reply with the same text never retires a user bubble, and the pending bubble stays until confirmed", async () => {
  const { reconcileEntries } = await loadEntries();
  const echo = { id: "a1", type: "text", role: "assistant", content: "플러그인 붙어있는게 뭐야?", timestampMs: 1500 };
  assert.deepEqual(reconcileEntries([optimistic, echo]).map((entry) => entry.id), ["optimistic-1", "a1"]);
});
test("the server projection carries the desktop's clientNonce on user text entries", () => {
  const [entry] = projectTranscriptEntries([{ id: "t9u", role: "user", content: "hi", timestampMs: 5, clientNonce: "n1" }], "bot");
  assert.equal(entry.clientNonce, "n1");
  const [without] = projectTranscriptEntries([{ id: "t2a", role: "assistant", content: "yo", timestampMs: 6 }], "bot");
  assert.equal("clientNonce" in without, false);
});

test("an active run is described as post-response only after this screen observes its reply", async () => {
  const { nextRunObservation, runPresentation } = await loadEntries();
  const user = { id: "u1", type: "text", role: "user", content: "너는?", timestampMs: 1 };
  const answer = { id: "a1", type: "text", role: "assistant", content: "난 벨몬트예요.", timestampMs: 2 };
  const activity = { id: "x1", type: "agent-activity", role: "assistant", agentId: "bot", agentName: "Bot", direction: "outgoing", content: "도구 실행", jobId: "j1", isError: false, timestampMs: 3 };

  const mountedDuringRun = nextRunObservation(null, [user, answer], "bot", "run-1", true);
  assert.equal(runPresentation([user, answer], true, false, mountedDuringRun.latestAssistantId !== mountedDuringRun.baselineAssistantId), "working", "old history cannot classify an unseen run");
  const beforeRun = nextRunObservation(null, [user], "bot", "run-0", false);
  const started = nextRunObservation(beforeRun, [user], "bot", "run-1", true);
  const replied = nextRunObservation(started, [user, answer], "bot", "run-1", true);
  assert.equal(runPresentation([user, answer], true, false, replied.latestAssistantId !== replied.baselineAssistantId), "post-response");
  assert.equal(runPresentation([user, { ...answer, isStreaming: true }], true, false, true), "working");
  assert.equal(runPresentation([user, answer, activity], true, false, true), "working");
  assert.equal(runPresentation([user, answer, { ...user, id: "u2", timestampMs: 4 }], true, false, true), "working");
  assert.equal(runPresentation([user, answer], true, true, true), "composing");
  assert.equal(runPresentation([user, answer], false, false, true), "idle");

  const idle = nextRunObservation(replied, [user, answer], "bot", "run-1", false);
  const backgroundRun = nextRunObservation(idle, [user, answer], "bot", "run-2", true);
  assert.equal(runPresentation([user, answer], true, false, backgroundRun.latestAssistantId !== backgroundRun.baselineAssistantId), "working", "a later background run cannot inherit the prior response");
});
