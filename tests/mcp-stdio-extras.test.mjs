// MCP local-mode extras: paginated tools/list + tools/list_changed in the stdio
// client, hook gates on the daemon MCP route, box-parity transport error wording,
// error-class accounting, and WebFetch remote-hook wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadStdioClient() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/box-exec-daemon/mcp-stdio-client.ts")],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
};

test("stdio client paginates tools/list and refreshes on tools/list_changed", async () => {
  const { McpStdioClient } = await loadStdioClient();
  const client = new McpStdioClient({ command: process.execPath, args: [path.join(repoRoot, "tests/fixtures/mcp-paginated-server.mjs")] });
  try {
    await client.start();
    assert.equal(client.startError, undefined);
    assert.deepEqual(client.tools.map((tool) => tool.name), ["alpha", "beta", "grow"], "both pages are collected");
    const result = await client.callTool("grow", {});
    assert.equal(result.content?.[0]?.text, "grown");
    assert.ok(await waitFor(() => client.tools.some((tool) => tool.name.startsWith("gamma-"))), "list_changed triggered a refresh");
    assert.equal(client.tools.length, 4);
  } finally {
    client.stop();
  }
});

test("daemon MCP route runs preToolUse and beforeMCPExecution gates and uses box error wording", () => {
  const server = read("source/box-exec-daemon/server.ts");
  const call = server.slice(server.indexOf("async callMcpTool("), server.indexOf("async callMcpTool(") + 4_000);
  assert.match(call, /#preToolUseGate\(toolName, \{ server: serverName, tool_input: toolArgs \}, signal\)/);
  assert.match(call, /#beforeMcpExecutionGate\(serverName, toolName, toolArgs, signal\)/);
  assert.match(call, /Box MCP execution failed for "\$\{toolName\}"/);
  const gate = server.slice(server.indexOf("async #beforeMcpExecutionGate("), server.indexOf("async #beforeMcpExecutionGate(") + 3_000);
  assert.match(gate, /\.beforeMCPExecution \?\? \[\]/);
  assert.match(gate, /hook_event_name: "beforeMCPExecution", server_name: serverName, tool_name: toolName, tool_input: toolArgs/);
  assert.match(gate, /rawPermission === "ask"/);
});

test("local MCP projection accounts real error classes (AGT-241)", () => {
  const composition = read("source/host/host-runner-composition.ts");
  assert.doesNotMatch(composition, /mcpErrorClassOf: \(\) => "unknown"/);
  assert.doesNotMatch(composition, /takeMcpExecErrorClass: \(\) => undefined/);
  assert.match(composition, /mcpErrorClassOf: \(error: unknown\) => mcpErrorClassOf\(error\)/);
  assert.match(composition, /errorClass\.length > 0 \? errorClass : MCP_ERROR_RESULT_CLASS/);
});

test("MCP surface auto-review is wired into the local projection (classifier mode + approval provider)", () => {
  const composition = read("source/host/host-runner-composition.ts");
  assert.doesNotMatch(composition, /mcpMeta: \{ getMcpTools: \(\) => \[\], callOptions: \{\} \}/);
  assert.match(composition, /const mcpMode = autoReviewGate\?\.currentModes\(\)\.mcp \?\? "off"/);
  assert.match(composition, /smartModeClassifierMode: mcpMode === "enforce"/);
  assert.match(composition, /smartModeClassifierShadowMode: mcpMode === "shadow"/);
  assert.match(composition, /createSandMcpApprovalProvider\(\{\s*controller: autoReviewController,\s*agentId: session\.id,/);
});

test("WebFetch executes remote hooks like WebSearch", () => {
  const webFetch = read("source/packages/agent/tools/core/web-fetch.ts");
  assert.match(webFetch, /import \{ withRemoteHooks \} from "\.\/remote-hooks\.js"/);
  assert.match(webFetch, /toolName: "WebFetch"/);
  assert.match(webFetch, /hookContextCollector: meta\.hookContextCollector/);
  const composition = read("source/host/host-runner-composition.ts");
  assert.doesNotMatch(composition, /web-fetch\.ts does not consume the remote-hook options/);
  assert.match(composition, /hookOptions: \{ resourceAccessor: turn\.remoteBoxResourceAccessor, enableExecuteHookExec: true, configuredSteps: \["preToolUse", "postToolUse", "postToolUseFailure"\] \}/);
});

test("shell state snapshots aliases, options and (bash) functions", () => {
  const shellState = read("source/box-exec-daemon/shell-state.ts");
  for (const file of ["options.sh", "aliases.sh", "functions.sh"]) assert.ok(shellState.includes(file), `${file} snapshot`);
  assert.match(shellState, /set \+o > /);
  assert.match(shellState, /alias 2>\/dev\/null \| sed/);
  assert.match(shellState, /typeset -f > /);
});

test("a crashed stdio server is respawned on the next tool call (A7)", async () => {
  // Live 2026-09-01: `crash` then `echo` answered "failed to start: server
  // process exited" forever — the daemon kept the dead client until the next
  // config reload. callMcpTool must attempt one respawn per call.
  const server = read("source/box-exec-daemon/server.ts");
  const call = server.slice(server.indexOf("async callMcpTool("), server.indexOf("async callMcpTool(") + 4_000);
  assert.match(call, /const respawned = new McpStdioClient\(JSON\.parse\(entry\.configKey\)/);
  assert.match(call, /await respawned\.start\(\);/);
  assert.match(call, /this\.#mcpServers\.set\(serverName, entry\);/);
  // and the failed-respawn path still reports the start error
  assert.match(call, /failed to start: \$\{respawned\.startError \?\? client\.startError\}/);
  // behavioral leg: the client itself marks startError on process exit, and a
  // fresh client from the same config starts clean.
  const { McpStdioClient } = await loadStdioClient();
  const fixture = path.join(repoRoot, "tests/fixtures/mcp-crash-server.mjs");
  const config = { command: process.execPath, args: [fixture] };
  const first = new McpStdioClient(config);
  await first.start();
  assert.equal(first.startError, undefined);
  // crash it (fire-and-forget call; the process exits mid-call)
  await first.callTool("crash", {}).catch(() => {});
  await waitFor(() => first.startError !== undefined);
  assert.match(String(first.startError), /exited/);
  const second = new McpStdioClient(config);
  await second.start();
  assert.equal(second.startError, undefined);
  const echoed = await second.callTool("echo", { text: "back" });
  assert.match(JSON.stringify(echoed), /back/);
  second.stop();
});
