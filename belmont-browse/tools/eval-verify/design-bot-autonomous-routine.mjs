// LIVE test — a BOT AUTONOMOUSLY creates a ROUTINE (automation) via its updateState tool (the harness never
// calls the createAgentAutomation gateway API). GPT/P1-2-style causal proof: createRoutine is a model-facing
// capability — updateState with target=routine, action=create (source/host/runner/tools/sand-state-tool.ts;
// registered in turn-toolset.ts:1378). We delegate to a maker agent; a routine carrying a maker-only nonce name
// appearing in that agent's automations can only be the maker executing its updateState tool. Cleanup deletes
// the routine + the maker and verifies the automation set and the roster ID-set are restored (readable rosters).
import fs from "node:fs";
import path from "node:path";
const REPO = process.env.BELMONT_REPO || process.cwd();
const gw = JSON.parse(fs.readFileSync(process.env.GATEWAY_JSON || path.join(REPO, ".cache/belmont-wsl-profile/sand-data/gateway.json"), "utf8"));
const PORT = gw.port, TOKEN = gw.token || gw.authToken || null;
const SP = process.argv[2] || "/tmp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = Math.random().toString(16).slice(2, 8);
const log = (...a) => console.log(...a);
async function api(method, args = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(args) });
  let body = null, text = ""; try { text = await res.text(); body = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body, text };
}
async function rosterRead() {
  const r = await api("listAgents");
  if (!r.ok || r.status !== 200) return { readable: false, list: [] };
  const list = Array.isArray(r.body) ? r.body : Array.isArray(r.body?.agents) ? r.body.agents : null;
  return list === null ? { readable: false, list: [] } : { readable: true, list };
}
async function automations(agentId) {
  const r = await api("getAgentAutomations", { id: agentId });
  const l = Array.isArray(r.body) ? r.body : Array.isArray(r.body?.automations) ? r.body.automations : [];
  return { ok: r.ok && r.status === 200, list: l };
}
const routineName = `belmont-selftest-routine-${n}`;
const created = { agents: [], routines: [] };
const R = { case: "bot-autonomous-routine", at: new Date().toISOString(), gateway: { port: PORT, auth: !!TOKEN } };
let baselineIds = new Set(), baselineReadable = false;
try {
  const base = await rosterRead(); baselineReadable = base.readable; baselineIds = new Set(base.list.map((a) => a.id));
  R.baseline = { count: baselineIds.size, readable: baselineReadable };

  const mk = await api("createAgent", { name: `belmont-selftest-rmaker-${n}`, description:
    `You manage your own routines. When asked, use your updateState tool (target: routine, action: create) to create ONE routine, then stop.`,
    origin: "belmont-selftest", clientNonce: `rmaker-${n}`, isIntroductionSuppressed: true });
  const makerId = mk.body?.agent?.id ?? mk.body?.id;
  if (!makerId) throw new Error(`createAgent(maker) no id: ${mk.status} ${mk.text?.slice(0,200)}`);
  created.agents.push(makerId);
  R.maker = { id: makerId };
  const before = await automations(makerId);
  R.automationsBefore = before.list.length;

  const prompt = `Create a scheduled routine now by calling your updateState tool with target "routine" and action "create": name it exactly "${routineName}", give it a daily schedule, and a prompt like "post a one-line status". Create it exactly once, then say done.`;
  let routineId = null, routineRow = null, prompts = 0, makerSaidDone = false, entryKinds = null;
  outer: for (let attempt = 0; attempt < 3 && !routineId; attempt++) {
    const sent = await api("sendPrompt", { agentId: makerId, prompt }); prompts++;
    R.sendPrompt = { status: sent.status, attempts: prompts };
    for (let i = 0; i < 22; i++) {
      const a = await automations(makerId);
      const hit = a.list.find((x) => JSON.stringify(x).includes(routineName));
      if (hit) { routineId = hit.id ?? hit.automationId ?? hit.routineId ?? null; routineRow = hit; if (routineId && !created.routines.includes(routineId)) created.routines.push(routineId); }
      const t = await api("getAgentTranscript", { id: makerId });
      const entries = Array.isArray(t.body) ? t.body : t.body?.entries ?? [];
      entryKinds = entries.map((e) => String(e?.kind ?? e?.type ?? "?"));
      makerSaidDone = entries.some((e) => e?.kind === "send-message" && /done/i.test(JSON.stringify(e?.message ?? e)));
      if (routineId) break outer;
      await sleep(3000);
    }
  }
  R.autonomous = {
    createRoutineIsModelTool: "updateState(target=routine,action=create) — sand-state-tool.ts + turn-toolset.ts:1378",
    harnessNeverCalledCreateAutomationApi: true,      // by construction: only sendPrompt; no createAgentAutomation call
    routineNameNonceKnownOnlyToMaker: true,
    routineInAutomations: !!routineId,
    routineId,
    autonomousRoutineCreated: !!routineId,            // routine with maker-only nonce name exists -> maker's tool made it
    makerSaidDone, promptsNeeded: prompts, entryKinds,
    routineRow: routineRow ? JSON.stringify(routineRow).slice(0, 500) : null,
  };
  log("autonomous routine:", JSON.stringify({ routineId, created: !!routineId, prompts }));
} catch (e) { R.error = e.message; log("ERROR:", e.message); }
finally {
  R.cleanup = { requestedRoutines: [...created.routines], requestedAgents: [...created.agents] };
  for (const rid of created.routines) { try { await api("deleteAgentAutomation", { id: R.maker?.id, automationId: rid }); } catch {} }
  try { if (created.agents.length) await api("deleteAgents", { ids: created.agents }); } catch (e) { R.cleanup.deleteError = e.message; }
  await sleep(1200);
  const now = await rosterRead();
  const leftover = now.list.filter((a) => (a.name ?? "").includes("selftest") && (a.name ?? "").includes(n));
  for (const a of leftover) { try { await api("deleteAgent", { id: a.id }); } catch {} }
  await sleep(800);
  const finalRead = await rosterRead();
  const finalIds = new Set(finalRead.list.map((a) => a.id));
  const addedNotRemoved = [...finalIds].filter((id) => !baselineIds.has(id));
  const removedFromBaseline = [...baselineIds].filter((id) => !finalIds.has(id));
  const leftoverTestNamed = finalRead.list.filter((a) => (a.name ?? "").includes("selftest") && (a.name ?? "").includes(n)).map((a) => ({ id: a.id, name: a.name }));
  R.cleanup.rostersReadable = baselineReadable && finalRead.readable;
  R.cleanup.addedNotRemoved = addedNotRemoved;
  R.cleanup.removedFromBaseline = removedFromBaseline;
  R.cleanup.leftoverTestNamed = leftoverTestNamed;
  R.cleanup.idSetRestored = R.cleanup.rostersReadable && addedNotRemoved.length === 0 && removedFromBaseline.length === 0 && leftoverTestNamed.length === 0;
  R.verdict_pass = !!(R.autonomous?.autonomousRoutineCreated && R.cleanup.idSetRestored);
  fs.writeFileSync(path.join(SP, "ev-bot-autonomous-routine.json"), JSON.stringify(R, null, 2));
  log("EVIDENCE -> ev-bot-autonomous-routine.json");
  log("VERDICT:", JSON.stringify({ routineCreated: R.autonomous?.autonomousRoutineCreated, idSetRestored: R.cleanup?.idSetRestored, pass: R.verdict_pass }));
  process.exit(R.verdict_pass ? 0 : 1);
}
