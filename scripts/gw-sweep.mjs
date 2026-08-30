import { readFileSync, appendFileSync, existsSync } from "node:fs";

const QUEUE = "/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-wsl-test-queue.jsonl";
const RESULTS = "/tmp/sweep-results.jsonl";
const PORT = 36731;
const CASE_TIMEOUT_MS = 100000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(); } catch { return null; }
}
async function send(prompt) {
  try {
    const r = await (await fetch(`http://127.0.0.1:${PORT}/api/sendPrompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) })).json();
    return r.accepted === true;
  } catch { return false; }
}

const h0 = await health();
if (!h0) { console.log("gateway down"); process.exit(1); }
const AID = h0.activeAgentId;
const TR = `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/agent-transcripts/${AID}/${AID}.jsonl`;
const lines = () => { try { return readFileSync(TR, "utf8").split("\n"); } catch { return []; } };

// Assistant text from the transcript lines added AFTER `fromIdx` (i.e. the response to our prompt).
function assistantTextSince(fromIdx) {
  const out = [];
  for (const line of lines().slice(fromIdx)) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const role = o.role ?? o.message?.role ?? o.type;
    if (role !== "assistant") continue;
    const c = o.message?.content ?? o.content;
    if (Array.isArray(c)) out.push(c.map((p) => (typeof p === "string" ? p : p.text || "")).join(" "));
    else if (typeof c === "string") out.push(c);
  }
  return out.join(" — ").trim();
}

const cases = readFileSync(QUEUE, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const done = new Set();
if (existsSync(RESULTS)) for (const l of readFileSync(RESULTS, "utf8").split("\n").filter(Boolean)) { try { done.add(JSON.parse(l).caseId); } catch {} }
let todo = cases.filter((c) => !done.has(c.testCaseId));
const ORD = { AGENT_REACHABLE: 0, GATED: 1, USER_REACHABLE: 2 };
todo.sort((a, b) => (ORD[a.route] ?? 3) - (ORD[b.route] ?? 3));
const LIMIT = Number(process.env.SWEEP_LIMIT || 0); if (LIMIT > 0) todo = todo.slice(0, LIMIT);
console.log(`[gw-sweep] agent=${AID} total=${cases.length} done=${done.size} todo=${todo.length}`);

async function waitIdle(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { await sleep(2000); const h = await health(); if (h && !h.isBusy) return true; }
  return false;
}

let i = 0;
for (const cs of todo) {
  i++;
  const id = cs.testCaseId;
  const prompt = `[TEST ${id}] Verify this behavior: ${cs.expectedBehavior}\n\nIf it is an agent tool behavior, ACTUALLY do it now with your tools. If it can only be done by clicking the desktop app UI you cannot operate, treat it as UIONLY. Then end your ENTIRE reply with a final line that is EXACTLY one of these, nothing else on that line: RESULT=PASS or RESULT=FAIL or RESULT=UIONLY`;
  await waitIdle(30000); // ensure prior turn finished
  const before = lines().length;
  const ok = await send(prompt);
  if (!ok) { appendFileSync(RESULTS, JSON.stringify({ caseId: id, area: cs.area, route: cs.route, verdict: "SEND_FAIL" }) + "\n"); continue; }
  await sleep(3500); // let the turn start (isBusy -> true)
  const idle = await waitIdle(CASE_TIMEOUT_MS);
  if (!idle) { appendFileSync(RESULTS, JSON.stringify({ caseId: id, area: cs.area, route: cs.route, verdict: "TIMEOUT" }) + "\n"); continue; }
  await sleep(600);
  const body = assistantTextSince(before);
  const m=[...body.matchAll(/RESULT=(PASS|FAIL|UIONLY)/g)].pop(); const verdict = m ? (m[1]==="UIONLY"?"UI_ONLY":m[1]) : (/\bUIONLY\b|cannot operate|no such|not available|missing .*tool/i.test(body)?"UNCLEAR":(body?"UNCLEAR":"NO_ASSISTANT"));
  appendFileSync(RESULTS, JSON.stringify({ caseId: id, area: cs.area, route: cs.route, verdict, snippet: body.slice(0, 220) }) + "\n");
  if (i % 5 === 0) console.log(`[gw-sweep] ${i}/${todo.length} last=${id} ${verdict}`);
}
console.log(`[gw-sweep] COMPLETE results=${RESULTS}`);
