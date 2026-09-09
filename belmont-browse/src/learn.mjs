// belmont-browse: the learning loop, step 1 — mine recent Aside sessions for failures/detours and draft
// knowledge pages (site playbooks, lessons) with a strong model, into the Belmont knowledge store (our code).
//   node src/learn.mjs --since 24h [--domain naver.com] [--draft]   # --draft asks gpt-5.5 for page drafts
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { KNOWLEDGE_DIR, ENGINES } from "./session.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { values: opt } = parseArgs({ options: { since: { type: "string", default: "24h" }, after: { type: "string" }, domain: { type: "string" }, engine: { type: "string", default: "902" }, draft: { type: "boolean", default: false }, "max-sessions": { type: "string", default: "40" } } });
// --since: relative window; --after <ISO time>: hard floor so sessions that predate a fix never count as evidence.
const sinceMs = Math.max(Date.now() - (/^(\d+)h$/.exec(opt.since) ? Number(RegExp.$1) * 3600e3 : /^(\d+)d$/.exec(opt.since) ? Number(RegExp.$1) * 86400e3 : 86400e3), opt.after ? Date.parse(opt.after) : 0);
const sessionsDir = path.join(ROOT, ".state", ENGINES[opt.engine].home, "u", "0", "sessions");

const ERROR_KINDS = [
  [/RefStaleError/i, "stale-ref"], [/Timed out waiting for navigation/i, "nav-timeout"], [/Selector "[^"]*" not found|Role selector not found/i, "selector-guess"],
  [/Invalid parameters/i, "cdp-params"], [/Checkbox click did not change/i, "click-verify"], [/is not defined|is not a function/i, "bad-api"], [/ENOENT|escapes the (session|workspace)/i, "path"],
];
// A host folds into the shortest suffix that already has a sites/ page (search.naver.com → naver.com);
// otherwise it keeps its own name, so console.cloud.google.com stays distinct from google.com.
const domainOf = (url) => {
  let host; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  const labels = host.split(".");
  for (let i = labels.length - 2; i > 0; i -= 1) { const suffix = labels.slice(i).join("."); if (existsSync(path.join(KNOWLEDGE_DIR, "sites", `${suffix}.md`))) return suffix; }
  return host;
};

function readSession(dir) {
  const file = path.join(dir, "messages.jsonl");
  if (!existsSync(file)) return null;
  const msgs = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const stat = { id: path.basename(dir), task: "", domains: new Set(), urls: new Set(), errors: [], toolCalls: 0, modelCalls: 0, lastTs: 0 };
  for (const m of msgs) {
    stat.lastTs = Math.max(stat.lastTs, m.timestamp ?? 0);
    if (m.role === "user" && !stat.task) stat.task = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(" ").slice(0, 200);
    if (m.role === "assistant") { stat.modelCalls += 1; for (const c of m.content ?? []) if (c.type === "toolCall") { stat.toolCalls += 1; const code = JSON.stringify(c.arguments ?? c.args ?? ""); for (const u of code.match(/https?:\/\/[^\s"'\\)]+/g) ?? []) { stat.urls.add(u); const d = domainOf(u); if (d) stat.domains.add(d); } } }
    if (m.role === "toolResult") { const text = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n"); if (/^Error|ERROR|Error:/m.test(text)) { const kind = ERROR_KINDS.find(([re]) => re.test(text))?.[1] ?? "other"; stat.errors.push({ kind, text: text.split("\n")[0].slice(0, 160) }); } }
  }
  return stat.lastTs >= sinceMs ? stat : null;
}

const sessions = existsSync(sessionsDir) ? readdirSync(sessionsDir).map((d) => readSession(path.join(sessionsDir, d))).filter(Boolean).sort((a, b) => b.lastTs - a.lastTs).slice(0, Number(opt["max-sessions"])) : [];
const byDomain = new Map();
for (const s of sessions) for (const d of s.domains) { if (opt.domain && d !== opt.domain) continue; const e = byDomain.get(d) ?? { sessions: 0, toolCalls: 0, errors: [], urls: new Set(), tasks: [] }; e.sessions += 1; e.toolCalls += s.toolCalls; e.errors.push(...s.errors); for (const u of s.urls) if (domainOf(u) === d) e.urls.add(u); e.tasks.push(s.task); byDomain.set(d, e); }

console.log(`sessions since ${opt.since}: ${sessions.length}; domains: ${byDomain.size}`);
const report = [];
for (const [domain, e] of [...byDomain].sort((a, b) => b[1].sessions - a[1].sessions)) {
  const kinds = {}; for (const err of e.errors) kinds[err.kind] = (kinds[err.kind] ?? 0) + 1;
  const hasPage = existsSync(path.join(KNOWLEDGE_DIR, "sites", `${domain}.md`));
  const line = `${domain}: ${e.sessions} sessions, ${e.toolCalls} tool calls (${(e.toolCalls / e.sessions).toFixed(1)}/session), errors ${e.errors.length} ${JSON.stringify(kinds)}, page ${hasPage ? "exists" : "MISSING"}`;
  console.log("  " + line); report.push({ domain, ...e, urls: [...e.urls].slice(0, 12), kinds, hasPage });
}
mkdirSync(path.join(KNOWLEDGE_DIR, "lessons"), { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const lessonFile = path.join(KNOWLEDGE_DIR, "lessons", opt.domain ? `${day}-mined-${opt.domain}.md` : `${day}-mined.md`); // a filtered run must not overwrite the daily sweep
writeFileSync(lessonFile, [`# Mined from ${sessions.length} sessions (${opt.since})`, "", ...report.map((r) => `## ${r.domain}\n- sessions ${r.sessions}, tool calls/session ${(r.toolCalls / r.sessions).toFixed(1)}, errors ${JSON.stringify(r.kinds)}, page ${r.hasPage ? "exists" : "missing"}\n- urls: ${r.urls.join(", ")}\n- errors:\n${r.errors.slice(0, 8).map((x) => `  - [${x.kind}] ${x.text}`).join("\n") || "  - none"}`)].join("\n") + "\n");
console.log(`lesson written: ${lessonFile}`);

if (opt.draft) {
  // Ask the engine (strong model, no browsing needed) to draft/refresh a site page from the evidence.
  const state = JSON.parse(readFileSync(path.join(ROOT, ".state", "serve.json"), "utf8"));
  const api = async (m, p, body) => { const r = await fetch(`http://127.0.0.1:${state.port}${p}`, { method: m, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return r.json(); };
  for (const r of report.filter((x) => (!x.hasPage || x.errors.length > 0) && x.domain !== "example.com")) {
    const existing = r.hasPage ? readFileSync(path.join(KNOWLEDGE_DIR, "sites", `${r.domain}.md`), "utf8") : "";
    const task = [`You are maintaining the Belmont knowledge store for the site ${r.domain}. Do NOT open a browser. Using only the evidence below, ${r.hasPage ? "revise the existing page" : "write a new page"} in the exact format of the example (frontmatter title/slug/aliases/updated, '## Current' with direct URLs and a step procedure and quirks, '## History'). Keep it under 60 lines. Output ONLY the markdown file content, nothing else.`,
      "", `Tasks seen: ${r.tasks.slice(0, 5).join(" | ")}`, `URLs that worked: ${r.urls.join(", ")}`, `Errors (kind: first line): ${r.errors.slice(0, 10).map((x) => `${x.kind}: ${x.text}`).join(" || ")}`, "", existing ? `Existing page:\n${existing}` : `Example page:\n${readFileSync(path.join(KNOWLEDGE_DIR, "sites", "naver.com.md"), "utf8")}`].join("\n");
    const created = await api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "read-only" });
    let view; for (let i = 0; i < 90; i += 1) { await new Promise((res) => setTimeout(res, 2000)); view = await api("GET", `/sessions/${created.id}`); if (["done", "error", "suspended"].includes(view.status)) break; }
    if (view?.status !== "done" || !view.result) { console.log(`  draft for ${r.domain}: ${view?.status} ${view?.error ?? ""}`); continue; }
    const md = view.result.replace(/^```(?:markdown|md)?\n?/m, "").replace(/\n?```\s*$/m, "").trim() + "\n";
    mkdirSync(path.join(KNOWLEDGE_DIR, "drafts"), { recursive: true });
    const out = path.join(KNOWLEDGE_DIR, "drafts", `${r.domain}.md`);
    writeFileSync(out, md);
    console.log(`  draft written: ${out} (${md.split("\n").length} lines)`);
  }
}
