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

// ---------- round 4 findings ----------

test("r4#1: payload-bearing markers are never pre-cleared during rearm (no loss window)", () => {
  const rearm = read("source/host/extensions/transcript/pending-wake-rearm.ts");
  assert.match(rearm, /const carriesPayload = marker\.kind === "agent-message" \|\| marker\.completion != null;/);
  assert.match(rearm, /if \(!carriesPayload && !\(marker\.kind === "shell" && marker\.interruptedByRecreate === true\)\)\s*store\.clearOne/);
  // The redeliver path no longer needs (and must not rely on) a late re-persist,
  // and the lost-child path must not strip a stored completion via upsert.
  assert.doesNotMatch(rearm, /Re-persist first \(rearmPendingWakes cleared/);
  assert.match(rearm, /if \(marker\.completion == null\)\s*this\.persistPendingWake\(\{/);
});

test("r4#2: multiline (-U) matches keep their after-context", async () => {
  const { projectGrepEvents } = await loadModule("source/box-exec-daemon/grep-projection.ts");
  const multilineMatch = JSON.stringify({ type: "match", data: { path: { text: "f.txt" }, line_number: 2, lines: { text: "l2\nl3\nl4\nl5\n" } } });
  const afterContext = JSON.stringify({ type: "context", data: { path: { text: "f.txt" }, line_number: 6, lines: { text: "l6\n" } } });
  const projected = projectGrepEvents([multilineMatch, afterContext].join("\n"), { offset: 0, headLimit: 10, contextBefore: 1, contextAfter: 1 });
  assert.deepEqual(projected.lines.map((line) => [line.lineNumber, line.isContext]), [[2, false], [6, true]], "line 6 is the -A of the match ending at line 5");
});

// ---------- round 5 findings ----------

test("r5: upsert preserves stored payloads against payload-less re-arms", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { SandPendingWakeStore } = await loadModule("source/host/extensions/transcript/sand-pending-wake-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-upsert-"));
  try {
    const store = new SandPendingWakeStore(root);
    store.markPending({ agentId: "a", kind: "cloud-agent", workId: "bc1", markedAtMs: 1, title: "t", subagentType: "cursor-agent", completion: { status: "completed", result: "the stored result" } });
    // The exact payload-less event watchCloudAgent persists on re-watch:
    store.markPending({ agentId: "a", kind: "cloud-agent", workId: "bc1", markedAtMs: 2, title: "Cloud agent bc1" });
    const marker = new SandPendingWakeStore(root).listPending().find((entry) => entry.workId === "bc1");
    assert.deepEqual(marker?.completion, { status: "completed", result: "the stored result" }, "the stored completion survives the re-watch upsert");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("r5: rearm actually redelivers (behavioral store->rearm->delivery, no pre-clear loss)", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const storeModule = await loadModule("source/host/extensions/transcript/sand-pending-wake-store.ts");
  const rearmModule = await loadModule("source/host/extensions/transcript/pending-wake-rearm.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-rearm-"));
  try {
    const store = new storeModule.SandPendingWakeStore(root);
    store.markPending({ agentId: "mgr", kind: "agent-message", workId: "m1", markedAtMs: Date.now(), title: "Message from W", agentMessage: { from: { id: "w", name: "W" }, text: "[job:z] result", displayed: true } });
    store.markPending({ agentId: "mgr", kind: "cloud-agent", workId: "bc1", markedAtMs: Date.now(), title: "t", subagentType: "cursor-agent", completion: { status: "completed", result: "stored cloud result" } });
    const inboundQueue = new Map();
    const deliveredCompletions = [];
    const tm = {
      pendingWakeStore: store,
      execution: { canExecute: true },
      sessions: { isAgentGone: () => false, deletedAgentIds: new Set(), resolveBackgroundSession: async (id) => ({ id }) },
      groupChat: { isGroupSession: () => false },
      telemetry: { reportPendingWake: () => {} },
      roster: { emitAsyncTasksForAgent: () => {} },
      backgroundWakes: {
        agentToAgent: { pendingAgentInbound: inboundQueue, reviveForAgentInbound: async () => {} },
        handleBackgroundSubagentCompletion: (completion) => deliveredCompletions.push(completion),
      },
      runnerRegistry: { getRunner: () => ({ getPendingCloudAgentWatchBcIds: () => [], watchCloudAgent: () => {} }) },
      upgradeResume: {},
    };
    const rearm = new rearmModule.PendingWakeRearm(tm);
    await rearm.rearmPendingWakes();
    // The per-marker rearms are void-dispatched; poll until both delivery
    // effects land instead of a fixed sleep (r6: flaky-wait hardening).
    for (let waited = 0; waited < 2_000; waited += 25) {
      if (inboundQueue.get("mgr")?.length > 0 && deliveredCompletions.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // The agent message reached the inbound queue AND its marker is STILL on
    // disk (no pre-clear) until the delivery path settles it.
    assert.equal(inboundQueue.get("mgr")?.[0]?.text, "[job:z] result");
    const remaining = new storeModule.SandPendingWakeStore(root).listPending();
    assert.ok(remaining.some((marker) => marker.workId === "m1"), "agent-message marker survives until delivery settles it");
    // The stored cloud-agent completion was delivered as a REAL result, and its
    // payload was not stripped from disk by any re-watch.
    assert.equal(deliveredCompletions[0]?.result, "stored cloud result");
    assert.equal(deliveredCompletions[0]?.subagentType, "cursor-agent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
