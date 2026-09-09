// Golden E2E E05/E06/E18 at the authoritative executor boundary: the real AI SDK client and the real
// ProviderPromptExecutor talk to a local OpenAI-compatible HTTP stub (streaming SSE), so request shape, tool
// definitions, tool-call parsing, tool-result continuation, provider failures and abort are exercised for real.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previousEnv = Object.fromEntries(["OPENROUTER_API_KEY", "SAND_OPENROUTER_BASE_URL", "SAND_OPENROUTER_MODEL", "SAND_AGENT_MOCK_RESPONSE", "SAND_CLAUDE_MODEL"].map((key) => [key, process.env[key]]));
after(() => { for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
delete process.env.SAND_AGENT_MOCK_RESPONSE;

// ---- local OpenAI-compatible stub ----
const stub = { mode: "tools", requests: [], closedRequests: 0, server: null, baseUrl: "" };
function sse(res, chunks) { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); }
const chunk = (delta, finish = null) => ({ id: "chatcmpl-stub", object: "chat.completion.chunk", created: 1, model: "stub/echo", choices: [{ index: 0, delta, finish_reason: finish }] });
before(async () => {
  stub.server = http.createServer((req, res) => {
    let body = ""; req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}"); stub.requests.push({ url: req.url, headers: req.headers, body: parsed });
      if (req.url !== "/v1/chat/completions") { res.writeHead(404); res.end(); return; }
      if (stub.mode === "429") { res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "rate limited", type: "rate_limit" } })); return; }
      if (stub.mode === "401") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "invalid api key", type: "auth" } })); return; }
      if (stub.mode === "hang") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: "partial" }))}\n\n`); req.on("close", () => { stub.closedRequests += 1; }); return; }
      const sawToolResult = parsed.messages.some((m) => m.role === "tool");
      if (!sawToolResult) {
        sse(res, [chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "echo", arguments: "" } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"text\":" } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: "\"hi\"}" } }] }), chunk({}, "tool_calls"), { ...chunk({}), choices: [], usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 } }]);
      } else {
        const toolResult = parsed.messages.find((m) => m.role === "tool");
        sse(res, [chunk({ role: "assistant", content: "echo said " }), chunk({ content: JSON.parse(toolResult.content).text ?? "?" }), chunk({}, "stop"), { ...chunk({}), choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } }]);
      }
    });
  });
  await new Promise((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
  stub.baseUrl = `http://127.0.0.1:${stub.server.address().port}/v1`;
  process.env.OPENROUTER_API_KEY = "stub-key"; process.env.SAND_OPENROUTER_BASE_URL = stub.baseUrl; process.env.SAND_OPENROUTER_MODEL = "stub/echo";
});
after(() => new Promise((resolve) => stub.server?.close(resolve)));

// ---- real provider adapter (real `ai` + `@ai-sdk/openai`), inert host boundaries ----
const mocks = {
  "../../../shared/node/inference-router-local.js": `export const resolveClaudeCodeCliPath = () => globalThis.__e2eClaudeCli ?? null;`,
  "../../../shared/node/settings/sand-settings-store.js": "export class SandSettingsStore { recordInferenceUsage() {} getInferenceProvider() { return 'openrouter'; } }",
  "../../host-paths.js": "export const getSandRootDir = () => '/fixture/no-files';",
  "../secrets/secrets-service.js": "export const getBoxSecretsStorePath = () => { throw new Error('Unexpected persistence access'); };",
  "./pi-codex-runtime.js": "export const createPiCodexExecutor = () => { throw new Error('codex not exercised'); }; export const getPiCodexAuthStatus = async () => ({ configured: false }); export const loginPiCodex = async () => {}; export const logoutPiCodex = async () => {};",
  "./pi-codex-login-session.js": "export const createPiCodexLoginSession = () => ({ start() {}, status() { return {}; }, cancel() {} });",
  "../../../shared/node/local-codex-account.js": "export const isLocalCodexMode = () => false;",
};
async function bundle(entry) {
  const built = await build({ entryPoints: [path.resolve(repoRoot, entry)], bundle: true, platform: "node", format: "esm", target: "node26", write: false,
    plugins: [{ name: "inert-host-boundaries", setup(plugin) { plugin.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined); plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: mocks[args.path], loader: "js" })); } }] });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
}
const provider = await bundle("source/host/extensions/inference/provider-session.ts");
const extension = await bundle("source/host/extensions/inference/extension.ts");

async function consume(result) {
  const derived = [result.response, result.usage, result.extendedUsage, result.providerMetadata].map((p) => Promise.resolve(p).catch(() => undefined));
  const events = []; let streamError = null;
  try { for await (const event of result.fullStream) events.push(event); } catch (error) { streamError = error; } finally { await Promise.all(derived); }
  return { events, streamError, response: await Promise.resolve(result.response).catch((error) => ({ rejected: error })) };
}
const echoTool = [{ name: "echo", description: "Echo the given text back.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];

test("E05: a real streaming request carries the host tool definitions, yields the tool call, and the tool result continues to the final answer", async () => {
  stub.mode = "tools"; stub.requests.length = 0;
  const executor = provider.createProviderPromptSession("openrouter", "stub/echo").getExecutor();
  executor.appendMessages([{ role: "user", content: "please echo hi" }]);
  const first = await consume(executor.stream({}, "turn-1", echoTool));
  assert.equal(first.streamError, null, String(first.streamError));
  const toolCall = first.events.find((e) => e.type === "tool-call");
  assert.ok(toolCall, `no tool-call part in ${JSON.stringify(first.events.map((e) => e.type))}`);
  assert.equal(toolCall.toolName, "echo");
  assert.deepEqual(typeof toolCall.args === "string" ? JSON.parse(toolCall.args) : toolCall.args, { text: "hi" });
  assert.equal(stub.requests.length, 1);
  assert.deepEqual(stub.requests[0].body.tools.map((t) => t.function.name), ["echo"], "definitions reach the wire as OpenAI tools");
  assert.equal(stub.requests[0].headers.authorization, "Bearer stub-key");
  assert.ok(!first.events.some((e) => e.type === "text-delta"), "no answer text before the tool ran");
  // The host runner owns tool execution: it appends the assistant tool call and the tool result, then streams again.
  executor.appendMessages([
    { role: "assistant", content: [{ type: "tool-call", toolCallId: toolCall.toolCallId, toolName: "echo", args: { text: "hi" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: toolCall.toolCallId, toolName: "echo", result: { text: "hi" } }] },
  ]);
  const second = await consume(executor.stream({}, "turn-2", echoTool));
  assert.equal(second.streamError, null, String(second.streamError));
  assert.equal(second.events.filter((e) => e.type === "text-delta").map((e) => e.textDelta).join(""), "echo said hi");
  assert.equal(stub.requests.length, 2);
  assert.ok(stub.requests[1].body.messages.some((m) => m.role === "tool" && m.tool_call_id === toolCall.toolCallId), "the tool result is sent back under the same call id");
  assert.equal(second.response.modelId ?? second.response.model ?? "stub/echo", "stub/echo");
});

test("E06: rate limit and auth failures surface as errors with no answer text and no tool execution", async () => {
  for (const mode of ["429", "401"]) {
    stub.mode = mode; stub.requests.length = 0;
    const executor = provider.createProviderPromptSession("openrouter", "stub/echo").getExecutor();
    executor.appendMessages([{ role: "user", content: "please echo hi" }]);
    const out = await consume(executor.stream({}, `turn-${mode}`, echoTool));
    const errored = out.streamError !== null || out.events.some((e) => e.type === "error") || out.response?.rejected !== undefined;
    assert.ok(errored, `${mode}: the failure must be visible (events ${JSON.stringify(out.events.map((e) => e.type))})`);
    assert.ok(!out.events.some((e) => e.type === "text-delta" || e.type === "tool-call"), `${mode}: no text or tool call was produced`);
    // The SDK retries rate limits with bounded backoff (default 2 retries) and never retries an auth failure.
    if (mode === "429") assert.ok(stub.requests.length >= 1 && stub.requests.length <= 3, `429: bounded retries, saw ${stub.requests.length}`);
    else assert.equal(stub.requests.length, 1, "401 is not retried");
  }
});

test("E06: an abort during streaming rejects promptly with the abort reason and closes the upstream request", async () => {
  stub.mode = "hang"; stub.requests.length = 0; stub.closedRequests = 0;
  const controller = new AbortController();
  const executor = provider.createProviderPromptSession("openrouter", "stub/echo").getExecutor();
  executor.appendMessages([{ role: "user", content: "hang" }]);
  const pending = consume(executor.stream({ signal: controller.signal }, "turn-abort", echoTool));
  await new Promise((resolve) => setTimeout(resolve, 150));
  controller.abort(new Error("user-stop"));
  const out = await pending;
  assert.ok(out.streamError !== null || out.events.some((e) => e.type === "error"), "the abort is visible to the consumer");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(stub.closedRequests, 1, "the upstream HTTP request is closed on abort");
  assert.ok(!out.events.some((e) => e.type === "finish" && e.finishReason === "stop"), "no clean finish is reported for an aborted stream");
  stub.mode = "tools";
});

test("E18: run readiness follows the selected provider, not only a Cursor token or local Codex", async () => {
  const ready = async (providerName) => {
    const api = extension.inferenceExtension.start({ deps: { auth: { peekAccessToken: () => null }, experiments: {}, settings: { getInferenceProvider: () => providerName } }, createPort: () => ({}), createWebSearch: () => null, createWebFetch: () => null });
    return api.isReady();
  };
  assert.equal(await ready("openrouter"), true, "OpenRouter-only account with a key is ready");
  const key = process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_API_KEY;
  try { assert.equal(await ready("openrouter"), false, "no key -> not ready"); } finally { process.env.OPENROUTER_API_KEY = key; }
  assert.equal(await ready("cursor"), false, "Cursor without a token stays not ready");
  assert.equal(await ready("codex"), false, "Codex without the Pi credential is not ready");
  globalThis.__e2eClaudeCli = "/fixture/claude";
  try { assert.equal(await ready("claude-code"), true, "Claude Code with its CLI present is ready"); } finally { delete globalThis.__e2eClaudeCli; }
  assert.equal(await ready("claude-code"), false, "Claude Code without the CLI is not ready");
});
