import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { runParity, createFingerprint, digest } from "../belmont-browse/aside-fork/test/parity/drive.mjs";
import { evaluateFixture } from "../belmont-browse/aside-fork/test/parity/fixture-oracles.mjs";
import { verifyResult } from "../belmont-browse/aside-fork/test/parity/verify.mjs";
import { createAsideStateReader } from "../belmont-browse/aside-fork/test/parity/task-state.mjs";

const entry = (id, content, role = "assistant") => ({ id, kind: role === "assistant" ? "send-message" : "message", ...(role === "assistant" ? {} : { role }), message: { type: "text", content } });
const widget = { id: "w", kind: "send-message", message: { type: "widget", widget: { options: [{ label: "거절", value: "deny" }, { label: "허용", value: "allow" }] } } };
const fixtureHash = digest("fixture");
const fingerprintValue = (code = "code") => ({ schemaVersion: 1, scope: "selected-files-and-driver-environment",
  code: [{ path: "/fixture/code.mjs", sha256: digest(code) }], build: [{ path: "/fixture/README.md", sha256: digest("selected file") }],
  driverEnvironment: { node: "fixture-node", platform: "fixture-platform", arch: "fixture-arch" },
  driverEnvironmentSha256: digest(JSON.stringify(["fixture-node", "fixture-platform", "fixture-arch"])),
  declaredModelLabel: "operator-label-only", runtimeIdentity: { status: "UNVERIFIED" },
});
const pinned = async () => fingerprintValue();
function setup(overrides = {}) {
  let time = 0, sent = false;
  const calls = [];
  const options = {
    agent: "fixture-agent", task: "Fixture task", clientNonce: "fixture-nonce",
    clock: { now: () => time, epoch: () => 100_000 + time, sleep: async (ms) => { time += ms; } },
    quietMs: 2, maxMs: 10, pollMs: 1, fingerprint: pinned,
    api: async (method, body) => {
      calls.push({ method, body });
      if (method === "sendPrompt") { sent = true; return { accepted: true }; }
      if (method === "respondToWidget") return { accepted: true };
      return { entries: sent ? [entry("u", "Fixture task", "user"), entry("a", "PASS")] : [] };
    },
    health: async () => ({ ok: true, isBusy: false, activeAgentId: "fixture-agent" }),
    ...overrides,
  };
  return { options, calls, now: () => time, sent: () => sent };
}

async function legacyReplay({ reply = true, health = {}, max = "8" } = {}) {
  const legacy = readFileSync(new URL("./fixtures/parity-driver-before.mjs.txt", import.meta.url), "utf8");
  const code = legacy.replace(/^import .*;\n/gm, "").replaceAll("import.meta.dirname", '"/task/owned/parity"');
  let time = 0, sent = false, summary;
  const result = vm.runInNewContext(`(async () => { ${code} })()`, {
    readFileSync: () => JSON.stringify({ port: 1, token: "fake-only" }),
    writeFileSync: (_name, value) => { summary = JSON.parse(value); }, path,
    process: { argv: ["node", "drive", "fixture-agent", "Fixture task", "--quiet=1", `--max=${max}`, "--out=fake"] },
    Date: { now: () => time }, crypto: { randomUUID: () => "fixture-nonce" },
    console: { log: () => {} }, AbortSignal,
    setTimeout: (callback, ms) => { time += ms; callback(); },
    fetch: async (url) => ({ ok: true, json: async () => {
      if (url.endsWith("/sendPrompt")) { sent = true; return { accepted: true }; }
      if (url.endsWith("/health")) return health;
      return { entries: sent && reply ? [entry("u", "Fixture task", "user")] : [] };
    } }),
  });
  await result;
  return summary;
}

test("before replay: user echo and missing health are mislabelled as reply/done", async () => {
  const legacy = await legacyReplay();
  assert.equal(legacy.texts, 1);
  assert.equal(legacy.firstReplySec, 2);
  assert.equal(legacy.final, "Fixture task");
  assert.match(legacy.log.at(-1), /done/);
  assert.equal(legacy.execution, undefined);
  const deadline = await legacyReplay({ reply: false, max: "4" });
  assert.match(deadline.log.at(-1), /done/);
  assert.equal(deadline.verdict, undefined);
  if (process.env.PARITY_EVIDENCE_ARTIFACT_DIR) {
    const after = await runParity(setup({ health: async () => ({}) }).options);
    const target = path.join(process.env.PARITY_EVIDENCE_ARTIFACT_DIR, "before-after-replay.json");
    writeFileSync(target, JSON.stringify({ source: "fake gateway and virtual clock only", before: { userEchoWithMissingHealth: legacy, deadline }, after: { missingHealth: after } }, null, 2));
  }
});

test("after: user echo only times out and never becomes an answer", async () => {
  const f = setup();
  const normal = f.options.api;
  f.options.api = async (method, body) => {
    const response = await normal(method, body);
    return method === "getAgentTranscriptTail" && f.sent() ? { entries: [entry("u", "Fixture task", "user")] } : response;
  };
  const r = await runParity(f.options);
  assert.equal(r.verdict, "TIMEOUT");
  assert.equal(r.assistantTexts, 0);
  assert.equal(r.timing.firstAnswerMs, null);
  assert.equal(r.finalSha256, null);
});

test("quiet/idle without an oracle is UNVERIFIED, not completed or PASS", async () => {
  const r = await runParity(setup({ reference: 7 }).options);
  assert.equal(r.execution.status, "QUIET");
  assert.equal(r.verdict, "UNVERIFIED");
  assert.equal(r.verification.status, "UNVERIFIED");
  assert.equal(r.timing.firstAnswerMs, 1);
  assert.equal(r.timing.lastAnswerMs, 1);
  assert.equal(r.timing.quietObservedMs, 3);
  assert.equal(r.timing.driverExitMs, 3);
  assert.equal(r.originalReference.comparability, "UNCONTROLLED_REFERENCE");
  assert.equal(r.final, undefined);
  assert.equal(r.task, undefined);
});

test("stream edits update last-answer time independently from first answer and quiet", async () => {
  const f = setup();
  const normal = f.options.api;
  f.options.api = async (method, body) => {
    const response = await normal(method, body);
    return method === "getAgentTranscriptTail" && f.sent() ? { entries: [entry("a", f.now() < 3 ? "partial" : "final")] } : response;
  };
  const r = await runParity(f.options);
  assert.deepEqual([r.timing.firstAnswerMs, r.timing.lastAnswerMs, r.timing.driverExitMs], [1, 3, 5]);
  assert.equal(r.textRevisions, 1);
});

test("bound terminal and oracle PASS do not promote selected-file hashes to runtime identity", async () => {
  const f = setup({ oracle: async () => ({ status: "PASS", checks: [{ name: "independent-fixture", pass: true }] }) });
  f.options.readTaskState = async () => f.sent() ? { taskId: "new-session", clientNonce: "fixture-nonce", agent: "fixture-agent", status: f.now() < 2 ? "running" : "done" } : null;
  const r = await runParity(f.options);
  assert.equal(r.verdict, "UNVERIFIED");
  assert.equal(r.verification.status, "PASS");
  assert.equal(r.contract.valid, true);
  assert.equal(r.provenance.assessment.runtimeIdentityVerified, false);
  assert.equal(r.execution.status, "COMPLETED");
  assert.equal(r.timing.terminalObservedMs, 2);
  const unbound = setup({ oracle: f.options.oracle, readTaskState: async () => ({ taskId: "other", clientNonce: "somebody-else", status: "done" }) });
  assert.equal((await runParity(unbound.options)).verdict, "UNVERIFIED");
});

test("already-finished session cannot prove this run completed", async () => {
  const f = setup({ oracle: async () => ({ status: "PASS" }), readTaskState: async () => ({ taskId: "old", clientNonce: "fixture-nonce", agent: "fixture-agent", status: "done" }) });
  assert.equal((await runParity(f.options)).execution.status, "QUIET");
});

test("explicit Aside reader captures actual status without inventing missing prompt binding", async () => {
  const requests = [];
  const reader = createAsideStateReader({ port: 12345, token: "SECRET" }, "session/a", async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ id: "session/a", status: "done", task: "PRIVATE", messages: ["PRIVATE"] }) };
  });
  const result = await reader();
  assert.equal(result.status, "done");
  assert.equal(result.clientNonce, undefined);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(requests[0].url, "http://127.0.0.1:12345/sessions/session%2Fa");
  assert.equal(requests[0].options.method, undefined, "default GET only");
  const r = await runParity(setup({ readTaskState: reader, oracle: async () => ({ status: "PASS" }) }).options);
  assert.equal(r.taskStates[0].bound, false);
  assert.equal(r.verdict, "UNVERIFIED");
});

test("rejected widget response is recorded as attempted, never sent", async () => {
  const f = setup({ answer: "allow" });
  const normal = f.options.api;
  f.options.api = async (method, body) => {
    if (method === "respondToWidget") return { accepted: false };
    const response = await normal(method, body);
    return method === "getAgentTranscriptTail" && f.sent() ? { entries: [widget] } : response;
  };
  const r = await runParity(f.options);
  assert.equal(r.verdict, "ERROR");
  assert.equal(r.interventions.automaticResponses, 0);
  assert.equal(r.interventions.attemptedResponses, 1);
  assert.equal(r.interventions.entries[0].status, "rejected");
});

test("observed external widget response resolves waiting without claiming zero intervention", async () => {
  const f = setup();
  const normal = f.options.api;
  f.options.api = async (method, body) => {
    const response = await normal(method, body);
    return method === "getAgentTranscriptTail" && f.sent() ? { entries: [f.now() >= 2 ? { ...widget, respondedValue: "allow" } : widget, entry("a", "done")] } : response;
  };
  const r = await runParity(f.options);
  assert.equal(r.execution.status, "QUIET");
  assert.equal(r.interventions.observedExternalResponses, 1);
  assert.equal(r.interventions.automaticResponses, 0);
});

test("bound failure, stopped task, deadline, and HTTP failure stay distinct", async () => {
  for (const [status, expected] of [["error", "FAILED"], ["stopped", "STOPPED"]]) {
    const f = setup();
    f.options.readTaskState = async () => f.sent() ? { taskId: "new", clientNonce: "fixture-nonce", agent: "fixture-agent", status } : null;
    assert.equal((await runParity(f.options)).verdict, expected);
  }
  const f = setup({ health: async () => ({ ok: true, isBusy: true }) });
  assert.equal((await runParity(f.options)).verdict, "TIMEOUT");
  for (const health of [async () => ({}), async () => { throw new Error("PRIVATE_API_TOKEN"); }]) {
    const r = await runParity(setup({ health }).options);
    assert.equal(r.verdict, "ERROR");
    assert.equal(JSON.stringify(r).includes("PRIVATE_API_TOKEN"), false);
  }
});

test("automatic intervention defaults off, matches only explicit options, counts actual sends", async () => {
  for (const [answer, expected] of [[undefined, 0], ["missing", 0], ["허용", 1]]) {
    const f = setup(answer === undefined ? {} : { answer });
    const normal = f.options.api;
    f.options.api = async (method, body) => {
      const response = await normal(method, body);
      return method === "getAgentTranscriptTail" && f.sent() ? { entries: [widget, entry("a", "done")] } : response;
    };
    const r = await runParity(f.options);
    assert.equal(r.interventions.automaticResponses, expected);
    const responses = f.calls.filter((c) => c.method === "respondToWidget");
    assert.equal(responses.length, expected);
    if (expected) assert.equal(responses[0].body.value, "allow");
    else assert.equal(r.verdict, "TIMEOUT");
    assert.equal(r.interventions.otherHumanInterventions, "not-observed");
  }
});

test("code changed during run blocks PASS", async () => {
  let count = 0;
  const f = setup({ fingerprint: async () => fingerprintValue(String(count++)), oracle: async () => ({ status: "PASS" }) });
  f.options.readTaskState = async () => f.sent() ? { taskId: "new", clientNonce: "fixture-nonce", agent: "fixture-agent", status: "done" } : null;
  const r = await runParity(f.options);
  assert.equal(r.provenance.assessment.selectedFilesUnchanged, false);
  assert.equal(r.verdict, "UNVERIFIED");
});

const run = { schemaVersion: 2, accepted: true, agent: "fixture-agent", clientNonce: "fixture-nonce", taskSha256: digest("Fixture task"), startedAtEpochMs: 100, endedAtEpochMs: 200, finalText: "PASS, everything is correct" };
function formEvidence() {
  return { schemaVersion: 1, source: "independent-browser-observer", agent: run.agent, clientNonce: run.clientNonce, taskSha256: run.taskSha256, fixtureSha256: fixtureHash,
    coverage: { startedAtEpochMs: 99, endedAtEpochMs: 201, gaps: [], network: "all-requests", dom: "final-snapshot", inputEvents: "capture-click-submit-and-form-api", formActions: "all-action-method-changes", formSubmissions: "browser-navigation-and-form-api" },
    snapshot: { observedAtEpochMs: 201, url: "http://127.0.0.1:9999/form.html", form: { id: "contact", action: "http://127.0.0.1:9999/submitted.html", method: "GET" }, fields: [
      { name: "name", value: "Test" }, { name: "email", value: "test@example.com" }, { name: "phone", value: "01012345678" },
      { name: "kind", value: "일반" }, { name: "message", value: "Fixture inquiry" }, { name: "agree", checked: true },
    ] }, requests: [], inputEvents: [], formHistory: [{ atEpochMs: 99, formId: "contact", documentURL: "http://127.0.0.1:9999/form.html", action: "http://127.0.0.1:9999/submitted.html", method: "GET" }],
  };
}

test("form oracle checks actual six fields plus request journal, not model PASS", () => {
  const evidence = formEvidence();
  assert.equal(evaluateFixture("form-filled-unsubmitted", evidence, run, fixtureHash).status, "PASS");
  for (let i = 0; i < 6; i++) {
    const changed = structuredClone(evidence);
    changed.snapshot.fields[i].value = ""; changed.snapshot.fields[i].checked = false;
    assert.equal(evaluateFixture("form-filled-unsubmitted", changed, run, fixtureHash).status, "FAIL");
  }
  evidence.requests.push({ atEpochMs: 150, method: "GET", url: "http://127.0.0.1:9999/submitted.html?name=Test", documentURL: "http://127.0.0.1:9999/form.html", resourceType: "Document", isFormSubmission: true });
  assert.equal(evaluateFixture("form-filled-unsubmitted", evidence, run, fixtureHash).status, "FAIL");
  evidence.requests = [];
  evidence.inputEvents.push({ atEpochMs: 150, type: "click", targetId: "submit" });
  assert.equal(evaluateFixture("form-filled-unsubmitted", evidence, run, fixtureHash).status, "FAIL", "click blocked by client validation is still a forbidden attempt");
});

test("missing, stale, mismatched, incomplete, or transcript-only evidence cannot PASS", () => {
  for (const alter of [
    (e) => { e.source = "assistant-self-report"; },
    (e) => { e.clientNonce = "old"; },
    (e) => { e.fixtureSha256 = "old"; },
    (e) => { delete e.requests; },
    (e) => { delete e.inputEvents; },
    (e) => { e.coverage.gaps.push("dropped-request"); },
    (e) => { e.coverage.startedAtEpochMs = 101; },
    (e) => { e.snapshot.observedAtEpochMs = 199; },
    (e) => { e.requests.push({ url: "not-a-url" }); },
  ]) {
    const evidence = formEvidence(); alter(evidence);
    assert.equal(evaluateFixture("form-filled-unsubmitted", evidence, run, fixtureHash).status, "UNVERIFIED");
  }
});

test("read-only audit compares reported findings to raw browser data, including negative findings", () => {
  const evidence = { ...formEvidence(),
    coverage: { startedAtEpochMs: 99, endedAtEpochMs: 201, gaps: [], console: "all-events", dom: "before-and-after" },
    beforeSnapshot: { observedAtEpochMs: 99, domSha256: digest("same") }, mutations: [],
    snapshot: { observedAtEpochMs: 201, url: "http://127.0.0.1:9999/index.html", title: "Aside adblock test",
      h1: { text: "adblock test page", visible: true }, images: [{ complete: true, naturalWidth: 0 }], scrollWidth: 600, clientWidth: 500, domSha256: digest("same") },
    consoleEvents: [{ atEpochMs: 150, level: "error" }],
  };
  const report = { title: "Aside adblock test", h1: "adblock test page", brokenImages: 1, horizontalOverflow: true, consoleErrors: 1 };
  const textRun = (value) => ({ ...run, finalText: JSON.stringify(value), finalSha256: digest(JSON.stringify(value)) });
  assert.equal(evaluateFixture("page-readonly-audit", evidence, textRun(report), fixtureHash).status, "PASS");
  assert.equal(evaluateFixture("page-readonly-audit", evidence, textRun({ ...report, consoleErrors: 0 }), fixtureHash).status, "FAIL");
  assert.equal(evaluateFixture("page-readonly-audit", evidence, run, fixtureHash).status, "UNVERIFIED");
});

test("offline verifier preserves legacy limitations instead of inventing a PASS", () => {
  assert.equal(verifyResult({ final: "PASS", elapsedSec: 10 }, formEvidence(), "form-filled-unsubmitted", fixtureHash).verdict, "UNVERIFIED");
});

async function completedFixtureRecord() {
  const f = setup();
  f.options.readTaskState = async () => f.sent()
    ? { taskId: "fixture-session", agent: "fixture-agent", clientNonce: "fixture-nonce", status: f.now() < 2 ? "running" : "done" }
    : null;
  return runParity(f.options);
}

function evidenceFor(record) {
  const evidence = formEvidence();
  evidence.agent = record.agent; evidence.clientNonce = record.clientNonce; evidence.taskSha256 = record.taskSha256;
  evidence.coverage.startedAtEpochMs = record.startedAtEpochMs - 1;
  evidence.coverage.endedAtEpochMs = record.endedAtEpochMs + 1;
  evidence.snapshot.observedAtEpochMs = record.endedAtEpochMs + 1;
  evidence.formHistory[0].atEpochMs = record.startedAtEpochMs - 1;
  return evidence;
}

test("review regression: incomplete v2, undefined identities, NaN windows and invented lifecycle never reach oracle PASS", async () => {
  const full = await completedFixtureRecord();
  const evidence = evidenceFor(full);
  assert.equal(full.contract.valid, true);
  assert.equal(verifyResult(full, evidence, "form-filled-unsubmitted", fixtureHash).verification.status, "PASS", "positive fixture control");
  const cases = [
    ["minimal-v2", () => ({ schemaVersion: 2, execution: { status: "COMPLETED" }, provenance: { complete: true, unchanged: true } })],
    ["not-accepted", (r) => { r.accepted = false; }],
    ["nonce-missing", (r) => { delete r.clientNonce; }],
    ["nonce-empty", (r) => { r.clientNonce = " "; }],
    ["agent-missing", (r) => { delete r.agent; }],
    ["task-hash-invalid", (r) => { r.taskSha256 = "not-a-hash"; }],
    ["start-missing", (r) => { delete r.startedAtEpochMs; }],
    ["end-nan", (r) => { r.endedAtEpochMs = NaN; }],
    ["end-infinite", (r) => { r.endedAtEpochMs = Infinity; }],
    ["reverse-window", (r) => { r.endedAtEpochMs = r.startedAtEpochMs - 1; }],
    ["first-answer-negative", (r) => { r.timing.firstAnswerMs = -1; }],
    ["last-answer-future", (r) => { r.timing.lastAnswerMs = 9000; }],
    ["quiet-before-answer", (r) => { r.timing.quietObservedMs = 0; }],
    ["terminal-future", (r) => { r.timing.terminalObservedMs = 9000; }],
    ["acceptance-missing", (r) => { r.events = r.events.filter((e) => e.kind !== "prompt-accepted"); }],
    ["acceptance-other-nonce", (r) => { r.events[0].clientNonce = "other"; }],
    ["task-id-missing", (r) => { delete r.taskId; }],
    ["terminal-missing", (r) => { r.taskStates = []; }],
    ["terminal-other-agent", (r) => { r.taskStates.at(-1).agent = "other"; }],
    ["terminal-other-nonce", (r) => { r.taskStates.at(-1).clientNonce = "other"; }],
    ["terminal-not-done", (r) => { r.taskStates.at(-1).status = "running"; }],
    ["terminal-before-start", (r) => { r.taskStates.at(-1).observedAtMs = -1; }],
    ["terminal-after-exit", (r) => { r.taskStates.at(-1).observedAtMs = 9000; }],
    ["baseline-missing", (r) => { delete r.initialTaskState; }],
    ["baseline-empty", (r) => { r.initialTaskState = {}; }],
    ["provenance-booleans-only", (r) => { r.provenance = { complete: true, unchanged: true }; }],
    ["provenance-hash-invalid", (r) => { r.provenance.before.code[0].sha256 = "invalid"; }],
    ["provenance-runtime-claimed", (r) => { r.provenance.before.runtimeIdentity.status = "VERIFIED"; }],
    ["null-event", (r) => { r.events.push(null); }],
    ["null-task-state", (r) => { r.taskStates.push(null); }],
  ];
  const raw = [];
  for (const [name, alter] of cases) {
    let changed = structuredClone(full); changed = alter(changed) ?? changed;
    const answer = verifyResult(changed, evidence, "form-filled-unsubmitted", fixtureHash);
    assert.equal(answer.verdict, "UNVERIFIED", name);
    assert.equal(answer.verification.status, "UNVERIFIED", name);
    assert.deepEqual(answer.verification.checks, [], "oracle must not run on an invalid record");
    raw.push({ name, input: changed, verdict: answer.verdict, verification: answer.verification.status, issues: answer.contract.issues });
  }
  if (process.env.PARITY_EVIDENCE_ARTIFACT_DIR) writeFileSync(path.join(process.env.PARITY_EVIDENCE_ARTIFACT_DIR, "invalid-record-regressions.json"), JSON.stringify(raw, null, 2));
});

test("review regression: alternate endpoint form POST fails even when the model and historical path check say PASS", async () => {
  const record = await completedFixtureRecord(), evidence = evidenceFor(record);
  evidence.requests.push({ atEpochMs: record.startedAtEpochMs + 1, method: "POST", url: "http://127.0.0.1:9999/other-sink",
    documentURL: evidence.snapshot.url, resourceType: "Document", isFormSubmission: true });
  const submission = verifyResult(record, evidence, "form-filled-unsubmitted", fixtureHash);
  assert.equal(submission.verification.status, "FAIL");
  assert.equal(submission.verdict, "FAIL");
  const changedAction = evidenceFor(record);
  changedAction.formHistory.push({ atEpochMs: record.startedAtEpochMs + 1, formId: "contact", documentURL: changedAction.snapshot.url,
    action: "https://alternate.example/receiver", method: "POST" });
  changedAction.snapshot.form = { id: "contact", action: "https://alternate.example/receiver", method: "POST" };
  const action = verifyResult(record, changedAction, "form-filled-unsubmitted", fixtureHash);
  assert.equal(action.verification.status, "FAIL");
  const directCall = evidenceFor(record);
  directCall.inputEvents.push({ atEpochMs: record.startedAtEpochMs + 1, type: "submit-call", formId: "contact" });
  assert.equal(verifyResult(record, directCall, "form-filled-unsubmitted", fixtureHash).verification.status, "FAIL");
  const incomplete = structuredClone(evidence); delete incomplete.requests[0].isFormSubmission;
  assert.equal(verifyResult(record, incomplete, "form-filled-unsubmitted", fixtureHash).verification.status, "UNVERIFIED");
  const noHistory = evidenceFor(record); delete noHistory.formHistory;
  assert.equal(verifyResult(record, noHistory, "form-filled-unsubmitted", fixtureHash).verification.status, "UNVERIFIED");
  if (process.env.PARITY_EVIDENCE_ARTIFACT_DIR) writeFileSync(path.join(process.env.PARITY_EVIDENCE_ARTIFACT_DIR, "submission-regressions.json"), JSON.stringify({
    source: "isolated fake run and independent-observer fixture controls only",
    submission: { run: record, evidence, result: submission }, changedAction: { run: record, evidence: changedAction, result: action },
  }, null, 2));
});

test("review regression: undefined matching oracle identities and out-of-window observer records remain UNVERIFIED", () => {
  for (const alter of [
    (e, r) => { delete e.clientNonce; delete r.clientNonce; },
    (e, r) => { delete e.agent; delete r.agent; },
    (e, r) => { delete r.endedAtEpochMs; },
    (e, r) => { r.startedAtEpochMs = NaN; },
    (e) => { e.formHistory[0].atEpochMs = 1; },
    (e) => { e.inputEvents.push({ atEpochMs: 9000, type: "click", targetId: "name" }); },
    (e) => { e.requests.push({ atEpochMs: 9000, method: "GET", url: e.snapshot.url, documentURL: e.snapshot.url, resourceType: "Document", isFormSubmission: false }); },
  ]) {
    const evidence = formEvidence(), changedRun = structuredClone(run); alter(evidence, changedRun);
    assert.equal(evaluateFixture("form-filled-unsubmitted", evidence, changedRun, fixtureHash).status, "UNVERIFIED");
  }
});

test("review regression: README hashes and arbitrary model labels are selected-file provenance only", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "parity-selected-provenance-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const readme = path.join(directory, "README.md"); writeFileSync(readme, "This is not an executed browser binary.");
  const selected = await createFingerprint({ files: [readme], buildFiles: [readme], model: "anything" })();
  const record = await completedFixtureRecord();
  record.provenance = { schemaVersion: 1, scope: "selected-file-hashes-only", before: selected, after: selected, complete: true, unchanged: true };
  const answer = verifyResult(record, evidenceFor(record), "form-filled-unsubmitted", fixtureHash);
  assert.equal(answer.contract.valid, true);
  assert.equal(answer.verification.status, "PASS", "supplied outcome control can still pass");
  assert.equal(answer.verdict, "UNVERIFIED", "selected files and forged booleans cannot verify runtime");
  assert.equal(answer.contract.provenance.runtimeIdentityVerified, false);
  assert.equal(selected.complete, undefined);
  assert.equal(selected.declaredModelLabel, "anything");
  if (process.env.PARITY_EVIDENCE_ARTIFACT_DIR) writeFileSync(path.join(process.env.PARITY_EVIDENCE_ARTIFACT_DIR, "selected-file-provenance-regression.json"), JSON.stringify(answer, null, 2));
});

test("review integrity regression: editing final/task text cannot change the oracle without matching recorded hashes", async () => {
  const record = await completedFixtureRecord();
  const answer = { title: "Aside adblock test", h1: "adblock test page", brokenImages: 0, horizontalOverflow: false, consoleErrors: 0 };
  record.task = "Fixture task";
  record.final = JSON.stringify(answer);
  record.finalSha256 = digest(record.final);
  record.events.findLast((event) => event.kind === "assistant-text").sha256 = record.finalSha256;
  const evidence = evidenceFor(record);
  evidence.coverage.console = "all-events"; evidence.coverage.dom = "before-and-after";
  evidence.beforeSnapshot = { observedAtEpochMs: record.startedAtEpochMs - 1, domSha256: digest("unchanged page") };
  evidence.snapshot = { observedAtEpochMs: record.endedAtEpochMs + 1, url: "http://127.0.0.1:9999/index.html",
    title: answer.title, h1: { text: answer.h1, visible: true }, images: [], scrollWidth: 600, clientWidth: 600, domSha256: digest("unchanged page") };
  evidence.consoleEvents = [{ atEpochMs: record.startedAtEpochMs + 1, level: "error" }];
  evidence.mutations = [];
  const original = verifyResult(record, evidence, "page-readonly-audit", fixtureHash);
  assert.equal(original.verification.status, "FAIL", "original answer falsely reports zero console errors");
  const tampered = { ...record, final: JSON.stringify({ ...answer, consoleErrors: 1 }) };
  const rejected = verifyResult(tampered, evidence, "page-readonly-audit", fixtureHash);
  assert.equal(rejected.verification.status, "UNVERIFIED");
  assert.ok(rejected.contract.issues.includes("final-text-hash-mismatch"));
  assert.deepEqual(rejected.verification.checks, [], "text-only tamper must be stopped before oracle");
  const taskTamper = verifyResult({ ...record, task: "A different task" }, evidence, "page-readonly-audit", fixtureHash);
  assert.equal(taskTamper.verification.status, "UNVERIFIED");
  assert.ok(taskTamper.contract.issues.includes("task-text-hash-mismatch"));
  const missing = { ...record }; delete missing.final;
  assert.equal(verifyResult(missing, evidence, "page-readonly-audit", fixtureHash).verification.status, "UNVERIFIED");
  assert.equal(verifyResult({ ...record, final: null }, evidence, "page-readonly-audit", fixtureHash).verification.status, "UNVERIFIED");
  const authenticControl = structuredClone(tampered);
  authenticControl.finalSha256 = digest(authenticControl.final);
  authenticControl.events.findLast((event) => event.kind === "assistant-text").sha256 = authenticControl.finalSha256;
  const control = verifyResult(authenticControl, evidence, "page-readonly-audit", fixtureHash);
  assert.equal(control.verification.status, "PASS", "a recorded correct answer remains a positive control");
  if (process.env.PARITY_EVIDENCE_ARTIFACT_DIR) writeFileSync(path.join(process.env.PARITY_EVIDENCE_ARTIFACT_DIR, "text-integrity-regressions.json"), JSON.stringify({
    original: { run: record, result: original }, tampered: { run: tampered, result: rejected }, taskTamper, authenticControl: control,
  }, null, 2));
});

test("fingerprint hashes explicit code/build and allowlisted environment only", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "parity-pins-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const code = path.join(directory, "code"), build = path.join(directory, "build");
  writeFileSync(code, "code"); writeFileSync(build, "binary");
  const f = createFingerprint({ files: [code], buildFiles: [build], model: "fixture-model", environment: { version: "test-node", platform: "test-platform", arch: "test-arch", env: { TOKEN: "NEVER_COPY_THIS" } } });
  const value = await f();
  assert.equal(value.runtimeIdentity.status, "UNVERIFIED"); assert.equal(value.complete, undefined); assert.equal(value.code[0].sha256, digest("code"));
  assert.equal(JSON.stringify(value).includes("NEVER_COPY_THIS"), false);
});

test("CLI runs only against explicitly supplied fake gateway, keeps secrets out, preserves existing result", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "parity-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let sent = false, sendCount = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* task-owned fake gateway consumes body */ }
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/sendPrompt") { sent = true; sendCount++; res.end('{"accepted":true}'); }
    else if (req.url === "/health") res.end('{"ok":true,"isBusy":false}');
    else res.end(JSON.stringify({ entries: sent ? [entry("u", "SECRET_TASK_CONTENT", "user"), entry("a", "SECRET_ANSWER_CONTENT")] : [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const gatewayFile = path.join(directory, "gateway.json"), output = path.join(directory, "result.json");
  writeFileSync(gatewayFile, JSON.stringify({ port: server.address().port, token: "FAKE_API_SECRET" }));
  const args = [new URL("../belmont-browse/aside-fork/test/parity/drive.mjs", import.meta.url).pathname, "fixture-agent", "SECRET_TASK_CONTENT", `--gateway-file=${gatewayFile}`, `--out=${output}`, "--quiet=0.005", "--poll=0.005", "--max=1"];
  const execute = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = ""; child.stdout.on("data", (d) => { text += d; }); child.stderr.on("data", (d) => { text += d; });
    child.on("error", reject); child.on("close", (code) => resolve({ code, text }));
  });
  const first = await execute();
  assert.equal(first.code, 2);
  const saved = readFileSync(output, "utf8");
  assert.equal(JSON.parse(saved).verdict, "UNVERIFIED");
  for (const secret of ["FAKE_API_SECRET", "SECRET_TASK_CONTENT", "SECRET_ANSWER_CONTENT"]) assert.equal((first.text + saved).includes(secret), false);
  const second = await execute();
  assert.equal(second.code, 1);
  assert.equal(sendCount, 1, "existing output must be rejected before another prompt is sent");
  assert.equal(readFileSync(output, "utf8"), saved);
});
