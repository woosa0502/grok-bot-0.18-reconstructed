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
