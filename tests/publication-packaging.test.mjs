import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import createIgnore from "ignore";

import { resolvePackagedAppArtifacts } from "../scripts/lib/packaged-app.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("packaged verification authority is the selected app bundle", () => {
  const appPath = path.join(repoRoot, "dist", "Example.app");
  const artifacts = resolvePackagedAppArtifacts(appPath);
  assert.equal(artifacts.appPath, appPath);
  assert.equal(artifacts.asarPath, path.join(appPath, "Contents", "Resources", "app.asar"));
  assert.equal(artifacts.unpackedPath, `${artifacts.asarPath}.unpacked`);
  assert.notEqual(artifacts.asarPath, path.join(repoRoot, ".build", "app.asar"));
  assert.throws(() => resolvePackagedAppArtifacts(path.join(repoRoot, ".build", "app.asar")), /\.app bundle/);
});

test("publication ignore rules retain reconstructed frontend source", async () => {
  const ignoreRules = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
  assert.match(ignoreRules, /^\/recovered\/$/m);
  assert.doesNotMatch(ignoreRules, /^recovered\/$/m);
  const retained = "frontend/src/recovered/ui/sand-form-primitives.css";
  const matcher = createIgnore().add(ignoreRules);
  assert.equal(matcher.ignores(retained), false, `${retained} must remain addable in a fresh repository`);
  assert.equal(matcher.ignores("recovered/generated-output.txt"), true, "root recovery output must remain ignored");
});

test("default packaging keeps the polished checksum-pinned renderer", async () => {
  const source = await readFile(path.join(repoRoot, "scripts", "package-macos.mjs"), "utf8");
  assert.match(source, /import \{ buildFidelityReconstructedAsar \} from "\.\/clean-build\.mjs"/);
  assert.match(source, /await buildFidelityReconstructedAsar\(\)/);
});

test("Router settings use the trusted backend and Pi-owned Codex runtime", async () => {
  const rendererPatch = await readFile(path.join(repoRoot, "scripts", "lib", "router-renderer-patch.mjs"), "utf8");
  const preload = await readFile(path.join(repoRoot, "source", "electron-preload", "preload.ts"), "utf8");
  const mainEdge = await readFile(path.join(repoRoot, "source", "electron-main", "main-edge.ts"), "utf8");
  const inference = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "inference-service.ts"), "utf8");
  const cursorSession = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "cursor-session.ts"), "utf8");
  const cursorBackend = await readFile(path.join(repoRoot, "source", "shared", "node", "cursor-backend", "cursor-inference.ts"), "utf8");
  const providers = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "provider-session.ts"), "utf8");
  const piRuntime = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "pi-codex-runtime.ts"), "utf8");
  const piProjection = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "pi-codex-projection.ts"), "utf8");
  const piCredentials = await readFile(path.join(repoRoot, "source", "host", "extensions", "inference", "pi-codex-credential-store.ts"), "utf8");
  const turnShell = await readFile(path.join(repoRoot, "source", "host", "runner", "turn-run-shell.ts"), "utf8");
  const coordinator = await readFile(path.join(repoRoot, "source", "node-agent-coordinator", "inference-router.ts"), "utf8");
  const coordinatorMain = await readFile(path.join(repoRoot, "source", "node-agent-coordinator", "main.ts"), "utf8");
  const mcpBridge = await readFile(path.join(repoRoot, "source", "node-agent-coordinator", "routed-mcp-bridge.ts"), "utf8");
  const localDocker = await readFile(path.join(repoRoot, "source", "electron-main", "box", "local-docker-host-connector.ts"), "utf8");
  assert.match(rendererPatch, /desktop\.agent\.getInferenceRouter\(\)/);
  assert.match(rendererPatch, /desktop\.agent\.setInferenceRouter\(n\)/);
  assert.match(rendererPatch, /desktop\.agent\.getBoxRuntime\(\)/);
  assert.match(rendererPatch, /desktop\.agent\.setBoxRuntime\(r\)/);
  assert.match(rendererPatch, /role:"switch"/);
  assert.match(rendererPatch, /Use local Docker VM/);
  assert.match(rendererPatch, /onValueChange:l=>\{if\(l!==null\)void e\(l\)\}/);
  assert.match(rendererPatch, /desktop\.secrets\.upsert/);
  assert.doesNotMatch(rendererPatch, /settings\.router-provider\.v1/);
  assert.match(rendererPatch, /Usage for /);
  assert.match(rendererPatch, /Requests/);
  assert.match(rendererPatch, /Input tokens/);
  assert.match(rendererPatch, /Last used/);
  assert.match(rendererPatch, /Tracked activity/);
  assert.match(rendererPatch, /RRouterProviders\.filter/);
  assert.match(preload, /getInferenceRouter: \(\) => edge\("getInferenceRouter"\)/);
  assert.match(preload, /getBoxRuntime: \(\) => edge\("getBoxRuntime"\)/);
  assert.match(preload, /setBoxRuntime: \(mode: string\) => edge\("setBoxRuntime", \{ mode \}\)/);
  assert.match(mainEdge, /syncHostSettingsToBox\(\{ inferenceProvider: provider \}\)/);
  assert.match(mainEdge, /invoke\(deps\.settingsStore, "setInferenceProvider", provider\)/);
  assert.match(mainEdge, /return \{ provider, usage:/);
  assert.match(mainEdge, /invoke\(deps\.boxRecovery, "restartCoordinator"\)/);
  assert.match(mainEdge, /mode === "local-docker"\) await startLocalDockerBox\(settingsPath\); else await stopLocalDockerBox\(\)/);
  assert.match(mainEdge, /setBoxRuntime", mode === "local-docker" \? "remote" : "local-docker"/);
  assert.match(localDocker, /public\.ecr\.aws\/k0i0n2g5\/cursorenvironments\/universal:sand-box-latest/);
  assert.match(localDocker, /"127\.0\.0\.1:1340:1340"/);
  assert.match(localDocker, /SAND_BOX_AUTO_UPDATE=0/);
  assert.match(localDocker, /dst=\/home\/box\/sand-host\/host-main\.cjs,readonly/);
  assert.match(localDocker, /\.getBoxRuntime\(\) === "local-docker" \? await localConnect\(\) : await remote\.connect\(\)/);
  assert.match(inference, /recordInferenceUsage\(provider/);
  assert.match(inference, /routerSettings\.getInferenceProvider\(\)/);
  assert.match(inference, /typeof extendedUsage\.then === "function"/);
  assert.match(inference, /createProviderPromptSession\(provider, sessionOptions\?\.modelId\)/);
  assert.match(providers, /import\(PI_RUNTIME_SPECIFIER\)/);
  assert.doesNotMatch(providers, /chatgpt\.com\/backend-api\/codex|auth\.openai\.com\/oauth\/token/);
  assert.match(providers, /createRoutedProviderSessionState\(this\.#messages, this\.modelId\)/);
  assert.match(piRuntime, /ModelRuntime\.create\(\{/);
  assert.match(piRuntime, /streamSimple\(resolved\.model, context/);
  assert.match(piRuntime, /getProviderAuthStatus\(CODEX_PROVIDER\)/);
  assert.doesNotMatch(piRuntime, /executeTool/);
  assert.match(piProjection, /ArrayBuffer\.isView\(value\)/);
  assert.match(piProjection, /PiStreamMaterializer/);
  assert.match(piProjection, /event\.type === "toolcall_end"/);
  assert.match(piCredentials, /implements CredentialStore/);
  assert.match(piCredentials, /migrateLegacyCodexCredential/);
  assert.match(providers, /parameters: jsonSchema\(parameters\)/);
  assert.match(providers, /You are Grok Bot, a warm, concise desktop assistant/);
  assert.match(providers, /mcpServers: \{ grok_bot_plugins:/);
  assert.match(providers, /recordRoutedUsage\(provider, usage\)/);
  assert.match(providers, /queryClaude/);
  assert.match(providers, /tools: mcpServerUrl == null \? \[\] : \["mcp__grok_bot_plugins__\*"\]/);
  assert.match(providers, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(providers, /OpenRouter needs OPENROUTER_API_KEY/);
  assert.match(cursorSession, /createProviderPromptSession\(routedProvider, sessionOptions\?\.modelId\)/);
  assert.match(cursorBackend, /createProviderPromptSession\(routedProvider, options\.requestedModel\.modelId\)/);
  assert.doesNotMatch(rendererPatch, /ANTHROPIC_API_KEY|OPENAI_API_KEY/);
  assert.match(turnShell, /inferenceProvider === "cursor"/);
  assert.match(turnShell, /createProviderPromptSession\(inferenceProvider, input\.modelId\)/);
  // The coordinator's own per-provider local turn loop (execute), activity pulse
  // (beginActivity), routed-MCP bridge wiring, and JSON-transcript merge were unreachable —
  // non-cursor providers run their turns on the full host runner and cursor routes there too —
  // so they were removed. The routed-MCP tool surface is still exercised through coordinatorMain
  // below; the coordinator keeps only its transcript store, the transcript-tail passthrough, and
  // local reaction toggling. (F-006)
  assert.match(coordinatorMain, /command\(commands, "listRoutedMcpTools", args\)/);
  assert.match(coordinator, /inference-router-transcript\.json/);
  assert.match(mcpBridge, /openWorldHint: !readOnly/);
  assert.match(coordinator, /schemaVersion: 2/);
  assert.match(coordinator, /\["getAgentTranscriptTail", "openAgentTail", "getAgentTranscriptWindow"\]/);
  assert.match(coordinator, /readonly richText\?: string/);
  assert.match(coordinator, /richText: entry\.richText/);
  assert.match(coordinator, /method === "reactToMessage"/);
  assert.match(coordinator, /reaction\.by === "me"/);
  assert.match(mcpBridge, /server\.listen\(0, "127\.0\.0\.1"/);
  assert.match(mcpBridge, /readOnlyHint: readOnly/);
  assert.match(mcpBridge, /request\.url !== `\/mcp\/\$\{secret\}`/);
  assert.match(coordinator, /kind: "send-message"/);
  assert.match(coordinatorMain, /createCoordinatorInferenceRouter/);
  assert.match(coordinatorMain, /routed\.handled/);
});
