import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { build, transform } from "esbuild";
import { parse } from "acorn";
import { simple } from "acorn-walk";

const root = path.resolve(import.meta.dirname, "..");
const baseline = process.env.BELMONT_IMAGE_WIRING_BASELINE === "1";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPjPwMDAxMDAwMDAAAALHwEDmIWXfgAAAABJRU5ErkJggg==";
const enabledEnv = { SAND_LOCAL_CODEX_MODE: "1", SAND_IMAGE_PROVIDER: "openai", SAND_MEDIA_OPENAI_API_KEY: "synthetic-test-key" };
const baselineFiles = new Set([
  "source/host/host-runner-composition.ts",
  "source/host/runner/system-prompt-assembly.ts",
  "source/host/runner/system-prompt.ts",
  "source/packages/agent/tools/core/generate-image.ts",
]);
async function source(relative) {
  if (baseline && baselineFiles.has(relative)) return execFileSync("git", ["show", `HEAD:${relative}`], { cwd: root, encoding: "utf8" });
  return readFile(path.join(root, relative), "utf8");
}
async function extracted(relative, name, variable = false) {
  const { code } = await transform(await source(relative), { loader: "ts", supported: { using: false } });
  let found;
  simple(parse(code, { ecmaVersion: "latest", sourceType: "module" }), {
    FunctionDeclaration(node) { if (!variable && node.id?.name === name) found = code.slice(node.start, node.end); },
    VariableDeclarator(node) { if (variable && node.id.name === name) found = code.slice(node.init.start, node.init.end); },
  });
  return found;
}
let loaded;
async function api() {
  return loaded ??= (async () => {
    const producer = await extracted("source/host/host-runner-composition.ts", "getGenerateImageToolInputs") ?? "function getGenerateImageToolInputs() { return undefined; }";
    const factory = await extracted("source/host/host-runner-composition.ts", "createTurnToolsetFactoryProvider", true);
    assert.ok(factory);
    const output = await build({
      stdin: { resolveDir: root, loader: "ts", contents: `
        import { dirname } from "node:path";
        import { isMediaProviderConfigured } from "./source/shared/node/media-provider.js";
        import { isLocalCodexMode } from "./source/shared/node/local-codex-account.js";
        export { createSystemPromptAssembly } from "./source/host/runner/system-prompt-assembly.js";
        export { createTurnToolsetFactoriesForTurn, buildTurnTools } from "./source/host/runner/tools/turn-toolset.js";
        export { createGenerateImageTool } from "./source/packages/agent/tools/core/generate-image.js";
        export { createSandGenerateImageService } from "./source/host/extensions/attachments/generate-image-service.js";
        export { createSandGenerateImageResourceAccessor } from "./source/host/extensions/attachments/generate-image-resource-accessor.js";
        export { createContext } from "./source/packages/context/core.js";
        export function hostFactory(scope) {
          const { runnerOptions, session, isSharedRoomTurn = false } = scope;
          const process = { env: scope.env };
          const method = (target, name) => typeof target?.[name] === "function" ? target[name].bind(target) : undefined;
          const extensions = { api: () => ({}) };
          const remoteBox = {};
          ${producer}
          const createProvider = (${factory});
          return { imageInputs: getGenerateImageToolInputs, provider: createProvider({}) };
        }
      ` },
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      target: "node26", supported: { using: false },
      plugins: baseline ? [{ name: "git-before-image-wiring", setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, async (args) => {
          const relative = path.relative(root, args.path);
          if (baselineFiles.has(relative)) return { contents: await source(relative), loader: "ts" };
        });
      } }] : [],
    });
    const module = { exports: {} };
    const wrapper = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${output.outputFiles[0].text}\n})`, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
    wrapper(createRequire(path.join(root, "package.json")), module, module.exports, path.join(root, "tests", "image-offer-bundle.cjs"), path.join(root, "tests"));
    return module.exports;
  })();
}
function prompt(module, capability) {
  const absent = () => null;
  return module.createSystemPromptAssembly({
    basePrompt: "base", isSubagentRunner: false, isSharedRoomRunner: false, isSystemPromptOverridden: false,
    agentProfileProvider: absent, agentStore: absent, compactionEpoch: () => 0,
    memoryStore: absent, memorySnapshots: absent, userMemory: absent, projectMemory: absent,
    isBoxScopedSubagent: () => false, isMemoryFreezeEnabled: () => false,
    requestContext: { resolve: () => ({ timeZone: "UTC" }) },
    automationStore: absent, workflowStore: absent, channelStore: absent, connectorManifests: [],
    isSpotlightEnabled: () => false, mcpManagement: absent, isLocalCodexMode: () => true,
    isImageGenerationEnabled: capability,
    mcpCustomInstructionsSection: absent, mcpDiscoveryStatusSection: absent,
    remoteBoxSection: () => "", computerSection: absent,
  }).getSystemPrompt();
}
function imageTool(module, productionProvider) {
  // Isolate the image capability from the production provider while retaining
  // the real per-turn factory, tool creation and final offered-tool gate.
  const factories = module.createTurnToolsetFactoriesForTurn(
    productionProvider.createGenerateImageToolInputs === undefined ? {} : {
      createGenerateImageToolInputs: productionProvider.createGenerateImageToolInputs,
    }, {}, {},
  );
  return module.buildTurnTools({
    factories, isSubagentRunner: false, isSharedRoomRunner: false, isBoxScopedSubagent: false,
    isComputerUseSubagent: false, isBrowserUseSubagent: false, remoteBoxHasDesktop: false,
    getRemoteBoxAvailable: () => false, getConversationId: () => "test-agent",
    cloudAgentsDisabledByTeam: () => true, spotlightEnabled: () => false,
  }, {}).getTool("GENERATE_IMAGE");
}
async function world(t, env = enabledEnv) {
  const module = await api();
  const dir = await mkdtemp(path.join(root, ".image-offer-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let providerCalls = 0;
  const requests = [];
  const generateImageService = module.createSandGenerateImageService({
    getAccessToken: async () => { throw new Error("Cursor authentication is forbidden in this test"); },
    getMachineId: async () => "test-machine",
  }, {
    mediaProvider: { env, fetch: async (url, request) => { providerCalls += 1; requests.push({ url, request }); return Response.json({ data: [{ b64_json: png }] }); } },
    persistImage: async (bytes) => {
      const absolutePath = path.join(dir, "assets", "generated.png");
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
      return { absolutePath };
    },
  });
  const resourceAccessor = module.createSandGenerateImageResourceAccessor(dir);
  const binding = module.hostFactory({
    runnerOptions: { generateImageService, generateImageResourceAccessor: resourceAccessor },
    session: { dbPath: path.join(dir, "store.db") }, env,
  });
  return { module, dir, binding, resourceAccessor, generateImageService, requests, providerCalls: () => providerCalls };
}
async function execute(module, tool, args) {
  return tool.execute(module.createContext(), {
    emitPartialToolCall: () => {},
    executeToolCall: (ctx, _call, _id, run) => run(ctx),
  }, (async function* () { yield JSON.stringify({ description: "A small blue owl sitting quietly beside a sunny window", ...args }); })(), { toolCallId: "test-image" });
}

test("configured local image provider is present in both real prompt and offered toolset", async (t) => {
  const { module, binding } = await world(t);
  assert.equal(typeof binding.provider.createGenerateImageToolInputs, "function");
  assert.ok(imageTool(module, binding.provider));
  const text = prompt(module, () => binding.imageInputs() !== undefined);
  assert.match(text, /use the GenerateImage tool/);
  assert.doesNotMatch(text, /Image generation is not available/);
});

test("missing explicit provider, missing key or missing bound accessor cannot advertise image generation", async (t) => {
  for (const env of [{ SAND_LOCAL_CODEX_MODE: "1" }, { SAND_LOCAL_CODEX_MODE: "1", OPENAI_API_KEY: "test" }, { SAND_LOCAL_CODEX_MODE: "1", SAND_IMAGE_PROVIDER: "openai" }]) {
    const { module, binding } = await world(t, env);
    assert.equal(imageTool(module, binding.provider), undefined);
    assert.match(prompt(module, () => binding.imageInputs() !== undefined), /Image generation is not available/);
  }
  const module = await api();
  const missing = module.hostFactory({ env: enabledEnv, runnerOptions: { generateImageService: () => {} }, session: { dbPath: "/synthetic/store.db" } });
  assert.equal(imageTool(module, missing.provider), undefined);
});

test("real host offer executes GenerateImage through configured API, persistence and canonical write result", async (t) => {
  const w = await world(t);
  const tool = imageTool(w.module, w.binding.provider);
  assert.ok(tool, "configured production factory must offer the tool");
  const result = await execute(w.module, tool, {});
  assert.equal(result.result.case, "success");
  assert.equal(w.providerCalls(), 1);
  assert.deepEqual(await readFile(result.result.value.filePath), Buffer.from(png, "base64"));
});

test("unreadable or empty explicitly requested reference images fail before any provider call", async (t) => {
  const w = await world(t);
  // Test the actual core tool independently as well, so a missing offer cannot
  // hide a reference-loss bug at the canonical execution boundary.
  const tool = w.module.createGenerateImageTool({
    resourceAccessor: w.resourceAccessor,
    generateImageService: w.generateImageService,
    requestContext: { env: { projectFolder: w.dir } },
  });
  const empty = path.join(w.dir, "assets", "empty.png");
  await mkdir(path.dirname(empty), { recursive: true });
  await writeFile(empty, new Uint8Array());
  for (const reference of [path.join(w.dir, "assets", "missing.png"), empty, "/not-authorized/reference.png"]) {
    await assert.rejects(() => execute(w.module, tool, { reference_image_paths: [reference] }), /reference image/i);
  }
  assert.equal(w.providerCalls(), 0);
});


test("real offered tool preserves authorized reference image bytes through the edit request", async (t) => {
  const w = await world(t);
  const reference = path.join(w.dir, "assets", "reference.png");
  await mkdir(path.dirname(reference), { recursive: true });
  await writeFile(reference, Buffer.from(png, "base64"));
  const tool = imageTool(w.module, w.binding.provider);
  assert.ok(tool);
  const result = await execute(w.module, tool, { reference_image_paths: [reference] });
  assert.equal(result.result.case, "success");
  assert.equal(w.providerCalls(), 1);
  assert.equal(w.requests[0].url, "https://api.openai.com/v1/images/edits");
  const source = w.requests[0].request.body.get("image[]");
  assert.equal(source.type, "image/png");
  assert.deepEqual(Buffer.from(await source.arrayBuffer()), Buffer.from(png, "base64"));
  assert.deepEqual(await readFile(result.result.value.filePath), Buffer.from(png, "base64"));
});
