// LIVE test — "봇이 봇 만들기" (createAgent) + "봇끼리 그룹만들어서 토론" (createGroup + group-chat room).
// Drives the Host gateway (port+token from gateway.json). Creates two clearly-marked TEST agents, groups
// them, sends ONE short discussion prompt, reads the room transcript to prove BOTH bots posted, then DELETES
// everything it created and verifies the roster returns to baseline. External artifact = roster count deltas
// + the room transcript authored by two distinct agents (never a single model's status string).
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
    body: JSON.stringify(args),
  });
  let body = null, text = ""; try { text = await res.text(); body = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body, text };
}
const roster = async () => { const r = await api("listAgents"); const list = Array.isArray(r.body) ? r.body : r.body?.agents ?? []; return list; };
const rosterCount = async () => (await roster()).length;

const created = { agents: [], group: null };
const R = { case: "bot-makes-bot + group-discuss", at: new Date().toISOString(), gateway: { port: PORT, auth: !!TOKEN } };
try {
  const base = await rosterCount();
  log("roster baseline:", base);

  // --- 봇이 봇 만들기: create two test agents ---
  const mk = async (name, persona) => {
    const r = await api("createAgent", { name, description: persona, origin: "belmont-selftest", clientNonce: `${name}-${n}`, isIntroductionSuppressed: true });
    const id = r.body?.agent?.id ?? r.body?.id;
    if (!id) throw new Error(`createAgent(${name}) returned no id: ${r.status} ${r.text?.slice(0, 200)}`);
    created.agents.push(id); return id;
  };
  const alice = await mk(`belmont-selftest-alice-${n}`, "You are Alice. You argue that apples are the best fruit. Keep it to ONE short sentence.");
  const bob = await mk(`belmont-selftest-bob-${n}`, "You are Bob. You argue that bananas are the best fruit. Keep it to ONE short sentence.");
  log("created agents:", alice, bob);

  // idempotency: same clientNonce must NOT create a second agent
  const dupAfter = await api("createAgent", { name: `belmont-selftest-alice-${n}`, description: "dup", origin: "belmont-selftest", clientNonce: `belmont-selftest-alice-${n}-${n}`, isIntroductionSuppressed: true });
  const dupId = dupAfter.body?.agent?.id ?? dupAfter.body?.id;
  R.idempotency = { sameNonceReturnsSameAgent: dupId === alice };
  if (dupId && dupId !== alice && !created.agents.includes(dupId)) created.agents.push(dupId); // track any stray for cleanup

  const afterCreate = await rosterCount();
  R.botMakesBot = { rosterBaseline: base, rosterAfterCreate: afterCreate, createdTwo: afterCreate - base >= 2, aliceId: alice, bobId: bob };
  log("roster after create:", afterCreate);

  // --- 봇끼리 그룹: create a group room with both ---
  const g = await api("createGroup", { name: `belmont-selftest-room-${n}`, description: "Debate: apple vs banana.", memberAgentIds: [alice, bob] });
  const groupId = g.body?.agent?.id ?? g.body?.id ?? g.body?.group?.id;
  if (!groupId) throw new Error(`createGroup returned no id: ${g.status} ${g.text?.slice(0, 200)}`);
  created.group = groupId;
  const list = await roster();
  const groupRow = list.find((a) => a.id === groupId);
  R.botGroups = { groupId, isGroup: groupRow?.isGroup ?? groupRow?.isGroupRoom ?? null, memberCount: (groupRow?.memberIds ?? groupRow?.memberAgentIds ?? []).length, groupRow: groupRow ? { id: groupRow.id, name: groupRow.name, isGroup: groupRow.isGroup } : null };
  log("created group:", groupId, "row:", JSON.stringify(R.botGroups.groupRow));

  // --- 토론: send ONE discussion prompt to the room; drive the members' turns ---
  const sent = await api("sendPrompt", { agentId: groupId, prompt: "한 문장씩 사과 vs 바나나로 짧게 토론하세요. 각자 SendMessage로 한 번만 말하세요." });
  R.discussion = { sendStatus: sent.status, sendAccepted: sent.body?.accepted ?? sent.ok };
  log("sendPrompt -> group:", sent.status, JSON.stringify(sent.body).slice(0, 120));

  // poll the room transcript for messages authored by BOTH agents
  let authors = new Set(), msgs = [], transcriptShape = null;
  for (let i = 0; i < 40; i++) {
    const t = await api("getAgentTranscript", { id: groupId });
    const entries = Array.isArray(t.body) ? t.body : t.body?.entries ?? t.body?.messages ?? t.body?.transcript ?? [];
    if (!transcriptShape && t.body) transcriptShape = Array.isArray(t.body) ? "array" : Object.keys(t.body).slice(0, 6);
    msgs = entries;
    const authorId = (e) => (e.author && typeof e.author === "object" ? e.author.id : null) ?? e.authorAgentId ?? e.agentId ?? e.senderId ?? (typeof e.author === "string" ? e.author : null) ?? e.from ?? e.role;
    authors = new Set(entries.map(authorId).filter(Boolean));
    if (authors.has(alice) && authors.has(bob)) break;
    await sleep(3000);
  }
  const roomAuthors = [...authors];
  const bothSpoke = authors.has(alice) && authors.has(bob);
  R.discussion.transcriptShape = transcriptShape;
  R.discussion.messageCount = msgs.length;
  R.discussion.roomAuthors = roomAuthors;
  R.discussion.bothBotsPosted = bothSpoke;
  const authorId2 = (e) => (e.author && typeof e.author === "object" ? e.author.id : null) ?? e.authorAgentId ?? e.agentId ?? (typeof e.author === "string" ? e.author : null) ?? e.role;
  const textOf = (e) => { const t = e.text ?? e.content ?? e.message ?? e.body; if (typeof t === "string") return t; try { return JSON.stringify(t).slice(0, 200); } catch { return String(t); } };
  R.discussion.sampleMessages = msgs.slice(-6).map((e) => ({ by: authorId2(e) === alice ? "alice" : authorId2(e) === bob ? "bob" : (authorId2(e) ?? "?"), text: textOf(e) }));
  R.discussion.rawLastEntryKeys = msgs.length ? Object.keys(msgs[msgs.length-1]) : null;
  log("room authors:", roomAuthors, "bothSpoke:", bothSpoke, "msgs:", msgs.length);
} catch (e) {
  R.error = e.message; log("ERROR:", e.message);
} finally {
  // --- cleanup: delete everything created, verify roster restored ---
  const toDelete = [...(created.group ? [created.group] : []), ...created.agents];
  R.cleanup = { requested: toDelete };
  try { if (toDelete.length) await api("deleteAgents", { ids: toDelete }); } catch (e) { R.cleanup.deleteAgentsError = e.message; }
  await sleep(1500);
  // fallback: delete any leftover one-by-one
  const now = await roster();
  const leftover = now.filter((a) => (a.name ?? "").includes(`selftest`) && (a.name ?? "").includes(n)).map((a) => a.id);
  for (const id of leftover) { try { await api("deleteAgent", { id }); } catch {} }
  await sleep(1000);
  const finalList = await roster();
  const stillThere = finalList.filter((a) => (a.name ?? "").includes("selftest") && (a.name ?? "").includes(n)).map((a) => ({ id: a.id, name: a.name }));
  R.cleanup.rosterFinal = finalList.length;
  R.cleanup.leftoverTestAgents = stillThere;
  R.cleanup.clean = stillThere.length === 0;
  R.verdict_pass = !!(R.botMakesBot?.createdTwo && R.botGroups?.groupId && R.discussion?.bothBotsPosted && R.cleanup.clean);
  fs.writeFileSync(path.join(SP, "ev-bot-group-discuss.json"), JSON.stringify(R, null, 2));
  log("EVIDENCE -> ev-bot-group-discuss.json");
  log("VERDICT:", JSON.stringify({ botMakesBot: R.botMakesBot?.createdTwo, botGroups: !!R.botGroups?.groupId, discussion: R.discussion?.bothBotsPosted, cleanup: R.cleanup?.clean, pass: R.verdict_pass }));
}
