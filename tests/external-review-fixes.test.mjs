// Fixes for the second external review (7 findings): turn-identity ordering
// (settle host is created before prepareTurn), ledger failure classification,
// reasoning model inheritance, cross-turn cache affinity, schema-aware MCP
// signatures, the pdfjs deadline, and the reproducible B-1 bootstrap.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    external: ["pdfjs-dist/*"],
    define: { "import.meta.url": JSON.stringify(pathToFileURL(entry).href) },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("#1: settle-host identity never flows through a shared per-prepare stamp", () => {
  const composition = read("source/host/host-runner-composition.ts");
  // The ordering fact the review proved: settle host creation precedes prepareTurn.
  const shell = read("source/host/runner/turn-run-shell.ts");
  const settleAt = shell.indexOf("host.createSettleHost()");
  const prepareAt = shell.indexOf("await host.prepareTurn(");
  assert.ok(settleAt >= 0 && prepareAt >= 0 && settleAt < prepareAt, "settle host is still created before prepareTurn — identity must be pre-bound");
  // Therefore: parent pinned to session.id, children pinned to their own id, no mutable.
  assert.match(composition, /createSettleHost: \(\) => createProductionTurnSettleHost\(session\.id\),/);
  assert.match(composition, /createSettleHost: \(\) => createProductionTurnSettleHost\(agentId\),/);
  assert.doesNotMatch(composition, /activeTurnConversationId/);
});

test("#3: the job ledger classifies failed sends as failures, not sent", () => {
  const tool = read("source/host/runner/tools/sand-agent-management-tools.ts");
  assert.match(tool, /getFailureInfo: \(result: unknown\) => \{/);
  assert.match(tool, /\/\^\(Sent to \|Posted \)\//);
  // The known failure strings in sendToAgent still start with none of the ack prefixes.
  const messaging = read("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  for (const failure of ["Message was empty; nothing was sent.", "An agent can't message itself.", "That agent no longer exists."]) {
    assert.ok(messaging.includes(failure), `known failure string present: ${failure}`);
    assert.doesNotMatch(failure, /^(Sent to |Posted )/);
  }
});

test("#5: cache affinity key is the conversation id, stable across turns", async () => {
  const { createProviderPromptSession } = await loadModule("source/host/extensions/inference/provider-session.ts");
  const first = createProviderPromptSession("codex", "gpt-5.5", "low", "conversation-abc");
  const second = createProviderPromptSession("codex", "gpt-5.5", "low", "conversation-abc");
  // Two separate sessions (as rebuilt each turn) — the executors they hand out
  // must still agree on the cache key, which we can only observe indirectly:
  // both were constructed with the same conversation id, so the constructor
  // fallback (randomUUID) must NOT be used. Pin the constructor contract:
  const source = read("source/host/extensions/inference/provider-session.ts");
  assert.match(source, /cacheSessionId != null && cacheSessionId\.length > 0 \? cacheSessionId : crypto\.randomUUID\(\)/);
  assert.ok(first.getExecutor() != null && second.getExecutor() != null);
});

test("#6: MCP reconcile signature includes description and input schema", () => {
  const discovery = read("source/shared/node/mcp/tools-discovery.ts");
  assert.match(discovery, /JSON\.stringify\(loose\.inputSchema \?\? null\)/);
  assert.match(discovery, /typeof loose\.description === "string" \? loose\.description : ""/);
});

test("#7: the pdfjs fallback runs under the same hard deadline", async () => {
  const { withDeadline } = await loadModule("source/host/runner/local-pdf-text-extractor.ts");
  const never = new Promise(() => {});
  await assert.rejects(() => withDeadline(never, 100, "pdfjs"), /pdfjs timed out/);
  const extractor = read("source/host/runner/local-pdf-text-extractor.ts");
  assert.match(extractor, /withDeadline\(extractWithPdfjs\(importPdfjs, bytes\), PDF_EXTRACT_TIMEOUT_MS, "pdfjs"\)/);
});

test("#2: the B-1 manager setup is reproducible (bootstrap script + durable designation)", () => {
  const bootstrap = read("scripts/setup-belmont-manager.mjs");
  assert.match(bootstrap, /manager\.json/);
  assert.match(bootstrap, /createAgentAutomation/);
  assert.match(bootstrap, /h-jobs\.sh/);
  assert.match(bootstrap, /matcher: "SendToAgent"/);
  const runtime = read("scripts/lib/wsl-runtime.mjs");
  assert.match(runtime, /export function readManagerAgentId\(profileDir\)/);
  assert.match(runtime, /env\.SAND_DEFAULT_AGENT_ID\?\.trim\(\) \|\| readManagerAgentId\(profileDir\)/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["belmont:manager"], "node scripts/setup-belmont-manager.mjs");
});

// ---------- round 3 findings ----------

test("r3#1: a failed durable persist is surfaced in the ack and telemetry, not silently ignored", () => {
  const messaging = read("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  assert.match(messaging, /const persisted = this\.persistInboundMarker\(toAgentId, inbound\);/);
  assert.match(messaging, /outcome: "persist_failed",\s*kind: "agent-message"/);
  assert.match(messaging, /could not be saved for restart-safe delivery/);
  assert.match(messaging, /\}\) \?\? false;/);
});

test("r3#3: payload-bearing markers survive the 48h prune for 14 days", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { SandPendingWakeStore, PENDING_WAKE_PAYLOAD_MAX_AGE_MS } = await loadModule("source/host/extensions/transcript/sand-pending-wake-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-prune-"));
  try {
    const now = Date.now();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1_000;
    const fifteenDaysAgo = now - 15 * 24 * 60 * 60 * 1_000;
    const store = new SandPendingWakeStore(root);
    store.markPending({ agentId: "a", kind: "agent-message", workId: "m1", markedAtMs: threeDaysAgo, agentMessage: { from: { id: "x", name: "X" }, text: "hello" } });
    store.markPending({ agentId: "a", kind: "subagent", workId: "c1", markedAtMs: threeDaysAgo, title: "t", completion: { status: "success", result: "r" } });
    store.markPending({ agentId: "a", kind: "shell", workId: "s1", markedAtMs: threeDaysAgo, title: "watch" });
    store.markPending({ agentId: "a", kind: "agent-message", workId: "m2", markedAtMs: fifteenDaysAgo, agentMessage: { from: { id: "x", name: "X" }, text: "old" } });
    const pruned = store.pruneStale(48 * 60 * 60 * 1_000, now);
    assert.deepEqual(pruned.map((marker) => marker.workId).sort(), ["m2", "s1"], "plain watch wake prunes at 48h; payload markers only past 14d");
    assert.deepEqual(store.listPending().map((marker) => marker.workId).sort(), ["c1", "m1"]);
    assert.ok(PENDING_WAKE_PAYLOAD_MAX_AGE_MS > 13 * 24 * 60 * 60 * 1_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("r3#5: the manager bootstrap reconciles a drifted persona and sweeper, not just creates-when-absent", () => {
  const bootstrap = read("scripts/setup-belmont-manager.mjs");
  assert.match(bootstrap, /api\(gateway, "updateAgent", \{ id: manager\.id, profile: \{ name: managerName, description: MANAGER_PERSONA \} \}\)/);
  assert.match(bootstrap, /api\(gateway, "updateAgentAutomation", \{ id: manager\.id, automationId: sweeper\.id, spec: sweeperSpec \}\)/);
  assert.match(bootstrap, /sweeper\.prompt === sweeperSpec\.prompt/);
});
