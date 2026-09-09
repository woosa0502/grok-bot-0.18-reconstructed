// belmont-browse: learning loop, step 3 — promote a draft page only if it measurably cuts the worker's steps (our code).
//   node src/learn-measure.mjs --domain github.com --task "..." [--model gpt-5.6-luna --thinking max --runs 2]
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, appendFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { KNOWLEDGE_DIR } from "./session.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { values: opt } = parseArgs({ options: { domain: { type: "string" }, task: { type: "string" }, model: { type: "string", default: "gpt-5.6-luna" }, thinking: { type: "string", default: "max" }, runs: { type: "string", default: "2" } } });
if (!opt.domain || !opt.task) { console.error("usage: --domain <d> --task <t>"); process.exit(2); }
const draft = path.join(KNOWLEDGE_DIR, "drafts", `${opt.domain}.md`), page = path.join(KNOWLEDGE_DIR, "sites", `${opt.domain}.md`), backup = `${page}.bak`;
if (!existsSync(draft)) { console.error(`no draft: ${draft}`); process.exit(2); }
const state = JSON.parse(readFileSync(path.join(ROOT, ".state", "serve.json"), "utf8"));
const api = async (m, p, body) => { const r = await fetch(`http://127.0.0.1:${state.port}${p}`, { method: m, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return r.json(); };

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
async function series(label) { const rows = []; for (let i = 0; i < Number(opt.runs); i += 1) { const r = await runOnce(); rows.push(r); console.log(`  [${label} #${i + 1}] ${r.status} tools=${r.toolCalls} model=${r.modelCalls} errors=${r.errors} ${r.secs}s`); } return rows; }

// A/B: without the page (hide any existing one), then with the draft promoted.
const hadPage = existsSync(page);
if (hadPage) renameSync(page, backup);
console.log(`== ${opt.domain}: baseline (no page), ${opt.model}/${opt.thinking}, runs=${opt.runs}`);
const base = await series("baseline");
copyFileSync(draft, page);
console.log(`== ${opt.domain}: with draft page`);
const withPage = await series("draft");
const d = { tools: avg(withPage, "toolCalls") - avg(base, "toolCalls"), errors: avg(withPage, "errors") - avg(base, "errors"), secs: avg(withPage, "secs") - avg(base, "secs") };
const keep = withPage.every((r) => r.status === "done") && (d.tools < 0 || (d.tools === 0 && d.errors < 0));
if (keep) { unlinkSync(draft); if (hadPage) unlinkSync(backup); }
else { unlinkSync(page); if (hadPage) renameSync(backup, page); }
const verdict = `${new Date().toISOString().slice(0, 16)} ${opt.domain} ${opt.model}/${opt.thinking}: tools ${avg(base, "toolCalls").toFixed(1)} → ${avg(withPage, "toolCalls").toFixed(1)}, errors ${avg(base, "errors").toFixed(1)} → ${avg(withPage, "errors").toFixed(1)}, secs ${avg(base, "secs").toFixed(0)} → ${avg(withPage, "secs").toFixed(0)} ⇒ ${keep ? "ADOPTED" : "REJECTED"}`;
appendFileSync(path.join(KNOWLEDGE_DIR, "lessons", "measurements.log"), verdict + "\n");
console.log(verdict);
