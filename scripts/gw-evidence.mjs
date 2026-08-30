// Evidence dumper: I (Claude) act as the user. Inject each case, wait for the
// turn to finish, then dump the REAL evidence — the agent's SendMessage replies
// (its actual user-facing answer, where RESULT= lives) plus every other tool
// call it made (Task/Shell/Read/Write/...). I read this and judge PASS/FAIL myself.
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";

const QUEUE = "/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-wsl-test-queue.jsonl";
const EVID = "/tmp/sweep-evidence.jsonl";   // rich evidence for my judgement
const VERD = "/tmp/sweep-verdicts.jsonl";   // my final verdicts (written by me, separately)
const PORT = Number(process.env.GW_PORT || 37513);
const CASE_TIMEOUT_MS = Number(process.env.CASE_TIMEOUT_MS || 150000);
const ROTATE_EVERY = Number(process.env.ROTATE_EVERY || 90); // fresh agent every N cases: avoids context-window overflow
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ONLY = (process.env.ROUTES || "AGENT_REACHABLE,GATED").split(",");
const LIMIT = Number(process.env.SWEEP_LIMIT || 12);

async function api(method, body) {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/api/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })).json(); } catch { return null; }
}
async function health() { try { return await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(); } catch { return null; } }
async function send(prompt) { const r = await api("sendPrompt", { prompt }); return r?.accepted === true; }

const h0 = await health();
if (!h0) { console.log("gateway down"); process.exit(1); }
let AID = h0.activeAgentId;
let TR = `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/agent-transcripts/${AID}/${AID}.jsonl`;
const lines = () => { try { return readFileSync(TR, "utf8").split("\n"); } catch { return []; } };

// Rotate to a fresh agent so no single conversation grows past the model context window.
// The previous sweep agent's evidence is already saved per-case, so we delete it to stay
// under the 50-agent limit.
async function rotateAgent() {
  const prev = AID;
  const created = await api("createAgent", { name: `sweep-${Date.now()}` });
  const nid = created?.agent?.id;
  if (!nid) { console.log("[rotate] createAgent failed, staying on", prev); return; }
  await api("openAgent", { id: nid });
  AID = nid;
  TR = `/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile/sand-data/agent-transcripts/${AID}/${AID}.jsonl`;
  if (prev && prev !== nid) await api("deleteAgents", { ids: [prev] });
  console.log(`[rotate] -> fresh agent ${nid.slice(0, 12)} (deleted ${String(prev).slice(0, 12)})`);
  await sleep(1500);
}

// Extract the agent's real reply channel: SendMessage contents + the tools it invoked.
// Marker-based (find the last user message carrying this case id) so it survives
// transcript compaction, which rewrites the file shorter and invalidates line indices.
function evidenceSince(id) {
  const all = lines();
  let start = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(all[i]); } catch { continue; }
    if ((o.role ?? o.message?.role) !== "user") continue;
    const c = o.message?.content ?? o.content;
    const text = Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p.text || "")).join(" ") : (typeof c === "string" ? c : "");
    if (text.includes(id)) { start = i; break; }
  }
  if (start < 0) return { msgs: [], tools: [], texts: [], noMarker: true };
  const msgs = [], tools = [], texts = [];
  for (const line of all.slice(start + 1)) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const role = o.role ?? o.message?.role;
    if (role !== "assistant") continue;
    const c = o.message?.content ?? o.content;
    if (!Array.isArray(c)) continue;
    for (const p of c) {
      if (!p || typeof p !== "object") continue;
      if (p.type === "tool_use") {
        const inp = p.input || p.args || {};
        if (p.name === "SendMessage") {
          const t = inp.content ?? inp.text;
          if (t) msgs.push(String(t));
          else msgs.push(`[SendMessage type=${inp.type ?? "?"} ${JSON.stringify(inp).slice(0, 200)}]`);
        } else {
          tools.push(`${p.name}(${JSON.stringify(inp).slice(0, 240)})`);
        }
      } else if (p.type === "text" && typeof p.text === "string" && p.text.trim().length > 45) {
        texts.push(p.text.trim());
      }
    }
  }
  return { msgs, tools, texts };
}

async function waitIdle(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { await sleep(1500); const h = await health(); if (h && !h.isBusy) return true; }
  return false;
}

const cases = readFileSync(QUEUE, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
// already-judged (by me) or already-evidenced
const seen = new Set();
for (const f of [VERD, EVID]) if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { try { seen.add(JSON.parse(l).caseId); } catch {} }
let todo = cases.filter((c) => ONLY.includes(c.route) && !seen.has(c.testCaseId));
const ORD = { AGENT_REACHABLE: 0, GATED: 1, USER_REACHABLE: 2 };
todo.sort((a, b) => (ORD[a.route] ?? 3) - (ORD[b.route] ?? 3));
todo = todo.slice(0, LIMIT);
console.log(`[evid] agent=${AID} routes=${ONLY} todo=${todo.length} (already ${seen.size})`);

let i = 0;
for (const cs of todo) {
  i++;
  if (i > 1 && i % ROTATE_EVERY === 1) await rotateAgent();
  const id = cs.testCaseId;
  const prompt = `[${id}] Please actually verify this capability right now using your tools, then report what happened concretely: ${cs.expectedBehavior}\n\nIf it genuinely requires clicking the desktop UI (which you cannot operate), say so. End your message with a final line: RESULT=PASS, RESULT=FAIL, or RESULT=UIONLY.`;
  await waitIdle(20000);
  const before = lines().length;
  const ok = await send(prompt);
  if (!ok) { appendFileSync(EVID, JSON.stringify({ caseId: id, area: cs.area, route: cs.route, expected: cs.expectedBehavior, error: "SEND_FAIL" }) + "\n"); continue; }
  await sleep(3000);
  const idle = await waitIdle(CASE_TIMEOUT_MS);
  const ev = evidenceSince(id);
  const rec = { caseId: id, area: cs.area, route: cs.route, expected: cs.expectedBehavior, msgs: ev.msgs, tools: ev.tools, texts: ev.texts, timedOut: !idle, ...(ev.noMarker ? { noMarker: true } : {}) };
  appendFileSync(EVID, JSON.stringify(rec) + "\n");
  console.log(`[evid] ${i}/${todo.length} ${id} msgs=${ev.msgs.length} tools=${ev.tools.length}${idle ? "" : " TIMEOUT"}`);
}
console.log(`[evid] DONE -> ${EVID}`);
