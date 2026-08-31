// Recommended improvement bundle: per-agent tool deny-lists, crash-window
// dedupe for inbound agent messages, the opt-in manager-only chat gate, and
// durable group-turn wakes.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadModule(relativeEntry) {
  const entry = path.join(repoRoot, relativeEntry);
  const result = await build({
    entryPoints: [entry],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    define: { "import.meta.url": JSON.stringify(pathToFileURL(entry).href) },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------- 1. per-agent tool deny-list ----------

test("per-agent tool policy persists, never denies SendMessage, and clears cleanly", async () => {
  const { SandSettingsStore } = await loadModule("source/shared/node/settings/sand-settings-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-toolpolicy-"));
  try {
    const store = new SandSettingsStore(path.join(root, "settings.json"));
    store.setAgentToolPolicy("clerk", { denyTools: ["ExternalShell", "SendMessage", "ExternalRead"] });
    const reloaded = new SandSettingsStore(path.join(root, "settings.json"));
    assert.deepEqual(reloaded.getAgentToolPolicy("clerk")?.denyTools, ["ExternalShell", "ExternalRead"], "SendMessage is stripped from any deny-list");
    assert.equal(reloaded.getAgentToolPolicy("other"), undefined);
    reloaded.setAgentToolPolicy("clerk", undefined);
    assert.equal(new SandSettingsStore(path.join(root, "settings.json")).getAgentToolPolicy("clerk"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the toolset filters denied tools per agent, and CreateAgent can set the policy", () => {
  const toolset = read("source/host/runner/tools/turn-toolset.ts");
  assert.match(toolset, /const denyPolicy = agentToolDenySet\(host\.getConversationId\(\)\);/);
  assert.match(toolset, /roomFiltered\.filter\(\(tool\) => tool\.name === "SendMessage" \|\| !denyPolicy\.has\(tool\.name\)\)/);
  const tool = read("source/host/runner/tools/sand-agent-management-tools.ts");
  assert.match(tool, /deny_tools: z\.array\(z\.string\(\)\.trim\(\)\.min\(1\)\)\.optional\(\)/);
  assert.match(tool, /resolved\.setAgentToolPolicy\?\.\(created\.id, \{ denyTools: denied \}\)/);
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /setAgentToolPolicy: \(agentId: string, policy/);
});

// ---------- 2. crash-window dedupe ----------

test("inbound agent-message entries are stamped with the marker id and deduped on redelivery", () => {
  const messaging = read("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  assert.match(messaging, /existing\?\.agentMessageId === message\.id/);
  assert.match(messaging, /\.\.\.\(message\.id == null \? \{\} : \{ agentMessageId: message\.id \}\)/);
});

// ---------- 3. manager-only chat gate (opt-in) ----------

test("SAND_MANAGER_ONLY_CHAT refuses user prompts to worker bots with a visible notice", () => {
  const pipeline = read("source/host/extensions/transcript/send-pipeline.ts");
  assert.match(pipeline, /process\.env\.SAND_MANAGER_ONLY_CHAT === "1"/);
  assert.match(pipeline, /targetAgentId !== managerId/);
  assert.match(pipeline, /This team runs manager-only chat/);
  // Groups are exempt (fan-out rooms remain reachable) and the gate returns
  // without running a turn.
  assert.match(pipeline, /agent\.isGroup === true/);
});

// ---------- 4. durable group-turn wakes ----------

test("a group post persists a group-turn marker that settles only after the turn ran", () => {
  const rooms = read("source/host/extensions/transcript/shared-rooms.ts");
  assert.match(rooms, /agentMessage: \{ from: \{ id: fromAgentId, name: member\.name \}, text: message, displayed: true, group: true \}/);
  assert.match(rooms, /finally \{\s*this\.tm\.pendingWakes\.clearSettledPendingWake\(\{ agentId: groupId, kind: "agent-message", workId: wakeId \}\);/);
  const rearm = read("source/host/extensions/transcript/pending-wake-rearm.ts");
  assert.match(rearm, /marker\.agentMessage\?\.group === true/);
  assert.match(rearm, /rerunGroupTurnWake/);
});

test("the group flag survives the store round-trip", async () => {
  const { SandPendingWakeStore } = await loadModule("source/host/extensions/transcript/sand-pending-wake-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-groupwake-"));
  try {
    const store = new SandPendingWakeStore(root);
    store.markPending({ agentId: "group-1", kind: "agent-message", workId: "g1", markedAtMs: 1, title: "Group post", agentMessage: { from: { id: "a", name: "A" }, text: "hello room", displayed: true, group: true } });
    const marker = new SandPendingWakeStore(root).listPending()[0];
    assert.equal(marker?.agentMessage?.group, true);
    assert.equal(marker?.agentMessage?.displayed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------- 5. AUDIT-W6 ----------

test("computer-use session audits are attributed to the child subagent (AUDIT-W6)", () => {
  const runtime = read("source/host/runner/subagent-runtime.ts");
  assert.match(runtime, /agentId: subagentAgentId,[\s\S]{0,400}kind: "computerUseSession"/);
});
