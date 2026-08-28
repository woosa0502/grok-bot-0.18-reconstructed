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
  assert.match(provider, /const PI_RUNTIME_SPECIFIER: string/);
  assert.match(provider, /import\(PI_RUNTIME_SPECIFIER\)/);
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
  assert.match(provider, /createRoutedProviderSessionState\(this\.#messages, this\.modelId\)/);
  assert.match(provider, /parsed\.modelId \?\? modelId/);
  assert.match(provider, /modelFromContext\(ctx\) \?\? this\.modelId/);
  assert.match(turnShell, /createProviderPromptSession\(inferenceProvider, input\.modelId\)/);
  assert.match(runtime, /models\.getModel\(CODEX_PROVIDER, selectedId\)/);
  assert.match(runtime, /Unknown Pi Codex model/);
});
