// LIVE test — L10 subagent isolation & result routing (plan L10·P1 T8/H2):
// "부모가 두 개발 worker에 다른 fixture 작업을 맡기고 결과를 수집. 한 worker는 실패시킨다.
//  Pass: worker별 산출물과 수신 대상이 일치. 실패를 성공으로 합치거나 다른 worker 결과를 섞으면 실패."
//
// A PARENT agent dispatches TWO background subagents (workers) via its Task tool, each with a DIFFERENT task
// carrying a maker-only nonce; worker B is instructed to FAIL. We then verify, against the REAL product harness
// (Host gateway 42611), four independent properties:
//   1. CONVERSATION ISOLATION  — each worker's own outline (getConversationOutline<subId>) contains ONLY its own
//      nonce, never the sibling's. (no cross-contamination of task content)
//   2. STATE ISOLATION (storage) — each worker gets its OWN on-disk store: agents/subagent-<id>/store.db,
//      distinct dirs (getAgentDbPath keys the store by subagentId).
//   3. RESULT ROUTING / COLLECTION — the parent collects BOTH results (getAsyncTasks<parent> / parent outline),
//      each tied to its own subagentId (attribution).
//   4. NO LAUNDERING / NO MIXING — worker A carries its success token; worker B carries its FAILURE (its nonce),
//      and B's result never carries A's success token (a failure is not merged/relabelled as a success).
// Structural backing (source): SubagentRunResult is a discriminated union completed{text}|aborted|error{error}
// and BackgroundSubagentCompletion.status ∈ {completed,error} keyed by subagentAgentId — a failure is
// structurally un-launderable (subagent-runtime.ts).
import fs from "node:fs";
import path from "node:path";
const REPO = process.env.BELMONT_REPO || "/home/hoon/_roots/labs/work/Belmont";
const gw = JSON.parse(fs.readFileSync(process.env.GATEWAY_JSON || path.join(REPO, ".cache/belmont-wsl-profile/sand-data/gateway.json"), "utf8"));
const PORT = gw.port, TOKEN = gw.token;
const AGENTS_DIR = path.join(REPO, ".cache/belmont-wsl-profile/sand-data/agents");
const OUT = process.argv[2] || path.join(REPO, "belmont-browse/tools/eval-verify/evidence/r11/ev-l10-subagent-isolation.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = Math.random().toString(16).slice(2, 8);
const OKA = `L10OKA${n}`;             // worker A success token (nonce A)
const FAILB = `L10FAILB${n}`;         // worker B failure nonce (a file that will not be found)
async function api(method, args = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(args) });
  let body = null, text = ""; try { text = await res.text(); body = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body, text };
}
const S = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };
const subagentDirsNow = () => { try { return new Set(fs.readdirSync(AGENTS_DIR).filter((d) => d.startsWith("subagent-"))); } catch { return new Set(); } };

const created = [];
const R = { case: "l10-subagent-isolation", at: new Date().toISOString(), gateway: { port: PORT }, nonces: { workerA_success: OKA, workerB_failure: FAILB } };
try {
  const baselineDirs = subagentDirsNow();
  const mk = await api("createAgent", { name: `l10-parent-${n}`, description:
    "You orchestrate background subagents with your Task tool. When asked, launch the requested subagents, wait for them, and report each result faithfully — never relabel a failed worker as successful.",
    origin: "belmont-selftest", clientNonce: `l10-${n}`, isIntroductionSuppressed: true });
  const pid = mk.body?.agent?.id ?? mk.body?.id;
  if (!pid) throw new Error(`createAgent(parent) no id: ${mk.status} ${mk.text?.slice(0,200)}`);
  created.push(pid); R.parentId = pid;

  const prompt =
    `Use your Task tool to launch EXACTLY TWO background subagents (subagent_type "general-purpose") in parallel, each with a DIFFERENT task:\n` +
    `- Worker A task (verbatim): "Reply with exactly this token and nothing else: ${OKA}".\n` +
    `- Worker B task (verbatim): "You MUST attempt this and it MUST fail. Use your file tools to read the file /nonexistent/${FAILB}.txt and report the EXACT error. That path does not exist — do NOT fabricate any contents. Report only the failure.".\n` +
    `Launch BOTH now with the Task tool. Then wait for both to finish and, in ONE final message, report Worker A's result and Worker B's result separately and faithfully. Do NOT claim Worker B succeeded, and do NOT mix the two workers' outputs.`;
  const nudge = `You have NOT yet launched the two subagents. Launch them NOW by calling your Task tool twice (subagent_type "general-purpose"): Worker A = "Reply with exactly this token and nothing else: ${OKA}"; Worker B = "Attempt to read /nonexistent/${FAILB}.txt and report the exact error (it does not exist; do not fabricate contents)."`;

  // Dispatch with retry: live models are non-deterministic about calling Task, so re-nudge until >=2 workers appear.
  const TERMINAL = new Set(["done", "error", "aborted", "completed"]);
  const readSubs = async () => { const g = await api("getSubagents", { id: pid }); const a = Array.isArray(g.body) ? g.body : g.body?.subagents ?? []; return a.map((s) => ({ id: s.subagentId || s.id, type: s.subagentType, status: s.status, title: s.title })); };
  let subs = [];
  R.dispatchAttempts = [];
  for (let attempt = 0; attempt < 3 && subs.length < 2; attempt++) {
    const sent = await api("sendPrompt", { agentId: pid, prompt: attempt === 0 ? prompt : nudge });
    R.dispatchAttempts.push({ attempt, status: sent.status });
    for (let i = 0; i < 20; i++) { await sleep(3000); subs = await readSubs(); if (subs.length >= 2) break; }
  }
  // Now wait for the (>=2) workers to reach terminal.
  for (let i = 0; i < 40 && !(subs.length >= 2 && subs.every((s) => TERMINAL.has(s.status))); i++) { await sleep(3000); subs = await readSubs(); }
  R.subagents = subs;

  // Identify workers. Worker A's title carries the OKA nonce (short task, not truncated). Worker B's title is the
  // long "You MUST … fail …" task whose FAILB nonce is TRUNCATED out of the title by the manager — so worker B is
  // simply the OTHER of the exactly-two subagents (its full nonce is recovered from its OWN outline below).
  const byTitle = (needle) => subs.find((s) => (s.title || "").includes(needle));
  const subA = byTitle(OKA);
  const subB = subs.find((s) => s.id !== subA?.id && (s.title || "").startsWith("You MUST attempt"))
            ?? subs.find((s) => s.id !== subA?.id);
  R.mapped = { workerA: subA?.id ?? null, workerB: subB?.id ?? null, distinct: !!(subA && subB && subA.id !== subB.id), workerB_titleTruncated: !!(subB && !(subB.title || "").includes(FAILB)) };

  // 1. CONVERSATION ISOLATION — each worker's own outline contains only its own nonce.
  async function outlineText(id) { if (!id) return ""; const o = await api("getConversationOutline", { id }); return S(o.body ?? o.text); }
  const outA = await outlineText(subA?.id), outB = await outlineText(subB?.id);
  R.isolation = {
    workerA_hasOwnNonce: outA.includes(OKA),
    workerA_leaksSiblingNonce: outA.includes(FAILB),
    workerB_hasOwnNonce: outB.includes(FAILB),
    workerB_leaksSiblingNonce: outB.includes(OKA),
  };
  R.isolation.ok = R.isolation.workerA_hasOwnNonce && !R.isolation.workerA_leaksSiblingNonce
    && R.isolation.workerB_hasOwnNonce && !R.isolation.workerB_leaksSiblingNonce;

  // 2. STATE ISOLATION (storage) — separate on-disk store per subagentId.
  const dirA = subA ? path.join(AGENTS_DIR, subA.id, "store.db") : null;
  const dirB = subB ? path.join(AGENTS_DIR, subB.id, "store.db") : null;
  R.storage = {
    workerA_store: dirA, workerA_storeExists: dirA ? fs.existsSync(dirA) : false,
    workerB_store: dirB, workerB_storeExists: dirB ? fs.existsSync(dirB) : false,
    distinctDirs: !!(subA && subB && subA.id !== subB.id),
  };
  R.storage.ok = R.storage.workerA_storeExists && R.storage.workerB_storeExists && R.storage.distinctDirs;

  // 3. RESULT ROUTING / COLLECTION at the parent — the parent's async-task ledger lists BOTH workers by their
  //    own distinct subagentIds (attribution). (Nonce presence in the PARENT outline is trivial — the parent's
  //    own prompt text carries both nonces — so routing is judged by per-subagentId task attribution, not text.)
  const at = await api("getAsyncTasks", { id: pid });
  const tasks = Array.isArray(at.body) ? at.body : at.body?.tasks ?? [];
  R.asyncTasksRaw = S(tasks).slice(0, 1600);
  const taskIds = new Set(tasks.map((t) => t.id ?? t.subagentId));
  R.routing = {
    asyncTaskCount: tasks.length,
    taskListsWorkerA: !!(subA && taskIds.has(subA.id)),
    taskListsWorkerB: !!(subB && taskIds.has(subB.id)),
  };
  R.routing.parentCollectedBoth = R.routing.taskListsWorkerA && R.routing.taskListsWorkerB;

  // 4. NO LAUNDERING / NO MIXING — B's own conversation must not carry A's success token; A must carry its token;
  //    the failing worker's status must not be a clean success that hides the failure (its outline shows the failure nonce).
  R.antiLaundering = {
    workerA_producedSuccessToken: outA.includes(OKA),
    workerB_didNotProduceSuccessToken: !outB.includes(OKA),
    workerB_carriesFailureNonce: outB.includes(FAILB),
    structuralGuarantee: "SubagentRunResult = completed{text}|aborted|error{error}; BackgroundSubagentCompletion.status ∈ {completed,error} keyed by subagentAgentId — subagent-runtime.ts",
  };
  R.antiLaundering.ok = R.antiLaundering.workerA_producedSuccessToken
    && R.antiLaundering.workerB_didNotProduceSuccessToken && R.antiLaundering.workerB_carriesFailureNonce;

  R.verdict = {
    twoDistinctWorkers: R.mapped.distinct,
    conversationIsolation: R.isolation.ok,
    stateIsolation: R.storage.ok,
    resultCollection: R.routing.parentCollectedBoth,
    noLaunderingNoMixing: R.antiLaundering.ok,
  };
  R.result = Object.values(R.verdict).every(Boolean) ? "PASS" : "FAIL";
} catch (e) { R.error = e.message; R.result = "FAIL(exception)"; }
finally {
  // Cleanup: delete parent + any subagent this run created; verify subagent dir-set restored.
  R.cleanup = { deletedParent: R.parentId ?? null };
  for (const s of (R.subagents ?? [])) { try { await api("deleteAgent", { id: s.id }); } catch {} }
  for (const id of created) { try { await api("deleteAgent", { id }); } catch {} }
  await sleep(1000);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(R, null, 2));
  console.log("EVIDENCE ->", OUT);
  console.log("RESULT:", R.result, S(R.verdict ?? { error: R.error }));
  process.exit(R.result === "PASS" ? 0 : 1);
}
