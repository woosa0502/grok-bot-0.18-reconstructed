import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function load(t) {
  const dir = await mkdtemp(join(tmpdir(), "belmont-template-draft-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "draft.mjs");
  await build({ entryPoints: ["source/host/extensions/inference/template-draft.ts"], outfile: file, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
  return (await import(pathToFileURL(file).href)).generateBotTemplateDraft;
}

test("draft uses selected host session without tools and accepts authoritative final response", async t => {
  const generate = await load(t);
  let seen;
  const owner = { createSession(_callback, options) { return { getModelId: () => options.modelId, getExecutor(messages) { return { stream(context, _invocation, tools) {
    seen = { options, messages, tools, signal: context.signal, reasoning: context.reasoning };
    return { fullStream: (async function* () { yield { type: "text-delta", textDelta: "provisional" }; })(), response: Promise.resolve({ messages: [{ role: "assistant", content: "authoritative" }] }) };
  } }; } }; } };
  const result = await generate(owner, { prompt: "Draft" }, { modelId: "local-selected", reasoning: "low", mcpTools: [{ name: "connected-read" }] });
  assert.deepEqual(seen.tools, []);
  assert.equal(seen.options.modelId, "local-selected");
  assert.equal(seen.reasoning, "low");
  assert.match(seen.messages[0].content, /connected-read/);
  assert.equal(result.text, "authoritative");
  assert.equal(result.reasoning, "low");
  assert.equal(seen.signal.aborted, true);
});

test("draft has bounded time even when a provider ignores abort", async t => {
  const generate = await load(t);
  let signal;
  const owner = { createSession() { return { getModelId: () => "test", getExecutor() { return { stream(context) { signal = context.signal; return { fullStream: (async function* () { await new Promise(() => {}); })() }; } }; } }; } };
  await assert.rejects(() => generate(owner, { prompt: "Draft" }, { mcpTools: [] }, 10), /초과/);
  assert.equal(signal.aborted, true);
});

test("draft rejects tool requests, oversized final output, and provider errors", async t => {
  const generate = await load(t);
  for (const event of [{ type: "tool-call" }, { type: "error", error: "failed" }, { type: "text-delta", textDelta: "x".repeat(80001) }]) {
    const owner = { createSession() { return { getModelId: () => "test", getExecutor() { return { stream() { return { fullStream: (async function* () { yield event; })() }; } }; } }; } };
    await assert.rejects(() => generate(owner, { prompt: "Draft" }, { mcpTools: [] }));
  }
});

test("regular and slim HTTP gateway registries route template drafts to the host API", async t => {
  const dir = await mkdtemp(join(tmpdir(), "belmont-template-route-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "protocol.mjs");
  await build({ entryPoints: ["source/host/gateway-protocol.ts"], outfile: file, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const protocol = await import(pathToFileURL(file).href);
  for (const registry of [protocol.SAND_GATEWAY_COMMANDS, protocol.SAND_GATEWAY_SLIM_COMMANDS]) {
    const calls = [];
    const result = await registry.generateBotTemplateDraft({ generateBotTemplateDraft(args) { calls.push(args); return { text: "draft", modelId: "selected" }; } }, JSON.stringify({ prompt: "from mobile" }));
    assert.deepEqual(calls, [{ prompt: "from mobile" }]);
    assert.deepEqual(result, { text: "draft", modelId: "selected" });
  }
});

test("host template endpoint forwards configured model effort and actual MCP tools", async t => {
  const dir = await mkdtemp(join(tmpdir(), "belmont-template-host-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "gateway.mjs");
  await build({ entryPoints: ["source/host/host-gateway-api.ts"], outfile: file, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { createHostGatewayApi } = await import(pathToFileURL(file).href);
  let seen;
  const owner = { createSession(_callback, options) { return { getModelId: () => options.modelId, getExecutor(messages) { return { stream(context, _id, tools) {
    seen = { modelId: options.modelId, reasoning: context.reasoning, messages, tools };
    return { fullStream: (async function* () { yield { type: "text-delta", textDelta: "draft" }; })() };
  } }; } }; } };
  const extensions = {
    settings: { getHostSettings: () => ({ inferenceProvider: "codex", localToolPermission: "ask", agentDefaultModel: { modelId: "gpt-5.6-sol", parameters: [{ id: "effort", value: "low" }] }, userLanguage: "ko", userTimeZone: "UTC", userTimeZoneOverride: "Asia/Seoul" }) },
    inference: { port: owner },
    mcp: { mcp: { listTools: async () => [{ name: "connected-reader", description: "Read supplied records" }] } },
  };
  const api = createHostGatewayApi({ extensions: { api: name => extensions[name] ?? {} } });
  const result = await api.generateBotTemplateDraft({ prompt: "Draft" });
  assert.equal(seen.modelId, "gpt-5.6-sol");
  assert.equal(seen.reasoning, "low");
  assert.deepEqual(seen.tools, []);
  assert.match(seen.messages[0].content, /connected-reader/);
  assert.match(seen.messages[0].content, /Asia\/Seoul/);
  assert.match(seen.messages[0].content, /builtInToolContracts/);
  assert.match(seen.messages[0].content, /"name":"Read"/);
  assert.match(seen.messages[0].content, /"name":"Shell"/);
  assert.match(seen.messages[0].content, /"mcpTools"/);
  assert.match(seen.messages[0].content, /localToolPermission/);
  assert.equal(result.reasoning, "low");
});
