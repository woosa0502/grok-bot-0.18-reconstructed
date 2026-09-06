import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { parse } from "acorn";
import { simple } from "acorn-walk";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Execute the actual composition closure with inert service dependencies. This
// keeps the test away from native service initialization, auth and live DBs;
// the turn projection, protobuf cloning and child lifetime are production code.
async function sourceNode(relative, name, variable = false) {
  const text = await readFile(path.join(repoRoot, relative), "utf8");
  const { code } = await transform(text, { loader: "ts", supported: { using: false } });
  const file = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  let found;
  simple(file, {
    VariableDeclarator(node) {
      if (variable && node.id.name === name) found = code.slice(node.init.start, node.init.end);
    },
    FunctionDeclaration(node) {
      if (!variable && node.id?.name === name) found = `export ${code.slice(node.start, node.end)}`;
    },
  });
  return found;
}

async function loadProduction(t) {
  const scopeNames = [
    "subagentTypeByConversationId", "ASIDE_BROWSE_ENABLED", "isAsideBrowseSubagentType",
    "method", "extensions", "runnerByConversationId", "deps", "runnerOptions",
    "bindSessionOwnedRunner", "ownedRunners", "createProductionTurnSettleHost",
    "compactionEpochFromConversationState", "remoteBoxAccessor", "productionContext",
    "executeRemoteSubagentStartHook", "executeRemoteSubagentStopHook", "session",
    "SAND_SUBAGENT_BOUNDARY_PROMPT",
  ];
  const composition = await sourceNode("source/host/host-runner-composition.ts", "createSubagentRunner", true);
  const factory = await sourceNode("source/host/runner/production-turn-run-shell-adapter.ts", "createProductionTurnRunShellHostInput");
  const rebinder = await sourceNode("source/host/runner/production-turn-run-shell-adapter.ts", "bindProductionTurnRunShellConversationState") ?? "";
  const runInput = await sourceNode("source/host/runner/production-turn-agent-owner.ts", "createProductionTurnAgentRunInput");
  const projection = await sourceNode("source/host/runner/turn-agent-composition.ts", "createTurnAgentRunInputProjection");
  assert.ok(composition && factory && runInput && projection, "production entry points must remain bound");
  const result = await build({
    stdin: {
      resolveDir: repoRoot, loader: "ts",
      contents: `
        import { ConversationStateStructure, ConversationAction } from "./source/packages/proto/generated/agent/v1/agent_pb.js";
        export { ConversationStateStructure, ConversationAction };
        export { createSubagentRuntime } from "./source/host/runner/subagent-runtime.js";
        export { SandAgentRunner } from "./source/host/runner/sand-agent-runner.js";
        const createProductionTurnAgentOwner = () => { throw new Error("No model owner may be constructed in this test"); };
        ${factory}\n${rebinder}\n${runInput}\n${projection}
        export function createChildFactory(scope) { const { ${scopeNames.join(",")} } = scope; return (${composition}); }
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false, packages: "external",
    supported: { using: false },
    plugins: [{
      name: "inert-runner-model-boundary",
      setup(builder) {
        builder.onResolve({ filter: /(?:production-turn-run-shell-adapter|turn-agent-composition)\.js$/ }, (args) => {
          if (!args.importer.endsWith("/sand-agent-runner.ts")) return;
          return { path: args.path, namespace: "inert-runner-boundary" };
        });
        builder.onLoad({ filter: /.*/, namespace: "inert-runner-boundary" }, () => ({
          contents: `export const SAND_AGENT_MAX_STEPS = 1; export function createProductionTurnRunShellAdapter() { throw new Error("No model runner may be constructed in this test"); }`,
        }));
      },
    }],
  });
  // node_modules may be a symlink into an active checkout: never write there.
  const dir = await mkdtemp(path.join(repoRoot, ".runtime-owner-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bundle = path.join(dir, "entry.mjs");
  await writeFile(bundle, result.outputFiles[0].text);
  return import(pathToFileURL(bundle).href);
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function createWorld(module, { held = false, aside = false, failure } = {}) {
  const { ConversationStateStructure, ConversationAction } = module;
  const parentState = new ConversationStateStructure({ summaryArchives: [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)] });
  const epochs = [];
  const input = module.createProductionTurnRunShellHostInput({
    createAgentOwnerInput: () => { throw new Error("No owner initialization"); },
    getConversationState: () => parentState,
    compactionEpoch: () => parentState.summaryArchives.length,
    assembleGeneratedTurnAction: async ({ compactionEpoch }) => {
      epochs.push(compactionEpoch());
      return { action: new ConversationAction() };
    },
    promptOptions: () => ({}),
  });
  const children = [];
  const types = new Map();
  const runners = new Map();
  const owned = new Set();
  let browseDisposed = 0;
  const scope = {
    subagentTypeByConversationId: types,
    ASIDE_BROWSE_ENABLED: aside,
    isAsideBrowseSubagentType: () => aside,
    method: (object, name) => typeof object?.[name] === "function" ? object[name].bind(object) : undefined,
    extensions: { api: () => ({ createSubagentSession: () => {
      if (failure === "aside") throw new Error("test Aside creation failure");
      return ({
      run: async () => ({ text: "browse", aborted: false }),
      interrupt: () => {}, getResolvedOutline: async () => [], getObservedToolCallCount: () => 0,
      getActivitySnapshot: () => [], getTranscriptPath: () => null,
      dispose: () => { browseDisposed += 1; },
    }); } }) },
    runnerByConversationId: runners,
    runnerOptions: { productionTurnRunShell: input },
    deps: { buildRunner(options) {
      if (failure === "constructor") throw new Error("test constructor failure");
      const storageOwner = new module.SandAgentRunner({ ...options, productionTurnRunShell: undefined });
      let current;
      const child = {
        options, inputs: [], disposed: 0, runs: 0,
        getAgentConversationStateStructure: () => storageOwner.getAgentConversationStateStructure(),
        setAgentConversationStateStructure: (value) => {
          if (failure === "checkpoint") throw new Error("test checkpoint failure");
          storageOwner.setAgentConversationStateStructure(value);
        },
        setAgentStore: (value) => storageOwner.setAgentStore(value),
        setState: (value) => storageOwner.setAgentConversationStateStructure(value),
        async run(prompt) {
          child.runs += 1;
          const turn = await options.productionTurnRunShell.createRunInput({
            owner: { runContext: {} }, runContext: {}, prompt, options: {},
          });
          child.inputs.push(turn);
          if (held) {
            current = deferred();
            return current.promise;
          }
          return { text: "child done", aborted: false };
        },
        interrupt() { current?.resolve({ text: "", aborted: true }); },
        finish(text = "done") { current?.resolve({ text, aborted: false }); },
        dispose() { child.disposed += 1; },
        getResolvedOutline: async () => [], getObservedToolCallCount: () => 0,
        getActivitySnapshot: () => [], getTranscriptPath: () => null,
      };
      children.push(child);
      return child;
    } },
    bindSessionOwnedRunner: (child) => {
      child.setAgentStore({ getConversationStateStructure: () => parentState });
      if (failure === "binding") throw new Error("test binding failure");
    }, ownedRunners: owned,
    createProductionTurnSettleHost: (id) => ({ id }),
    compactionEpochFromConversationState: (state) => state.summaryArchives.length,
    remoteBoxAccessor: {}, productionContext: {},
    executeRemoteSubagentStartHook: async () => {}, executeRemoteSubagentStopHook: async () => {},
    session: { id: "parent" }, SAND_SUBAGENT_BOUNDARY_PROMPT: "child boundary",
  };
  const runtime = module.createSubagentRuntime({
    getConversationId: () => "parent", resolveBoxId: () => "test-box",
    emitAsyncTasksChanged: () => {}, computerUse: { freeWindow: () => {} },
  });
  return {
    children, types, runners, owned, parentState, epochs, runtime,
    create: module.createChildFactory(scope),
    browseDisposed: () => browseDisposed,
  };
}

const args = { subagentType: "executor", toolCallId: "task-1" };

test("fresh children use their own protobuf base state and compaction epoch", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module);
  const child = world.create("child-1", args);
  await child.run("task");
  assert.equal(world.children[0].inputs[0].baseState.summaryArchives.length, 0,
    "a fresh child must not import the parent's compacted history");
  assert.deepEqual(world.epochs, [0]);
  assert.equal(world.parentState.summaryArchives.length, 3);
  await child.dispose();
});

test("child ownership persists across turns and is released only on disposal", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module);
  const session = world.create("child-1", args);
  const child = world.children[0];
  await session.run("first");
  assert.equal(world.types.get("child-1"), "executor", "a settled turn does not end the session");
  assert.equal(world.runners.get("child-1"), child);
  child.setState(new module.ConversationStateStructure({ summaryArchives: [Uint8Array.of(1)] }));
  await session.run("continued");
  assert.deepEqual(world.epochs, [0, 1]);
  assert.equal(child.inputs[1].baseState.summaryArchives.length, 1);
  await session.dispose();
  await session.dispose();
  assert.equal(world.types.has("child-1"), false);
  assert.equal(world.runners.has("child-1"), false);
  assert.equal(world.owned.has(child), false);
  assert.equal(child.disposed, 1, "owner disposal is idempotent");
});

test("independent children keep separate checkpoints even when the parent advances", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module);
  const first = world.create("child-1", args);
  const second = world.create("child-2", { ...args, subagentType: "computerUse" });
  world.children[0].setState(new module.ConversationStateStructure({ summaryArchives: [Uint8Array.of(1)] }));
  world.children[1].setState(new module.ConversationStateStructure({ summaryArchives: [Uint8Array.of(1), Uint8Array.of(2)] }));
  world.parentState.summaryArchives.push(Uint8Array.of(4));
  await Promise.all([first.run("a"), second.run("b")]);
  assert.equal(world.children[0].inputs[0].baseState.summaryArchives.length, 1);
  assert.equal(world.children[1].inputs[0].baseState.summaryArchives.length, 2);
  assert.deepEqual(world.epochs, [1, 2]);
  await Promise.all([first.dispose(), second.dispose()]);
});

test("Aside child type ownership also lasts through all turns", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module, { aside: true });
  const child = world.create("browse-1", { ...args, subagentType: "asideBrowse" });
  await child.run("first");
  assert.equal(world.types.get("browse-1"), "asideBrowse");
  await child.run("second");
  await child.dispose();
  await child.dispose();
  assert.equal(world.types.has("browse-1"), false);
  assert.equal(world.browseDisposed(), 1);
});

test("steer reruns retain child ownership, and drain waits for the replacement turn", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module, { held: true });
  const session = world.create("child-1", args);
  world.runtime.sessions.set("child-1", session);
  world.runtime.dispatchBackgroundSubagent({
    subagentAgentId: "child-1", subagentType: "executor", toolCallId: "task-1",
    prompt: "first", run: () => session.run("first"),
  });
  await tick();
  const child = world.children[0];
  child.setState(new module.ConversationStateStructure({ summaryArchives: [Uint8Array.of(1)] }));
  let drained = false;
  const drain = world.runtime.drainBackgroundSubagents().then(() => { drained = true; });
  assert.equal(world.runtime.steerSubagent("child-1", "continue differently"), "ok");
  await tick();
  assert.equal(child.runs, 2);
  assert.equal(world.types.get("child-1"), "executor");
  assert.equal(world.runners.get("child-1"), child);
  assert.equal(child.inputs[1].baseState.summaryArchives.length, 1);
  assert.equal(drained, false, "drain must include the replacement run created while settling");
  child.finish();
  await drain;
  assert.equal(child.disposed, 1);
  assert.equal(world.types.size, 0);
  assert.equal(world.runners.size, 0);
  assert.equal(world.runtime.isRunning("child-1"), false);
});

test("drain includes steered turns even without the host composition", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module);
  const first = deferred();
  const replacement = deferred();
  let disposed = 0;
  const session = {
    run: () => replacement.promise,
    interrupt: () => first.resolve({ text: "", aborted: true }),
    getResolvedOutline: async () => [], getObservedToolCallCount: () => 0,
    getActivitySnapshot: () => [], getTranscriptPath: () => null,
    dispose: () => { disposed += 1; },
  };
  world.runtime.sessions.set("child-1", session);
  world.runtime.dispatchBackgroundSubagent({
    subagentAgentId: "child-1", subagentType: "executor", toolCallId: "task-1",
    prompt: "first", run: () => first.promise,
  });
  let drained = false;
  const drain = world.runtime.drainBackgroundSubagents().then(() => { drained = true; });
  world.runtime.steerSubagent("child-1", "change");
  await tick();
  assert.equal(drained, false);
  replacement.resolve({ text: "done", aborted: false });
  await drain;
  assert.equal(disposed, 1);
});


test("failed child creation leaves no type ownership or allocated runner", async (t) => {
  const module = await loadProduction(t);
  for (const failure of ["constructor", "checkpoint", "binding", "aside"]) {
    const world = createWorld(module, { failure, aside: failure === "aside" });
    assert.throws(() => world.create("failed-child", args), /test .* failure/);
    await tick();
    assert.equal(world.types.size, 0, `${failure} failure must not register a type`);
    assert.equal(world.runners.size, 0, `${failure} failure must not register a runner`);
    assert.equal(world.owned.size, 0, `${failure} failure must not keep an owned runner`);
    for (const child of world.children) assert.equal(child.disposed, 1, `${failure} must dispose its allocation`);
  }
});

function delayedSession({ outline, disposal, result = "done" } = {}) {
  return {
    runs: 0, disposals: 0,
    run() { this.runs += 1; return Promise.resolve({ text: result, aborted: false }); },
    interrupt: () => {},
    getResolvedOutline: () => outline?.promise ?? Promise.resolve([]),
    getObservedToolCallCount: () => 0, getActivitySnapshot: () => [], getTranscriptPath: () => null,
    async dispose() { this.disposals += 1; await disposal?.promise; },
  };
}
function dispatch(runtime, id, session) {
  runtime.dispatchBackgroundSubagent({
    subagentAgentId: id, subagentType: "executor", toolCallId: `task-${id}`,
    prompt: "task", run: () => session.run(),
  });
}

test("drain begun during terminal cleanup waits through outline, disposal, and delivery", async (t) => {
  const module = await loadProduction(t);
  const { runtime } = createWorld(module);
  const outline = deferred();
  const disposal = deferred();
  const delivery = deferred();
  const session = delayedSession({ outline, disposal });
  let delivered = false;
  runtime.setBackgroundSubagentHandler(async () => {
    await delivery.promise;
    delivered = true;
  });
  runtime.sessions.set("finishing", session);
  dispatch(runtime, "finishing", session);
  await tick();
  let drained = false;
  const drain = runtime.drainBackgroundSubagents().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false, "an outline wait is still part of the owned lifecycle");
  assert.equal(runtime.isRunning("finishing"), true);
  assert.equal(runtime.steerSubagent("finishing", "late steer"), "not-running");
  outline.resolve([]);
  await tick();
  assert.equal(drained, false, "runner disposal has not finished");
  assert.equal(session.disposals, 1);
  disposal.resolve();
  await tick();
  assert.equal(drained, false, "completion delivery has not finished");
  delivery.resolve();
  await drain;
  assert.equal(delivered, true);
  assert.equal(runtime.isRunning("finishing"), false);
  assert.equal(runtime.sessions.has("finishing"), false);
});

test("same-id dispatch waits for old settlement and old cleanup cannot delete a replacement session", async (t) => {
  const module = await loadProduction(t);
  const { runtime } = createWorld(module);
  const outline = deferred();
  const oldSession = delayedSession({ outline, result: "old result" });
  const replacement = delayedSession({ result: "replacement result" });
  const completions = [];
  runtime.setBackgroundSubagentHandler((completion) => completions.push(completion.result));
  runtime.sessions.set("same-id", oldSession);
  dispatch(runtime, "same-id", oldSession);
  await tick();
  // The public session registry can be changed by an adapter. Settlement must
  // retain its captured owner, and duplicate dispatch must remain rejected.
  runtime.sessions.set("same-id", replacement);
  dispatch(runtime, "same-id", replacement);
  await tick();
  assert.equal(replacement.runs, 0, "ID reuse is unavailable during old settlement");
  outline.resolve([]);
  await runtime.drainBackgroundSubagents();
  assert.equal(runtime.sessions.get("same-id"), replacement);
  assert.equal(oldSession.disposals, 1);
  assert.equal(replacement.disposals, 0);
  dispatch(runtime, "same-id", replacement);
  await runtime.drainBackgroundSubagents();
  assert.equal(replacement.runs, 1);
  assert.equal(replacement.disposals, 1);
  assert.deepEqual(completions, ["old result", "replacement result"]);
});

test("a stop received during terminal cleanup suppresses completion after disposal", async (t) => {
  const module = await loadProduction(t);
  const { runtime } = createWorld(module);
  const outline = deferred();
  const session = delayedSession({ outline });
  const completions = [];
  runtime.setBackgroundSubagentHandler((completion) => completions.push(completion));
  runtime.sessions.set("stopping", session);
  dispatch(runtime, "stopping", session);
  await tick();
  assert.equal(runtime.abortSubagent("stopping"), "ok");
  outline.resolve([]);
  await runtime.drainBackgroundSubagents();
  assert.equal(session.disposals, 1);
  assert.equal(completions.length, 0);
  assert.equal(runtime.listSubagents()[0].status, "aborted");
});

test("concurrent disposal calls share completion and keep ownership reserved until release", async (t) => {
  const module = await loadProduction(t);
  const world = createWorld(module);
  const session = world.create("reserved", args);
  const child = world.children[0];
  const release = deferred();
  child.dispose = async () => { child.disposed += 1; await release.promise; };
  const first = session.dispose();
  const second = session.dispose();
  assert.equal(first, second);
  await tick();
  assert.equal(world.types.get("reserved"), "executor");
  assert.equal(world.runners.get("reserved"), child);
  assert.throws(() => world.create("reserved", args), /already has an owner/);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(child.disposed, 1);
  assert.equal(world.types.size, 0);
  assert.equal(world.runners.size, 0);
});

test("stop targets the captured running owner even if the public session entry changes", async (t) => {
  const module = await loadProduction(t);
  const { runtime } = createWorld(module);
  const outline = deferred();
  const original = delayedSession({ outline });
  const replacement = delayedSession();
  let oldInterrupts = 0;
  let newInterrupts = 0;
  original.interrupt = () => { oldInterrupts += 1; };
  replacement.interrupt = () => { newInterrupts += 1; };
  runtime.sessions.set("owner", original);
  dispatch(runtime, "owner", original);
  await tick();
  runtime.sessions.set("owner", replacement);
  assert.equal(runtime.abortSubagent("owner"), "ok");
  assert.equal(oldInterrupts, 1);
  assert.equal(newInterrupts, 0);
  outline.resolve([]);
  await runtime.drainBackgroundSubagents();
  assert.equal(runtime.sessions.get("owner"), replacement);
  await replacement.dispose();
});

test("dispatch observer failure disposes the published session without starting its turn", async (t) => {
  const module = await loadProduction(t);
  const runtime = module.createSubagentRuntime({
    getConversationId: () => "parent", resolveBoxId: () => "box",
    emitAsyncTasksChanged: () => {}, computerUse: { freeWindow: () => {} },
    onPendingWakeArmed: () => { throw new Error("injected notification failure"); },
  });
  const session = delayedSession();
  const completions = [];
  runtime.setBackgroundSubagentHandler((value) => completions.push(value));
  runtime.sessions.set("failed-dispatch", session);
  dispatch(runtime, "failed-dispatch", session);
  await runtime.drainBackgroundSubagents();
  assert.equal(session.runs, 0);
  assert.equal(session.disposals, 1);
  assert.equal(runtime.sessions.size, 0);
  assert.equal(runtime.isRunning("failed-dispatch"), false);
  assert.equal(completions[0].status, "error");
  assert.match(completions[0].result, /injected notification failure/);
});
