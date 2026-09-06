// Silent-stop postmortem, part 2 (2026-09-05): Belmont acknowledged a Gmail cleanup, moved 40 of 639
// mails in batches of ten, then ended the turn on plain assistant text — and the closing send nudge
// never fired. Root cause: the detector read the prompt messages through a getter bound to "the
// executor created last"; the real Agent builds a fresh executor per runStream / summary / step,
// so at settle time the getter could point at a pre-compaction snapshot that ended right after an
// acknowledgement ("already reported"). Fixes: (1) record what each model call actually received,
// innermost in the chain, and settle from that; (2) keep silent-tail detection on for the hidden
// nudge run so the runtime can nudge again (bounded) when the model sends a progress note and keeps
// working; (3) tell a routine wake to resume the user's unfinished task instead of ending on it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
async function load(entry) {
  const result = await build({
    absWorkingDir: repoRoot, bundle: true, entryPoints: [entry],
    format: "esm", platform: "node", target: "node22", write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const call = (...names) => ({ role: "assistant", content: names.map((toolName, i) => ({ type: "tool-call", toolName, toolCallId: `${toolName}-${i}-${Math.random()}` })) });
const results = (assistant) => ({ role: "tool", content: assistant.content.map((p) => ({ type: "tool-result", toolCallId: p.toolCallId })) });
const seq = (...msgs) => msgs.flatMap((m) => (m.role === "assistant" && m.content.some((p) => p.type === "tool-call") ? [m, results(m)] : [m]));
const summary = () => ({ role: "user", content: "[Previous conversation summary]: # Summary …", providerOptions: { cursor: { isSummary: true } } });
const earlyReminder = () => ({ role: "user", content: "<system_reminder>\nRemember: the user cannot see tool output or your thinking — only SendMessage reaches them.\n</system_reminder>", providerOptions: { cursor: { sandEarlyResultReminder: true } } });

function fakeExecutor(initial = []) {
  const messages = [...initial];
  return {
    streams: 0,
    getMessages: () => [...messages],
    getState: () => [...messages],
    clearMessages: () => { messages.length = 0; },
    appendMessages(incoming) { messages.push(...(Array.isArray(incoming) ? incoming : [incoming])); },
    stream() { this.streams += 1; return "stream"; },
  };
}

test("the snapshot middleware records exactly what the model was given on each stream(), reminders included", async () => {
  const snap = await load("source/host/runner/prompt-messages-snapshot-middleware.ts");
  const reminders = await load("source/host/runner/send-message-reminder-middleware.ts");
  const recorder = snap.createPromptMessagesRecorder();
  assert.deepEqual(recorder.latest(), [], "nothing recorded before the first model call");

  // Seven tool calls since the last SendMessage: the outer reminder middleware appends its message
  // before the (innermost) recorder sees the list, so the recording matches the provider call.
  const inner = fakeExecutor(seq(user("q"), call("SendMessage"), ...Array.from({ length: 7 }, () => call("Shell"))));
  const chain = reminders.createSendMessageReminderMiddleware()(snap.createPromptMessagesSnapshotMiddleware(recorder)(inner));
  assert.equal(chain.stream({}), "stream");
  const recorded = recorder.latest();
  assert.equal(recorded.length, inner.getMessages().length);
  assert.ok(reminders.isSendMessageReminderMessage(recorded.at(-1)), "the injected reminder is part of what the model saw");

  // Appends without a model call (tool results landing after the final response) do not move it.
  inner.appendMessages(seq(call("Shell")));
  assert.equal(recorder.latest().length, recorded.length, "the recording is what the model last saw");

  // A second, fresh executor sharing the recorder — the Agent asks for one per runStream / summary /
  // step — only replaces the recording when IT streams, and then with its own (current) messages.
  const fresh = fakeExecutor(seq(user("q2"), call("SendMessage")));
  const chain2 = snap.createPromptMessagesSnapshotMiddleware(recorder)(fresh);
  assert.equal(recorder.latest().length, recorded.length);
  chain2.stream({});
  assert.equal(recorder.latest().length, fresh.getMessages().length);
  assert.equal(inner.streams, 1);
  assert.equal(fresh.streams, 1);
});

test("detector: a closing-nudge run that works without reporting is silent; ending at once is not", async () => {
  const { turnEndedOnSilentToolCalls } = await load("source/host/runner/turn-shape.ts");
  const nudge = user("Your previous turn acknowledged the user and then ran tool calls …");
  const cont = { continuesAcknowledgedTurn: true };
  assert.equal(turnEndedOnSilentToolCalls(seq(nudge), cont), false, "ended at once: nothing more to report");
  assert.equal(turnEndedOnSilentToolCalls(seq(nudge, call("Shell"), call("CallMcpTool")), cont), true, "worked, never reported");
  assert.equal(turnEndedOnSilentToolCalls(seq(nudge, call("SendMessage")), cont), false, "reported");
  assert.equal(turnEndedOnSilentToolCalls(seq(nudge, call("SendMessage"), call("CallMcpTool")), cont), true, "progress note, then more silent work");
  assert.equal(turnEndedOnSilentToolCalls(seq(nudge, call("TodoWrite"), call("update_state")), cont), false, "bookkeeping only is not work");
  assert.equal(turnEndedOnSilentToolCalls(seq(nudge, call("Shell"))), false, "without the option a no-ack run is the reply nudge's territory");
});

test("incident shape (Gmail cleanup, 2026-09-05 08:58): the model's last prompt says silent; the stale pre-compaction snapshot said reported", async () => {
  const { turnEndedOnSilentToolCalls } = await load("source/host/runner/turn-shape.ts");
  const opening = [
    user("승인카드가 안왔는데"),
    ...seq(call("SendMessage"), call("GetMcpServerStatus")),
    earlyReminder(),
    ...seq(call("TodoWrite", "GetMcpTools"), call("CallMcpTool"), call("SendMessage"), call("TodoWrite")),
    earlyReminder(),
  ];
  // Messages as the model last saw them before its text-only final response (recorded at stream()).
  const lastPrompt = [
    ...opening,
    summary(),
    earlyReminder(),
    ...seq(call("CallMcpTool"), call("CallMcpTool"), call("SendMessage"), call("CallMcpTool")),
    earlyReminder(),
    ...seq(call("CallMcpTool"), call("CallMcpTool")),
  ];
  assert.equal(turnEndedOnSilentToolCalls(lastPrompt), true);
  assert.equal(turnEndedOnSilentToolCalls(opening), false, "the old getter's stale snapshot ended on bookkeeping after an ack");
});

test("wiring: both executor chains record model-call messages innermost and hand the recording to the runner", () => {
  const shell = read("source/host/runner/turn-run-shell.ts");
  assert.match(shell, /createPromptMessagesSnapshotMiddleware\(promptMessagesRecorder\)\(agent\.getExecutor\(\)\)/);
  assert.match(shell, /input\.onLatestPromptMessages\?\.\(\(\) => promptMessagesRecorder\.latest\(\)\);/);
  assert.doesNotMatch(shell, /onLatestPromptMessages\?\.\(\(\) => toolExecutor\.getMessages\(\)\)/);
  const composition = read("source/host/runner/turn-agent-composition.ts");
  assert.match(composition, /createPromptMessagesSnapshotMiddleware\(promptMessagesRecorder\)\(/);
  assert.match(composition, /input\.onLatestPromptMessages\?\.\(\(\) => promptMessagesRecorder\.latest\(\)\);/);
  assert.doesNotMatch(composition, /onLatestPromptMessages\?\.\(\(\) => toolExecutor\.getMessages\(\)\)/);
});

test("wiring: closing-nudge runs keep silent-tail detection on and the runtime re-nudges up to a bound", () => {
  const settle = read("source/host/runner/turn-settle.ts");
  assert.match(settle, /const continuesAcknowledgedTurn = args\.closingNudge === true \|\| args\.taskContinuation === true;/);
  assert.match(settle, /if \(!host\.isSubagentRunner && \(!args\.hidden \|\| continuesAcknowledgedTurn\)\) \{/);
  assert.match(settle, /continuesAcknowledgedTurn \? \{ continuesAcknowledgedTurn: true \} : \{\}/);
  const shell = read("source/host/runner/turn-run-shell.ts");
  assert.match(shell, /closingNudge: options\.closingNudge === true,/);
  const runtime = read("source/host/extensions/transcript/turn-runtime.ts");
  assert.match(runtime, /export const MAX_CLOSING_SEND_NUDGES = 3;/);
  assert.match(runtime, /closingNudges < MAX_CLOSING_SEND_NUDGES &&/);
  assert.match(runtime, /nudged = await runner\.run\(CLOSING_SEND_NUDGE_PROMPT, \{\s*hidden: true,\s*closingNudge: true,/);
  assert.match(runtime, /A progress update is not a result/);
  assert.match(runtime, /end the turn without sending anything\./);
});

test("a routine wake tells the bot to resume the user's unfinished task instead of ending after a progress note", async () => {
  const automation = await load("source/host/automations/automation.ts");
  const record = {
    id: "job-sweeper", name: "Job sweeper", prompt: "[Job sweeper] Maintenance wake — do not message the user unless something completed or is stuck.",
    trigger: { type: "cron", schedule: "@every 15m" }, schedule: "@every 15m", triggerDescription: "Every 15 minutes",
    nextRunAt: null, runs: [], isEnabled: true, enabled: true, createdAt: 0, lastRunAt: null, notices: [],
  };
  const prompt = automation.buildAutomationWakePrompt(record, { timeZone: "Asia/Seoul" });
  assert.match(prompt, /Carry it out now\./);
  assert.match(prompt, /keep working on that task in this same turn until it is finished or genuinely blocked/);
  assert.ok(prompt.indexOf(automation.AUTOMATION_WAKE_RESUME_USER_WORK_LINE) > prompt.indexOf("Carry it out now."), "the resume line follows the routine's own instructions");
});
