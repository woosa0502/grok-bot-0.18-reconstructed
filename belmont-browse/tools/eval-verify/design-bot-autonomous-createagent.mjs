// LIVE test — a BOT creates another bot when DELEGATED (the harness never calls the createAgent gateway API for
// the child). GPT's P1-2, claim NARROWED (round-2): this proves delegated-creation SUCCESS as strong INDIRECT
// causal evidence, NOT an exclusive tool-call proof. The product exposes createAgent as a model-facing turn tool
// (source/host/runner/tools/sand-agent-management-tools.ts:92,202; registered in turn-toolset.ts:1367), wrapped
// by defineCommunicateTool — so its trace is a `communicateUpdateToolCall` (args.currentStep
// {"__sand_tool__":true,"tool":"CreateAgent",...}; communicate-tool.ts:19-31,124-165, agent-messaging.ts:7), NOT
// a literal `createAgentToolCall`. That wrapper frame is not exposed by the gateway transcript RPCs, so it is not
// captured here (see R.delegatedCreation.literalToolCallFrameCaptured=false).
//
// Flow: create a MAKER agent -> sendPrompt telling it to create a child (name carries a maker-only nonce) via its
// createAgent tool -> the child appears in the roster (only the maker could have made it) -> delete maker+child ->
// assert the roster ID-set equals the pre-test baseline, from GENUINELY-READABLE rosters (not an HTTP-error []).
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
    method: "POST", headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(args) });
  let body = null, text = ""; try { text = await res.text(); body = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body, text };
}
// rosterRead distinguishes a REAL read from an HTTP error/unparseable body (which must NOT collapse to []),
// so an unreadable baseline/final can never masquerade as "id-set restored" (whole-project review #3).
async function rosterRead() {
  const r = await api("listAgents");
  if (!r.ok || !Number.isInteger(r.status) || r.status !== 200) return { readable: false, list: [] };
  const list = Array.isArray(r.body) ? r.body : Array.isArray(r.body?.agents) ? r.body.agents : null;
  if (list === null) return { readable: false, list: [] };
  return { readable: true, list };
}
const roster = async () => (await rosterRead()).list;
const rosterIds = async () => new Set((await roster()).map((a) => a.id));
// (Note: a transcript scanner for the createAgent frame was removed — the gateway transcript RPCs return a
// redacted display view (message/send-message) that omits the communicateUpdateToolCall wrapper frame, so it is
// not recoverable here. The claim is limited to delegated-creation success; see R.delegatedCreation.)

const created = [];
const R = { case: "bot-autonomous-createAgent", at: new Date().toISOString(), gateway: { port: PORT, auth: !!TOKEN } };
let baselineIds = new Set(), baselineReadable = false;
try {
  const base = await rosterRead(); baselineReadable = base.readable; baselineIds = new Set(base.list.map((a) => a.id));
  R.baseline = { count: baselineIds.size, readable: baselineReadable };
  log("baseline roster ids:", baselineIds.size, "readable:", baselineReadable);

  // MAKER agent
  const childName = `belmont-selftest-child-${n}`;
  const mk = await api("createAgent", { name: `belmont-selftest-maker-${n}`, description:
    `You create other agents on request. When asked, call your createAgent tool exactly once to create an agent named "${childName}" with a one-line description, then stop. Do not create any other agents.`,
    origin: "belmont-selftest", clientNonce: `maker-${n}`, isIntroductionSuppressed: true });
  const makerId = mk.body?.agent?.id ?? mk.body?.id;
  if (!makerId) throw new Error(`createAgent(maker) no id: ${mk.status} ${mk.text?.slice(0,200)}`);
  created.push(makerId);
  R.maker = { id: makerId };
  log("maker:", makerId);

  // DELEGATED CREATION (strong INDIRECT causal evidence, not an exclusive tool-call proof): createAgent is a
  // model-facing tool (source: sand-agent-management-tools.ts), this harness NEVER calls the createAgent API for
  // `childName`, and `childName` carries a nonce known ONLY to the maker (via its prompt). So in this controlled
  // run a roster agent with that exact name appearing after delegating to the maker is strong evidence the maker
  // created it. The raw createAgent wrapper frame (a communicateUpdateToolCall; see R.delegatedCreation) is not
  // exposed by the gateway transcript RPCs, so the claim is limited to delegated-creation success.
  let childId = null, childRow = null, makerSaidDone = false, transcriptShape = null, entryKinds = null, prompts = 0;
  const prompt = `Create a new agent named "${childName}" by calling your createAgent tool now. Give it the description "belmont selftest child (autonomous)". Call the tool exactly once, then say done.`;
  outer: for (let attempt = 0; attempt < 3 && !childId; attempt++) {
    const sent = await api("sendPrompt", { agentId: makerId, prompt }); prompts++;
    R.sendPrompt = { status: sent.status, accepted: sent.body?.accepted ?? sent.ok, attempts: prompts };
    log(`sendPrompt#${prompts} -> maker:`, sent.status);
    for (let i = 0; i < 22; i++) {
      const list = await roster();
      const child = list.find((a) => (a.name ?? "") === childName);
      if (child) { childId = child.id; childRow = child; if (!created.includes(childId)) created.push(childId); }
      const t = await api("getAgentTranscript", { id: makerId });
      const entries = Array.isArray(t.body) ? t.body : t.body?.entries ?? t.body?.messages ?? t.body?.transcript ?? [];
      if (!transcriptShape && t.body) transcriptShape = Array.isArray(t.body) ? "array" : Object.keys(t.body).slice(0, 8);
      entryKinds = entries.map((e) => String(e?.kind ?? e?.type ?? (e?.role ? `role:${e.role}` : "?")));
      makerSaidDone = entries.some((e) => (e?.kind === "send-message") && /done/i.test(JSON.stringify(e?.message ?? e)));
      if (childId) break outer;
      await sleep(3000);
    }
  }
  R.delegatedCreation = {
    // CLAIM (narrowed per whole-project review): a bot given only a natural-language request performs a
    // successful CREATION when delegated — strong INDIRECT causal evidence, not an exclusive tool-call proof.
    createAgentIsModelTool: "source/host/runner/tools/sand-agent-management-tools.ts:92,202 + turn-toolset.ts:1367",
    harnessNeverCalledCreateAgentForChild: true,           // by construction: we only sendPrompt; API createAgent is only for the maker
    childNameNonceKnownOnlyToMaker: true,
    childInRoster: !!childId,
    childId,
    delegatedCreationSucceeded: !!childId,                  // child with maker-only nonce name exists after delegating to the maker
    causalStrength: "strong-indirect (controlled run, no other creating actor; the test does not, by itself, prove the exclusive tool-call path)",
    makerSaidDone,
    promptsNeeded: prompts,
    transcriptShape, entryKinds,
    childRow: childRow ? JSON.stringify(childRow).slice(0, 600) : null,
    // CORRECTED frame mechanism: CreateAgent is wrapped by defineCommunicateTool, so its trace is a
    // communicateUpdateToolCall whose args.currentStep is {"__sand_tool__":true,"phase":..,"tool":"CreateAgent",..}
    // (source/host/runner/tools/communicate-tool.ts:19-31,124-165; agent-messaging.ts:7) — NOT a literal
    // createAgentToolCall frame. The gateway transcript RPCs return a redacted display view (message/send-message)
    // that omits it, so the raw wrapper frame was not captured here; the claim is limited to delegated-creation
    // success. Capturing the wrapper's start/complete under one toolCallId matched to the returned child id is the
    // remaining step to upgrade this to an exclusive tool-call proof.
    literalToolCallFrameCaptured: false,
  };
  log("delegatedCreation:", JSON.stringify({ childId, succeeded: !!childId, makerSaidDone, prompts }));
} catch (e) { R.error = e.message; log("ERROR:", e.message); }
finally {
  // cleanup: delete everything we (or the maker) created; verify EXACT id-set restoration
  R.cleanup = { requestedDelete: [...created] };
  try { if (created.length) await api("deleteAgents", { ids: created }); } catch (e) { R.cleanup.deleteError = e.message; }
  await sleep(1500);
  // sweep any leftover test-named agents/groups by our nonce
  const now = await roster();
  const leftover = now.filter((a) => (a.name ?? "").includes("selftest") && (a.name ?? "").includes(n));
  for (const a of leftover) { try { await api("deleteAgent", { id: a.id }); } catch {} }
  await sleep(1000);
  const finalRead = await rosterRead();
  const finalIds = new Set(finalRead.list.map((a) => a.id));
  const addedNotRemoved = [...finalIds].filter((id) => !baselineIds.has(id));
  const removedFromBaseline = [...baselineIds].filter((id) => !finalIds.has(id));
  const leftoverTestNamed = finalRead.list.filter((a) => (a.name ?? "").includes("selftest") && (a.name ?? "").includes(n)).map((a) => ({ id: a.id, name: a.name }));
  R.cleanup.rostersReadable = baselineReadable && finalRead.readable;  // both baseline AND final were real reads
  R.cleanup.baselineCount = baselineIds.size;
  R.cleanup.finalCount = finalIds.size;
  R.cleanup.addedNotRemoved = addedNotRemoved;                 // must be empty
  R.cleanup.removedFromBaseline = removedFromBaseline;         // must be empty (we didn't touch real agents)
  R.cleanup.leftoverTestNamed = leftoverTestNamed;             // must be empty (incl. any group)
  // id-set restored ONLY counts when both rosters were genuinely readable (an unreadable roster -> not restored)
  R.cleanup.idSetRestored = R.cleanup.rostersReadable && addedNotRemoved.length === 0 && removedFromBaseline.length === 0 && leftoverTestNamed.length === 0;
  // Verdict (narrowed): delegated bot-creation SUCCEEDED AND cleanup restored the exact roster ID-set from
  // genuinely-readable rosters. NOT claimed: an exclusive createAgent tool-call trace (see delegatedCreation).
  R.verdict_pass = !!(R.delegatedCreation?.delegatedCreationSucceeded && R.cleanup.idSetRestored);
  fs.writeFileSync(path.join(SP, "ev-bot-autonomous-createagent.json"), JSON.stringify(R, null, 2));
  log("EVIDENCE -> ev-bot-autonomous-createagent.json");
  log("VERDICT:", JSON.stringify({ delegatedCreationSucceeded: R.delegatedCreation?.delegatedCreationSucceeded, idSetRestored: R.cleanup?.idSetRestored, rostersReadable: R.cleanup?.rostersReadable, pass: R.verdict_pass }));
  process.exit(R.verdict_pass ? 0 : 1);
}
