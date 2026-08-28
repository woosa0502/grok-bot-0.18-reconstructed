import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function source(relative) {
  return await readFile(path.join(repoRoot, relative), "utf8");
}

test("Pi Codex is loaded lazily so unrelated Belmont bundles do not absorb the coding-agent CLI", async () => {
  const provider = await source("source/host/extensions/inference/provider-session.ts");
  assert.doesNotMatch(provider, /import \{[^}]*createPiCodexExecutor[^}]*\} from/);
  // Lazy, but via a LITERAL specifier so esbuild bundles pi-codex-runtime into the packaged host
  // (a variable dynamic import is left external and fails at runtime with module-not-found). (PI-P0-01)
  assert.match(provider, /import\("\.\/pi-codex-runtime\.js"\)/);
  assert.match(provider, /lazyPiCodexExecutor/);
});

test("Pi emits delegated tool calls while Belmont retains execution ownership", async () => {
  const runtime = await source("source/host/extensions/inference/pi-codex-runtime.ts");
  const projection = await source("source/host/extensions/inference/pi-codex-projection.ts");
  assert.match(runtime, /createPiContext\(options\.messages, options\.definitions/);
  assert.match(runtime, /yield projected/);
  assert.doesNotMatch(runtime, /executeTool/);
  assert.match(projection, /event\.type === "toolcall_end"/);
  assert.match(projection, /type: "tool-call"/);
});

test("Pi boundary preserves images, reasoning, aborts, and authoritative final output", async () => {
  const runtime = await source("source/host/extensions/inference/pi-codex-runtime.ts");
  const projection = await source("source/host/extensions/inference/pi-codex-projection.ts");
  assert.match(projection, /ArrayBuffer\.isView\(value\)/);
  assert.match(projection, /Buffer\.from\(bytes\)\.toString\("base64"\)/);
  assert.match(projection, /reasoning-delta/);
  assert.match(projection, /this\.#content = cloneValue\(message\.content\)/);
  assert.match(runtime, /options\.signal\?\.throwIfAborted\(\)/);
  assert.match(runtime, /materializer\.abort\(\)/);
  assert.match(runtime, /belmontContentFromPi\(materializer\.content\(\)\)/);
});

test("bot-selected Codex model survives executor state and reaches Pi catalog validation", async () => {
  const provider = await source("source/host/extensions/inference/provider-session.ts");
  const runtime = await source("source/host/extensions/inference/pi-codex-runtime.ts");
  const turnShell = await source("source/host/runner/turn-run-shell.ts");
  // getState returns the messages ARRAY (the executor state contract the middlewares and checkpoint
  // path consume with .map()/.length); the model rides the per-run context / requested id, not the
  // state blob, and parseRoutedProviderSessionState still reads a legacy state.modelId if present. (PI-P0-03)
  assert.match(provider, /return \[\.\.\.this\.#messages\];/);
  assert.match(provider, /parsed\.modelId \?\? modelId/);
  assert.match(provider, /modelFromContext\(ctx\) \?\? this\.modelId/);
  // Per-agent model + reasoning ride the same requested-model channel: main vs subagent each resolve
  // their own selection (model id + effort) from settings, and reasoning threads through the context
  // alongside modelId (reasoningFromContext ?? this.reasoning).
  assert.match(provider, /reasoningFromContext\(ctx\) \?\? this\.reasoning/);
  assert.match(turnShell, /createProviderPromptSession\(inferenceProvider, resolvedModelId, resolvedReasoning\)/);
  assert.match(runtime, /models\.getModel\(CODEX_PROVIDER, selectedId\)/);
  assert.match(runtime, /Unknown Pi Codex model/);
});
