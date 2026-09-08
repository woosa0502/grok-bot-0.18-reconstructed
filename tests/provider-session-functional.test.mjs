import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";

const fixtureKey = "__belmontProviderFunctionalFixture";
const previousEnv = Object.fromEntries(["OPENROUTER_API_KEY", "SAND_CLAUDE_MODEL", "SAND_OPENROUTER_MODEL"].map(key => [key, process.env[key]]));
process.env.OPENROUTER_API_KEY = "inert-sdk-fixture";
process.env.SAND_CLAUDE_MODEL = "claude-env-default";
process.env.SAND_OPENROUTER_MODEL = "fixture/env-default";
after(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete globalThis[fixtureKey];
});

// Run the actual provider adapter; every model, process, and persistence
// boundary is an inert local fixture. The SDKs themselves are never invoked.
const mocks = {
  "@anthropic-ai/claude-agent-sdk": `export const query = args => globalThis.${fixtureKey}.claude(args);`,
  "@ai-sdk/openai": "export const createOpenAI = () => ({ chat: modelId => ({ modelId }) });",
  "ai": `export const streamText = args => globalThis.${fixtureKey}.openrouter(args); export const jsonSchema = x => x; export const tool = x => x;`,
  "../../../shared/node/inference-router-local.js": "export const resolveClaudeCodeCliPath = () => '/fixture/no-process';",
  "../../../shared/node/settings/sand-settings-store.js": "export class SandSettingsStore { recordInferenceUsage() {} }",
  "../../host-paths.js": "export const getSandRootDir = () => '/fixture/no-files';",
  "../secrets/secrets-service.js": "export const getBoxSecretsStorePath = () => { throw new Error('Unexpected persistence access'); };",
  "./pi-codex-runtime.js": `export const createPiCodexExecutor = args => globalThis.${fixtureKey}.codex(args);`,
};
const built = await build({
  entryPoints: [path.resolve(import.meta.dirname, "../source/host/extensions/inference/provider-session.ts")],
  bundle: true, platform: "node", format: "esm", target: "node26", write: false,
  plugins: [{ name: "inert-sdk-fixtures", setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }],
});
const provider = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

function fixture({ hold = false, fail = false } = {}) {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  async function wait(signal) {
    started.resolve();
    signal?.throwIfAborted();
    if (hold) await new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal?.addEventListener("abort", abort, { once: true });
      release.promise.then(() => { signal?.removeEventListener("abort", abort); resolve(); });
    });
    signal?.throwIfAborted();
    if (fail) throw new Error("fixture-provider-error");
  }
  function ai(args, kind) {
    const signal = args.abortSignal ?? args.signal;
    calls.push({ kind, model: args.model?.modelId ?? args.modelId, signal });
    const response = Promise.withResolvers();
    const usage = Promise.withResolvers();
    // Raw SDK promises are handled, like the actual SDK's lazy promises.
    response.promise.catch(() => undefined);
    usage.promise.catch(() => undefined);
    const fullStream = (async function* () {
      try {
        await wait(signal);
        yield { type: "text-delta", textDelta: "fixture-ok" };
        usage.resolve({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
        response.resolve({ messages: [{ role: "assistant", content: [{ type: "text", text: "fixture-ok" }] }] });
      } catch (error) { response.reject(error); usage.reject(error); throw error; }
    })();
    return { fullStream, response: response.promise, usage: usage.promise, extendedUsage: usage.promise, providerMetadata: Promise.resolve({}) };
  }
  globalThis[fixtureKey] = {
    openrouter: args => ai(args, "openrouter"),
    codex: args => ai(args, "codex"),
    claude: async function* (args) {
      const signal = args.options.abortController?.signal;
      const prompt = typeof args.prompt === "string" ? args.prompt : await Array.fromAsync(args.prompt);
      calls.push({ kind: "claude-code", model: args.options.model, signal, prompt });
      await wait(signal);
      yield { type: "result", subtype: "success", result: "fixture-ok", session_id: "fixture", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
    },
  };
  return { started, release, calls };
}

async function consume(result) {
  const derived = [result.response, result.usage, result.extendedUsage, result.providerMetadata].map(p => Promise.resolve(p).catch(() => undefined));
  const events = [];
  try { for await (const event of result.fullStream) events.push(event); }
  finally { await Promise.all(derived); }
  return { events, response: await result.response };
}

for (const kind of ["codex", "openrouter", "claude-code"]) {
  test(`${kind}: session and per-turn model selection reaches the executor`, async () => {
    const f = fixture();
    const session = provider.createProviderPromptSession(kind, "session-model");
    assert.equal(session.getModelId(), "session-model");
    const executor = session.getExecutor();
    executor.appendMessages([{ role: "user", content: "fixture request" }]);
    await consume(executor.stream({}, "fixture-1"));
    await consume(executor.stream({ modelId: "per-turn-model" }, "fixture-2"));
    assert.deepEqual(f.calls.map(call => call.model), ["session-model", "per-turn-model"]);
  });

  test(`${kind}: active cancellation reaches an in-flight session request`, async () => {
    const f = fixture({ hold: true });
    const controller = new AbortController();
    const executor = provider.createProviderPromptSession(kind, "fixture-model").getExecutor();
    const promise = consume(executor.stream({ signal: controller.signal }, "fixture-stop"));
    const rejected = assert.rejects(promise, /fixture-stop/);
    await f.started.promise;
    controller.abort(new Error("fixture-stop"));
    await rejected;
    assert.equal(f.calls[0].signal.aborted, true);
    f.release.resolve();
  });
}

for (const kind of ["openrouter", "claude-code"]) {
  test(`${kind}: text helper forwards model, succeeds, and stops on abort`, async () => {
    let f = fixture();
    assert.equal(await provider.runRoutedProviderText(kind, [{ role: "user", content: "fixture" }], { modelId: "helper-model" }), "fixture-ok");
    assert.equal(f.calls[0].model, "helper-model");
    f = fixture({ hold: true });
    const controller = new AbortController();
    const promise = provider.runRoutedProviderText(kind, [], { signal: controller.signal, modelId: "helper-model" });
    const rejected = assert.rejects(promise, /helper-stop/);
    await f.started.promise;
    controller.abort(new Error("helper-stop"));
    await rejected;
    assert.equal(f.calls[0].signal.aborted, true);
    f.release.resolve();
  });

  test(`${kind}: already-aborted text helper never starts an SDK query`, async () => {
    const f = fixture();
    const signal = AbortSignal.abort(new Error("before-start"));
    await assert.rejects(provider.runRoutedProviderText(kind, [], { signal }), /before-start/);
    assert.equal(f.calls.length, 0);
  });

  test(`${kind}: provider failure remains visible to text helper callers`, async () => {
    fixture({ fail: true });
    await assert.rejects(provider.runRoutedProviderText(kind, []), /fixture-provider-error/);
  });
}

test("Claude default follows configured model and removes its parent abort listener", async () => {
  const f = fixture();
  const controller = new AbortController();
  const originalAdd = controller.signal.addEventListener.bind(controller.signal);
  const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
  const listeners = new Set();
  controller.signal.addEventListener = (name, listener, options) => { if (name === "abort") listeners.add(listener); return originalAdd(name, listener, options); };
  controller.signal.removeEventListener = (name, listener, options) => { if (name === "abort") listeners.delete(listener); return originalRemove(name, listener, options); };
  const session = provider.createProviderPromptSession("claude-code");
  assert.equal(session.getModelId(), "claude-env-default");
  const completed = await consume(session.getExecutor().stream({ signal: controller.signal }, "fixture-default"));
  assert.equal(f.calls[0].model, "claude-env-default");
  assert.equal(completed.response.modelId, "claude-env-default");
  assert.equal(listeners.size, 0);
});

test("Claude text helper normalizes an empty or padded model override", async () => {
  const f = fixture();
  for (const modelId of ["", "   ", "claude-code", "  requested-model  "]) {
    await provider.runRoutedProviderText("claude-code", [], { modelId });
  }
  assert.deepEqual(f.calls.map(call => call.model), ["claude-env-default", "claude-env-default", "claude-env-default", "requested-model"]);
});

test("changing the selected provider and model does not retarget an active request", async () => {
  const f = fixture({ hold: true });
  const context = { modelId: "active-model" };
  const current = provider.createProviderPromptSession("claude-code", "session-default").getExecutor();
  const active = consume(current.stream(context, "fixture-active"));
  await f.started.promise;
  context.modelId = "next-model";
  const next = provider.createProviderPromptSession("openrouter", context.modelId).getExecutor();
  const nextRequest = consume(next.stream({}, "fixture-next"));
  f.release.resolve();
  await Promise.all([active, nextRequest]);
  assert.deepEqual(f.calls.map(({ kind, model }) => ({ kind, model })), [
    { kind: "claude-code", model: "active-model" },
    { kind: "openrouter", model: "next-model" },
  ]);
});

test("Claude media input preserves transcript order and native image/document blocks", async () => {
  const f = fixture();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const pdf = Buffer.from("%PDF-1.7\nfixture").toString("base64");
  await provider.runRoutedProviderText("claude-code", [
    { role: "system", content: "fixture system" },
    { role: "user", content: [
      { type: "text", text: "before image" },
      { type: "image", image: `data:image/png;base64,${png}` },
      { type: "text", text: "after image" },
      { type: "file", mimeType: "application/pdf", data: pdf },
      { type: "file", mimeType: "text/plain", data: Buffer.from("fixture text file") },
    ] },
    { role: "assistant", content: "fixture assistant" },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "fixture-call", experimental_content: [{ type: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from(png, "base64")) }] }] },
  ]);
  const envelope = f.calls[0].prompt[0];
  assert.equal(envelope.type, "user");
  assert.equal(envelope.message.role, "user");
  const blocks = envelope.message.content;
  assert.deepEqual(blocks.filter(block => block.type === "image").map(block => block.source), [
    { type: "base64", media_type: "image/png", data: png },
    { type: "base64", media_type: "image/png", data: png },
  ]);
  assert.deepEqual(blocks.filter(block => block.type === "document").map(block => block.source), [
    { type: "base64", media_type: "application/pdf", data: pdf },
    { type: "text", media_type: "text/plain", data: "fixture text file" },
  ]);
  assert.deepEqual(blocks.filter(block => block.type === "text" && /^(SYSTEM|USER|ASSISTANT|TOOL):$/.test(block.text)).map(block => block.text), ["SYSTEM:", "USER:", "ASSISTANT:", "TOOL:"]);
  const imageIndex = blocks.findIndex(block => block.type === "image");
  assert.equal(blocks[imageIndex - 1].text, "before image");
  assert.equal(blocks[imageIndex + 1].text, "after image");
  assert.equal(blocks.some(block => block.type === "text" && (block.text.includes(png) || block.text.includes(pdf))), false);
});

test("Claude converts media URLs and reports unsupported attachments explicitly", async () => {
  const f = fixture();
  const executor = provider.createProviderPromptSession("claude-code").getExecutor();
  executor.appendMessages([{ role: "user", content: [
    { type: "image", image: new URL("https://fixture.invalid/image.png") },
    { type: "file", mimeType: "application/pdf", data: new URL("https://fixture.invalid/file.pdf") },
    { type: "file", mimeType: "application/zip", data: "BINARY_SENTINEL" },
    { type: "audio", data: "AUDIO_SENTINEL" },
    { type: "video", data: "VIDEO_SENTINEL" },
  ] }]);
  await consume(executor.stream({}, "fixture-media"));
  const blocks = f.calls[0].prompt[0].message.content;
  assert.deepEqual(blocks.find(block => block.type === "image").source, { type: "url", url: "https://fixture.invalid/image.png" });
  assert.deepEqual(blocks.find(block => block.type === "document").source, { type: "url", url: "https://fixture.invalid/file.pdf" });
  const text = blocks.filter(block => block.type === "text").map(block => block.text).join("\n");
  assert.match(text, /application\/zip.*Do not claim/);
  assert.match(text, /audio requires media preprocessing/);
  assert.match(text, /video requires media preprocessing/);
  assert.doesNotMatch(text, /BINARY_SENTINEL|AUDIO_SENTINEL|VIDEO_SENTINEL/);
});
