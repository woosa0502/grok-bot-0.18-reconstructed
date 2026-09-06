// 2026-09-05: what the phone needs from the host so its recovered screens do real work — a
// per-bot model selection over the gateway, a reply-language setting rendered into the prompt,
// and a way to write a memory from outside a turn (autofill).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
async function load(entry) {
  const result = await build({ absWorkingDir: repoRoot, bundle: true, entryPoints: [entry], format: "esm", platform: "node", target: "node22", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("settings store: the reply language and per-bot models round-trip through settings.json", async () => {
  const { SandSettingsStore } = await load("source/shared/node/settings/sand-settings-store.ts");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "belmont-settings-")), "settings.json");
  const store = new SandSettingsStore(file);
  assert.equal(store.getUserLanguage(), undefined);
  store.setUserLanguage("  한국어 ");
  assert.equal(new SandSettingsStore(file).getUserLanguage(), "한국어", "trimmed and persisted");
  store.setUserLanguage("");
  assert.equal(new SandSettingsStore(file).getUserLanguage(), undefined, "empty clears it");
  store.setAgentModelForAgentId("bot-a", { modelId: "gpt-5.6-luna", maxMode: true, parameters: [{ id: "effort", value: "max" }] });
  assert.deepEqual(new SandSettingsStore(file).getAgentModelsByAgentId(), { "bot-a": { modelId: "gpt-5.6-luna", maxMode: true, parameters: [{ id: "effort", value: "max" }] } });
  store.setAgentModelForAgentId("bot-a", undefined);
  assert.deepEqual(new SandSettingsStore(file).getAgentModelsByAgentId(), {});
});

test("settings service: userLanguage flows through getHostSettings/setHostSettings and per-bot selection validates", async () => {
  const { SettingsService } = await load("source/host/extensions/settings/settings-service.ts");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "belmont-settings-service-")), "settings.json");
  const service = new SettingsService(file);
  assert.equal(service.getHostSettings().userLanguage, undefined);
  service.setHostSettings({ userLanguage: "English" });
  assert.equal(service.getHostSettings().userLanguage, "English");
  assert.equal(service.getUserLanguage(), "English");
  service.setHostSettings({ userLanguage: null });
  assert.equal(service.getHostSettings().userLanguage, undefined);
  const selection = { modelId: "gpt-5.6-sol", maxMode: false, parameters: [{ id: "effort", value: "high" }] };
  assert.deepEqual(service.setAgentModelForAgentId("bot-b", selection), selection);
  assert.deepEqual(service.getHostSettings().agentModelsByAgentId, { "bot-b": selection });
  assert.throws(() => service.setAgentModelForAgentId("bot-b", { modelId: "" }), /invalid model selection/);
  assert.equal(service.setAgentModelForAgentId("bot-b", null), undefined);
  assert.deepEqual(service.getAgentModelsByAgentId(), {});
});

test("the reply-language line renders only when set", async () => {
  const { renderUserLanguageSystemPrompt } = await load("source/shared/user-language.ts");
  assert.equal(renderUserLanguageSystemPrompt(undefined), "");
  assert.equal(renderUserLanguageSystemPrompt("  "), "");
  assert.match(renderUserLanguageSystemPrompt("한국어"), /^The user's preferred reply language is 한국어\./);
});

test("wiring: gateway methods, prompt section, request context, and memory add are connected", () => {
  const protocol = read("source/host/gateway-protocol.ts");
  for (const name of ["addAgentMemory", "getAgentModelSelection", "setAgentModelSelection"]) assert.match(protocol, new RegExp(`  ${name}: \\(api: GatewayApi, body: string\\) => api\\.${name}\\(parseCommandArgs\\(body\\)\\),`));
  const api = read("source/host/host-gateway-api.ts");
  assert.match(api, /addAgentMemory: \(args: any\) =>\s*method\(manager, "addAgentMemory"\)\(args\.id, args\.content, args\.tier\),/);
  assert.match(api, /method\(settings, "setAgentModelForAgentId"\)\(args\.id, args\.selection \?\? null\)/);
  const assembly = read("source/host/runner/system-prompt-assembly.ts");
  assert.match(assembly, /add\(getUserIdentitySection\(\)\);\s*add\(getUserLanguageSection\(\)\);/);
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /const userLanguage = method\(settings, "getUserLanguage"\)\?\.\(\);/);
  const manager = read("source/host/extensions/transcript/transcript-manager.ts");
  assert.match(manager, /async addAgentMemory\(agentId: string, content: string, tier: unknown\)/);
  const memory = read("source/host/extensions/memory/memory-service.ts");
  // deleteAgentMemory sent { memoryId } to a remove() that read { id }: no memory was ever deleted (found 2026-09-05 through the phone).
  assert.match(memory, /remove\(\{ agentId, id, memoryId \}: \{ agentId: string; id\?: string; memoryId\?: string \}\): boolean \{ const key = id \?\? memoryId;/);
  assert.match(manager, /this\.memory\.remove\(\{ agentId, id: memoryId, memoryId \}\)/);
  assert.match(memory, /add\(\{ agentId, content, kind \}: \{ agentId: string; content: string; kind: MemoryKind \}\): MemoryRecord \| null/);
});
