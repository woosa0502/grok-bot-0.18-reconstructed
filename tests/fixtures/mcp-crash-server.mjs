#!/usr/bin/env node
// Tiny MCP stdio server: initialize/tools list + echo + crash (process exit).
import { createInterface } from "node:readline";
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "notifications/initialized" || id === undefined) return;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "crash-fixture" }, capabilities: {} } });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: [
    { name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
    { name: "crash", description: "exit", inputSchema: { type: "object", properties: {} } },
  ] } });
  if (method === "tools/call") {
    if (params?.name === "crash") process.exit(3);
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `ECHO ${params?.arguments?.text ?? ""}` }] } });
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
});
