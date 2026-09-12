// belmont-browse: learning loop, step 3 — promote a draft page only if it measurably beats the CURRENT
// approved procedure AND actually reaches the task goal (our code).
//   node src/learn-measure.mjs --domain github.com --task "..." --goal "<a string the final result must contain on success>"
//     [--model gpt-5.6-luna --thinking max --runs 2]
//
// Three guarantees the external review required:
//  1. The bar is the current approved procedure (no-page is only a diagnostic / the bar when none exists),
//     the draft is adopted only when it is strictly cheaper and its errors are no worse.
//  2. Goal verification, not a failure-word blacklist: each run is succeeded / failed / unknown, judged on the
//     FULL result (never a truncated preview). Only runs proven succeeded can adopt; unknown never promotes.
//  3. The operational sites/<domain>.md is NEVER mutated while measuring: the candidate is measured in an
//     isolated eval sites dir handed to the worker as `sitesDir`, so a concurrent knowledge reader never sees
//     an unapproved draft. The operational page is replaced — atomically — only after the draft is approved.
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, appendFileSync, writeFileSync, openSync, closeSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { KNOWLEDGE_DIR } from "./session.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(ROOT, ".state");
const { values: opt } = parseArgs({ options: {
  domain: { type: "string" }, task: { type: "string" }, model: { type: "string", default: "gpt-5.6-luna" },
  thinking: { type: "string", default: "max" }, runs: { type: "string", default: "2" },
  goal: { type: "string" },
} });
if (!opt.domain || !opt.task) { console.error("usage: --domain <d> --task <t> [--goal <success-substring>]"); process.exit(2); }

const draft = path.join(KNOWLEDGE_DIR, "drafts", `${opt.domain}.md`);
const opPage = path.join(KNOWLEDGE_DIR, "sites", `${opt.domain}.md`); // operational page; live bot sessions read this
const lockPath = path.join(STATE_DIR, "learn-measure.lock");
// Isolated eval store, OUTSIDE KNOWLEDGE_DIR so the global knowledge index never picks up a candidate page.
const evalDir = path.join(STATE_DIR, "learn-eval", `${opt.domain}-${process.pid}`);
const evalSites = path.join(evalDir, "sites");
const evalPage = path.join(evalSites, `${opt.domain}.md`);

if (!existsSync(draft)) { console.error(`no draft: ${draft}`); process.exit(2); }
const state = JSON.parse(readFileSync(path.join(STATE_DIR, "serve.json"), "utf8"));
const api = async (m, p, body) => { const r = await fetch(`http://127.0.0.1:${state.port}${p}`, { method: m, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return r.json(); };

// Goal verification. A terminal "done" is not success; the worker can stop and report it could not finish.
// Judge the FULL result. Failure markers => "failed". An operator-supplied --goal found in the result =>
// "succeeded". Otherwise "unknown" — the absence of a known failure phrase is NOT proof of success, and an
// unknown run never promotes a draft. (This replaces inferring success from a blacklist, and checks the whole
// result so a late failure admission is not lost to truncation.)
const GOAL_FAILURE = [/unable to/i, /could\s?n'?t/i, /can\s?not\b/i, /can'?t\b/i, /failed to/i, /was ?n'?t able/i, /not able to/i, /gave up/i, /하지\s*못했/, /완료(하지|할 수 없|에 실패)/, /실패(했|함|하였|으로)/, /불가능/, /찾지\s*못/];
function goalVerdict(resultFull) {
  const text = (resultFull ?? "").trim();
  if (GOAL_FAILURE.some((re) => re.test(text))) return "failed";
  if (opt.goal && text.toLowerCase().includes(opt.goal.toLowerCase())) return "succeeded";
  return "unknown";
}

async function runOnce(sitesDir) {
  const t0 = Date.now();
  const created = await api("POST", "/sessions", { task: opt.task, model: opt.model, thinking: opt.thinking, mode: "guard", autoApprove: true, sitesDir });
  let view;
  for (let i = 0; i < 240; i += 1) { await new Promise((r) => setTimeout(r, 2000)); view = await api("GET", `/sessions/${created.id}`); if (["done", "error", "stopped"].includes(view.status)) break; }
  const errors = (view.activity ?? []).filter((l) => /\bERROR\b/.test(l)).length;
  const full = view.result ?? ""; // verify on the whole result; only the log preview is truncated
  return { status: view.status, toolCalls: view.toolCalls, modelCalls: view.modelCalls, errors, secs: Math.round((Date.now() - t0) / 1000), result: full.slice(0, 100), verdict: goalVerdict(full) };
}
// Median, not mean: one runaway run must not decide adoption.
const avg = (rows, k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const medOf = (rows) => ({ tools: avg(rows, "toolCalls"), errors: avg(rows, "errors"), secs: avg(rows, "secs") });
async function series(label, sitesDir) { const rows = []; for (let i = 0; i < Number(opt.runs); i += 1) { const r = await runOnce(sitesDir); rows.push(r); console.log(`  [${label} #${i + 1}] ${r.status} tools=${r.toolCalls} model=${r.modelCalls} errors=${r.errors} ${r.secs}s goal=${r.verdict}`); } return rows; }

// ---- single-writer lock --------------------------------------------------------------------------------
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const fd = openSync(lockPath, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), domain: opt.domain })); closeSync(fd); return; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let info; try { info = JSON.parse(readFileSync(lockPath, "utf8")); } catch { info = null; }
      // Steal only a DEAD owner's lock. A live owner keeps it no matter how old: a long-running measurement
      // must not lose its single-writer guarantee just because a timeout elapsed.
      if (!info || !info.pid || !isAlive(info.pid)) { try { unlinkSync(lockPath); } catch {} continue; }
      console.error(`[learn-measure] another run holds the lock (pid ${info.pid}, alive); refusing concurrent measurement`); process.exit(3);
    }
  }
  console.error("[learn-measure] could not acquire lock"); process.exit(3);
}
// Release only OUR lock — never another owner's.
function releaseLock() { try { const info = JSON.parse(readFileSync(lockPath, "utf8")); if (info?.pid === process.pid) unlinkSync(lockPath); } catch {} }
const atomicPublish = (src, dest) => { const tmp = `${dest}.tmp-${process.pid}`; copyFileSync(src, tmp); renameSync(tmp, dest); }; // crash-safe replace
const rmIfExists = (p) => { try { if (existsSync(p)) unlinkSync(p); } catch {} };

// The operational page is isolated from the worker only if the service reads the per-session `sitesDir`
// overlay. Without that capability the only way to measure a draft would be to mutate the shared operational
// page — exactly the exposure this tool must avoid — so refuse rather than fall back to an unsafe write.
async function assertIsolationAvailable() {
  let health;
  try { health = await api("GET", "/health"); } catch { health = null; }
  if (!health?.sitesOverlay) {
    console.error("[learn-measure] the connected service does not advertise the per-session sites overlay (health.sitesOverlay), so the operational page cannot be isolated during measurement. Start a service that supports it (see tools/patch-daemon.py sitesDir forwarding). Refusing to expose an unapproved draft on the operational page.");
    process.exit(4);
  }
}

acquireLock();
let adopted = false;
try {
  await assertIsolationAvailable();
  mkdirSync(evalSites, { recursive: true });
  const hadOp = existsSync(opPage); // the current approved procedure, if any

  // current procedure (adoption bar) — measured from a copy in the isolated eval store; opPage is untouched
  let cur = null;
  if (hadOp) { copyFileSync(opPage, evalPage); console.log(`== ${opt.domain}: current procedure, ${opt.model}/${opt.thinking}, runs=${opt.runs}`); cur = await series("current", evalSites); }
  // draft candidate
  copyFileSync(draft, evalPage); console.log(`== ${opt.domain}: draft candidate`); const draftRows = await series("draft", evalSites);
  // no page at all — memory's own effect; the bar only when there is no current procedure
  rmIfExists(evalPage); console.log(`== ${opt.domain}: no page (diagnostic${hadOp ? "" : " + bar"})`); const nop = await series("no-page", evalSites);

  const barName = hadOp ? "current" : "no-page";
  const barRows = hadOp ? cur : nop;
  const bar = medOf(barRows), dr = medOf(draftRows), np = medOf(nop);
  const goalOk = draftRows.every((r) => r.verdict === "succeeded"); // unknown/failed never promote
  const dTools = dr.tools - bar.tools, dErrors = dr.errors - bar.errors, dSecs = dr.secs - bar.secs;
  const errorsOk = dErrors <= 0;
  const cheaper = dTools < 0 || (dTools === 0 && dErrors < 0) || (dTools === 0 && dErrors === 0 && dSecs < 0);
  adopted = goalOk && errorsOk && cheaper;
  const draftVerdicts = draftRows.map((r) => r.verdict).join("/");
  const reason = !goalOk ? `goal not reached in all runs (${draftVerdicts})` : !errorsOk ? "errors worse" : !cheaper ? `not cheaper than ${barName}` : "";

  const ts = new Date().toISOString().slice(0, 16);
  const verdict = `${ts} ${opt.domain} ${opt.model}/${opt.thinking} [bar=${barName}]: tools ${bar.tools.toFixed(1)} → ${dr.tools.toFixed(1)}, errors ${bar.errors.toFixed(1)} → ${dr.errors.toFixed(1)}, secs ${bar.secs.toFixed(0)} → ${dr.secs.toFixed(0)}${hadOp ? `, no-page ${np.tools.toFixed(1)}` : ""}, goal ${draftVerdicts} ⇒ ${adopted ? "ADOPTED" : `REJECTED (${reason})`}`;
  appendFileSync(path.join(KNOWLEDGE_DIR, "lessons", "measurements.log"), verdict + "\n");
  console.log(verdict);
  if (!opt.goal) console.log("[learn-measure] note: no --goal given, so every run is 'unknown' and nothing can be promoted. Pass --goal with an observable success marker to enable adoption.");
} catch (err) {
  console.error(`[learn-measure] aborted: ${err.message}`);
  process.exitCode = 1;
} finally {
  // The operational page was never mutated during measurement, so rejection needs no restore and a crash
  // cannot leave it inconsistent (no backup, no recovery journal to mishandle). On approval, publish the
  // draft atomically (temp+rename) and consume it; on rejection, leave opPage as-is and keep the draft.
  try {
    if (adopted) { atomicPublish(draft, opPage); rmIfExists(draft); }
  } finally {
    rmSync(evalDir, { recursive: true, force: true });
    releaseLock();
  }
}
