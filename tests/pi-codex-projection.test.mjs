import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { transform } from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function loadProjection() {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/pi-codex-projection.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function assistant(content, stopReason = "pending") {
  return {
    role: "assistant",
    content,
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 123,
  };
}

test("Pi projection preserves cross-realm Uint8Array images as base64", async () => {
  const projection = await loadProjection();
  const foreignBytes = vm.runInNewContext("new Uint8Array([0, 1, 2, 255])");
  const messages = projection.messagesToPi([{
    role: "user",
    content: [{ type: "image", data: foreignBytes, mimeType: "image/png" }],
  }], () => 1);
  assert.equal(messages[0].role, "user");
  assert.deepEqual(messages[0].content, [{ type: "image", data: "AAEC/w==", mimeType: "image/png" }]);
});

test("Pi projection preserves assistant tool-call and tool-result ordering", async () => {
  const projection = await loadProjection();
  const messages = projection.messagesToPi([{
    role: "assistant",
    content: [
      { type: "text", text: "before" },
      { type: "tool-call", toolCallId: "call-1", toolName: "Shell", args: { command: "pwd" } },
      { type: "tool-result", toolCallId: "call-1", toolName: "Shell", result: "/workspace" },
      { type: "text", text: "after" },
    ],
  }], () => 1);
  assert.deepEqual(messages.map(message => message.role), ["assistant", "toolResult", "assistant"]);
  assert.equal(messages[0].content[1].type, "toolCall");
  assert.equal(messages[1].toolCallId, "call-1");
  assert.equal(messages[2].content[0].text, "after");
});

test("Pi materializer reconciles malformed incremental state from authoritative partial output", async () => {
  const projection = await loadProjection();
  const materializer = new projection.PiStreamMaterializer();
  materializer.apply({ type: "start", partial: assistant([]) });
  const partial = assistant([{ type: "text", text: "recovered" }]);
  const emitted = materializer.apply({ type: "text_delta", contentIndex: 7, delta: "recovered", partial });
  assert.deepEqual(emitted, { type: "text-delta", textDelta: "recovered" });
  assert.deepEqual(materializer.content(), partial.content);
});

test("Pi final output replaces stale deltas and retains reasoning and delegated tool calls", async () => {
  const projection = await loadProjection();
  const materializer = new projection.PiStreamMaterializer();
  materializer.apply({ type: "start", partial: assistant([{ type: "text", text: "" }]) });
  materializer.apply({
    type: "text_delta",
    contentIndex: 0,
    delta: "stale",
    partial: assistant([{ type: "text", text: "stale" }]),
  });
  const final = assistant([
    { type: "thinking", thinking: "reason" },
    { type: "toolCall", id: "call-2", name: "Read", arguments: { path: "/workspace/a" } },
    { type: "text", text: "fresh" },
  ], "toolUse");
  materializer.apply({ type: "done", reason: "toolUse", message: final });
  assert.deepEqual(projection.belmontContentFromPi(materializer.content()), [
    // Reasoning maps to Belmont's canonical { type: "reasoning", text } — the field is `text`, so
    // hasMeaningfulContentPart (which reads part.text.trim()) does not crash on a reasoning part.
    { type: "reasoning", text: "reason" },
    { type: "tool-call", toolCallId: "call-2", toolName: "Read", args: { path: "/workspace/a" } },
    { type: "text", text: "fresh" },
  ]);
  assert.equal(materializer.apply({ type: "text_delta", contentIndex: 2, delta: "late", partial: final }), undefined);
  assert.equal(materializer.content()[2].text, "fresh");
});

test("Pi reasoning carries its signature and redacted reasoning maps to redacted-reasoning", async () => {
  const projection = await loadProjection();
  // A signed (encrypted) reasoning part keeps its signature under `signature`; a redacted part
  // becomes { type: "redacted-reasoning", data } — never a reasoning part with an undefined text.
  const signed = projection.belmontContentFromPi([{ type: "thinking", thinking: "", thinkingSignature: "sig-xyz" }]);
  assert.deepEqual(signed, [{ type: "reasoning", text: "", signature: "sig-xyz" }]);
  const redacted = projection.belmontContentFromPi([{ type: "thinking", thinking: "", thinkingSignature: "enc-1", redacted: true }]);
  assert.deepEqual(redacted, [{ type: "redacted-reasoning", data: "enc-1" }]);
});

test("routed provider state preserves bot-selected model across compact and resume", async () => {
  const projection = await loadProjection();
  const state = projection.createRoutedProviderSessionState([{ role: "user", content: "hello" }], "gpt-5.4");
  assert.deepEqual(projection.parseRoutedProviderSessionState(state), {
    messages: [{ role: "user", content: "hello" }],
    modelId: "gpt-5.4",
  });
  assert.deepEqual(projection.parseRoutedProviderSessionState([{ role: "user", content: "legacy" }]), {
    messages: [{ role: "user", content: "legacy" }],
  });
});

test("routed Codex text reconciles stale deltas from the authoritative final response", async () => {
  const projection = await loadProjection();
  assert.equal(projection.belmontTextFromResponse({
    messages: [{
      role: "assistant",
      content: [
        { type: "reasoning", reasoning: "hidden" },
        { type: "text", text: "fresh" },
        { type: "tool-call", toolCallId: "call", toolName: "Read", args: {} },
      ],
    }],
  }), "fresh");
  assert.equal(projection.belmontTextFromResponse({
    messages: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "call", toolName: "Read", args: {} }] }],
  }), "");
  assert.equal(projection.belmontTextFromResponse({ messages: [] }), null);

  const provider = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(provider, /const authoritative = belmontTextFromResponse\(settled\)/);
  assert.match(provider, /options\?\.onTextDelta\?\.\("", text\)/);
});
