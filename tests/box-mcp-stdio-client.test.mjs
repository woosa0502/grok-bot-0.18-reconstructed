// Regression tests for the box-side MCP stdio client reconstruction
// (source/box-exec-daemon/mcp-stdio-client.ts): config parsing, the
// initialize/tools-list/tools-call round trip against a real stdio server,
// start-error reporting, and abort handling.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadClientModule() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "belmont-mcp-client-"));
  const output = path.join(temporary, "mcp-stdio-client.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/box-exec-daemon/mcp-stdio-client.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

// A minimal MCP stdio server: newline-delimited JSON-RPC, tools echo/add.
const TEST_SERVER = `
import { createInterface } from "node:readline";
const TOOLS = [
  { name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "add", description: "add", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
];
const send = m => process.stdout.write(JSON.stringify(m) + "\\n");
createInterface({ input: process.stdin }).on("line", line => {
  const t = line.trim(); if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test-mcp", version: "0.1.0" }, instructions: "test-instructions" } });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const a = params?.arguments ?? {};
    if (params?.name === "echo") return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ECHO " + String(a.text ?? "") }] } });
    if (params?.name === "add") return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "SUM " + (Number(a.a) + Number(a.b)) }], structuredContent: { sum: Number(a.a) + Number(a.b) } } });
    return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "unknown tool" } });
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
});
`;

test("parseMcpStdioConfig accepts mcpServers wrapper and bare maps, skips url servers", async () => {
  const { module, dispose } = await loadClientModule();
  try {
    const wrapped = module.parseMcpStdioConfig(JSON.stringify({ mcpServers: { a: { command: "node", args: ["x.js"], env: { K: "v" } }, http: { url: "https://example.com" } } }));
    assert.equal(wrapped.size, 1, "only the stdio (command) server is kept");
    assert.deepEqual(wrapped.get("a"), { command: "node", args: ["x.js"], env: { K: "v" } });
    assert.equal(wrapped.has("http"), false, "url servers are skipped");

    const bare = module.parseMcpStdioConfig(JSON.stringify({ b: { command: "sh" } }));
    assert.equal(bare.get("b").command, "sh");

    assert.equal(module.parseMcpStdioConfig("not json").size, 0, "malformed json -> empty");
    assert.equal(module.parseMcpStdioConfig("").size, 0, "empty -> empty");
  } finally {
    await dispose();
  }
});

test("McpStdioClient completes the handshake, lists tools, and calls them", async () => {
  const { module, dispose } = await loadClientModule();
  const serverDir = await mkdtemp(path.join(os.tmpdir(), "belmont-mcp-server-"));
  const serverPath = path.join(serverDir, "server.mjs");
  await writeFile(serverPath, TEST_SERVER);
  let client;
  try {
    client = new module.McpStdioClient({ command: process.execPath, args: [serverPath] });
    await client.start();
    assert.equal(client.startError, undefined, "no start error");
    assert.equal(client.serverInfoName, "test-mcp");
    assert.equal(client.instructions, "test-instructions");
    assert.deepEqual(client.tools.map(t => t.name).sort(), ["add", "echo"]);

    const echo = await client.callTool("echo", { text: "hi" });
    assert.equal(echo.isError, false);
    assert.deepEqual(echo.content, [{ type: "text", text: "ECHO hi" }]);

    const add = await client.callTool("add", { a: 2, b: 3 });
    assert.equal(add.content[0].text, "SUM 5");
    assert.deepEqual(add.structuredContent, { sum: 5 }, "structuredContent is preserved");
  } finally {
    client?.stop();
    await rm(serverDir, { recursive: true, force: true });
    await dispose();
  }
});

test("McpStdioClient records startError for a command that cannot spawn", async () => {
  const { module, dispose } = await loadClientModule();
  let client;
  try {
    client = new module.McpStdioClient({ command: "definitely-not-a-real-binary-belmont", args: [] });
    await assert.rejects(client.start(), "start() rejects when the server cannot spawn");
    assert.notEqual(client.startError, undefined, "startError is recorded so mcpState can report 'error'");
  } finally {
    client?.stop();
    await dispose();
  }
});

test("McpStdioClient rejects a tool call whose signal is already aborted", async () => {
  const { module, dispose } = await loadClientModule();
  const serverDir = await mkdtemp(path.join(os.tmpdir(), "belmont-mcp-server-"));
  const serverPath = path.join(serverDir, "server.mjs");
  await writeFile(serverPath, TEST_SERVER);
  let client;
  try {
    client = new module.McpStdioClient({ command: process.execPath, args: [serverPath] });
    await client.start();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(client.callTool("echo", { text: "x" }, controller.signal), /aborted/);
  } finally {
    client?.stop();
    await rm(serverDir, { recursive: true, force: true });
    await dispose();
  }
});
