// Task continuation (2026-09-05): Belmont's turn ends the moment the model stops calling tools, so a
// bot that sends a progress note and stops looks finished. The Aside browse engine polls a task until
// the service says done; Belmont now does the equivalent with the model's own TodoWrite list as the
// done signal — the runtime hands the turn back (hidden wake) while items are open and the run did not
// end waiting on someone. Postmortem over 130 user turns: 19 ended with open items; ~8 were genuinely
// unfinished work the user then had to chase ("다했니?", "이어서 진행해"), the rest were handoffs to
// other bots, approval waits, or stale items — the decision function stops on exactly those.
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
const hiddenWake = (text) => user(`<timestamp>x</timestamp>\n<user_query>\n[SAND_HIDDEN_PROMPT]${text}\n</user_query>`);
const call = (...names) => ({ role: "assistant", content: names.map((toolName, i) => ({ type: "tool-call", toolName, toolCallId: `${toolName}-${i}-${Math.random()}`, args: toolName === "SendMessage" ? { type: "text", content: "x" } : {} })) });
const results = (assistant) => ({ role: "tool", content: assistant.content.map((p) => ({ type: "tool-result", toolCallId: p.toolCallId, ...(p.toolName === "SendToAgent" ? { result: "Sent to Worker. This is asynchronous — if they reply, it'll arrive later as a new message that wakes you; don't wait on it now." } : {}) })) });
const seq = (...msgs) => msgs.flatMap((m) => (m.role === "assistant" && m.content.some((p) => p.type === "tool-call") ? [m, results(m)] : [m]));
const reminder = () => ({ role: "user", content: "<system_reminder>\nRemember: the user cannot see tool output …\n</system_reminder>", providerOptions: { cursor: { sandEarlyResultReminder: true } } });

test("readOpenTodos: unfinished TodoWrite items come back from the persisted state, in state order", async () => {
  const work = await load("source/host/runner/turn-open-work.ts");
  const proto = await load("source/packages/proto/generated/agent/v1/todo_tool_pb.ts");
  const items = [
    ["gmail-cleanup-scan", "Gmail 연결 상태와 메일함/분류 규칙 확인 후 정리 대상 스캔", proto.TodoStatus.IN_PROGRESS],
    ["gmail-8020-verify", "8020AI 대량 이동 반영 여부 확인", proto.TodoStatus.COMPLETED],
    ["gmail-ambiguous-review", "애매한 메일 목록을 사용자 확인용으로 요약", proto.TodoStatus.PENDING],
    ["old", "cancelled item", proto.TodoStatus.CANCELLED],
    ["gmail-8020-small-batch-1", "8020AI 광고 메일 소량 휴지통 이동을 반복 처리하고 확인", proto.TodoStatus.IN_PROGRESS],
  ];
  const blobs = new Map();
  const ids = items.map(([id, content, status], index) => {
    const blobId = new Uint8Array(32).fill(index + 1);
    blobs.set(Buffer.from(blobId).toString("hex"), new proto.TodoItem({ id, content, status }).toBinary());
    return blobId;
  });
  const missing = new Uint8Array(32).fill(99);
  const blobStore = { getBlob: async (_ctx, id) => blobs.get(Buffer.from(id).toString("hex")) };
  const open = await work.readOpenTodos({ todos: ids }, blobStore, {});
  assert.deepEqual(open.map((t) => [t.id, t.status]), [
    ["gmail-cleanup-scan", "in_progress"],
    ["gmail-ambiguous-review", "pending"],
    ["gmail-8020-small-batch-1", "in_progress"],
  ]);
  assert.deepEqual(await work.readOpenTodos({ todos: [] }, blobStore, {}), []);
  assert.deepEqual(await work.readOpenTodos(undefined, blobStore, {}), []);
  await assert.rejects(work.readOpenTodos({ todos: ids }, undefined, {}), /unavailable/);
  await assert.rejects(work.readOpenTodos({ todos: [...ids, missing] }, blobStore, {}), /missing/);
  const failing = { getBlob: async () => { throw new Error("db closed"); } };
  await assert.rejects(work.readOpenTodos({ todos: ids }, failing, {}), /db closed/);
  await assert.rejects(work.readOpenTodos({ todos: ids }, { getBlob: async () => new Uint8Array([255]) }, {}));
});

test("settle distinguishes unreadable todo evidence from a genuinely empty task list", async () => {
  const { createTurnSettle } = await load("source/host/runner/turn-settle.ts");
  const settle = createTurnSettle({
    isSubagentRunner: false, latestPromptMessages: () => seq(user("finish this"), call("Shell")),
    getBlobStore: () => ({ getBlob: async () => undefined }), isRunSuperseded: () => false,
  }, { conversationId: "agent", profilePromptSnapshots: {} });
  await settle.settleCompletedTurn({
    finalState: { todos: [new Uint8Array(32).fill(1)], summaryArchives: [], turnTimings: [] },
    turnStartedAtMs: 1, hidden: true, trimmedPrompt: "finish this", session: {}, baseContext: {},
  });
  const result = settle.buildResult({ aborted: false });
  assert.equal(result.taskCompletionUnknown, true);
  assert.equal(result.openTodos, undefined);
});

test("runWorkShape: work is counted from the run's prompt; deliveries and bookkeeping are not work; a handoff tail is flagged", async () => {
  const { runWorkShape } = await load("source/host/runner/turn-open-work.ts");
  const earlier = seq(user("earlier"), call("Shell"), call("Shell"), call("SendMessage"));
  const run = seq(hiddenWake("[task continuation] …"), call("SendMessage"), call("CallMcpTool"), reminder(), call("CallMcpTool"), call("TodoWrite"), call("update_state"));
  assert.deepEqual(runWorkShape([...earlier, ...run]), { workToolCalls: 2, handedOff: false, todoWrites: 1 });
  assert.deepEqual(runWorkShape(seq(user("q"), call("SendMessage"), call("TodoWrite"))), { workToolCalls: 0, handedOff: false, todoWrites: 1 }, "bookkeeping only is idle, but the list was touched");
  assert.deepEqual(runWorkShape(seq(user("q"), call("SendMessage"), call("Shell"), call("SendToAgent"), call("TodoWrite"))), { workToolCalls: 2, handedOff: true, todoWrites: 1 }, "delegated and ended: the reply will revive us");
  assert.deepEqual(runWorkShape(seq(user("q"), call("SendToAgent"), call("Shell"))), { workToolCalls: 2, handedOff: false, todoWrites: 0 }, "work after the handoff means we are not waiting on it");
  assert.deepEqual(runWorkShape([]), { workToolCalls: 0, handedOff: false, todoWrites: 0 });
});

test("decideTaskContinuation: continue while items are open; stop on done / aborted / waiting / handoff / idle / cap / deadline", async () => {
  const work = await load("source/host/runner/turn-open-work.ts");
  const open = [{ id: "a", content: "a", status: "in_progress" }];
  const base = { openTodos: open, aborted: false, awaitingUserSelection: false, handedOff: false, continuations: 0, idleContinuations: 0, elapsedMs: 0 };
  assert.deepEqual(work.decideTaskContinuation(base), { continue: true });
  assert.equal(work.decideTaskContinuation({ ...base, openTodos: [] }).reason, "done");
  assert.equal(work.decideTaskContinuation({ ...base, openTodos: undefined }).reason, "done", "no signal (read failed / subagent) means no continuation");
  assert.equal(work.decideTaskContinuation({ ...base, aborted: true }).reason, "aborted");
  assert.equal(work.decideTaskContinuation({ ...base, awaitingUserSelection: true }).reason, "awaiting_user", "approval card / question widget pending");
  assert.equal(work.decideTaskContinuation({ ...base, handedOff: true }).reason, "handed_off", "delegated to another bot");
  assert.equal(work.decideTaskContinuation({ ...base, idleContinuations: work.MAX_IDLE_TASK_CONTINUATIONS }).reason, "idle", "one continuation that did nothing ends it");
  assert.equal(work.decideTaskContinuation({ ...base, continuations: work.MAX_TASK_CONTINUATIONS }).reason, "cap");
  assert.equal(work.decideTaskContinuation({ ...base, elapsedMs: work.TASK_CONTINUATION_DEADLINE_MS }).reason, "deadline");
  assert.equal(work.MAX_IDLE_TASK_CONTINUATIONS, 1);
  assert.ok(work.MAX_TASK_CONTINUATIONS >= 20 && work.MAX_TASK_CONTINUATIONS <= 30, "enough runs for a 600-mail cleanup in batches, still bounded");
});

test("handoffs require successful pending work; foreground Task and failed SendToAgent cannot suppress continuation", async () => {
  const { runWorkShape } = await load("source/host/runner/turn-open-work.ts");
  function shape(name, output, highLevel) {
    const invocation = call(name);
    return runWorkShape([user("finish this"), invocation, {
      role: "tool", content: [{ type: "tool-result", toolCallId: invocation.content[0].toolCallId, result: output }],
      ...(highLevel == null ? {} : { providerOptions: { cursor: { highLevelToolCallResult: highLevel } } }),
    }]).handedOff;
  }
  assert.equal(shape("Task", "This is the output of the subagent:\n\nDone"), false);
  assert.equal(shape("Task", "Subagent is running in the background.\n\nAgent ID: child"), true);
  assert.equal(shape("Task", "Subagent is running in the background.", { isError: true }), false);
  assert.equal(shape("Task", "Error: failed to dispatch"), false);
  assert.equal(shape("Task", undefined), false, "a call without a result is not evidence of async work");
  assert.equal(shape("Task", "rendered output", { isError: false, output: { success: { isBackground: true, agentId: "child" } } }), true);
  assert.equal(shape("Task", "Subagent is running in the background.", { isError: false, output: { success: { isBackground: false, agentId: "child" } } }), false, "structured foreground result outranks display text");
  assert.equal(shape("SendToAgent", "No agent found with id worker."), false);
  assert.equal(shape("SendToAgent", "Permission denied: no delegation"), false);
  assert.equal(shape("SendToAgent", "Posted your message to the group."), false, "a room post does not arm a direct reply wake for this caller");
  assert.equal(shape("SendToAgent", "Sent to Worker. This is asynchronous — if they reply, it'll arrive later."), true);
  assert.equal(shape("SendToAgent", "Sent to Worker.", { isError: true }), false);
});

test("postmortem scenarios drive the loop the way the audit wanted", async () => {
  const work = await load("source/host/runner/turn-open-work.ts");
  const open = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, content: `item ${i}`, status: "in_progress" }));
  // Simulate the runtime loop: each continuation run returns (openTodos, workToolCalls, handedOff, awaiting).
  function drive(runs, first) {
    let latest = first, continuations = 0, idle = (first.workToolCalls ?? 0) > 0 ? 0 : 1;
    const log = [];
    for (;;) {
      const d = work.decideTaskContinuation({ openTodos: latest.openTodos, aborted: false, awaitingUserSelection: latest.awaiting === true, handedOff: latest.handedOff === true, continuations, idleContinuations: idle, elapsedMs: 0 });
      if (!d.continue) { log.push(`stop:${d.reason}`); return log; }
      latest = runs[continuations] ?? { openTodos: [], workToolCalls: 0 };
      continuations += 1; log.push("run");
      idle = (latest.workToolCalls ?? 0) > 0 ? 0 : idle + 1;
    }
  }
  // Gmail cleanup, 9/5 08:58: the turn ended on plain text with 4 open items; batches continue until the list clears.
  assert.deepEqual(
    drive([{ openTodos: open(3), workToolCalls: 6 }, { openTodos: open(2), workToolCalls: 6 }, { openTodos: [], workToolCalls: 4 }], { openTodos: open(4), workToolCalls: 3 }),
    ["run", "run", "run", "stop:done"],
  );
  // 9/1 23:12 "리서치 봇시켜서 …": delegated and ended — the reply revives the manager; no continuation.
  assert.deepEqual(drive([], { openTodos: open(1), workToolCalls: 1, handedOff: true }), ["stop:handed_off"]);
  // 9/4 23:20: waiting on an approval card.
  assert.deepEqual(drive([], { openTodos: open(2), workToolCalls: 5, awaiting: true }), ["stop:awaiting_user"]);
  // 9/2 13:31 "네, 완료했습니다" with a stale in-progress item: one idle continuation, then stop.
  assert.deepEqual(drive([{ openTodos: open(1), workToolCalls: 0 }], { openTodos: open(1), workToolCalls: 2 }), ["run", "stop:idle"]);
  // 9/2 13:27 "잠깐 멈춰" and a casual "안녕" with stale open items: the turn did no work, so nothing restarts.
  assert.deepEqual(drive([{ openTodos: open(1), workToolCalls: 5 }], { openTodos: open(1), workToolCalls: 0 }), ["stop:idle"]);
  // A continuation that answers "waiting" with no tool call ends the loop even though items stay open.
  assert.deepEqual(drive([{ openTodos: open(1), workToolCalls: 0 }], { openTodos: open(1), workToolCalls: 3 }), ["run", "stop:idle"]);
});

test("turnHasUnapprovedCard: a card the user has not answered yes to keeps the turn from continuing", async () => {
  const { turnHasUnapprovedCard } = await load("source/host/runner/turn-open-work.ts");
  const card = (status, timestampMs, type = "auto-review-approval") => ({
    kind: "send-message", timestampMs,
    message: type === "auto-review-approval" ? { type, approval: { requestId: "r", status } } : { type, ask: { requestId: "r", status } },
  });
  const text = (timestampMs) => ({ kind: "send-message", timestampMs, message: { type: "text", content: "x" } });
  const since = 1_000;
  assert.equal(turnHasUnapprovedCard([text(1_100), card("approved", 1_200)], since), false, "approved: continue");
  assert.equal(turnHasUnapprovedCard([card("pending", 1_200)], since), true, "pending (run interrupted while waiting)");
  assert.equal(turnHasUnapprovedCard([card("denied", 1_200)], since), true, "the user said no");
  assert.equal(turnHasUnapprovedCard([card("expired", 1_200), text(1_300)], since), true, "expired unanswered: the user is in the loop");
  assert.equal(turnHasUnapprovedCard([card("expired", 900)], since), false, "cards from earlier turns do not count");
  assert.equal(turnHasUnapprovedCard([card("allowed", 1_200, "local-tool-permission")], since), false);
  assert.equal(turnHasUnapprovedCard([card("expired", 1_200, "local-tool-permission")], since), true);
  assert.equal(turnHasUnapprovedCard([], since), false);
});

test("shouldParkTask: a bot that was working and stopped short leaves a resume card; idle chats, handoffs and finished work do not", async () => {
  const { shouldParkTask, buildParkedTaskWidget, PARKED_TASK_RESUME_VALUE, PARKED_TASK_STOP_VALUE } = await load("source/host/runner/turn-open-work.ts");
  const open = [{ id: "a", content: "남은 광고 묶음 정리", status: "in_progress" }, { id: "b", content: "애매한 메일 목록 요약", status: "pending" }];
  assert.equal(shouldParkTask({ reason: "cap", openTodos: open, workToolCalls: 4, continuations: 24 }), true);
  assert.equal(shouldParkTask({ reason: "deadline", openTodos: open, workToolCalls: 4, continuations: 3 }), true);
  assert.equal(shouldParkTask({ reason: "awaiting_user", openTodos: open, workToolCalls: 4, continuations: 0 }), true, "an unanswered card stopped the loop: the card itself may be expired, so leave a way back");
  assert.equal(shouldParkTask({ reason: "idle", openTodos: open, workToolCalls: 0, continuations: 1 }), true, "a continuation that did nothing after real work");
  assert.equal(shouldParkTask({ reason: "idle", openTodos: open, workToolCalls: 0, continuations: 0 }), false, "a greeting with stale items parks nothing");
  assert.equal(shouldParkTask({ reason: "handed_off", openTodos: open, workToolCalls: 2, continuations: 0 }), false, "waiting on another bot's reply");
  assert.equal(shouldParkTask({ reason: "done", openTodos: [], workToolCalls: 5, continuations: 2 }), false);
  assert.equal(shouldParkTask({ reason: "aborted", openTodos: open, workToolCalls: 5, continuations: 2 }), false);
  assert.equal(shouldParkTask({ reason: "cap", openTodos: undefined, workToolCalls: 5, continuations: 24 }), false);
  const card = buildParkedTaskWidget("cap", open);
  assert.equal(card.type, "widget");
  assert.match(card.widget.prompt, /작업이 끝나지 않은 채 멈춰 있어/);
  assert.match(card.widget.prompt, /남은 항목 2개/);
  assert.match(card.widget.prompt, /· 남은 광고 묶음 정리/);
  assert.deepEqual(card.widget.options.map((o) => o.value), [PARKED_TASK_RESUME_VALUE, PARKED_TASK_STOP_VALUE]);
  assert.equal(card.widget.options[0].style, "primary");
  const many = buildParkedTaskWidget("deadline", Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, content: `item ${i}`, status: "pending" })));
  assert.match(many.widget.prompt, /· … 외 3개/);
});

test("the continuation wake lists the open items and makes waiting a no-tool-call end", async () => {
  const work = await load("source/host/runner/turn-open-work.ts");
  const prompt = work.buildTaskContinuationPrompt([
    { id: "a", content: "8020AI 광고 메일 소량 휴지통 이동을 반복 처리하고 확인", status: "in_progress" },
    { id: "b", content: "애매한 메일 목록을 사용자 확인용으로 요약", status: "pending" },
  ]);
  assert.match(prompt, /^\[task continuation\] Nobody new has messaged you/);
  assert.match(prompt, /- \(in progress\) 8020AI 광고 메일 소량 휴지통 이동을 반복 처리하고 확인/);
  assert.match(prompt, /- \(pending\) 애매한 메일 목록을 사용자 확인용으로 요약/);
  assert.match(prompt, /end the turn without any tool call/);
  assert.match(prompt, /Do not re-ask, re-send, or repeat a delegation/);
  const many = work.buildTaskContinuationPrompt(Array.from({ length: 15 }, (_, i) => ({ id: `${i}`, content: `item ${i}`, status: "pending" })));
  assert.match(many, /- … and 3 more/);
});

test("start-of-turn ack reminder: a hidden wake owes no opening ack; a person's turn still does", async () => {
  const ack = await load("source/host/runner/start-of-turn-ack-reminder-middleware.ts");
  function fakeExecutor(initial) {
    const messages = [...initial];
    return { getMessages: () => [...messages], getState: () => [...messages], clearMessages: () => { messages.length = 0; }, appendMessages: (m) => { messages.push(...(Array.isArray(m) ? m : [m])); }, stream: () => "ok" };
  }
  const hidden = fakeExecutor(seq(user("earlier"), call("SendMessage"), hiddenWake("[task continuation] …"), call("CallMcpTool"), call("CallMcpTool")));
  ack.createStartOfTurnAckReminderMiddleware()(hidden).stream({});
  assert.ok(!hidden.getMessages().some((m) => ack.isStartOfTurnAckReminderMessage(m)), "no ack reminder on a hidden wake");
  const person = fakeExecutor(seq(user("안녕"), call("CallMcpTool"), call("CallMcpTool")));
  ack.createStartOfTurnAckReminderMiddleware()(person).stream({});
  assert.ok(person.getMessages().some((m) => ack.isStartOfTurnAckReminderMessage(m)), "a person's turn opened with tools still gets the ack reminder");
  assert.equal(ack.hasTextSendMessageSinceTurnStart(seq(hiddenWake("x"), call("Shell"))), true);
  assert.equal(ack.hasTextSendMessageSinceTurnStart(seq(user("x"), call("Shell"))), false);
});

test("wiring: settle reads the signal, the shell threads the option, and the runtime loops before the closing nudge", () => {
  const settle = read("source/host/runner/turn-settle.ts");
  assert.match(settle, /workShape = runWorkShape\(host\.latestPromptMessages\(\)\);/);
  assert.match(settle, /openTodos = await readOpenTodos\(/);
  assert.match(settle, /\.\.\.\(openTodos === undefined \? \{\} : \{ openTodos \}\),/);
  const shell = read("source/host/runner/turn-run-shell.ts");
  assert.match(shell, /taskContinuation: options\.taskContinuation === true,/);
  const runtime = read("source/host/extensions/transcript/turn-runtime.ts");
  assert.match(runtime, /const decision = decideTaskContinuation\(\{/);
  assert.match(runtime, /runner\.run\(buildTaskContinuationPrompt\(openTodos\), \{\s*hidden: true,\s*taskContinuation: true,/);
  assert.match(runtime, /idleContinuations = \(continued\.workToolCalls \?\? 0\) > 0 \? 0 : idleContinuations \+ 1;/);
  assert.match(runtime, /let idleContinuations = \(latest\.workToolCalls \?\? 0\) > 0 \? 0 : 1;/, "a turn that did no work does not restart a parked task");
  assert.match(runtime, /awaitingUserSelection: latest\.awaitingUserSelection === true \|\| unapprovedCardThisTurn\(\) \|\| heldByParkedCard\(\),/, "an unanswered approval card or an unanswered parked card stops the loop");
  assert.match(runtime, /shouldParkTask\(park\) &&/, "a parked task leaves a resume card");
  assert.match(runtime, /message: buildParkedTaskWidget\(park\.reason, latest\.openTodos \?\? \[\]\),/);
  assert.ok(runtime.indexOf("decideTaskContinuation({") < runtime.indexOf("closingNudges < MAX_CLOSING_SEND_NUDGES"), "continuation runs first; the closing nudge covers the last silent run");
  assert.match(runtime, /startedAtMs,\n\s*\);/, "the turn start feeds the wall-clock budget");
});

test("hasUnansweredParkedTaskCard: an unanswered card for the same list holds the task; answering it or changing the list lifts the hold", async () => {
  // 9/5 18:03→18:48: the Gmail list (8 items) was parked with a card at 18:05; every later chore
  // ("ls -la 항목 수") ran one more continuation and dropped one more identical card.
  const { hasUnansweredParkedTaskCard, buildParkedTaskWidget } = await load("source/host/runner/turn-open-work.ts");
  const todos = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, content: `item ${i}`, status: "pending" }));
  const card = (openTodos, respondedValue) => ({ kind: "send-message", message: buildParkedTaskWidget("idle", openTodos), ...(respondedValue === undefined ? {} : { respondedValue }) });
  const question = { kind: "send-message", message: { type: "widget", widget: { prompt: "어느 폴더로 옮길까?", options: [] } } };
  const text = { kind: "send-message", message: { type: "text", content: "8개" } };
  assert.equal(hasUnansweredParkedTaskCard([], todos(8)), false);
  assert.equal(hasUnansweredParkedTaskCard([text], todos(8)), false, "no card yet");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8)), text], todos(8)), true, "same list, unanswered");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8), "이어가기")], todos(8)), false, "answered");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8))], todos(7)), false, "the list changed");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8), "그만두기"), card(todos(8))], todos(8)), true, "the latest card decides");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8)), card(todos(3), "이어가기")], todos(8)), false, "the latest card decides (answered, different list)");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8)), question], todos(8)), true, "a model question is not a parked card");
  assert.equal(hasUnansweredParkedTaskCard([card(todos(8))], []), false, "nothing open");
});

test("wiring: the runtime holds a parked list behind its unanswered card and never drops a second card for it", () => {
  const runtime = read("source/host/extensions/transcript/turn-runtime.ts");
  assert.match(runtime, /const heldByParkedCard = \(\): boolean => \(latest\.todoWrites \?\? 0\) === 0 && parkedCardPending\(\);/);
  assert.match(runtime, /awaitingUserSelection: latest\.awaitingUserSelection === true \|\| unapprovedCardThisTurn\(\) \|\| heldByParkedCard\(\),/);
  assert.match(runtime, /shouldParkTask\(park\) &&\s*!parkedCardPending\(\) &&/);
  const settle = read("source/host/runner/turn-settle.ts");
  assert.match(settle, /todoWrites: workShape\.todoWrites/);
});
