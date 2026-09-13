// L10 phase-based orchestrator — each phase is a SHORT invocation so the harness never reaps it for running long
// while the gateway (which actually runs the worker turns) survives. State persists in a JSON file between phases.
// Phases: create | poll | verify | cleanup    Usage: node l10-phase.mjs <phase> <stateFile>
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/hoon/_roots/labs/work/Belmont";
const gw = JSON.parse(fs.readFileSync(path.join(REPO, ".cache/belmont-wsl-profile/sand-data/gateway.json"), "utf8"));
const PORT = gw.port, TOKEN = gw.token;
const AGENTS_DIR = path.join(REPO, ".cache/belmont-wsl-profile/sand-data/agents");
const OUT = path.join(REPO, "belmont-browse/tools/eval-verify/evidence/r11/ev-l10-subagent-isolation.json");
const phase = process.argv[2];
const STATE = process.argv[3] || "/tmp/l10-state.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };
async function api(method, args = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(args) });
  let body = null, text = ""; try { text = await res.text(); body = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body, text };
}
const loadState = () => JSON.parse(fs.readFileSync(STATE, "utf8"));
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const readSubs = async (pid) => { const g = await api("getSubagents", { id: pid }); const a = Array.isArray(g.body) ? g.body : g.body?.subagents ?? []; return a.map((s) => ({ id: s.subagentId || s.id, type: s.subagentType, status: s.status, title: s.title })); };

if (phase === "create") {
  const n = Math.random().toString(16).slice(2, 8);
  const OKA = `L10OKA${n}`, FAILB = `L10FAILB${n}`;
  const mk = await api("createAgent", { name: `l10-parent-${n}`, description:
    "You orchestrate background subagents with your Task tool. Launch the requested subagents, wait, and report each result faithfully — never relabel a failed worker as successful.",
    origin: "belmont-selftest", clientNonce: `l10-${n}`, isIntroductionSuppressed: true });
  const pid = mk.body?.agent?.id ?? mk.body?.id;
  if (!pid) { console.log("NO PARENT", mk.status, mk.text?.slice(0, 200)); process.exit(1); }
  // Sequential dispatch to keep peak memory to ONE worker turn at a time (isolation is unaffected by ordering).
  const prompt =
    `Use your Task tool to launch two background subagents (subagent_type "general-purpose"), ONE AT A TIME:\n` +
    `First launch Worker A with task (verbatim): "Reply with exactly this token and nothing else: ${OKA}". Wait for A to finish.\n` +
    `Then launch Worker B with task (verbatim): "Attempt to read the file /nonexistent/${FAILB}.txt and report the EXACT error. That path does not exist — do NOT fabricate contents; report only the failure.". Wait for B to finish.\n` +
    `Finally, in ONE message, report Worker A's result and Worker B's result separately and faithfully. Do NOT claim Worker B succeeded and do NOT mix the two outputs.`;
  const sent = await api("sendPrompt", { agentId: pid, prompt });
  saveState({ n, OKA, FAILB, pid, createStatus: mk.status, sendStatus: sent.status, at: new Date().toISOString() });
  console.log("CREATED parent", pid, "send", sent.status, "nonces", OKA, FAILB);
}

else if (phase === "poll") {
  const st = loadState();
  const TERMINAL = new Set(["done", "error", "aborted", "completed"]);
  let subs = await readSubs(st.pid);
  // If no workers yet, nudge once.
  if (subs.length < 1) {
    await api("sendPrompt", { agentId: st.pid, prompt: `You have NOT launched the subagents yet. Do it NOW with your Task tool: Worker A = "Reply with exactly this token and nothing else: ${st.OKA}"; then Worker B = "Attempt to read /nonexistent/${st.FAILB}.txt and report the exact error (it does not exist; do not fabricate)."` });
  }
  // Short poll window (~90s) per invocation.
  for (let i = 0; i < 30; i++) {
    subs = await readSubs(st.pid);
    const done = subs.length >= 2 && subs.every((s) => TERMINAL.has(s.status));
    if (done) break;
    await sleep(3000);
  }
  st.subs = subs;
  saveState(st);
  console.log("POLL:", S(subs.map((s) => ({ id: s.id.slice(0, 22), status: s.status, t: (s.title || "").slice(0, 30) }))));
  const allDone = subs.length >= 2 && subs.every((s) => TERMINAL.has(s.status));
  console.log(allDone ? "ALL-TERMINAL" : "NOT-DONE-YET");
}

else if (phase === "verify") {
  const st = loadState();
  const { OKA, FAILB, pid } = st;
  const subs = await readSubs(pid);
  const R = { case: "l10-subagent-isolation", at: new Date().toISOString(), gateway: { port: PORT }, parentId: pid,
    nonces: { workerA_success: OKA, workerB_failure: FAILB }, dispatch: { createStatus: st.createStatus, sendStatus: st.sendStatus, mode: "sequential (peak = 1 worker turn)" }, subagents: subs };
  const byTitle = (needle) => subs.find((s) => (s.title || "").includes(needle));
  const subA = byTitle(OKA);
  const subB = subs.find((s) => s.id !== subA?.id && (s.title || "").startsWith("Attempt to read"))
            ?? subs.find((s) => s.id !== subA?.id);
  R.mapped = { workerA: subA?.id ?? null, workerB: subB?.id ?? null, distinct: !!(subA && subB && subA.id !== subB.id), workerB_titleTruncated: !!(subB && !(subB.title || "").includes(FAILB)) };
  const outlineText = async (id) => { if (!id) return ""; const o = await api("getConversationOutline", { id }); return S(o.body ?? o.text); };
  const outA = await outlineText(subA?.id), outB = await outlineText(subB?.id);
  R.rawOutlineA = outA.slice(0, 900); R.rawOutlineB = outB.slice(0, 900);
  R.isolation = { workerA_hasOwnNonce: outA.includes(OKA), workerA_leaksSiblingNonce: outA.includes(FAILB),
                  workerB_hasOwnNonce: outB.includes(FAILB), workerB_leaksSiblingNonce: outB.includes(OKA) };
  R.isolation.ok = R.isolation.workerA_hasOwnNonce && !R.isolation.workerA_leaksSiblingNonce && R.isolation.workerB_hasOwnNonce && !R.isolation.workerB_leaksSiblingNonce;
  const storeA = subA ? path.join(AGENTS_DIR, subA.id, "store.db") : null, storeB = subB ? path.join(AGENTS_DIR, subB.id, "store.db") : null;
  R.storage = { workerA_store: storeA, workerA_storeExists: storeA ? fs.existsSync(storeA) : false,
                workerB_store: storeB, workerB_storeExists: storeB ? fs.existsSync(storeB) : false, distinctDirs: R.mapped.distinct };
  R.storage.ok = R.storage.workerA_storeExists && R.storage.workerB_storeExists && R.storage.distinctDirs;
  const at = await api("getAsyncTasks", { id: pid });
  const tasks = Array.isArray(at.body) ? at.body : at.body?.tasks ?? [];
  R.asyncTasksRaw = S(tasks).slice(0, 1600);
  const taskIds = new Set(tasks.map((t) => t.id ?? t.subagentId));
  R.routing = { asyncTaskCount: tasks.length, taskListsWorkerA: !!(subA && taskIds.has(subA.id)), taskListsWorkerB: !!(subB && taskIds.has(subB.id)) };
  R.routing.parentCollectedBoth = R.routing.taskListsWorkerA && R.routing.taskListsWorkerB;
  R.antiLaundering = { workerA_producedSuccessToken: outA.includes(OKA), workerB_didNotProduceSuccessToken: !outB.includes(OKA), workerB_carriesFailureNonce: outB.includes(FAILB),
    structuralGuarantee: "SubagentRunResult = completed{text}|aborted|error{error}; BackgroundSubagentCompletion.status ∈ {completed,error} keyed by subagentAgentId — subagent-runtime.ts" };
  R.antiLaundering.ok = R.antiLaundering.workerA_producedSuccessToken && R.antiLaundering.workerB_didNotProduceSuccessToken && R.antiLaundering.workerB_carriesFailureNonce;
  R.verdict = { twoDistinctWorkers: R.mapped.distinct, conversationIsolation: R.isolation.ok, stateIsolation: R.storage.ok, resultCollection: R.routing.parentCollectedBoth, noLaunderingNoMixing: R.antiLaundering.ok };
  R.result = Object.values(R.verdict).every(Boolean) ? "PASS" : "FAIL";
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(R, null, 2));
  st.result = R.result; st.verdict = R.verdict; saveState(st);
  console.log("EVIDENCE ->", OUT);
  console.log("RESULT:", R.result, S(R.verdict));
}

else if (phase === "cleanup") {
  const st = loadState();
  const subs = st.subs ?? await readSubs(st.pid);
  for (const s of subs) { try { await api("deleteAgent", { id: s.id }); } catch {} }
  try { await api("deleteAgent", { id: st.pid }); } catch {}
  await sleep(800);
  const roster = await api("listAgents");
  const list = Array.isArray(roster.body) ? roster.body : roster.body?.agents ?? [];
  const leftover = list.filter((a) => /l10-parent-/.test(a.name || "")).map((a) => a.id);
  console.log("CLEANUP done. deletedParent", st.pid, "leftoverL10", leftover);
}

else { console.log("unknown phase", phase); process.exit(2); }
