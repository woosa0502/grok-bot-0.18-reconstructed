// Phase B durability (waves after the B-1 manager round): durable agent-to-agent
// delivery (AUDIT-5 core), durable background completions (P1-04), lost-child
// re-dispatch info (A-3 lite), manager protection/awareness (B-2 subset), and
// the wave's quality fixes (grep grouping, delete preview, ls truncation,
// SIGKILL escalation, MCP server-request replies, local model catalog).
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
    banner: { js: `import { createRequire as __bcr } from "node:module"; const require = __bcr(${JSON.stringify(pathToFileURL(entry).href)});` },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------- durable pending-wake payloads survive the store round-trip ----------

test("agent-message, completion, and taskPrompt payloads survive the pending-wake store", async () => {
  const { SandPendingWakeStore } = await loadModule("source/host/extensions/transcript/sand-pending-wake-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-wake-store-"));
  try {
    const store = new SandPendingWakeStore(root);
    store.markPending({
      agentId: "belmont", kind: "agent-message", workId: "msg-1", markedAtMs: 111,
      title: "Message from QA Bot",
      agentMessage: { from: { id: "worker", name: "QA Bot" }, text: "[job:x1] result", priority: true, displayed: true },
    });
    store.markPending({
      agentId: "belmont", kind: "subagent", workId: "child-1", markedAtMs: 222,
      title: "research", subagentType: "generalPurpose",
      taskPrompt: "find the answer to X",
      completion: { status: "success", result: "the answer is 42" },
    });
    store.markPending({
      agentId: "belmont", kind: "shell", workId: "77", markedAtMs: 333,
      title: "build", completion: { status: "success", detail: "exit 0", outputPath: "/workspace/.sand/t/77.txt" },
    });
    const restored = new SandPendingWakeStore(root).listPending();
    const message = restored.find((marker) => marker.kind === "agent-message");
    assert.deepEqual(message?.agentMessage, { from: { id: "worker", name: "QA Bot" }, text: "[job:x1] result", priority: true, displayed: true });
    const child = restored.find((marker) => marker.kind === "subagent");
    assert.equal(child?.taskPrompt, "find the answer to X");
    assert.deepEqual(child?.completion, { status: "success", result: "the answer is 42" });
    const shell = restored.find((marker) => marker.kind === "shell");
    assert.deepEqual(shell?.completion, { status: "success", detail: "exit 0", outputPath: "/workspace/.sand/t/77.txt" });
    // Settling removes exactly one marker.
    assert.equal(new SandPendingWakeStore(root).clearOne("belmont", "agent-message", "msg-1"), true);
    assert.equal(new SandPendingWakeStore(root).listPending().length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------- wiring guards: enqueue-persist / deliver-clear ordering ----------

test("agent messages persist before delivery and settle only after the wake ran (AUDIT-5)", () => {
  const source = read("source/host/extensions/transcript/agent-to-agent-messaging.ts");
  assert.ok(source.indexOf("this.persistInboundMarker(toAgentId, inbound);") < source.indexOf("void this.reviveForAgentInbound(toAgentId);"), "persist happens before the revive kick");
  assert.match(source, /this\.persistInboundMarker\(agentId, \{ \.\.\.message, isDisplayed: true \}\);/);
  assert.match(source, /this\.clearInboundMarker\(agentId, message\);/);
});

test("background completions persist their result into the marker and clear only after revival (P1-04)", () => {
  const source = read("source/host/extensions/transcript/completion-revivals.ts");
  assert.ok(source.indexOf("this.persistCompletionIntoMarker(completion);") < source.indexOf("void this.reviveForSubagentCompletions"), "subagent result stored on arrival");
  assert.match(source, /const result = await this\.runSubagentRevival\(agentId, completions\);[\s\S]{0,700}if \(result\.outcome !== "dropped" \|\| result\.reason === "quiesced"\)/);
  assert.ok(source.indexOf("this.persistShellCompletionIntoMarker(completion);") >= 0);
  assert.match(source, /const outcome = await this\.runShellRevival\(agentId, completions\);[\s\S]{0,500}if \(outcome !== "dropped"\)/);
});

test("rearm replays stored payloads: agent messages, real completions, and re-dispatch info", () => {
  const source = read("source/host/extensions/transcript/pending-wake-rearm.ts");
  assert.match(source, /this\.redeliverAgentMessageWake\(marker, report\)/);
  assert.match(source, /report\("rearmed", "stored_completion_redelivered"\)/);
  assert.match(source, /marker\.taskPrompt == null\s*\? "Check its transcript/);
  assert.match(source, /re-dispatch it with a fresh Task call/);
  const runtime = read("source/host/runner/subagent-runtime.ts");
  assert.match(runtime, /taskPrompt: params\.prompt\.slice\(0, 8_000\)/);
});

// ---------- B-2 subset: manager protection + worker awareness ----------

test("the designated manager cannot be deleted and workers get the managed-team section", () => {
  const lifecycle = read("source/host/extensions/transcript/agent-lifecycle.ts");
  assert.match(lifecycle, /SAND_DEFAULT_AGENT_ID[\s\S]{0,300}Change or clear that designation before deleting it/);
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /managedTeamSection: \(\) => \{/);
  assert.match(composition, /managerId === session\.id\) return null;/);
  assert.match(composition, /send the result BACK TO THE MANAGER with SendToAgent/);
  const assembly = read("source/host/runner/system-prompt-assembly.ts");
  assert.match(assembly, /if \(!deps\.isSubagentRunner\) add\(deps\.managedTeamSection\?\.\(\) \?\? null\);/);
});

// ---------- quality fixes ----------

test("grep groups context with its own match; delete previews without reading whole files; ls flags truncation", () => {
  const server = read("source/box-exec-daemon/server.ts");
  assert.match(server, /let pendingContext: \{ file: string; lineNumber: number; content: string \}\[\] = \[\];/);
  assert.match(server, /if \(matchIndex\+\+ < offset\) \{ keepTrailingContext = false; pendingContext = \[\]; continue; \}/);
  assert.match(server, /if \(info\.isFile\(\)\) \{[\s\S]{0,400}const handle = await open\(target, "r"\);/);
  assert.match(server, /if \(budget <= 0\) \{ node\.childrenWereProcessed = false; break; \}/);
  assert.match(server, /process\.kill\(-child\.pid, "SIGKILL"\)/);
  assert.match(server, /#nextShellId = Math\.floor\(Date\.now\(\) \/ 1000\) % 1_000_000_000;/);
});

test("MCP client answers server-initiated requests instead of hanging them", () => {
  const client = read("source/box-exec-daemon/mcp-stdio-client.ts");
  assert.match(client, /message\.method === "ping"[\s\S]{0,200}result: \{\}/);
  assert.match(client, /code: -32601, message: `Method not supported by this client/);
});

test("local mode serves the Pi model catalog to the desktop picker (P1-12)", () => {
  const services = read("source/electron-main/main-production-services.ts");
  assert.match(services, /if \(isLocalCodexMode\(process\.env\)\) \{[\s\S]{0,600}"gpt-5\.5"/);
  assert.match(services, /modelNames: piModels,/);
});
