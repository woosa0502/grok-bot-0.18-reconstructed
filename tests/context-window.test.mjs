// Effective context window for pre-emptive compaction (AUDIT-6B operator knobs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/inference/context-window.ts")],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("trusts the nominal window only downward; env pin/cap still override", async () => {
  // A2 (2026-09-01): trusting the catalog's 272k upward put the compaction
  // trigger above the backend's real ~55-83k rejection floor and long
  // conversations died instead of compacting. Unpinned now defaults to the
  // conservative 50k; a SMALLER nominal window stays respected.
  const { effectiveContextWindowTokens, CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS } = await load();
  assert.equal(effectiveContextWindowTokens(272_000, {}), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  assert.equal(effectiveContextWindowTokens(undefined, {}), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  assert.equal(effectiveContextWindowTokens(30_000, {}), 30_000);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "120000" }), 120_000);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS: "100000" }), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS: "40000" }), 40_000);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "200000", SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS: "150000" }), 150_000);
  // Invalid values never disable compaction.
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "abc" }), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  assert.equal(effectiveContextWindowTokens(272_000, { SAND_CODEX_CONTEXT_WINDOW_TOKENS: "0" }), CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
});

test("Pi runtime reports the effective window to the summarization orchestrator", () => {
  const source = readFileSync(path.join(repoRoot, "source/host/extensions/inference/pi-codex-runtime.ts"), "utf8");
  assert.match(source, /maxTokens: effectiveContextWindowTokens\(resolved\.model\.contextWindow\)/);
  assert.doesNotMatch(source, /maxTokens: resolved\.model\.contextWindow \?\? 0/);
});
