// Silent-stop postmortem (2026-09-03): a bot acknowledged the user, worked, and never reported.
// Three gaps closed here — (1) the closing send nudge's detector always saw [] because nothing bound
// the executor's message getter to the runner; (2) the detector only recognised "ack → tools → end"
// with a tool-call tail, missing text-only endings, tool-first turns and interim sends; (3) a mid-turn
// compaction hid the acknowledgement behind the summary. Behavioural tests on the detector plus
// wiring guards on the three seams.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
async function loadTurnShape() {
  const result = await build({
    absWorkingDir: repoRoot, bundle: true, entryPoints: ["source/host/runner/turn-shape.ts"],
    format: "esm", platform: "node", target: "node22", write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const call = (...names) => ({ role: "assistant", content: names.map((toolName, i) => ({ type: "tool-call", toolName, toolCallId: `${toolName}-${i}-${Math.random()}` })) });
const results = (assistant) => ({ role: "tool", content: assistant.content.map((p) => ({ type: "tool-result", toolCallId: p.toolCallId })) });
const text = (t) => ({ role: "assistant", content: [{ type: "text", text: t }] });
const seq = (...msgs) => msgs.flatMap((m) => (m.role === "assistant" && m.content.some((p) => p.type === "tool-call") ? [m, results(m)] : [m]));

test("ack → tools → end is still silent (the original shape)", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  assert.equal(turnEndedOnSilentToolCalls(seq(user("네이버 날씨"), call("SendMessage"), call("browser_navigate"), call("browser_snapshot"))), true);
});
test("ack → tools → final SendMessage → memory bookkeeping is delivered, not silent", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  assert.equal(turnEndedOnSilentToolCalls(seq(user("q"), call("SendMessage"), call("Shell"), call("SendMessage"), call("update_state"))), false);
  assert.equal(turnEndedOnSilentToolCalls(seq(user("q"), call("SendMessage"), call("Shell"), call("SendMessage"), call("TodoWrite"))), false);
});
test("ack → tools → plain assistant text is silent: plain text never reaches the user", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  assert.equal(turnEndedOnSilentToolCalls(seq(user("q"), call("SendMessage"), call("Shell"), text("완료"))), true);
});
test("tool-first turn that acks later and then works is silent too", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  assert.equal(turnEndedOnSilentToolCalls(seq(user("q"), call("Read"), call("SendMessage"), call("Shell"))), true);
});
test("an interim SendMessage followed by more work is still silent", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  assert.equal(turnEndedOnSilentToolCalls(seq(user("q"), call("SendMessage"), call("Shell"), call("SendMessage"), call("Shell"), call("Read"))), true);
});
test("no delivery at all is the reply nudge's case, not this one", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  assert.equal(turnEndedOnSilentToolCalls(seq(user("q"), call("Shell"), call("Read"))), false);
  assert.equal(turnEndedOnSilentToolCalls([]), false);
});
test("a mid-turn compaction hides the ack: the collectors' knowledge decides", async () => {
  const { turnEndedOnSilentToolCalls } = await loadTurnShape();
  const summary = user("[Previous conversation summary]: Summary: 1. Primary Request and Intent: ...");
  assert.equal(turnEndedOnSilentToolCalls([summary], { deliveredBeforeVisibleHistory: true }), true, "nothing after the summary");
  assert.equal(turnEndedOnSilentToolCalls(seq(summary, call("update_state")), { deliveredBeforeVisibleHistory: true }), true, "only bookkeeping after the summary");
  assert.equal(turnEndedOnSilentToolCalls(seq(summary, text("done")), { deliveredBeforeVisibleHistory: true }), true, "plain text after the summary");
  assert.equal(turnEndedOnSilentToolCalls(seq(summary, call("Shell"), call("SendMessage")), { deliveredBeforeVisibleHistory: true }), false, "reported after the summary");
  assert.equal(turnEndedOnSilentToolCalls([summary], {}), false, "no ack before the summary: reply nudge territory");
});
test("wiring: the runner receives the executor's message getter and the settle step is compaction-aware", () => {
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /onLatestPromptMessages: \(getter: \(\) => readonly unknown\[\]\) => \{/);
  assert.match(composition, /owner\?\.setLatestPromptMessagesGetter\?\.\(getter\);/);
  const runner = read("source/host/runner/sand-agent-runner.ts");
  assert.match(runner, /setLatestPromptMessagesGetter\(getter: \(\(\) => readonly unknown\[\]\) \| undefined\): void \{/);
  const settle = read("source/host/runner/turn-settle.ts");
  assert.match(settle, /deliveredBeforeVisibleHistory: compactedThisTurn && sentMessageCount > 0/);
  const runtime = read("source/host/extensions/transcript/turn-runtime.ts");
  assert.match(runtime, /end the turn without sending anything\./);
});
