// belmont-browse: learning loop, step 3 — promote a draft page only if it measurably beats the CURRENT
// approved procedure (not merely "better than no page") and actually reaches the task goal (our code).
//   node src/learn-measure.mjs --domain github.com --task "..." [--model gpt-5.6-luna --thinking max --runs 2]
//
// Adoption rule (see docs/memory-2.1 handoff): the bar is the current approved procedure. The draft is
// adopted only when every draft run reaches the goal, its error count is no worse than the bar, and it is
// strictly cheaper than the bar. "No page at all" is kept as a separate diagnostic (memory's own effect),
// and is used as the bar only when there is no current procedure to beat. The live page is never left in an
// inconsistent state: measurement mutations are crash-safe (backup + recovery journal + single-writer lock)
// and the live page is restored on every exit; it becomes the draft only after the draft is approved.
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, appendFileSync, writeFileSync, openSync, closeSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { KNOWLEDGE_DIR } from "./session.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(ROOT, ".state");
const { values: opt } = parseArgs({ options: { domain: { type: "string" }, task: { type: "string" }, model: { type: "string", default: "gpt-5.6-luna" }, thinking: { type: "string", default: "max" }, runs: { type: "string", default: "2" } } });
if (!opt.domain || !opt.task) { console.error("usage: --domain <d> --task <t>"); process.exit(2); }
const draft = path.join(KNOWLEDGE_DIR, "drafts", `${opt.domain}.md`), page = path.join(KNOWLEDGE_DIR, "sites", `${opt.domain}.md`), backup = `${page}.bak`;
const lockPath = path.join(STATE_DIR, "learn-measure.lock");
const recoveryPath = path.join(STATE_DIR, `learn-measure.recovery.${opt.domain}.json`);
if (!existsSync(draft)) { console.error(`no draft: ${draft}`); process.exit(2); }
const state = JSON.parse(readFileSync(path.join(STATE_DIR, "serve.json"), "utf8"));
const api = async (m, p, body) => { const r = await fetch(`http://127.0.0.1:${state.port}${p}`, { method: m, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return r.json(); };

// A terminal "done" status is NOT proof the task goal was reached — the worker can stop and report that it
// could not finish. There is no structured success flag in the session view, so we gate on the final result
// text and reject any run that admits it did not complete. Conservative by design: we would rather not adopt
// a maybe-good draft than adopt one that only *looked* done.
const GOAL_FAILURE = [/unable to/i, /could\s?n'?t/i, /can\s?not\b/i, /can'?t\b/i, /failed to/i, /was ?n'?t able/i, /not able to/i, /gave up/i, /하지\s*못했/, /완료(하지|할 수 없|에 실패)/, /실패(했|함|하였|으로)/, /불가능/, /찾지\s*못/];
const reachedGoal = (r) => r.status === "done" && (r.result ?? "").trim() !== "" && !GOAL_FAILURE.some((re) => re.test(r.result));

async function runOnce() {
  const t0 = Date.now();
  const created = await api("POST", "/sessions", { task: opt.task, model: opt.model, thinking: opt.thinking, mode: "guard", autoApprove: true });
  let view;
  for (let i = 0; i < 240; i += 1) { await new Promise((r) => setTimeout(r, 2000)); view = await api("GET", `/sessions/${created.id}`); if (["done", "error", "stopped"].includes(view.status)) break; }
  const errors = (view.activity ?? []).filter((l) => /\bERROR\b/.test(l)).length;
  return { status: view.status, toolCalls: view.toolCalls, modelCalls: view.modelCalls, errors, secs: Math.round((Date.now() - t0) / 1000), result: (view.result ?? "").slice(0, 100) };
}
// Median, not mean: one runaway run must not decide adoption.
const avg = (rows, k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const medOf = (rows) => ({ tools: avg(rows, "toolCalls"), errors: avg(rows, "errors"), secs: avg(rows, "secs") });
async function series(label) { const rows = []; for (let i = 0; i < Number(opt.runs); i += 1) { const r = await runOnce(); rows.push(r); console.log(`  [${label} #${i + 1}] ${r.status} tools=${r.toolCalls} model=${r.modelCalls} errors=${r.errors} ${r.secs}s goal=${reachedGoal(r) ? "yes" : "no"}`); } return rows; }

// ---- crash-safe live-page handling -------------------------------------------------------------------
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const fd = openSync(lockPath, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), domain: opt.domain })); closeSync(fd); return; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let info; try { info = JSON.parse(readFileSync(lockPath, "utf8")); } catch { info = null; }
      const stale = !info || !(info.pid && isAlive(info.pid)) || (Date.now() - (info.at || 0) > 60 * 60 * 1000);
      if (stale) { try { unlinkSync(lockPath); } catch {} continue; }
      console.error(`[learn-measure] another run holds the lock (pid ${info.pid}); refusing concurrent measurement`); process.exit(3);
    }
  }
  console.error("[learn-measure] could not acquire lock"); process.exit(3);
}
const releaseLock = () => { try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch {} };
const writePage = (srcFile) => { const tmp = `${page}.tmp`; copyFileSync(srcFile, tmp); renameSync(tmp, page); }; // atomic replace
const rmIfExists = (p) => { if (existsSync(p)) unlinkSync(p); };
// An earlier run killed mid-measurement may have left the live page holding the draft, or removed. The
// champion sits in the backup; restore the live page to its pre-run state before this run reads it.
function crashRecover() {
  if (!existsSync(recoveryPath)) return;
  let j; try { j = JSON.parse(readFileSync(recoveryPath, "utf8")); } catch { j = null; }
  if (j && j.page === page) {
    if (j.hadPage) { if (existsSync(backup)) writePage(backup); }
    else rmIfExists(page);
    console.error(`[learn-measure] restored the live page after an interrupted run of ${j.domain}`);
  }
  rmIfExists(backup);
  rmIfExists(recoveryPath);
}

acquireLock();
crashRecover();
const hadPage = existsSync(page); // the current approved procedure, if any
if (hadPage) copyFileSync(page, backup);
writeFileSync(recoveryPath, JSON.stringify({ domain: opt.domain, page, backup, hadPage, at: Date.now() }));

let adopted = false;
try {
  // Measure the CURRENT approved procedure first (the adoption bar), while the live page still holds it.
  let cur = null;
  if (hadPage) { console.log(`== ${opt.domain}: current procedure, ${opt.model}/${opt.thinking}, runs=${opt.runs}`); cur = await series("current"); }
  // Measure the draft candidate.
  writePage(draft);
  console.log(`== ${opt.domain}: draft candidate`);
  const draftRows = await series("draft");
  // Memory's own effect: with no page at all. Separate diagnostic; the bar only when there is no current procedure.
  rmIfExists(page);
  console.log(`== ${opt.domain}: no page (diagnostic${hadPage ? "" : " + bar"})`);
  const nop = await series("no-page");

  const barName = hadPage ? "current" : "no-page";
  const barRows = hadPage ? cur : nop;
  const bar = medOf(barRows), dr = medOf(draftRows), np = medOf(nop);
  const goalOk = draftRows.every(reachedGoal);
  const dTools = dr.tools - bar.tools, dErrors = dr.errors - bar.errors, dSecs = dr.secs - bar.secs;
  const errorsOk = dErrors <= 0;
  const cheaper = dTools < 0 || (dTools === 0 && dErrors < 0) || (dTools === 0 && dErrors === 0 && dSecs < 0);
  adopted = goalOk && errorsOk && cheaper;
  const reason = !goalOk ? "goal not reached in all runs" : !errorsOk ? "errors worse" : !cheaper ? `not cheaper than ${barName}` : "";

  const ts = new Date().toISOString().slice(0, 16);
  const verdict = `${ts} ${opt.domain} ${opt.model}/${opt.thinking} [bar=${barName}]: tools ${bar.tools.toFixed(1)} → ${dr.tools.toFixed(1)}, errors ${bar.errors.toFixed(1)} → ${dr.errors.toFixed(1)}, secs ${bar.secs.toFixed(0)} → ${dr.secs.toFixed(0)}${hadPage ? `, no-page ${np.tools.toFixed(1)}` : ""} ⇒ ${adopted ? "ADOPTED" : `REJECTED (${reason})`}`;
  appendFileSync(path.join(KNOWLEDGE_DIR, "lessons", "measurements.log"), verdict + "\n");
  console.log(verdict);
} catch (err) {
  console.error(`[learn-measure] aborted: ${err.message}`);
  process.exitCode = 1;
} finally {
  // Deterministic live-page state on every exit path.
  try {
    if (adopted) { writePage(draft); rmIfExists(backup); rmIfExists(draft); } // commit: live page := approved draft, draft consumed
    else if (hadPage) { writePage(backup); rmIfExists(backup); }             // restore the champion; keep the draft for revision
    else rmIfExists(page);                                                   // no champion existed; drop the trial page, keep the draft
  } finally {
    rmIfExists(recoveryPath);
    releaseLock();
  }
}
