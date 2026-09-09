// Watch a bot's transcript for new entries without sending a prompt (for automation/routine runs).
// usage: node watch.mjs <agentId> [--quiet=30] [--max=600] [--out=file] [--answer=allow]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const SAND = path.resolve(import.meta.dirname, "../../../../.cache/belmont-wsl-profile/sand-data");
const gw = JSON.parse(readFileSync(path.join(SAND, "gateway.json"), "utf8"));
const args = process.argv.slice(2); const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [agent] = args.filter((a) => !a.startsWith("--")); const quietMs = Number(opt.quiet ?? 30) * 1000; const maxMs = Number(opt.max ?? 600) * 1000; const answer = opt.answer ?? "allow";
const api = async (m, body) => { const r = await fetch(`http://127.0.0.1:${gw.port}/api/${m}`, { method: "POST", headers: { authorization: `Bearer ${gw.token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${m}: ${r.status} ${await r.text()}`); return r.json(); };
const t0 = Date.now(); const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(0)}s`;
const seen = new Set((await api("getAgentTranscriptTail", { id: agent, limit: 60 })).entries.map((e) => e.id));
if (opt.run) { await api("runAgentAutomationNow", { id: agent, automationId: opt.run }); console.log(`${stamp()} automation ${opt.run} triggered`); }
const log = []; const say = (l) => { console.log(l); log.push(l); }; let lastNew = Date.now(), lastText = null, texts = 0, widgets = 0;
while (Date.now() - t0 < maxMs) {
  await new Promise((r) => setTimeout(r, 2000));
  const tail = await api("getAgentTranscriptTail", { id: agent, limit: 60 });
  for (const e of tail.entries) {
    if (seen.has(e.id)) continue; seen.add(e.id); lastNew = Date.now(); const m = e.message ?? {};
    if (m.type === "widget") { widgets += 1; const options = Array.isArray(m.widget?.options) ? m.widget.options : []; say(`${stamp()} [widget] ${JSON.stringify(m.widget).slice(0, 200)}`); const value = options.find((o) => o.value === answer || o.label === answer)?.value ?? options[0]?.value ?? answer; await api("respondToWidget", { entryId: e.id, value, agentId: agent }); say(`${stamp()} [user] answered: ${value}`); }
    else if (m.type === "text") { texts += 1; lastText = m.content; say(`${stamp()} [text] ${String(m.content).replace(/\n/g, " ⏎ ").slice(0, 400)}`); }
    else say(`${stamp()} [${e.kind}:${m.type ?? ""}] ${JSON.stringify(m).slice(0, 160)}`);
  }
  const health = await fetch(`http://127.0.0.1:${gw.port}/health`).then((r) => r.json()).catch(() => ({}));
  if (lastText && Date.now() - lastNew > quietMs && !health.isBusy) break;
}
say(`${stamp()} done texts=${texts} widgets=${widgets}`);
if (opt.out) writeFileSync(opt.out, JSON.stringify({ agent, elapsedSec: Math.round((Date.now() - t0) / 1000), texts, widgets, final: lastText, log }, null, 2));
