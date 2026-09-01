// A2: the reproduced context-overflow death (live, 2026-09-01 — a long
// transcript agent died with "Codex error: Your input exceeds the context
// window" instead of compacting). Two mechanisms, both pinned here:
//  1. PREVENTIVE — the effective window fed to the summarization trigger must
//     not trust the catalog's 272k upward (the Codex OAuth backend rejects at
//     ~55–83k, so the 0.9 trigger sat at an unreachable ~245k). Unpinned, the
//     window defaults conservatively to 50k so the proactive trigger (45k)
//     stays below the LOWEST observed backend rejection.
//  2. REACTIVE — the summarization retry loop dispatches on
//     `error instanceof InputTokenLimitError`, but the local Pi runtime threw
//     plain Errors, so the blocking-compaction recovery never ran. The runtime
//     must classify its failures into the typed errors.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadModules() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "overflow-entry.ts",
      contents: `
        export { effectiveContextWindowTokens, CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS } from "./source/host/extensions/inference/context-window.js";
        export { classifyTokenLimitErrorFromMessage } from "./source/packages/chat-inference/token-limit-error-classification.js";
        export { InputTokenLimitError } from "./source/packages/chat-inference/prompt-executor.js";
        export { SELF_SUMMARY_CONTEXT_WINDOW_FRACTION } from "./source/packages/agent/self-summary/constants.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const modulesPromise = loadModules();

test("unpinned, the effective window never trusts the catalog upward", async () => {
  const { effectiveContextWindowTokens, CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS, SELF_SUMMARY_CONTEXT_WINDOW_FRACTION } = await modulesPromise;
  const env = {};
  // The 272k catalog value is clamped to the conservative default…
  assert.equal(effectiveContextWindowTokens(272_000, env), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  // …a SMALLER catalog value is real and respected…
  assert.equal(effectiveContextWindowTokens(30_000, env), 30_000);
  // …and a missing catalog still yields a usable window (0 disables the trigger).
  assert.equal(effectiveContextWindowTokens(undefined, env), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  // The proactive trigger must sit below the lowest observed backend rejection (~55k).
  assert.ok(CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS * SELF_SUMMARY_CONTEXT_WINDOW_FRACTION < 55_000);
});

test("the env pin and cap still override in both directions", async () => {
  const { effectiveContextWindowTokens } = await modulesPromise;
  // An operator who knows the real limit can pin ABOVE the default.
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "80000" }), 80_000);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "40000" }), 40_000);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "80000", SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS: "60000" }), 60_000);
  // Garbage never disables compaction.
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "banana" }) > 0, true);
});

test("the live overflow message classifies into the typed retry-loop error", async () => {
  const { classifyTokenLimitErrorFromMessage, InputTokenLimitError } = await modulesPromise;
  const live = "Your input exceeds the context window of this model. Please adjust your input and try again.";
  const classified = classifyTokenLimitErrorFromMessage(live);
  assert.ok(classified instanceof InputTokenLimitError, "the exact live message must classify as InputTokenLimitError");
  assert.equal(classifyTokenLimitErrorFromMessage("connection reset by peer"), undefined, "unrelated errors stay unclassified");
});

test("the Pi runtime classifies its failures before rejecting", () => {
  const runtime = read("source/host/extensions/inference/pi-codex-runtime.ts");
  assert.match(runtime, /classifyTokenLimitErrorFromMessage\(error\.message\)/, "the catch path must classify");
  assert.match(runtime, /response\.reject\(finalError\)/, "the classified error must be the one rejected");
  assert.match(runtime, /throw finalError;/, "and the one thrown");
});

test("rate-limit failures carry retry guidance; token-limit classification wins", async () => {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "ratelimit-entry.ts",
      contents: 'export { isRateLimitLikeMessage } from "./source/host/extensions/inference/pi-codex-runtime.js";',
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
  });
  const { isRateLimitLikeMessage } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  for (const message of [
    "HTTP 429 Too Many Requests",
    "the model is currently overloaded",
    "Rate limit exceeded, retry later",
    "503 Service Unavailable",
    "You have hit your usage limit",
  ]) assert.equal(isRateLimitLikeMessage(message), true, message);
  for (const message of [
    "Your input exceeds the context window of this model.",
    "connection reset by peer",
    "file not found",
  ]) assert.equal(isRateLimitLikeMessage(message), false, message);
  const runtime = read("source/host/extensions/inference/pi-codex-runtime.ts");
  assert.match(runtime, /rate limiting or overloaded right now; this is transient/);
});
