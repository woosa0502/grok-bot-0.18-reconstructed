// A roster bot whose model id names an OpenAI-compatible host ("nvidia/…") runs there while the
// rest of the app stays on the global provider; local context summaries run on the cheap model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("the run shell routes a host-prefixed model id through the openrouter executor and summarizes locally on luna", () => {
  const shell = read("source/host/runner/turn-run-shell.ts");
  assert.match(shell, /const routedHost = openAiCompatibleHostForModel\(resolvedModelId\);/);
  assert.match(shell, /const turnProvider: typeof inferenceProvider = routedHost === undefined \? inferenceProvider : "openrouter";/);
  assert.match(shell, /createProviderPromptSession\(turnProvider, resolvedModelId, resolvedReasoning, input\.conversationId\)/);
  assert.match(shell, /const LOCAL_SUMMARY_MODEL = process\.env\.SAND_CODEX_SUMMARY_MODEL\?\.trim\(\) \|\| "gpt-5\.6-luna";/);
  assert.match(shell, /routedHost === undefined \? LOCAL_SUMMARY_MODEL : resolvedModelId/);
});

test("the provider session honours the requested model on the openrouter path and knows the NVIDIA host", () => {
  const session = read("source/host/extensions/inference/provider-session.ts");
  assert.match(session, /nvidia: \{ baseURL: "https:\/\/integrate\.api\.nvidia\.com\/v1", keyName: "NVIDIA_API_KEY"/);
  assert.match(session, /: requested \|\| process\.env\.SAND_OPENROUTER_MODEL\?\.trim\(\) \|\| "openai\/gpt-5\.2";/);
  assert.match(session, /openRouterExecutor\(this\.getMessages\(\), invocationId, definitions, undefined, this\.onUsage, undefined, modelFromContext\(ctx\) \?\? this\.modelId\)/);
  assert.match(session, /modelId: requestedModelId\.slice\(host\.length \+ 1\)/, "the host prefix is stripped before the request");
});
