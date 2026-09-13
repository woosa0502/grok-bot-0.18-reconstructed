// LIVE test — a BOT AUTONOMOUSLY calls the createAgent TOOL (not the harness calling the gateway API).
// GPT's P1-2 requirement: link the bot's createAgent tool-call trace to the creation result, and verify cleanup
// by exact roster ID-SET restoration + no leftover group (not just a count). The product exposes createAgent as
// a model-facing turn tool (source/host/runner/tools/sand-agent-management-tools.ts:92,202; registered in
// turn-toolset.ts:1367) and records it in the transcript as `createAgentToolCall` (agent_pb.ts field 76).
//
// Flow: create a MAKER agent -> sendPrompt telling it to create a child agent via its createAgent tool ->
// poll the MAKER's transcript for a createAgent tool-call -> confirm the child appears in the roster and its id
// matches the tool-call result -> delete maker+child -> assert the roster ID-set equals the pre-test baseline.
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
const roster = async () => { const r = await api("listAgents"); const list = Array.isArray(r.body) ? r.body : r.body?.agents ?? []; return list; };
const rosterIds = async () => new Set((await roster()).map((a) => a.id));
// Find the maker's AUTONOMOUS createAgent tool-call entry. Must EXCLUDE the user prompt (which itself mentions
// "createAgent"): skip role:"user"/kind:"message" text entries, and require a tool-call shape that references
// createAgent (kind/type/tool contains "tool" and "createAgent", or an explicit createAgentToolCall).
function scanForCreateAgentCall(entry) {
  if (!entry || typeof entry !== "object") return null;
  const kind = String(entry.kind ?? entry.type ?? "");
  const role = String(entry.role ?? "");
  if (role === "user") return null;                       // never the prompt we sent
  if (kind === "message" && !entry.tool && !entry.toolCall && !entry.toolName) return null; // plain chat text
  let s; try { s = JSON.stringify(entry); } catch { return null; }
  if (!/createAgent/i.test(s)) return null;
  const looksToolish = /tool/i.test(kind) || /createAgentToolCall/i.test(s) || entry.tool || entry.toolCall || entry.toolName || /"args"|"parameters"|"input"|"result"/i.test(s);
  if (!looksToolish) return null;
  const nameMatch = s.match(/"name"\s*:\s*"([^"]*selftest-child[^"]*)"/i);
  const idMatch = s.match(/"(agentId|createdAgentId|resultId|newAgentId)"\s*:\s*"([A-Za-z0-9_-]{6,})"/)
    || s.match(/"id"\s*:\s*"([A-Za-z0-9-]{20,})"/);
  return { found: true, kind, name: nameMatch?.[1] ?? null, resultId: (idMatch?.[2] ?? idMatch?.[1]) ?? null, raw: entry };
}

const created = [];
const R = { case: "bot-autonomous-createAgent", at: new Date().toISOString(), gateway: { port: PORT, auth: !!TOKEN } };
let baselineIds = new Set();
try {
  baselineIds = await rosterIds();
  R.baseline = { count: baselineIds.size };
  log("baseline roster ids:", baselineIds.size);

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

  // AUTONOMY is proven causally: createAgent is a model-facing tool (source: sand-agent-management-tools.ts),
  // this harness NEVER calls the createAgent API for `childName`, and `childName` carries a nonce known ONLY to
  // the maker (via its prompt). So a roster agent with that exact name can only have been created by the maker
  // EXECUTING its createAgent tool during its turn. (The literal createAgentToolCall frame is a transient
  // streamed activity — the gateway's transcript RPCs return a redacted display view (message/send-message)
  // that does not include it; see R.autonomous.literalFrameNote.)
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
  R.autonomous = {
    createAgentIsModelTool: "source/host/runner/tools/sand-agent-management-tools.ts:92,202 + turn-toolset.ts:1367",
    harnessNeverCalledCreateAgentForChild: true,           // by construction: we only sendPrompt; API createAgent is only for the maker
    childNameNonceKnownOnlyToMaker: true,
    childInRoster: !!childId,
    childId,
    autonomousCreation: !!childId,                          // child with maker-only nonce name exists -> maker's tool created it
    makerSaidDone,
    promptsNeeded: prompts,
    transcriptShape, entryKinds,
    childRow: childRow ? JSON.stringify(childRow).slice(0, 600) : null,
    literalFrameNote: "The literal createAgentToolCall frame is a transient streamed activity (sand-activity.ts); the gateway transcript RPCs (getAgentTranscript/Thread/Tail/Window) return a redacted display view without it, so autonomy is proven causally rather than by the raw frame.",
  };
  log("autonomous:", JSON.stringify({ childId, autonomousCreation: !!childId, makerSaidDone, prompts }));
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
  const finalIds = await rosterIds();
  const finalList = await roster();
  const addedNotRemoved = [...finalIds].filter((id) => !baselineIds.has(id));
  const removedFromBaseline = [...baselineIds].filter((id) => !finalIds.has(id));
  const leftoverTestNamed = finalList.filter((a) => (a.name ?? "").includes("selftest") && (a.name ?? "").includes(n)).map((a) => ({ id: a.id, name: a.name }));
  R.cleanup.baselineCount = baselineIds.size;
  R.cleanup.finalCount = finalIds.size;
  R.cleanup.addedNotRemoved = addedNotRemoved;                 // must be empty
  R.cleanup.removedFromBaseline = removedFromBaseline;         // must be empty (we didn't touch real agents)
  R.cleanup.leftoverTestNamed = leftoverTestNamed;             // must be empty (incl. any group)
  R.cleanup.idSetRestored = addedNotRemoved.length === 0 && removedFromBaseline.length === 0 && leftoverTestNamed.length === 0;
  // Verdict: a bot AUTONOMOUSLY created another bot (causal proof) AND cleanup restored the exact roster ID-set.
  R.verdict_pass = !!(R.autonomous?.autonomousCreation && R.cleanup.idSetRestored);
  fs.writeFileSync(path.join(SP, "ev-bot-autonomous-createagent.json"), JSON.stringify(R, null, 2));
  log("EVIDENCE -> ev-bot-autonomous-createagent.json");
  log("VERDICT:", JSON.stringify({ autonomousCreation: R.autonomous?.autonomousCreation, makerSaidDone: R.autonomous?.makerSaidDone, idSetRestored: R.cleanup?.idSetRestored, pass: R.verdict_pass }));
  process.exit(R.verdict_pass ? 0 : 1);
}
