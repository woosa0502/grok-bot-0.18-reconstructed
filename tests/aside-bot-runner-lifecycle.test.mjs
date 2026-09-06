import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: repoRoot,
  stdin: { contents: ["aside-bot-runner", "browse-client", "browse-subagent-session", "browse-suspension"].map((name) => `export * from './source/host/extensions/browse-runtime/${name}.ts';`).join("\n") + "\nexport { WidgetResponses } from './source/host/extensions/transcript/widget-responses.ts';", resolveDir: repoRoot },
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
  plugins: [{ name: "isolated-widget-transcript", setup(build) {
    build.onResolve({ filter: /^\.\/transcript-store\.js$/ }, (args) => args.importer.endsWith("widget-responses.ts") ? { path: "widget-test-store", namespace: "fixture" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const getTranscript = () => globalThis.__asideWidgetEntries; export function updateEntry(id, update) { const rows = getTranscript(); const i = rows.findIndex(row => row.id === id); if (i < 0) return null; rows[i] = update(rows[i]); return rows[i]; }", loader: "js" }));
  } }],
});
const { wrapRunnerForAsideBot, BrowseServiceError, BrowseClient, BrowseSubagentSession, parseSuspensionAnswer, sendBrowseFollowUp, encodeAsideSuspensionAnswer, decodeAsideSuspensionAnswer, WidgetResponses } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const agentId = "11111111-2222-4333-8444-555555555555";
const view = (id = "bound", status = "done", extra = {}) => ({ id, status, result: "finished", error: null, activity: [], toolCalls: 0, modelCalls: 0, suspension: null, ...extra });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, link = null, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aside-adapter-contract-"));
  const prior = process.env.SAND_DATA_ROOT;
  process.env.SAND_DATA_ROOT = root;
  t.after(() => {
    if (prior === undefined) delete process.env.SAND_DATA_ROOT;
    else process.env.SAND_DATA_ROOT = prior;
    rmSync(root, { recursive: true, force: true });
  });
  const agentDir = path.join(root, "agents", agentId);
  mkdirSync(agentDir, { recursive: true });
  const linkFile = path.join(agentDir, "browse-runtime.json");
  if (link !== null) writeFileSync(linkFile, JSON.stringify({ ...(link.pendingKind != null ? { pendingToolCallId: "tool-1" } : {}), ...link }));
  const calls = [];
  const behavior = {
    create: async () => view("new", "queued"),
    get: async (id) => view(id),
    continue: async (id) => view(id, "running"),
    steer: async (id) => view(id, "running"),
    answer: async (id) => view(id, "running"),
    stop: async (id) => view(id, "stopped"),
    asideSessions: async () => [{ id: "another-bots-chat", updatedAt: Date.now() }],
    asideMessages: async () => [],
    ...overrides,
  };
  const client = Object.fromEntries(Object.keys(behavior).map((name) => [name, async (...args) => { calls.push({ name, args }); return behavior[name](...args); }]));
  const sent = [];
  const runner = wrapRunnerForAsideBot({ run: async () => assert.fail("unexpected delegation") }, agentId, { client: () => client, emitUpdate: (event) => sent.push(event.message), log: () => {} });
  return { runner, client, calls, sent, behavior, readLink: () => existsSync(linkFile) ? JSON.parse(readFileSync(linkFile, "utf8")) : null, named: (name) => calls.filter((call) => call.name === name) };
}

test("new bots and hidden nudges never adopt the account's newest chat", async (t) => {
  const f = fixture(t);
  await f.runner.run("hidden nudge", { hidden: true });
  assert.equal(f.calls.length, 0);
  await f.runner.run("new independent task");
  assert.equal(f.named("create").length, 1);
  assert.equal(f.named("asideSessions").length, 0);
  assert.equal(f.readLink().browseId, "new");
  assert.equal(f.readLink().ownerAgentId, agentId);
});

test("legacy deliberate bindings remain stable and mirror only their own session", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: null }, { asideMessages: async (id) => [{ role: "user", timestamp: 10, text: `message from ${id}` }] });
  await f.runner.run("nudge", { hidden: true });
  await f.runner.run("follow-up");
  assert.deepEqual(f.named("continue").map((call) => call.args), [["bound", "follow-up"]]);
  assert.equal(f.named("asideSessions").length, 0);
  assert.equal(f.named("create").length, 0);
  assert.equal(f.readLink().source, "legacy");
  assert.ok(f.sent.some((message) => message.content === "[Aside에서 입력] message from bound"));
});

test("an explicit link selects and mirrors a concrete UI session; unlink starts no remote task", async (t) => {
  const f = fixture(t);
  await f.runner.run("/aside link chosen-ui-session");
  assert.equal(f.readLink().browseId, "chosen-ui-session");
  assert.equal(f.readLink().source, "selected");
  assert.equal(f.named("create").length, 0);
  await f.runner.run("/aside unlink");
  assert.equal(f.readLink(), null);
  assert.equal(f.named("stop").length, 0);
});

test("a copied binding owned by a different bot fails without starting or steering work", async (t) => {
  const f = fixture(t, { browseId: "foreign", pendingKind: null, ownerAgentId: "other-bot" });
  await assert.rejects(f.runner.run("continue"), /belongs to another bot/);
  assert.equal(f.calls.length, 0);
});

for (const status of ["running", "queued"]) {
  test(`${status} follow-ups steer the existing session without a duplicate task`, async (t) => {
    let reads = 0;
    const f = fixture(t, { browseId: "bound", pendingKind: null }, { get: async (id) => view(id, reads++ === 0 ? status : "done") });
    await f.runner.run("change the destination");
    assert.deepEqual(f.named("steer").map((call) => call.args), [["bound", "change the destination"]]);
    assert.equal(f.named("continue").length, 0);
    assert.equal(f.named("create").length, 0);
  });
}

test("a continue/busy race steers the same session", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: null }, { continue: async () => { throw new BrowseServiceError("still running", 409, "SESSION_BUSY"); } });
  await f.runner.run("new instruction");
  assert.equal(f.named("steer").length, 1);
  assert.equal(f.named("create").length, 0);
});

test("a steer/end race continues the same conversation after a terminal reread", async () => {
  const calls = [];
  let reads = 0;
  const client = {
    get: async () => view("bound", reads++ === 0 ? "running" : "done"),
    steer: async () => { throw new BrowseServiceError("ended", 409, "SESSION_NOT_RUNNING"); },
    continue: async (...args) => { calls.push(args); return view(); },
  };
  await sendBrowseFollowUp(client, "bound", "follow-up");
  assert.deepEqual(calls, [["bound", "follow-up"]]);
});

test("transport errors preserve the binding and do not create replacement work", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: null }, { continue: async () => { throw new TypeError("fetch failed"); } });
  await f.runner.run("follow-up");
  assert.equal(f.named("create").length, 0);
  assert.equal(f.readLink().browseId, "bound");
  assert.ok(f.sent.some((message) => message.content?.includes("fetch failed")));
});

for (const [name, failure] of [
  ["tools already executed", { errorCode: "MODEL_UNAVAILABLE", executionStarted: true, toolCalls: 2, modelCalls: 1 }],
  ["native execution started without completed counters", { errorCode: "MODEL_UNAVAILABLE", executionStarted: true, toolCalls: 0, modelCalls: 0 }],
  ["missing tool count", { errorCode: "MODEL_UNAVAILABLE", executionStarted: false, toolCalls: undefined, modelCalls: 0 }],
  ["missing model count", { errorCode: "MODEL_UNAVAILABLE", executionStarted: false, toolCalls: 0, modelCalls: undefined }],
  ["missing execution evidence", { errorCode: "MODEL_UNAVAILABLE", toolCalls: 0, modelCalls: 0 }],
  ["unclassified failure before execution", { errorCode: "AGENT_RUN_FAILED", executionStarted: false, toolCalls: 0, modelCalls: 0 }],
]) {
  test(`failed tasks are not replayed when ${name}`, async (t) => {
    const f = fixture(t, null, { get: async (id) => view(id, "error", { error: "provider failed", ...failure }) });
    await f.runner.run("submit the invoice once");
    assert.equal(f.named("create").length, 1);
    assert.equal(f.readLink().browseId, "new");
    assert.equal(f.named("continue").length, 0);
    assert.ok(!f.sent.some((message) => message.content?.includes("다시 시도합니다")));
    assert.ok(f.sent.some((message) => message.content?.includes("기존 작업을 유지")));
  });
}

test("a post-action failure resumes only on an explicit follow-up in its original session", async (t) => {
  let continued = false;
  const f = fixture(t, null, {
    get: async (id) => continued ? view(id) : view(id, "error", { error: "reply failed after submit", errorCode: "AGENT_RUN_FAILED", executionStarted: true, toolCalls: 2, modelCalls: 1 }),
    continue: async (id) => { continued = true; return view(id, "running"); },
  });
  await f.runner.run("submit the invoice once");
  assert.equal(f.named("create").length, 1);
  await f.runner.run("Check whether it was submitted; do not submit again.");
  assert.deepEqual(f.named("continue").map((call) => call.args), [["new", "Check whether it was submitted; do not submit again."]]);
  assert.equal(f.named("create").length, 1);
});

test("only a typed missing ordinary session permits a replacement", async (t) => {
  const f = fixture(t, { browseId: "missing", pendingKind: null }, { get: async (id) => {
    if (id === "missing") throw new BrowseServiceError("absent", 404, "SESSION_NOT_FOUND");
    return view(id);
  } });
  await f.runner.run("the actual task");
  assert.deepEqual(f.named("create").map((call) => call.args), [[{ task: "the actual task" }]]);
});

test("a missing approval session never turns 'allow' into a fresh task", async (t) => {
  const f = fixture(t, { browseId: "missing", pendingKind: "approval" }, { get: async () => { throw new BrowseServiceError("absent", 404, "SESSION_NOT_FOUND"); } });
  await f.runner.run("허용");
  assert.equal(f.named("create").length, 0);
  assert.equal(f.named("answer").length, 0);
  assert.equal(f.readLink().browseId, "missing");
});

test("Korean approval/confirmation accepts real words without ASCII boundary bugs", () => {
  for (const answer of ["허용", "승인", "응", "네", "네!", "allow always", "허용 항상"]) assert.equal(parseSuspensionAnswer("approval", answer).verdict, "allow", answer);
  for (const answer of ["확인", "진행", "응", "네", "진행."]) assert.equal(parseSuspensionAnswer("action-confirmation", answer).verdict, "confirm", answer);
  for (const answer of ["거절", "허용하지마", "네이버", "yesterday", "yesplease"]) assert.equal(parseSuspensionAnswer("approval", answer).verdict, "deny", answer);
  assert.equal(parseSuspensionAnswer("approval", "허용 항상").always, true);
  assert.equal(parseSuspensionAnswer("approval", "허용 비항상").always, false);
});

const questions = [
  { header: "계정", question: "어느 계정인가요?", options: [{ label: "회사" }, { label: "개인" }] },
  { header: "지역", question: "어느 지역인가요?", options: [{ label: "서울" }, { label: "부산" }] },
];
const questionView = (id) => view(id, "suspended", { suspension: { kind: "ask-user-question", toolCallId: "tool-1", description: "계정과 지역", request: { questions } } });
const approvalView = (id, toolCallId) => view(id, "suspended", { suspension: { kind: "approval", toolCallId, description: "동일한 승인 설명", request: { action: "submit" } } });

function widgetHarness(t, messages, sendPrompt) {
  const previous = globalThis.__asideWidgetEntries;
  globalThis.__asideWidgetEntries = messages.map((message, index) => ({ id: `card-${index}`, kind: "send-message", message }));
  t.after(() => { globalThis.__asideWidgetEntries = previous; });
  return new WidgetResponses({
    sessions: { activeSession: { id: agentId, db: { updateTranscriptEntry() {} } }, ensureActionTarget: async () => {} },
    roster: { emit() {} }, sendPrompt,
  });
}

test("a same-shaped replacement approval invalidates the displayed tool-call identity", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: "approval", pendingToolCallId: "call-1", pendingRequest: { action: "submit" } }, { get: async (id) => approvalView(id, "call-2") });
  assert.equal((await f.runner.run("허용")).awaitingUserSelection, true);
  assert.equal(f.named("answer").length, 0);
  assert.equal(f.readLink().pendingToolCallId, "call-2");
  assert.equal(decodeAsideSuspensionAnswer(f.sent.at(-1).widget.options[0].value).toolCallId, "call-2");
});

test("a suspension changing between preflight and answer carries the old ID and refreshes", async (t) => {
  let current = "call-1";
  const f = fixture(t, { browseId: "bound", pendingKind: "approval", pendingToolCallId: "call-1", pendingRequest: { action: "submit" } }, {
    get: async (id) => approvalView(id, current),
    answer: async () => { current = "call-2"; throw new BrowseServiceError("old approval", 409, "STALE_SUSPENSION"); },
  });
  assert.equal((await f.runner.run("허용")).awaitingUserSelection, true);
  assert.deepEqual(f.named("answer")[0].args, ["bound", { verdict: "allow", always: false }, "call-1"]);
  assert.equal(f.named("answer").length, 1);
  assert.equal(f.named("create").length, 0);
  assert.equal(f.readLink().pendingToolCallId, "call-2");
});

for (const mode of ["button", "custom"]) {
  test(`the actual widget handler rejects an old ${mode} reply after an identical newer approval`, async (t) => {
    let current = "call-1";
    let answered = false;
    const f = fixture(t, null, {
      get: async (id) => answered ? view(id) : approvalView(id, current),
      answer: async () => { answered = true; return view(); },
    });
    await f.runner.run("task");
    const oldCard = f.sent.at(-1);
    current = "call-2";
    await f.runner.run("refresh");
    const newCard = f.sent.at(-1);
    const submitted = [];
    const handler = widgetHarness(t, [oldCard, newCard], async (prompt) => { submitted.push(prompt); await f.runner.run(prompt); });
    await handler.respondToWidget("card-0", mode === "button" ? oldCard.widget.options[0].value : "네", agentId);
    assert.equal(decodeAsideSuspensionAnswer(submitted[0]).toolCallId, "call-1");
    assert.equal(f.named("answer").length, 0);
    assert.equal(f.readLink().pendingToolCallId, "call-2");
    await handler.respondToWidget("card-1", mode === "button" ? newCard.widget.options[0].value : "네", agentId);
    assert.equal(f.named("answer").length, 1);
    assert.deepEqual(f.named("answer")[0].args, ["new", { verdict: "allow", always: false }, "call-2"]);
  });
}

test("the actual widget handler preserves unrelated widget replies verbatim", async (t) => {
  const prompts = [];
  const handler = widgetHarness(t, [{ type: "widget", widget: { prompt: "Plain choice", options: [{ label: "OK", value: "plain answer" }] } }], async (prompt) => { prompts.push(prompt); });
  assert.equal((await handler.respondToWidget("card-0", "plain answer", agentId)).accepted, true);
  assert.deepEqual(prompts, ["plain answer"]);
});

test("an old question-one card cannot supply the answer to question two", async (t) => {
  const f = fixture(t, null, { get: async (id) => questionView(id) });
  await f.runner.run("task");
  const firstCard = f.sent.at(-1);
  await f.runner.run("회사");
  const secondCard = f.sent.at(-1);
  const handler = widgetHarness(t, [firstCard, secondCard], async (prompt) => { await f.runner.run(prompt); });
  await handler.respondToWidget("card-0", firstCard.widget.options[1].value, agentId);
  assert.equal(f.named("answer").length, 0);
  assert.deepEqual(f.readLink().pendingAnswers, [{ header: "계정", answer: "회사" }]);
  assert.equal(f.readLink().pendingToolCallId, "tool-1");
});

test("collecting multiple answers cannot cross into a new identical question tool call", async (t) => {
  let current = "tool-1";
  const f = fixture(t, null, { get: async (id) => {
    const result = questionView(id);
    return { ...result, suspension: { ...result.suspension, toolCallId: current } };
  } });
  await f.runner.run("task");
  await f.runner.run("회사");
  current = "tool-2";
  await f.runner.run("서울");
  assert.equal(f.named("answer").length, 0);
  assert.deepEqual(f.readLink().pendingAnswers, []);
  assert.equal(f.readLink().pendingToolCallId, "tool-2");
});

test("multiple bot questions are collected separately and submitted once with every header", async (t) => {
  let answered = false;
  const f = fixture(t, null, { get: async (id) => answered ? view(id) : questionView(id), answer: async () => { answered = true; return view(); } });
  assert.equal((await f.runner.run("prepare the report")).awaitingUserSelection, true);
  assert.match(f.sent.at(-1).widget.prompt, /\[1\/2\].*계정/);
  assert.equal((await f.runner.run("회사")).awaitingUserSelection, true);
  assert.match(f.sent.at(-1).widget.prompt, /\[2\/2\].*지역/);
  assert.equal(f.named("answer").length, 0);
  assert.equal((await f.runner.run("서울")).text, "finished");
  assert.deepEqual(f.named("answer")[0].args, ["new", { answers: [{ header: "계정", answer: "회사" }, { header: "지역", answer: "서울" }] }, "tool-1"]);
  assert.equal(f.readLink().pendingKind, null);
  assert.equal(f.readLink().pendingAnswers, undefined);
});

test("an answer request failure retains previous partial answers for an exact retry", async (t) => {
  let attempts = 0;
  const f = fixture(t, { browseId: "bound", pendingKind: "ask-user-question", pendingRequest: { questions }, pendingAnswers: [{ header: "계정", answer: "회사" }] }, {
    get: async (id) => attempts > 1 ? view(id) : questionView(id),
    answer: async () => { if (++attempts === 1) throw new TypeError("connection lost"); return view(); },
  });
  await f.runner.run("서울");
  assert.deepEqual(f.readLink().pendingAnswers, [{ header: "계정", answer: "회사" }]);
  await f.runner.run("서울");
  assert.equal(f.named("create").length, 0);
  assert.deepEqual(f.named("answer")[0].args, f.named("answer")[1].args);
});

test("a new suspension is shown without treating a follow-up as its answer", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: null }, { get: async (id) => questionView(id) });
  assert.equal((await f.runner.run("change the report")).awaitingUserSelection, true);
  assert.equal(f.named("create").length, 0);
  assert.equal(f.named("answer").length, 0);
  assert.match(f.sent.at(-1).widget.prompt, /계정/);
});

test("changed questions discard stale partial answers and ask the current question", async (t) => {
  const updatedQuestions = [{ header: "새 계정", question: "어느 계정인가요?", options: ["팀"] }];
  const f = fixture(t, { browseId: "bound", pendingKind: "ask-user-question", pendingRequest: { questions }, pendingAnswers: [{ header: "계정", answer: "회사" }] }, {
    get: async (id) => view(id, "suspended", { suspension: { kind: "ask-user-question", toolCallId: "tool-1", description: "changed", request: { questions: updatedQuestions } } }),
  });
  assert.equal((await f.runner.run("서울")).awaitingUserSelection, true);
  assert.equal(f.named("answer").length, 0);
  assert.deepEqual(f.readLink().pendingAnswers, []);
  assert.match(f.sent.at(-1).widget.prompt, /새 계정/);
});

test("a question answered elsewhere clears stale state without replaying an answer", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: "approval" });
  await f.runner.run("허용");
  assert.equal(f.named("answer").length, 0);
  assert.equal(f.named("continue").length, 0);
  assert.equal(f.named("create").length, 0);
  assert.equal(f.readLink().pendingKind, null);
  await f.runner.run("next actual task");
  assert.equal(f.named("continue").length, 1);
});

test("free-text questions remain answerable and retain their original header", async (t) => {
  let answered = false;
  const f = fixture(t, null, {
    get: async (id) => answered ? view(id) : view(id, "suspended", { suspension: { kind: "ask-user-question", toolCallId: "tool-1", description: "주소", request: { questions: [{ header: "주소", question: "어느 주소인가요?" }] } } }),
    answer: async () => { answered = true; return view(); },
  });
  assert.equal((await f.runner.run("delivery")).awaitingUserSelection, true);
  assert.equal(f.sent.at(-1).type, "text");
  assert.match(f.sent.at(-1).content, /어느 주소/);
  await f.runner.run("서울 강남구");
  assert.deepEqual(f.named("answer")[0].args[1], { answers: [{ header: "주소", answer: "서울 강남구" }] });
});

test("automation text is executable only with the explicit automationWake marker", async (t) => {
  const f = fixture(t);
  const prompt = "What you saved to do each time:\nCheck the dashboard\nCarry it out now.";
  await f.runner.run(prompt, { hidden: true });
  assert.equal(f.named("create").length, 0);
  await f.runner.run(prompt, { hidden: true, automationWake: { id: "daily", name: "daily check" } });
  assert.deepEqual(f.named("create")[0].args, [{ task: "Check the dashboard" }]);
});

test("automation wakes cannot approve a pending human decision", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: "approval" });
  const prompt = "What you saved to do each time:\nallow\nCarry it out now.";
  assert.equal((await f.runner.run(prompt, { hidden: true, automationWake: {} })).awaitingUserSelection, true);
  assert.equal(f.named("answer").length, 0);
  assert.equal(f.named("create").length, 0);
});

test("a stop during create cancels the returned session before it can be detached", async (t) => {
  let resolveCreate;
  const f = fixture(t, null, { create: () => new Promise((resolve) => { resolveCreate = resolve; }) });
  const pending = f.runner.run("long task");
  await tick();
  f.runner.interrupt("user stopped");
  resolveCreate(view("late-session", "queued"));
  assert.equal((await pending).aborted, true);
  assert.deepEqual(f.named("stop").map((call) => call.args), [["late-session"]]);
  assert.equal(f.readLink(), null);
});

test("superseded polling cannot emit a second answer while the next turn steers", async (t) => {
  let resolveOld;
  let reads = 0;
  const f = fixture(t, null, { get: async (id) => {
    reads += 1;
    if (reads === 1) return new Promise((resolve) => { resolveOld = resolve; });
    return view(id, reads === 2 ? "running" : "done");
  } });
  const old = f.runner.run("first task");
  await tick();
  f.runner.interrupt("superseded by a new user message");
  const latest = await f.runner.run("updated task");
  resolveOld(view("new", "done", { result: "obsolete answer" }));
  assert.equal((await old).aborted, true);
  assert.equal(latest.text, "finished");
  assert.equal(f.named("create").length, 1);
  assert.equal(f.named("steer").length, 1);
  assert.equal(f.named("stop").length, 0);
  assert.ok(!f.sent.some((message) => message.content === "obsolete answer"));
});

test("explicit stop also cancels a suspended session and clears collected answers", async (t) => {
  const f = fixture(t, { browseId: "bound", pendingKind: "ask-user-question", pendingAnswers: [{ header: "계정", answer: "회사" }] });
  f.runner.interrupt("user stopped");
  await tick();
  assert.deepEqual(f.named("stop")[0].args, ["bound"]);
  assert.equal(f.readLink().pendingKind, null);
  assert.equal(f.readLink().pendingAnswers, undefined);
});

test("stop during the suspension mirror fetch cannot resurrect the question card", async (t) => {
  let resolveMirror;
  const f = fixture(t, null, { get: async (id) => questionView(id), asideMessages: () => new Promise((resolve) => { resolveMirror = resolve; }) });
  const pending = f.runner.run("task");
  await tick();
  f.runner.interrupt("user stopped");
  resolveMirror([]);
  assert.equal((await pending).aborted, true);
  assert.equal(f.readLink().pendingKind, null);
  assert.equal(f.sent.length, 0);
});

test("a delayed hidden mirror preserves a question stored by the foreground turn", async (t) => {
  let resolveMirror;
  let reads = 0;
  const f = fixture(t, { browseId: "bound", pendingKind: null }, {
    get: async (id) => questionView(id),
    asideMessages: async () => ++reads === 1 ? new Promise((resolve) => { resolveMirror = resolve; }) : [],
  });
  const hidden = f.runner.run("nudge", { hidden: true });
  await tick();
  await f.runner.run("follow-up");
  resolveMirror([{ role: "user", timestamp: 10, text: "UI message" }]);
  await hidden;
  assert.equal(f.readLink().pendingKind, "ask-user-question");
  assert.deepEqual(f.readLink().pendingRequest, { questions });
});

test("subagent answers preserve headers and refuse incomplete multi-question responses", async () => {
  const request = { questions };
  const expected = { answers: [{ header: "계정", answer: "회사" }, { header: "지역", answer: "서울" }] };
  assert.deepEqual(parseSuspensionAnswer("ask-user-question", "계정: 회사\n지역: 서울", request), expected);
  assert.deepEqual(parseSuspensionAnswer("ask-user-question", JSON.stringify(expected), request), expected);
  assert.throws(() => parseSuspensionAnswer("ask-user-question", "회사", request), /every question/);
  assert.throws(() => parseSuspensionAnswer("ask-user-question", '{"answers":[{"header":"계정","answer":"회사"}]}', request), /every original header/);
  const answers = [];
  let answered = false;
  const client = { create: async () => view("sub", "queued"), get: async (id) => answered ? view(id) : questionView(id), answer: async (id, response) => { answers.push(response); answered = true; return view(id); } };
  const session = new BrowseSubagentSession(client, "subagent", new Map(), () => {});
  const waiting = await session.run("report");
  assert.match(waiting.text, /어느 계정/);
  assert.match(waiting.text, /어느 지역/);
  assert.match(waiting.text, /header: answer/);
  await session.run(encodeAsideSuspensionAnswer({ toolCallId: "tool-1" }, "계정: 회사\n지역: 서울"));
  assert.deepEqual(answers, [expected]);
});

test("subagent cancellation during asynchronous create leaves no detached execution", async () => {
  let resolveCreate;
  const stopped = [];
  const links = new Map();
  const client = {
    create: () => new Promise((resolve) => { resolveCreate = resolve; }),
    stop: async (id) => { stopped.push(id); return view(id, "stopped"); },
  };
  const session = new BrowseSubagentSession(client, "subagent", links, () => {});
  const pending = session.run("task");
  await tick();
  session.interrupt("user stopped");
  resolveCreate(view("late-subagent", "queued"));
  assert.equal((await pending).aborted, true);
  assert.deepEqual(stopped, ["late-subagent"]);
  assert.equal(links.size, 0);
});

test("subagent old identity cannot authorize a later same-shaped approval", async () => {
  let current = "call-1";
  const answers = [];
  const client = { create: async () => view("sub", "queued"), get: async (id) => approvalView(id, current), answer: async (...args) => { answers.push(args); return view(); } };
  const session = new BrowseSubagentSession(client, "subagent", new Map(), () => {});
  assert.match((await session.run("task")).text, /call-1/);
  const oldAnswer = encodeAsideSuspensionAnswer({ toolCallId: "call-1" }, "allow");
  current = "call-2";
  assert.match((await session.run(oldAnswer)).text, /call-2/);
  assert.match((await session.run(oldAnswer)).text, /call-2/);
  await session.run("allow");
  assert.equal(answers.length, 0);
});

test("HTTP error codes and status are preserved without contacting any service", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "SESSION_BUSY", error: "already running" }), { status: 409 });
  const client = new BrowseClient("http://unused.invalid", "fake-token");
  await assert.rejects(client.continue("bound", "next"), (error) => error instanceof BrowseServiceError && error.status === 409 && error.code === "SESSION_BUSY");
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  await assert.rejects(client.get("bound"), (error) => error instanceof BrowseServiceError && error.status === 404 && error.code === undefined);
  let requestBody;
  globalThis.fetch = async (_url, options) => { requestBody = JSON.parse(options.body); return new Response(JSON.stringify(view())); };
  await client.answer("bound", { verdict: "allow", always: false }, "displayed-call-id");
  assert.deepEqual(requestBody, { response: { verdict: "allow", always: false }, expectedToolCallId: "displayed-call-id" });
});
