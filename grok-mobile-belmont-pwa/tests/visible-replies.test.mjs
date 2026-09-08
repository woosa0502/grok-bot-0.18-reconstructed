import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { projectTranscriptEntries } from "../server.mjs";

const bundle = await build({
  entryPoints: [new URL("../src/screens/ChatScreen.tsx", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
});
const { transcriptRows } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const text = (id, replyTo, branched = false) => ({ kind: "send-message", id, message: { type: "text", content: id, ...(replyTo ? { reply_to: replyTo } : {}) }, timestampMs: 1, ...(branched ? { branched: true } : {}) });
const rows = (raw) => transcriptRows(projectTranscriptEntries(raw, "bot")).filter((row) => row.kind !== "day");

test("ordinary model reply_to answers stay visible with no false thread pill", () => {
  const result = rows([{ kind: "message", id: "u", role: "user", content: "hello", timestampMs: 1 }, text("answer", "u"), text("followup", "answer")]);
  assert.deepEqual(result.map((row) => row.id), ["u", "answer", "followup"]);
  assert.ok(result.every((row) => row.replyCount == null && row.threadRootId == null));
});

test("a real branch roots at the main reply, without traversing its ordinary reply_to", () => {
  const result = rows([text("u"), text("answer", "u"), text("thread-user", "answer", true), text("thread-answer", "thread-user", true)]);
  assert.deepEqual(result.map((row) => row.id), ["u", "answer"]);
  assert.equal(result[0].replyCount, undefined);
  assert.equal(result[1].replyCount, 2);
});

test("missing-parent and cyclic branches remain visible until a valid root is loaded", () => {
  const result = rows([text("ordinary-orphan", "missing"), text("branch-orphan", "missing", true), text("child", "branch-orphan", true), text("cycle-a", "cycle-b", true), text("cycle-b", "cycle-a", true)]);
  assert.deepEqual(result.map((row) => row.id), ["ordinary-orphan", "branch-orphan", "child", "cycle-a", "cycle-b"]);
  assert.equal(result[0].threadRootId, undefined);
  assert.equal(result[1].threadRootId, "missing");
  const loaded = rows([text("missing"), text("branch-orphan", "missing", true), text("child", "branch-orphan", true)]);
  assert.deepEqual(loaded.map((row) => row.id), ["missing"]);
  assert.equal(loaded[0].replyCount, 2);
});

test("ordinary reply-linked widgets and attachments remain actionable in the main chat", () => {
  const result = rows([text("root"), { kind: "send-message", id: "widget", replyTo: "root", message: { type: "widget", widget: { prompt: "choose", options: [{ label: "ok", value: "ok" }] } }, timestampMs: 2 }, { kind: "user-attachment", id: "file", replyTo: "root", file_name: "proof.txt", file_path: "/proof.txt", byteSize: 1, timestampMs: 3 }]);
  assert.deepEqual(result.map((row) => row.id), ["root", "widget", "file"]);
  assert.ok(result.every((row) => row.replyCount == null && row.threadRootId == null));
});

test("explicitly branched cards fold while ordinary approval remains visible", () => {
  const approval = { kind: "send-message", id: "approval", replyTo: "root", message: { type: "auto-review-approval", approval: { requestId: "r", summary: "approval", status: "pending" } }, timestampMs: 2 };
  const widget = { kind: "send-message", id: "widget", branched: true, replyTo: "root", message: { type: "widget", widget: { prompt: "choose", options: [] } }, timestampMs: 3 };
  const file = { kind: "user-attachment", id: "file", branched: true, replyTo: "widget", file_name: "proof.txt", file_path: "/proof.txt", timestampMs: 4 };
  const result = rows([text("root"), approval, widget, file]);
  assert.deepEqual(result.map((row) => row.id), ["root", "approval"]);
  assert.equal(result[0].replyCount, 2);
  assert.equal(result[1].threadRootId, undefined);
});
