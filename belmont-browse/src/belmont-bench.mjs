// belmont-browse: send the same task to a Belmont agent through the gateway and time it (our code).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SAND = path.join(ROOT, ".cache/belmont-wsl-profile/sand-data");
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    task: { type: "string" },
    agent: { type: "string", default: "40fb61e3-7d7c-470d-8735-7b94090ff515" },
    "quiet-seconds": { type: "string", default: "30" },
    "timeout-minutes": { type: "string", default: "25" },
    "no-send": { type: "boolean", default: false }, // attach to a prompt already sent (matched by task text)
  },
});
const task = opt.task ?? positionals.join(" ");
if (!task) { console.error("usage: node src/belmont-bench.mjs --task \"...\""); process.exit(2); }
const gw = JSON.parse(readFileSync(path.join(SAND, "gateway.json"), "utf8"));
const api = async (m, body) => {
  const res = await fetch(`http://127.0.0.1:${gw.port}/api/${m}`, { method: "POST", headers: { authorization: `Bearer ${gw.token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${m} -> ${res.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
};
const log = (...a) => console.error(...a);
let t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const short = (v, n = 160) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + "…" : s ?? ""; };

function blobCounts() {
  const db = new DatabaseSync(path.join(SAND, "agents", opt.agent, "conversation-blobs.db"), { readOnly: true });
  const row = db.prepare("select count(*) as n, sum(length(data)) as bytes, sum(case when data like '{\"role\":\"assistant\"%' then 1 else 0 end) as assistant, sum(case when data like '{\"role\":\"tool\"%' then 1 else 0 end) as tool from blobs").get();
  db.close();
  return row;
}
const before = blobCounts();
const boxBefore = await api("getForeverBoxStatus", { agentId: opt.agent });
log(`[belmont] agent=${opt.agent} box=${boxBefore.state} blobs=${before.n} assistant=${before.assistant}`);
const baseline = await api("getAgentTranscriptTail", { id: opt.agent, limit: 60 });
const seen = new Set();
if (opt["no-send"]) {
  const sent = (baseline.entries ?? []).filter((e) => e.kind === "message" && e.role === "user" && e.content === task).at(-1);
  if (!sent) throw new Error("no earlier user message matching the task text");
  t0 = sent.timestampMs;
  log(`[belmont] attached to prompt sent at ${new Date(t0).toISOString()}`);
} else {
  for (const e of baseline.entries ?? []) seen.add(e.id);
  await api("sendPrompt", { agentId: opt.agent, prompt: task, clientNonce: crypto.randomUUID() });
  log(`[belmont] prompt sent ${stamp()}`);
}

const stats = { approvals: 0, permissions: 0, widgets: 0, assistantTexts: 0, approvalWaitMs: 0, boxStates: [] };
let lastNewAt = Date.now(), lastBox = boxBefore.state, lastKind = "";
const quietMs = Number(opt["quiet-seconds"]) * 1000, deadline = t0 + Number(opt["timeout-minutes"]) * 60_000;
const resolved = new Set();
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const box = await api("getForeverBoxStatus", { agentId: opt.agent }).catch(() => null);
  if (box && box.state !== lastBox) { stats.boxStates.push(`${stamp()} ${lastBox}->${box.state}`); log(`[box ${stamp()}] ${lastBox} -> ${box.state}`); lastBox = box.state; lastNewAt = Date.now(); }
  const tail = await api("getAgentTranscriptTail", { id: opt.agent, limit: 40 }).catch(() => null);
  for (const e of tail?.entries ?? []) {
    const m = e.message ?? {};
    if (typeof e.timestampMs === "number" && e.timestampMs < t0 - 5000) continue; // ignore entries from before this run
    if (m.type === "auto-review-approval" && m.approval?.status === "pending" && !resolved.has(m.approval.requestId)) {
      resolved.add(m.approval.requestId);
      const tAsk = Date.now();
      await api("resolveAutoReviewApproval", { requestId: m.approval.requestId, resolution: "approved", agentId: opt.agent, entryId: e.id }).catch((err) => log(`[approval] failed: ${err.message}`));
      stats.approvals += 1; stats.approvalWaitMs += Date.now() - tAsk;
      log(`[approval ${stamp()}] approved: ${short(m.approval.summary ?? m.approval.reason, 120)}`);
      lastNewAt = Date.now();
    }
    if (m.type === "local-tool-permission" && m.ask?.status === "pending" && !resolved.has(m.ask.requestId)) {
      resolved.add(m.ask.requestId);
      await api("resolveLocalToolPermission", { agentId: opt.agent, entryId: e.id, requestId: m.ask.requestId, resolution: "allow-once" }).catch((err) => log(`[permission] failed: ${err.message}`));
      stats.permissions += 1;
      log(`[permission ${stamp()}] allowed: ${m.ask.action} ${short(m.ask.target, 80)}`);
      lastNewAt = Date.now();
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    lastNewAt = Date.now();
    lastKind = `${e.kind}:${m.type ?? e.role ?? ""}`;
    if (m.type === "text") { stats.assistantTexts += 1; log(`[text ${stamp()}] ${short(m.content, 200)}`); }
    else if (m.type === "widget") { stats.widgets += 1; log(`[widget ${stamp()}] ${short(m, 200)}`); }
    else if (e.kind !== "message") log(`[${lastKind} ${stamp()}] ${short(m, 120)}`);
  }
  const pendingCards = (tail?.entries ?? []).some((e) => e.timestampMs >= t0 - 5000 && ((e.message?.approval?.status === "pending") || (e.message?.ask?.status === "pending")));
  if (!pendingCards && lastKind === "send-message:text" && Date.now() - lastNewAt > quietMs && lastBox !== "booting" && lastBox !== "starting") break;
}
const after = blobCounts();
const deltaAssistant = after.assistant - before.assistant, deltaBytes = after.bytes - before.bytes;
log(`\n==== belmont benchmark summary ====`);
log(`elapsed ${stamp()} (quiet wait ${opt["quiet-seconds"]}s included) | assistant texts ${stats.assistantTexts} | approvals ${stats.approvals} | permissions ${stats.permissions} | widgets ${stats.widgets}`);
log(`model calls (assistant blobs) ${deltaAssistant} | tool blobs ${after.tool - before.tool} | new conversation bytes ${deltaBytes} (~${Math.round(deltaBytes / 4)} tokens of new content)`);
log(`box: ${stats.boxStates.join(" | ") || "no state change (" + lastBox + ")"}`);
