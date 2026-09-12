// Regression tests for belmont-browse/src/learn-measure.mjs adoption rules.
//
// These INVERT the external reviewer's diagnostic repros (belmont-review/review-repros.test.mjs): where the
// repros asserted the old defects (a worse challenger adopted because the baseline was "no page"; a terminal
// "done" accepted as task success; fewer tools overriding more errors; a transport error leaving the live
// page missing or an unapproved draft live), these assert the CORRECTED behavior after the fix:
//   - the bar is the CURRENT approved procedure (no-page is only a diagnostic / the bar when none exists),
//   - a draft is adopted only if every run reaches the goal, errors are no worse, and it is strictly cheaper,
//   - the live page is restored on every exit; it becomes the draft only after approval.
//
// Worker responses and timers are test doubles (no real browser, Aside service, site, account or API). Each
// scenario runs the real module in a child process against a temp knowledge dir and inspects the files.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const moduleUrl = new URL("../src/learn-measure.mjs", import.meta.url);
const moduleFile = fileURLToPath(moduleUrl);

function runScenario(scenario, { seedChampion = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "belmont-learn-"));
  for (const sub of ["src", ".state", "knowledge/sites", "knowledge/drafts", "knowledge/lessons"]) mkdirSync(join(root, sub), { recursive: true });
  copyFileSync(moduleFile, join(root, "src/learn-measure.mjs"));
  writeFileSync(join(root, "src/session.mjs"), "export const KNOWLEDGE_DIR = process.env.REVIEW_KNOWLEDGE_DIR;\n");
  writeFileSync(join(root, ".state/serve.json"), JSON.stringify({ port: 1, token: "test-only-not-a-secret" }));
  if (seedChampion) writeFileSync(join(root, "knowledge/sites/example.com.md"), "CHAMPION");
  writeFileSync(join(root, "knowledge/drafts/example.com.md"), "DRAFT");
  const preload = join(root, "mock-runtime.mjs");
  writeFileSync(preload, `
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.REVIEW_ROOT;
const scenario = process.env.REVIEW_SCENARIO;
const page = join(root, "knowledge/sites/example.com.md");
const trace = join(root, "trace.jsonl");
let created = 0;
globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
globalThis.fetch = async (_url, options) => {
  const content = existsSync(page) ? readFileSync(page, "utf8") : "NONE";
  appendFileSync(trace, JSON.stringify({ method: options.method, content }) + "\\n");
  if (scenario === "throw-baseline" && content === "NONE") throw new Error("simulated transport failure");
  if (scenario === "throw-draft" && content === "DRAFT") throw new Error("simulated transport failure");
  if (options.method === "POST") return { json: async () => ({ id: "test-" + (++created) }) };
  const tools = content === "NONE" ? 10 : content === "CHAMPION" ? 2 : (scenario === "better-draft" || scenario === "adopt-no-current") ? 1 : 6;
  const failedResult = scenario === "done-without-goal" && content === "DRAFT";
  const moreErrors = scenario === "more-errors" && content === "DRAFT";
  return { json: async () => ({ status: "done", toolCalls: tools, modelCalls: tools,
    activity: moreErrors ? ["ERROR unsafe partial failure", "ERROR known failed step"] : [],
    result: failedResult ? "Unable to complete the requested task: target item not found" : "Goal achieved" }) };
};
`);
  const child = spawnSync(process.execPath, ["--import", preload, join(root, "src/learn-measure.mjs"), "--domain", "example.com", "--task", "Read-only test task", "--runs", "2"], {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, REVIEW_ROOT: root, REVIEW_KNOWLEDGE_DIR: join(root, "knowledge"), REVIEW_SCENARIO: scenario },
  });
  const readOptional = (p) => existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null;
  const result = { status: child.status, stdout: child.stdout, stderr: child.stderr,
    page: readOptional("knowledge/sites/example.com.md"),
    backup: readOptional("knowledge/sites/example.com.md.bak"),
    draft: readOptional("knowledge/drafts/example.com.md"),
    log: readOptional("knowledge/lessons/measurements.log"),
    trace: (readOptional("trace.jsonl") || "").trim().split("\n").filter(Boolean).map(JSON.parse),
  };
  rmSync(root, { recursive: true, force: true });
  return result;
}

// ---- inverted repros: the old defects must NOT happen -------------------------------------------------
test("a 6-call challenger does NOT replace a 2-call champion (bar is the current procedure, not no-page)", () => {
  const r = runScenario("worse-than-champion");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "CHAMPION");            // champion kept
  assert.match(r.log, /REJECTED/);
  assert.doesNotMatch(r.log, /ADOPTED/);
  assert.equal(r.trace.some((x) => x.content === "CHAMPION"), true); // the champion was actually measured
  assert.equal(r.backup, null);                // backup cleaned up
  assert.equal(r.draft, "DRAFT");              // draft retained for revision
});

test("a terminal 'done' that reports it could not finish is REJECTED (done != goal)", () => {
  const r = runScenario("done-without-goal");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "CHAMPION");
  assert.match(r.log, /REJECTED/);
  assert.match(r.log, /goal not reached/);
  assert.equal(r.draft, "DRAFT");
});

test("fewer tools do NOT override an increased error count", () => {
  const r = runScenario("more-errors");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /errors 0\.0 → 2\.0/);   // champion 0 errors vs draft 2 errors
  assert.match(r.log, /REJECTED/);
  assert.equal(r.page, "CHAMPION");
});

test("a transport error during baseline leaves the live page intact (not missing)", () => {
  const r = runScenario("throw-baseline");
  assert.notEqual(r.status, 0);
  assert.equal(r.page, "CHAMPION");            // restored, not null
  assert.equal(r.backup, null);                // no stray backup left behind
  assert.equal(r.draft, "DRAFT");
  assert.equal(r.log, null);                   // no verdict written on abort
});

test("a transport error during the challenger does NOT leave an unapproved draft live", () => {
  const r = runScenario("throw-draft");
  assert.notEqual(r.status, 0);
  assert.equal(r.page, "CHAMPION");            // champion restored, draft not promoted
  assert.equal(r.backup, null);
  assert.equal(r.draft, "DRAFT");
  assert.equal(r.log, null);
});

// ---- positive paths: a genuinely better draft IS adopted ---------------------------------------------
test("a draft strictly cheaper than the champion, reaching the goal, is ADOPTED (atomic replace on approval)", () => {
  const r = runScenario("better-draft");             // DRAFT -> 1 tool call < champion's 2
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "DRAFT");               // live page atomically replaced with the approved draft
  assert.match(r.log, /ADOPTED/);
  assert.equal(r.backup, null);                // backup cleaned up
  assert.equal(r.draft, null);                 // draft consumed on adoption
});

test("with no current procedure, a draft beating the no-page bar is ADOPTED", () => {
  const r = runScenario("adopt-no-current", { seedChampion: false }); // no champion; DRAFT 1 < no-page 10
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "DRAFT");
  assert.match(r.log, /bar=no-page/);
  assert.match(r.log, /ADOPTED/);
  assert.equal(r.backup, null);
  assert.equal(r.draft, null);
});
