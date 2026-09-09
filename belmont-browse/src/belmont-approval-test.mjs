// belmont-browse: drive Belmont through a delegated task that needs approval, answering the question card like a user (our code).
import { readFileSync } from "node:fs";
import path from "node:path";
const SAND = path.resolve(import.meta.dirname, "../../.cache/belmont-wsl-profile/sand-data");
const gw = JSON.parse(readFileSync(path.join(SAND, "gateway.json"), "utf8"));
const agent = process.argv[2]; const task = process.argv[3]; const answer = process.argv[4] ?? "허용합니다";
const api = async (m, body) => { const r = await fetch(`http://127.0.0.1:${gw.port}/api/${m}`, { method: "POST", headers: { authorization: `Bearer ${gw.token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(20_000) }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${r.status} ${t.slice(0, 200)}`); try { return JSON.parse(t); } catch { return t; } };
const t0 = Date.now(); const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(0)}s`;
const seen = new Set((await api("getAgentTranscriptTail", { id: agent, limit: 40 })).entries.map((e) => e.id));
await api("sendPrompt", { agentId: agent, prompt: task, clientNonce: crypto.randomUUID() });
console.log(`${stamp()} prompt sent`);
let answered = false, lastNew = Date.now(), lastText = null;
while (Date.now() - t0 < 8 * 60_000) {
  await new Promise((r) => setTimeout(r, 2000));
  const tail = await api("getAgentTranscriptTail", { id: agent, limit: 40 });
  for (const e of tail.entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id); lastNew = Date.now();
    const m = e.message ?? {};
    if (m.type === "widget") {
      const w = typeof m.widget === "string" ? m.widget : JSON.stringify(m.widget ?? m);
      console.log(`${stamp()} [widget] ${w.slice(0, 160)}`);
      if (!answered) { await api("respondToWidget", { entryId: e.id, value: answer, agentId: agent }); answered = true; console.log(`${stamp()} [user] answered widget: ${answer}`); }
    } else if (m.type === "text") { lastText = m.content; console.log(`${stamp()} [text] ${String(m.content).slice(0, 200)}`); }
    else if (e.kind !== "message") console.log(`${stamp()} [${e.kind}:${m.type}] ${JSON.stringify(m).slice(0, 120)}`);
  }
  if (lastText && Date.now() - lastNew > 45_000) break;
}
console.log(`${stamp()} done; final: ${String(lastText).slice(0, 300)}`);
