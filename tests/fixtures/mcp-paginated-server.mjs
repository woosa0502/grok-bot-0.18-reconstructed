#!/usr/bin/env node
// Minimal stdio MCP server for tests: paginated tools/list (two pages) and a
// `grow` tool that adds a new tool and emits notifications/tools/list_changed.
import { createInterface } from "node:readline";

const tools = [
  { name: "alpha", description: "first page tool", inputSchema: { type: "object" } },
  { name: "beta", description: "second page tool", inputSchema: { type: "object" } },
  { name: "grow", description: "adds a tool and notifies list_changed", inputSchema: { type: "object" } },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "paginated-fixture" } } });
  } else if (message.method === "tools/list") {
    const cursor = message.params?.cursor;
    if (cursor === undefined) send({ jsonrpc: "2.0", id: message.id, result: { tools: tools.slice(0, 1), nextCursor: "page-2" } });
    else send({ jsonrpc: "2.0", id: message.id, result: { tools: tools.slice(1) } });
  } else if (message.method === "tools/call") {
    if (message.params?.name === "grow") {
      tools.push({ name: `gamma-${tools.length}`, description: "added later", inputSchema: { type: "object" } });
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "grown" }] } });
      send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    } else {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `ran ${message.params?.name}` }] } });
    }
  }
});
