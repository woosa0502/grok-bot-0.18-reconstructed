// LIVE G4/G5 + G7-lifecycle verification against the real 909 engine, using an EXTERNAL-artifact observer
// (belmont-browse: our verification harness; not shipped). Each case writes evidence JSON. Cost/tools/errors are
// recorded AS MEASURED — no target numbers. We do NOT re-run to cherry-pick a favorable outcome.
//
// Cases (argv[2]): g4g5-run1 | g4g5-run2 | g7-timeout | g7-suspended | g7-lostcreate
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.env.BELMONT_REPO || process.cwd();
const { evaluateProcedure, createEvaluationApi } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/procedure-evaluation.mjs")).href);
const observer = await import("./g4g5-observer.mjs");
const CASE = process.argv[2];
const OUT = process.argv[3] || `/tmp/g4g7-${CASE}.json`;
const K = process.env.BELMONT_KNOWLEDGE_DIR || path.join(REPO, ".cache/eval-verify-909/knowledge");
const STATE = path.join(REPO, "belmont-browse/.state");
const DOMAIN = "booking.test";
const serve = JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
const formPort = Number(process.env.FORM_PORT || JSON.parse(fs.readFileSync(process.env.FORM_STATE_FILE, "utf8")).port);
const URL_ = `http://127.0.0.1:${formPort}`;
const realApi = createEvaluationApi(serve);
const sitesP = path.join(K, "sites", `${DOMAIN}.md`), draftP = path.join(K, "drafts", `${DOMAIN}.md`);

const bookTask = [
  `Complete a flight booking for ${DOMAIN}. Steps, in order, using ONLY the bash tool:`,
  `1) Call memory_search with the query "${DOMAIN} booking procedure" and read the saved procedure.`,
  `2) Follow that procedure EXACTLY, running each bash command it lists.`,
  `Reply DONE when finished. The booking service is at ${URL_} .`,
].join("\n");

// Procedures the agent recalls via memory_search (overlay). Champion vs candidate differ in real step count.
const champion = `# ${DOMAIN}\n\n## Current\nBooking procedure (do every step):\n`
  + `1. bash: T=$(curl -s ${URL_}/page | sed -n 's/^Booking token: //p')\n`
  + `2. bash: curl -s -X POST ${URL_}/submit -d "token=$T&destination=NYC"\n`
  + `3. bash: curl -s -X POST ${URL_}/submit -d "token=$T&seat=aisle"\n`
  + `4. Reply DONE\n`;
const goodCandidate = `# ${DOMAIN}\n\n## Current\nBooking procedure (do every step):\n`
  + `1. bash: T=$(curl -s ${URL_}/page | sed -n 's/^Booking token: //p')\n`
  + `2. bash: curl -s -X POST ${URL_}/submit -d "token=$T&destination=NYC&seat=aisle"\n`
  + `3. Reply DONE\n`;
const failingCandidate = `# ${DOMAIN}\n\n## Current\nBooking procedure (do every step):\n`
  + `1. bash: curl -s ${URL_}/page\n`
  + `2. Reply DONE   (do not submit anything)\n`;

const verifier = { id: observer.id, isolation: observer.isolation, beforeTrial: observer.beforeTrial, verify: observer.verify };
const backup = {};
function writeKnowledge(champTxt, candTxt) {
  for (const [p, txt] of [[sitesP, champTxt], [draftP, candTxt]]) {
    backup[p] = fs.existsSync(p) ? fs.readFileSync(p) : null;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, txt);
  }
}
function restoreKnowledge() {
  for (const [p, b] of Object.entries(backup)) { if (b === null) { try { fs.unlinkSync(p); } catch {} } else fs.writeFileSync(p, b); }
}
const lockPath = path.join(fs.realpathSync(K), ".learn-measure.lock");
const lockExists = () => fs.existsSync(lockPath);
const model = "gpt-5.5", thinking = "high";
const common = { domain: DOMAIN, api: realApi, knowledgeDir: K, stateDir: STATE, model, thinking, pollMs: 1000, noPageDiagnostic: false, log: (l) => console.log(l) };

const record = (obj) => { fs.writeFileSync(OUT, JSON.stringify({ case: CASE, at: new Date().toISOString(), daemonNote: "see report/handoff for daemon sha", ...obj }, null, 2)); console.log("EVIDENCE ->", OUT); };

async function g4g5(candTxt, tag) {
  writeKnowledge(champion, candTxt);
  let report, error;
  try {
    report = await evaluateProcedure({ ...common, task: bookTask, verifier, publish: true, runs: 1, timeoutMs: 180000 });
  } catch (e) { error = { code: e.code, message: e.message }; }
  finally { restoreKnowledge(); }
  const rows = report?.rows ?? {};
  const summarize = (arm) => (rows[arm] ?? []).map((r) => ({ arm, status: r.status, tools: r.toolCalls, errors: r.errors, ms: Math.round(r.ms), verdict: r.grade?.verdict, critical: r.grade?.criticalFailure, evidence: r.grade?.evidence?.[0] }));
  record({ tag, published: report?.published ?? false, accept: report?.accept, reason: report?.reason,
    metrics: report?.metrics, rows: [...summarize("current"), ...summarize("draft")],
    publishedFileSha: report?.published ? "check sites file" : null, lockReleased: !lockExists(), error });
}

async function g7Timeout() {
  writeKnowledge(champion, goodCandidate);
  const task = "Run this exact bash command and nothing else: sleep 600. Do not reply until it finishes.";
  let error, stopObserved = false;
  const api = async (m, u, b, s) => { const r = await realApi(m, u, b, s); if (u.endsWith("/stop")) stopObserved = true; return r; };
  let stoppedTerminal = null, orphanId = null;
  const apiTrack = async (m, u, b, s) => { const r = await api(m, u, b, s); if (u === "/sessions" && m === "POST") orphanId = r.id; return r; };
  try { await evaluateProcedure({ ...common, api: apiTrack, task, verifier, publish: false, runs: 1, timeoutMs: 15000 }); }
  catch (e) { error = { code: e.code, message: e.message }; }
  finally { restoreKnowledge(); }
  if (orphanId) { try { const v = await realApi("GET", `/sessions/${orphanId}`); stoppedTerminal = v?.status; } catch (e) { stoppedTerminal = `query-failed:${e.message}`; } }
  record({ expected: "TRIAL_TIMEOUT then stop; session terminal; lock released", error, stopRequested: stopObserved, sessionFinalStatus: stoppedTerminal, lockReleased: !lockExists() });
}

async function g7Suspended() {
  writeKnowledge(champion, goodCandidate);
  const task = "Use the ask_user_question tool to ask the operator exactly: 'Proceed with the booking? (yes/no)'. Then wait for the answer. Do not use any other tool.";
  let error, stopObserved = false, orphanId = null;
  const api = async (m, u, b, s) => { const r = await realApi(m, u, b, s); if (u.endsWith("/stop")) stopObserved = true; if (u === "/sessions" && m === "POST") orphanId = r.id; return r; };
  try { await evaluateProcedure({ ...common, api, task, verifier, publish: false, runs: 1, timeoutMs: 120000 }); }
  catch (e) { error = { code: e.code, message: e.message }; }
  finally { restoreKnowledge(); }
  let finalStatus = null; if (orphanId) { try { finalStatus = (await realApi("GET", `/sessions/${orphanId}`))?.status; } catch (e) { finalStatus = `query-failed:${e.message}`; } }
  record({ expected: "EVALUATION_SUSPENDED (autoApprove false); stop requested; session terminal; lock released", error, stopRequested: stopObserved, sessionFinalStatus: finalStatus, lockReleased: !lockExists() });
}

async function g7LostCreate() {
  // Simulate a lost POST /sessions response: the session IS created server-side, but the client "loses" the reply.
  // evaluateProcedure must NOT retry and must PRESERVE the lock + inspection state. We then identify the orphan
  // and terminate it explicitly (never force-delete the lock while a worker's fate is unknown).
  writeKnowledge(champion, goodCandidate);
  let error, postCount = 0, orphanId = null;
  const api = async (m, u, b, s) => {
    if (u === "/sessions" && m === "POST") { postCount++; const r = await realApi(m, u, b, s); orphanId = r.id; throw Object.assign(new Error("response lost after creation"), { code: "LOST_RESPONSE" }); }
    return realApi(m, u, b, s);
  };
  try { await evaluateProcedure({ ...common, api, task: bookTask, verifier, publish: false, runs: 1, timeoutMs: 60000 }); }
  catch (e) { error = { code: e.code, message: e.message }; }
  finally { restoreKnowledge(); }
  const lockPreserved = lockExists();
  // Inspection then explicit recovery: identify the orphan, confirm, terminate, re-confirm terminal, then release lock.
  let orphanStatusBefore = null, orphanStatusAfter = null, released = false;
  if (orphanId) {
    try { orphanStatusBefore = (await realApi("GET", `/sessions/${orphanId}`))?.status; } catch (e) { orphanStatusBefore = `query-failed:${e.message}`; }
    try { await realApi("POST", `/sessions/${orphanId}/stop`, {}); } catch {}
    for (let i = 0; i < 20; i++) { try { const v = await realApi("GET", `/sessions/${orphanId}`); orphanStatusAfter = v?.status; if (["done","error","stopped","interrupted"].includes(v?.status)) break; } catch (e) { orphanStatusAfter = `query-failed:${e.message}`; break; } await new Promise(r => setTimeout(r, 500)); }
  }
  const terminal = ["done","error","stopped","interrupted"].includes(orphanStatusAfter);
  if (lockPreserved && terminal) { try { fs.unlinkSync(lockPath); released = true; } catch {} }
  record({ expected: "no POST retry; lock PRESERVED; orphan identified+terminated; then explicit lock release",
    postCount, error, lockPreservedOnFailure: lockPreserved, orphanId, orphanStatusBefore, orphanStatusAfter,
    orphanConfirmedTerminal: terminal, lockReleasedAfterConfirmedTermination: released,
    note: terminal ? "orphan confirmed terminal before releasing lock" : "TERMINATION NOT CONFIRMED — lock left in place, requires inspection" });
}

const map = { "g4g5-run1": () => g4g5(goodCandidate, "champion-vs-good-candidate"), "g4g5-run2": () => g4g5(failingCandidate, "champion-vs-failing-candidate"), "g7-timeout": g7Timeout, "g7-suspended": g7Suspended, "g7-lostcreate": g7LostCreate };
if (!map[CASE]) { console.error("unknown case:", CASE, "| choices:", Object.keys(map).join(", ")); process.exit(2); }
await map[CASE]();
