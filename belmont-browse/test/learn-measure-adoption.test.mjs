// Regression tests for belmont-browse/src/learn-measure.mjs adoption + isolation rules.
//
// The candidate is delivered to the worker through a per-session sites overlay (the `sitesDir` the service
// advertises via health.sitesOverlay); the operational page knowledge/sites/<domain>.md is the thing live bot
// sessions read. The mock worker reads the OVERLAY the session was given, while an independent reader reads
// the OPERATIONAL page — so these tests prove the operational page is never an unapproved draft during a
// trial, that a draft is adopted only when it is cheaper AND proven to reach the goal AND no worse on errors,
// and that the single-writer lock and crash behavior are safe. No live browser, Aside service, site, account
// or booking API is used; file writes, child processes, an independent reader, SIGKILL and the lock are real.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const moduleFile = fileURLToPath(new URL("../src/learn-measure.mjs", import.meta.url));

function makeRoot(seedChampion = true) {
  const root = fs.mkdtempSync(join(tmpdir(), "belmont-learn-"));
  for (const sub of ["src", ".state", "knowledge/sites", "knowledge/drafts", "knowledge/lessons"]) fs.mkdirSync(join(root, sub), { recursive: true });
  fs.copyFileSync(moduleFile, join(root, "src/learn-measure.mjs"));
  fs.writeFileSync(join(root, "src/session.mjs"), "export const KNOWLEDGE_DIR = process.env.REVIEW_KNOWLEDGE_DIR;\n");
  fs.writeFileSync(join(root, ".state/serve.json"), JSON.stringify({ port: 1, token: "test-only-not-a-secret" }));
  if (seedChampion) fs.writeFileSync(join(root, "knowledge/sites/example.com.md"), "CHAMPION");
  fs.writeFileSync(join(root, "knowledge/drafts/example.com.md"), "DRAFT");
  // The worker reads the per-session overlay it was given (sitesDir in the POST body); an independent reader
  // reads the operational page. `cheaperDraft` scenarios make the draft cost 1 call (< champion's 2) so the
  // goal/error guards — not the cost comparison — are what must reject them (detection power).
  fs.writeFileSync(join(root, "mock.mjs"), String.raw`
import fs from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = process.env.REVIEW_ROOT, scenario = process.env.REVIEW_SCENARIO;
const opPage = join(root, "knowledge/sites/example.com.md"); // operational page live readers use
const log = join(root, "knowledge/lessons/measurements.log");
const trace = join(root, "trace.jsonl");
let lastSitesDir = null, created = 0, readerRan = false;
globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.endsWith("/health")) return { json: async () => ({ ok: true, sitesOverlay: true }) };
  if (options.method === "POST" && u.endsWith("/sessions")) {
    const body = options.body ? JSON.parse(options.body) : {};
    lastSitesDir = body.sitesDir ?? null;
    return { json: async () => ({ id: "test-" + (++created) }) };
  }
  const overlayPage = lastSitesDir ? join(lastSitesDir, "example.com.md") : null;
  const content = overlayPage && fs.existsSync(overlayPage) ? fs.readFileSync(overlayPage, "utf8") : "NONE";
  fs.appendFileSync(trace, JSON.stringify({ scenario, content, opPage: fs.existsSync(opPage) ? fs.readFileSync(opPage, "utf8") : null, verdictExists: fs.existsSync(log) }) + "\n");
  if (scenario === "throw-baseline" && content === "NONE") throw new Error("simulated transport failure");
  if (scenario === "throw-draft" && content === "DRAFT") throw new Error("simulated transport failure");
  if (scenario === "kill-during-draft" && content === "DRAFT") process.kill(process.pid, "SIGKILL");
  if (scenario === "unapproved-reader" && content === "DRAFT" && !readerRan) {
    readerRan = true;
    const script = 'const f=require("node:fs");console.log(JSON.stringify({opPage:f.existsSync(process.argv[1])?f.readFileSync(process.argv[1],"utf8"):null,verdictExists:f.existsSync(process.argv[2])}))';
    const reader = spawnSync(process.execPath, ["-e", script, opPage, log], { encoding: "utf8" });
    if (reader.status !== 0) throw new Error(reader.stderr);
    fs.writeFileSync(join(root, "independent-reader.json"), reader.stdout);
  }
  const cheaperDraft = ["better-draft", "adopt-no-current", "done-without-goal", "more-errors", "goal-failure-after-100", "goal-unknown"].includes(scenario);
  const toolCalls = content === "CHAMPION" ? 2 : content === "DRAFT" ? (cheaperDraft ? 1 : 6) : 10;
  const moreErrors = scenario === "more-errors" && content === "DRAFT";
  let result = "Goal achieved";
  if (content === "DRAFT" && scenario === "done-without-goal") result = "Unable to complete the requested task: no booking was made.";
  if (content === "DRAFT" && scenario === "goal-failure-after-100") result = "Read the itinerary and compared route candidates. ".repeat(4) + "Unable to complete the requested task: no booking was made.";
  if (content === "DRAFT" && scenario === "goal-unknown") result = "예약은 아직 미완료 상태이며, 항공권을 발권하지 않았습니다.";
  return { json: async () => ({ status: "done", activity: moreErrors ? ["ERROR unsafe partial failure", "ERROR known failed step"] : [], toolCalls, modelCalls: toolCalls, result }) };
};
`);
  return root;
}

function run(scenario, { seedChampion = true, goal = "Goal achieved", prelock = false } = {}) {
  const root = makeRoot(seedChampion);
  try {
    if (prelock) fs.writeFileSync(join(root, ".state/learn-measure.lock"), JSON.stringify({ pid: process.pid, at: Date.now() - 3600001, domain: "example.com" }));
    const args = ["--import", join(root, "mock.mjs"), join(root, "src/learn-measure.mjs"), "--domain", "example.com", "--task", "Complete the test booking", "--runs", "2"];
    if (goal) args.push("--goal", goal);
    const child = spawnSync(process.execPath, args, {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, REVIEW_ROOT: root, REVIEW_KNOWLEDGE_DIR: join(root, "knowledge"), REVIEW_SCENARIO: scenario },
    });
    const read = (p) => fs.existsSync(join(root, p)) ? fs.readFileSync(join(root, p), "utf8") : null;
    return {
      status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr,
      page: read("knowledge/sites/example.com.md"), draft: read("knowledge/drafts/example.com.md"),
      backup: read("knowledge/sites/example.com.md.bak"), lock: read(".state/learn-measure.lock"),
      log: read("knowledge/lessons/measurements.log"), reader: read("independent-reader.json"), trace: read("trace.jsonl"),
      evalLeftover: fs.existsSync(join(root, ".state/learn-eval")) ? fs.readdirSync(join(root, ".state/learn-eval")) : [],
    };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---- adoption rules (strengthened: negative scenarios use a cheaper draft so goal/error gates must reject) ----
test("a 6-call challenger does NOT replace a 2-call champion (bar is the current procedure)", () => {
  const r = run("worse-than-champion");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "CHAMPION");
  assert.match(r.log, /REJECTED/);
  assert.doesNotMatch(r.log, /ADOPTED/);
  assert.equal(r.draft, "DRAFT");
});

test("a terminal 'done' that reports it could not finish is REJECTED even when cheaper (done != goal)", () => {
  const r = run("done-without-goal");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "CHAMPION");
  assert.match(r.log, /REJECTED \(goal not reached/);
  assert.equal(r.draft, "DRAFT");
});

test("fewer tools do NOT override an increased error count", () => {
  const r = run("more-errors");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /errors 0\.0 → 2\.0/);
  assert.match(r.log, /REJECTED \(errors worse\)/);
  assert.equal(r.page, "CHAMPION");
});

test("a transport error during baseline leaves the operational page intact", () => {
  const r = run("throw-baseline");
  assert.notEqual(r.status, 0);
  assert.equal(r.page, "CHAMPION");
  assert.equal(r.log, null);
});

test("a transport error during the challenger leaves the operational page intact (no unapproved draft)", () => {
  const r = run("throw-draft");
  assert.notEqual(r.status, 0);
  assert.equal(r.page, "CHAMPION");
  assert.equal(r.draft, "DRAFT");
  assert.equal(r.log, null);
});

test("a draft strictly cheaper than the champion AND proven to reach the goal is ADOPTED (atomic publish)", () => {
  const r = run("better-draft");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "DRAFT");
  assert.match(r.log, /ADOPTED/);
  assert.equal(r.draft, null); // consumed on adoption
});

test("with no current procedure, a goal-reaching draft beating the no-page bar is ADOPTED", () => {
  const r = run("adopt-no-current", { seedChampion: false });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.page, "DRAFT");
  assert.match(r.log, /bar=no-page/);
  assert.match(r.log, /ADOPTED/);
});

// ---- goal verification (P1-1): full result, succeeded/failed/unknown ----
test("a failure admission after character 100 is caught (verified on the full result, not a preview)", () => {
  const r = run("goal-failure-after-100");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /REJECTED \(goal not reached/);
  assert.equal(r.page, "CHAMPION");
});

test("an incomplete result outside the failure vocabulary is 'unknown' and is NOT promoted", () => {
  const r = run("goal-unknown");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /REJECTED \(goal not reached/);
  assert.match(r.log, /unknown/);
  assert.equal(r.page, "CHAMPION");
});

// ---- isolation (P1-2): operational page never shows an unapproved draft during a trial ----
test("an independent reader sees the champion — never the draft — during an ultimately REJECTED trial", () => {
  const r = run("unapproved-reader");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.reader), { opPage: "CHAMPION", verdictExists: false });
  assert.match(r.log, /REJECTED/);
  assert.equal(r.page, "CHAMPION");
});

// ---- crash + lock (P2-3 / P2-3b) ----
test("a SIGKILL during the draft trial leaves the operational page untouched (no backup/journal to mishandle)", () => {
  const r = run("kill-during-draft");
  assert.equal(r.signal, "SIGKILL");
  assert.equal(r.page, "CHAMPION"); // operational page was never written during measurement
  assert.equal(r.draft, "DRAFT");
  assert.equal(r.backup, null);
});

test("a live lock owner is NOT evicted merely because the lock is older than an hour", () => {
  const r = run("worse-than-champion", { prelock: true });
  assert.equal(r.status, 3, r.stderr); // refused; single-writer preserved
  assert.match(r.stderr, /refusing concurrent measurement/);
  assert.ok(r.lock); // the live owner's lock is still there, not stolen
  assert.equal(r.page, "CHAMPION");
  assert.equal(r.log, null);
});
