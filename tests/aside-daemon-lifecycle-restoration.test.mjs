import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import { resolveAsideOriginal } from "./helpers/aside-originals.mjs";

// Read the pinned daemon as text. Never import it: that would boot real services.
const repo = path.resolve(import.meta.dirname, "..");
const bundle = resolveAsideOriginal("1.26.906.1714");
const patcher = path.join(repo, "belmont-browse/tools/patch-daemon-lifecycle.py");
const source = readFileSync(bundle, "utf8");
const dir = mkdtempSync(path.join(tmpdir(), "aside-lifecycle-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const originalPath = path.join(dir, "original.mjs");
const patchedPath = path.join(dir, "patched.mjs");
writeFileSync(originalPath, source);
const initial = spawnSync("python3", [patcher, originalPath, patchedPath], { encoding: "utf8" });
assert.equal(initial.status, 0, initial.stderr);
const patched = readFileSync(patchedPath, "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function slice(start, end, input = patched) {
  const first = input.indexOf(start);
  assert.ok(first >= 0 && input.indexOf(start, first + start.length) === -1, `unique start: ${start}`);
  const last = input.indexOf(end, first + start.length);
  assert.ok(last > first, `end after start: ${end}`);
  return input.slice(first, last + end.length);
}

const primitives = [
  slice("async function __belmontOriginalCheckRoutines(){", "routineCheckInFlight=!1}));"),
  slice("async function __belmontOriginalRunGc(){", "GC_INTERVAL_MS=216e5,gcTimer=null}));"),
  slice("async function __belmontOriginalRunPass(){", "COMPREHENSION_INTERVAL_MS=6e4,timer=null,passInFlight=!1}))") + ";",
  slice("function isCurrentCapture(Cn,ei=captureGeneration){", "captureStats=new Map,pointerSignalOrderByAccount=new Map}));"),
  slice("function isObservableTarget(Cn){", "observerCdp=null,observerBrowser=null,browserContextCheck=null}));"),
  slice("async function initializeSessionLifecycles(){", "reconciliationByProfileKey=new Map}))") + ";",
].join("\n");
const shim = patched.slice(patched.indexOf("// belmont-browse-lifecycle: drainable-906-v1"))
  .replace("export const __belmontLifecycles", "globalThis.hooks");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeTimers() {
  const active = new Set();
  const cleared = [];
  function add(kind, callback, ms) {
    const timer = { kind, callback, ms, unref() { return this; } };
    active.add(timer);
    return timer;
  }
  function clear(timer) { if (active.delete(timer)) cleared.push(timer); }
  return {
    active, cleared,
    setTimeout: (callback, ms) => add("timeout", callback, ms),
    setInterval: (callback, ms) => add("interval", callback, ms),
    clearTimeout: clear, clearInterval: clear,
    fire(timer) { if (!active.has(timer)) return; if (timer.kind === "timeout") active.delete(timer); timer.callback(); },
    find(kind, ms) { return [...active].find((item) => item.kind === kind && item.ms === ms); },
  };
}

function runtime(overrides = {}) {
  const timers = fakeTimers();
  const calls = { initializers: [], warnings: [], nativeStops: 0, releases: 0, unsubscribe: 0 };
  const account = { id: 7, createdAt: "fixture-account" };
  const context = {
    ...timers, Promise, Error, AggregateError, performance, Symbol,
    AccountRegistry: { getAll: () => ({ accounts: [] }), getAccount: () => account, getCurrentAccountId: () => account.id },
    logger: { warn: (...args) => calls.warnings.push(args), info() {}, debug() {} },
    settings: () => ({ get: () => ({ enabled: false, retentionDays: 30 }) }),
    nativeContextAwarenessHelper: { reconcile() {}, stop() { calls.nativeStops++; } },
    globalCdpClient: {
      start() {}, isConnected: false,
      on: () => () => calls.unsubscribe++,
      transportEvents: { on: () => () => calls.unsubscribe++ },
      ensureConnected: async () => {}, send: async () => ({ targetInfos: [] }),
    },
    globalExtensionBridge: { onConnect() {} },
    Semaphore: class { async acquire() { return { [Symbol.dispose]() { calls.releases++; } }; } },
    __esmMin: (initialize) => {
      let initialized = false;
      return () => { if (!initialized) { initialized = true; initialize(); } };
    },
    isCaptureAllowed: () => ({ allowed: true }),
    isAgentOwnedTarget: () => false,
    hasContextAwarenessLedger: () => false,
    isCurrentAccount: () => true,
    isContextAwarenessReadable: () => true,
    runRoutineSuggestionDiscovery: async () => {}, expireEventRoutines: async () => {},
    listDueRoutines: () => [], runDueRoutine: async () => {},
    runContextAwarenessGc() {}, compactDegradedContextAwarenessFrames: async () => {}, reclaimContextAwarenessSpace() {},
    __belmontOriginalRunContextAwarenessComprehension: async () => {}, digestContextAwareness: async () => {},
    sealContextAwarenessFrames: async () => ({ frames: 0 }),
    ASIDE_BROWSER_BUNDLE_ID: "at.studio.AsideBrowser", ASIDE_BROWSER_APP_NAME: "Aside",
    ...overrides,
  };
  for (const name of new Set([...primitives.matchAll(/\b(init_[\w$]+)\(\)/g)].map((match) => match[1]))) {
    if (!(name in context)) context[name] = () => calls.initializers.push(name);
  }
  vm.createContext(context);
  vm.runInContext(primitives + "\n" + shim, context, { timeout: 1000 });
  return { context, hooks: context.hooks, timers, calls, account };
}

test("lifecycle CLI rejects absent/duplicate anchors before mutating either file", () => {
  const anchor = "async function checkRoutines(){";
  for (const [name, input] of [
    ["missing", source.replace(anchor, "async function foreignCheckRoutines(){")],
    ["duplicate", source + "\n" + anchor + "}\n"],
  ]) {
    const inputPath = path.join(dir, `${name}.mjs`);
    const outputPath = path.join(dir, `${name}-output.mjs`);
    writeFileSync(inputPath, input);
    writeFileSync(outputPath, "untouched-output");
    const result = spawnSync("python3", [patcher, inputPath, outputPath], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /anchor mismatch/);
    assert.equal(readFileSync(inputPath, "utf8"), input);
    assert.equal(readFileSync(outputPath, "utf8"), "untouched-output");
    const inPlace = spawnSync("python3", [patcher, inputPath], { encoding: "utf8" });
    assert.notEqual(inPlace.status, 0);
    assert.equal(readFileSync(inputPath, "utf8"), input);
  }
});

test("lifecycle CLI is byte-idempotent and rejects tampered suffix or transformed body", () => {
  const second = spawnSync("python3", [patcher, patchedPath], { encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already patched and validated/);
  assert.equal(readFileSync(patchedPath, "utf8"), patched);
  for (const [name, input] of [
    ["suffix", patched.replace('phase: "idle"', 'phase: "running"')],
    ["body", patched.replace("async function __belmontOriginalCheckRoutines(){", "async function foreignCheckRoutines(){")],
    ["timer-body", patched.replace("},ROUTINE_CHECK_INTERVAL_MS)", "},999)")],
  ]) {
    const inputPath = path.join(dir, `tampered-${name}.mjs`);
    writeFileSync(inputPath, input);
    const result = spawnSync("python3", [patcher, inputPath], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(inputPath, "utf8"), input);
  }
  assert.equal(readFileSync(bundle, "utf8"), source);
});

test("routine stop waits for the raw scheduled routine Promise and prevents new timer work", async () => {
  const gate = deferred();
  let dispatched = 0;
  const r = runtime({
    AccountRegistry: { getAll: () => ({ accounts: [{ id: 7 }] }) },
    listDueRoutines: () => [{ id: "routine" }],
    runDueRoutine: async () => { dispatched++; await gate.promise; },
  });
  await r.hooks.startRoutineScheduler();
  const timer = r.timers.find("interval", 30_000);
  r.timers.fire(timer);
  await tick();
  assert.equal(dispatched, 1);
  let stopped = false;
  const stop = r.hooks.stopRoutineScheduler().then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  assert.equal(r.timers.active.size, 0);
  r.timers.fire(timer);
  gate.resolve();
  await stop;
  assert.equal(dispatched, 1);
  await r.context.checkRoutines();
  assert.equal(dispatched, 1);
});

for (const name of ["context", "comprehension"]) {
  test(`${name} shares pending startup, drains its first pass, then restarts one timer without reinitialization`, async () => {
    const gate = deferred();
    let passes = 0;
    const account = { id: 7, createdAt: "fixture-account" };
    const r = runtime({
      AccountRegistry: { getAll: () => ({ accounts: [account] }), getAccount: () => account, getCurrentAccountId: () => 7 },
      hasContextAwarenessLedger: () => true,
      compactDegradedContextAwarenessFrames: async () => { if (name === "context") { passes++; await gate.promise; } },
      __belmontOriginalRunContextAwarenessComprehension: async () => { if (name === "comprehension") { passes++; await gate.promise; } },
    });
    const start = name === "context" ? r.hooks.startContextAwareness : r.hooks.startContextAwarenessComprehension;
    const stop = name === "context" ? r.hooks.stopContextAwareness : r.hooks.stopContextAwarenessComprehension;
    const first = start();
    assert.equal(start(), first);
    await tick();
    assert.equal(passes, 1);
    let stopped = false;
    const closing = stop();
    assert.equal(stop(), closing);
    closing.then(() => { stopped = true; });
    await tick();
    assert.equal(stopped, false);
    assert.equal(r.timers.active.size, 0);
    await assert.rejects(start(), /while stopping/);
    gate.resolve();
    await Promise.all([first, closing]);
    const initialized = [...r.calls.initializers];
    await start();
    assert.equal(passes, 2);
    assert.equal(r.timers.active.size, 1);
    assert.deepEqual(r.calls.initializers, initialized);
    await start();
    assert.equal(r.timers.active.size, 1);
    assert.equal(passes, 2);
    await stop();
    assert.equal(r.timers.active.size, 0);
  });
}

test("failed startup and failed cleanup remain observable and refuse unsafe restart", async () => {
  const failure = new Error("injected startup account read failure");
  const r = runtime({ AccountRegistry: { getCurrentAccountId: () => { throw failure; } } });
  await assert.rejects(r.hooks.startContextAwareness(), (error) => error === failure);
  await assert.rejects(r.hooks.startContextAwareness(), /while failed/);
  let stopFailure;
  await assert.rejects(r.hooks.stopContextAwareness(), (error) => {
    stopFailure = error;
    return error instanceof AggregateError && error.errors.includes(failure);
  });
  await assert.rejects(r.hooks.stopContextAwareness(), (error) => error === stopFailure);
  await assert.rejects(r.hooks.startContextAwareness(), /while stop_failed/);
  assert.equal(r.calls.nativeStops, 1);
});

test("asynchronous startup rejection is shared and reaches both start and stop callers", async () => {
  const failure = new Error("injected asynchronous account enumeration failure");
  const r = runtime();
  r.context.AccountRegistry.getAll = () => { throw failure; };
  const starting = r.hooks.startContextAwareness();
  assert.equal(r.hooks.startContextAwareness(), starting);
  await assert.rejects(starting, (error) => error instanceof AggregateError && error.errors.includes(failure));
  await assert.rejects(r.hooks.startContextAwareness(), /while failed/);
  await assert.rejects(r.hooks.stopContextAwareness(), (error) => error instanceof AggregateError && error.errors.includes(failure));
  assert.equal(r.timers.active.size, 0);
});

test("context stop retains the first detached disposal and disposes observer recreated by pending capture", async () => {
  const firstDispose = deferred(), firstClose = deferred(), canvas = deferred();
  const secondDispose = deferred(), secondClose = deferred(), helper = deferred();
  const events = [];
  const r = runtime({
    settings: () => ({ get: () => ({ enabled: true, retentionDays: 30 }) }),
    nativeContextAwarenessHelper: { reconcile() {}, stop: () => helper.promise },
    isCanvasRenderedPage: () => true,
    readCanvasContent: async () => {
      events.push("canvas-entered");
      await canvas.promise;
      r.context.observerBrowser = { dispose: () => { events.push("second-dispose"); return secondDispose.promise; } };
      r.context.observerCdp = { close: () => { events.push("second-close"); return secondClose.promise; } };
      return "captured text";
    },
  });
  await r.hooks.startContextAwareness();
  r.context.resolveObservedTarget = async () => ({ targetId: "tab", url: "https://canvas.test", title: "Canvas" });
  r.context.observerBrowser = { dispose: () => { events.push("first-dispose"); return firstDispose.promise; } };
  r.context.observerCdp = { close: () => { events.push("first-close"); return firstClose.promise; } };
  const capture = r.context.captureTab(7, "tab", "interaction", r.context.captureGeneration);
  await tick();
  assert.deepEqual(events, ["canvas-entered"]);
  let stopped = false;
  const closing = r.hooks.stopContextAwareness().then(() => { stopped = true; });
  await tick();
  assert.equal(r.context.observerBrowser, null);
  assert.equal(r.timers.active.size, 0);
  assert.equal(r.calls.unsubscribe, 4);
  assert.equal(stopped, false);
  firstDispose.resolve();
  await tick();
  assert.ok(events.includes("first-close"));
  assert.equal(stopped, false);
  canvas.resolve();
  helper.resolve();
  await capture;
  await tick();
  assert.equal(stopped, false);
  assert.equal(events.includes("second-dispose"), false, "the first detached close still owns pending work");
  firstClose.resolve();
  await tick();
  assert.ok(events.includes("second-dispose"));
  assert.equal(stopped, false);
  secondDispose.resolve();
  await tick();
  assert.ok(events.includes("second-close"));
  assert.equal(stopped, false);
  secondClose.resolve();
  await closing;
  assert.equal(r.context.observerBrowser, null);
  assert.equal(r.context.observerCdp, null);
  assert.equal(r.calls.releases, 1);
});

test("context stop clears grace/debounce timers and drains pending user and native signals", async () => {
  const targets = deferred(), extension = deferred();
  const r = runtime({ settings: () => ({ get: () => ({ enabled: true, retentionDays: 30 }) }),
    sendCommandToExtension: () => extension.promise, hasFocusedAgentManagerSurface: () => false });
  await r.hooks.startContextAwareness();
  const grace = r.timers.find("timeout", 15_000);
  assert.ok(grace);
  r.context.listObservableTargets = () => targets.promise;
  const debounce = r.timers.setTimeout(() => { throw new Error("stopped debounce fired"); }, 500);
  r.context.pendingCaptures.set("queued", { timer: debounce });
  const userSignal = r.context.reportUserTabSignal(7, { kind: "activation", targetId: "unmapped", url: "https://test" });
  const nativeSignal = r.context.reportNativeBrowserSignal(7, { kind: "mouse.click", bundleId: "at.studio.AsideBrowser" });
  await tick();
  let stopped = false;
  const closing = r.hooks.stopContextAwareness().then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  assert.equal(r.timers.active.size, 0);
  assert.ok(r.timers.cleared.includes(grace));
  assert.ok(r.timers.cleared.includes(debounce));
  targets.resolve([{ targetId: "tab", url: "https://test" }]);
  await userSignal;
  await tick();
  assert.equal(stopped, false);
  extension.resolve({ items: [] });
  await Promise.all([nativeSignal, closing]);
  r.timers.fire(grace);
  assert.equal(r.calls.warnings.length, 0);
  assert.equal(r.context.pendingCaptures.size, 0);
});

function nativeHelperFixture() {
  const timers = fakeTimers();
  const child = new EventEmitter();
  child.kills = 0;
  child.kill = () => { child.kills++; };
  const method = slice("stop(){this.#x+=1", "pause(Cn,ei=INDEFINITE_PAUSE)").replace("pause(Cn,ei=INDEFINITE_PAUSE)", "");
  const Helper = vm.runInNewContext(`(class {
    #x=0; #a=true; #n=7; #r="fixture"; #S=false; #s=null; #f=null; #p=null;
    #m=null; #b=null; #c=null; #e; #i="running"; #t=null;
    constructor(child) { this.#e=child; }
    #A() {} #j() {} async #K() {}
    get pending() { return this.#t; }
    ${method}
  })`, { ...timers, Error, Promise, logDetachedError() {} });
  return { helper: new Helper(child), child, timers };
}

test("native helper stop returns the exact child-close Promise and clears both deadlines", async () => {
  const { helper, child, timers } = nativeHelperFixture();
  const stopping = helper.stop();
  assert.ok(stopping instanceof Promise);
  assert.equal(stopping, helper.pending);
  assert.equal(helper.stop(), stopping);
  let stopped = false;
  stopping.then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  assert.equal(timers.active.size, 2);
  child.emit("close");
  await stopping;
  assert.equal(helper.pending, null);
  assert.equal(timers.active.size, 0);
  assert.equal(child.kills, 0);
});

test("native helper timeout rejects, and context lifecycle refuses restart after that failure", async () => {
  const { helper, child, timers } = nativeHelperFixture();
  const r = runtime({ nativeContextAwarenessHelper: { reconcile() {}, stop: () => helper.stop() } });
  await r.hooks.startContextAwareness();
  const stopping = r.hooks.stopContextAwareness();
  const rejected = assert.rejects(stopping, (error) => error instanceof AggregateError
    && error.errors.some((inner) => /did not exit within 2000ms/.test(inner.message)));
  timers.fire(timers.find("timeout", 1000));
  assert.equal(child.kills, 1);
  timers.fire(timers.find("timeout", 2000));
  await rejected;
  assert.equal(timers.active.size, 0);
  await assert.rejects(r.hooks.startContextAwareness(), /while stop_failed/);
});
import { existsSync as lifecycleExtraExists, readFileSync as lifecycleExtraRead, mkdtempSync as lifecycleExtraTemp, rmSync as lifecycleExtraRemove } from "node:fs";
import { spawnSync as lifecycleExtraSpawn } from "node:child_process";
import { tmpdir as lifecycleExtraTmpdir } from "node:os";
import { join as lifecycleExtraJoin, resolve as lifecycleExtraResolve } from "node:path";
import { runInNewContext as lifecycleExtraVm } from "node:vm";
import lifecycleExtraAssert from "node:assert/strict";
import lifecycleExtraTest from "node:test";

const lifecycleExtraRepo = process.env.BELMONT_LIFECYCLE_TEST_REPO || lifecycleExtraResolve(import.meta.dirname, "..");
const lifecycleExtraRawPath = resolveAsideOriginal("1.26.906.1714");
const lifecycleExtraSkip = !lifecycleExtraExists(lifecycleExtraRawPath);
const lifecycleExtraTick = () => new Promise((resolve) => setImmediate(resolve));
function lifecycleExtraDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function lifecycleExtraPatched(t) {
  const root = lifecycleExtraTemp(lifecycleExtraJoin(lifecycleExtraTmpdir(), "aside-lifecycle-extra-"));
  t.after(() => lifecycleExtraRemove(root, { recursive: true, force: true }));
  const output = lifecycleExtraJoin(root, "daemon.fixture.mjs");
  const result = lifecycleExtraSpawn("python3", [lifecycleExtraJoin(lifecycleExtraRepo, "belmont-browse/tools/patch-daemon-lifecycle.py"), lifecycleExtraRawPath, output], { encoding: "utf8" });
  lifecycleExtraAssert.equal(result.status, 0, result.stderr);
  return lifecycleExtraRead(output, "utf8");
}
function lifecycleExtraSlice(source, begin, end) {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end, start + begin.length);
  lifecycleExtraAssert.ok(start >= 0 && stop > start, `Missing raw primitive boundaries: ${begin}`);
  return source.slice(start, stop);
}
function lifecycleExtraSummaryFixture(source, options = {}) {
  const agents = [];
  const promptGate = options.promptGate || { promise: Promise.resolve() };
  const idleGate = options.idleGate || { promise: Promise.resolve() };
  const resolved = { model: { id: "fixture-summary", provider: "fixture", api: "fixture" }, apiKey: "fixture" };
  class FakeAgent {
    state = { messages: [{ role: "assistant", content: "partial" }] };
    prompts = 0;
    aborts = 0;
    idles = 0;
    unsubscribes = 0;
    constructor(config) { this.config = config; agents.push(this); }
    subscribe(callback) { this.subscriber = callback; return () => { this.unsubscribes += 1; }; }
    async prompt() {
      this.prompts += 1;
      await promptGate.promise;
      this.state.messages = [{ role: "assistant", content: "complete" }];
      this.subscriber({ type: "message_end", message: { role: "assistant", usage: { input: 3, output: 7 } } });
    }
    abort() { this.aborts += 1; }
    waitForIdle() { this.idles += 1; return idleGate.promise; }
  }
  const raw = lifecycleExtraSlice(source, "async function __belmontOriginalRunSummaryAgent(Cn){", "async function resolveContextAwarenessSummaryModel(Cn){");
  const shim = source.slice(source.indexOf("// belmont-browse-lifecycle: drainable-906-v1")).replace("export const __belmontLifecycles", "const __belmontLifecycles");
  const context = {
    Promise, Map, Set, Error, AggregateError,
    models: () => ({ resolve: () => options.modelGate ? options.modelGate.promise : Promise.resolve(resolved) }),
    settings: () => ({ get: () => ({ summaryModel: { modelId: "fixture-summary", provider: "fixture", thinkingLevel: "none" } }) }),
    buildExecutableModelConfig: (value) => value,
    toModelInfo: (value) => value,
    modelRuntime: { streamSimple() {} },
    Agent$1: FakeAgent,
    textContent$3: (message) => message.content,
    init_start_comprehension() {}, init_scheduler() {}, init_start_context_awareness() {}, init_lifecycles() {},
    __belmontOriginalStartContextAwarenessComprehension() {},
    timer: null, clearInterval() {},
  };
  const api = lifecycleExtraVm(`${raw}\n${shim}\n({ runSummaryAgent, hooks: __belmontLifecycles, state: () => __belmontLifecycleState("comprehension") })`, context);
  return { ...api, agents, resolved };
}

lifecycleExtraTest("lifecycle summary abort waits for idle and never returns a partial summary", { skip: lifecycleExtraSkip }, async (t) => {
  const source = lifecycleExtraPatched(t);
  const promptGate = lifecycleExtraDeferred();
  const idleGate = lifecycleExtraDeferred();
  const fixture = lifecycleExtraSummaryFixture(source, { promptGate, idleGate });
  const summary = fixture.runSummaryAgent({ accountId: "one", systemPrompt: "fixture", prompt: "fixture" });
  const summaryRejected = lifecycleExtraAssert.rejects(summary, (error) => error.code === "BELMONT_LIFECYCLE_STOPPING");
  await lifecycleExtraTick();
  lifecycleExtraAssert.equal(fixture.agents.length, 1);
  let stopped = false;
  const stop = fixture.hooks.stopContextAwarenessComprehension().then(() => { stopped = true; });
  lifecycleExtraAssert.equal(fixture.agents[0].aborts, 1);
  lifecycleExtraAssert.equal(fixture.agents[0].idles, 1);
  promptGate.resolve();
  await summaryRejected;
  await lifecycleExtraTick();
  lifecycleExtraAssert.equal(stopped, false, "waitForIdle must be awaited after the prompt settles");
  lifecycleExtraAssert.equal(fixture.agents[0].unsubscribes, 1);
  idleGate.resolve();
  await stop;
  lifecycleExtraAssert.equal(fixture.state().agents.size, 0);
  await lifecycleExtraAssert.rejects(fixture.runSummaryAgent({ accountId: "one" }), (error) => error.code === "BELMONT_LIFECYCLE_STOPPING");
  lifecycleExtraAssert.equal(fixture.agents.length, 1, "stopped summaries cannot create another agent");
});

lifecycleExtraTest("lifecycle summary model resolution cannot launch a prompt after stop", { skip: lifecycleExtraSkip }, async (t) => {
  const modelGate = lifecycleExtraDeferred();
  const fixture = lifecycleExtraSummaryFixture(lifecycleExtraPatched(t), { modelGate });
  const summary = fixture.runSummaryAgent({ accountId: "one", systemPrompt: "fixture", prompt: "fixture" });
  const summaryRejected = lifecycleExtraAssert.rejects(summary, (error) => error.code === "BELMONT_LIFECYCLE_STOPPING");
  let stopped = false;
  const stop = fixture.hooks.stopContextAwarenessComprehension().then(() => { stopped = true; });
  await lifecycleExtraTick();
  lifecycleExtraAssert.equal(stopped, false);
  modelGate.resolve(fixture.resolved);
  await summaryRejected;
  await stop;
  lifecycleExtraAssert.equal(fixture.agents[0].prompts, 0);
  lifecycleExtraAssert.equal(fixture.agents[0].unsubscribes, 1);
});

lifecycleExtraTest("lifecycle normal summary preserves output and token accounting", { skip: lifecycleExtraSkip }, async (t) => {
  const fixture = lifecycleExtraSummaryFixture(lifecycleExtraPatched(t));
  const result = await fixture.runSummaryAgent({ accountId: "one", systemPrompt: "fixture", prompt: "fixture" });
  lifecycleExtraAssert.equal(JSON.stringify(result), JSON.stringify({ output: "complete", model: "fixture-summary", inputTokens: 3, outputTokens: 7 }));
  await fixture.hooks.stopContextAwarenessComprehension();
  lifecycleExtraAssert.equal(fixture.agents[0].aborts, 0);
});

lifecycleExtraTest("lifecycle summary real failures reject shutdown and block restart", { skip: lifecycleExtraSkip }, async (t) => {
  const promptGate = lifecycleExtraDeferred();
  const fixture = lifecycleExtraSummaryFixture(lifecycleExtraPatched(t), { promptGate });
  const summary = fixture.runSummaryAgent({ accountId: "one", systemPrompt: "fixture", prompt: "fixture" });
  const summaryRejected = lifecycleExtraAssert.rejects(summary, /actual summary failure/);
  promptGate.reject(Error("actual summary failure"));
  await summaryRejected;
  await lifecycleExtraAssert.rejects(fixture.hooks.stopContextAwarenessComprehension(), (error) => error.errors.some((entry) => /actual summary failure/.test(entry.message)));
  await lifecycleExtraAssert.rejects(fixture.hooks.startContextAwarenessComprehension(), /stop_failed/);
});

function lifecycleExtraServerFixture(source) {
  const method = lifecycleExtraSlice(source, "async disposeAll(){let belmontFailures=[];", "async#d(Cn,ei){");
  // Only the patched raw disposeAll primitive executes. Private stores and factory
  // publication are independent fakes, not the production server implementation.
  return lifecycleExtraVm(`new (class {
    #e = new Map(); #t = new Map();
    disposed = [];
    add(id, error = null) { this.#e.set(id, { accountId: "one", sessionId: id, error }); }
    pending(id, promise, error = null) {
      const load = promise.then(() => this.add(id, error));
      this.#t.set(id, load);
      load.then(() => this.#t.delete(id), () => this.#t.delete(id));
    }
    async disposeSession(accountId, id) {
      this.disposed.push(id);
      const entry = this.#e.get(id);
      this.#e.delete(id);
      if (entry.error) throw entry.error;
    }
    ${method}
  })()`, { Promise, Map, AggregateError });
}

lifecycleExtraTest("lifecycle engine disposal includes sessions published by pending constructors", { skip: lifecycleExtraSkip }, async (t) => {
  const fixture = lifecycleExtraServerFixture(lifecycleExtraPatched(t));
  const pending = lifecycleExtraDeferred();
  fixture.add("already-loaded");
  fixture.pending("late-loaded", pending.promise);
  let stopped = false;
  const stop = fixture.disposeAll().then(() => { stopped = true; });
  await lifecycleExtraTick();
  lifecycleExtraAssert.equal(stopped, false);
  lifecycleExtraAssert.equal(fixture.disposed.length, 0);
  pending.resolve();
  await stop;
  lifecycleExtraAssert.deepEqual(Array.from(fixture.disposed).sort(), ["already-loaded", "late-loaded"]);
});

lifecycleExtraTest("lifecycle engine disposal drains all sessions despite load and dispose rejection", { skip: lifecycleExtraSkip }, async (t) => {
  const fixture = lifecycleExtraServerFixture(lifecycleExtraPatched(t));
  const pending = lifecycleExtraDeferred();
  fixture.add("failure", Error("dispose failed"));
  fixture.add("other");
  fixture.pending("load-failure", pending.promise);
  const stopRejected = lifecycleExtraAssert.rejects(fixture.disposeAll(), (error) => {
    lifecycleExtraAssert.deepEqual(error.errors.map((entry) => entry.message).sort(), ["dispose failed", "load failed"]);
    return true;
  });
  pending.reject(Error("load failed"));
  await stopRejected;
  lifecycleExtraAssert.deepEqual(Array.from(fixture.disposed).sort(), ["failure", "other"]);
});

lifecycleExtraTest("lifecycle cancellation defers one fenced summary claim without spending retries or claiming another", { skip: lifecycleExtraSkip }, async (t) => {
  const source = lifecycleExtraPatched(t);
  const pass = lifecycleExtraSlice(source, "async function runComprehensionPass(Cn,ei={}){", "var MAX_JOBS_PER_PASS,");
  const defer = lifecycleExtraSlice(source, "function deferSummaryJob(Cn,ei,ti){", "function skipSummaryJob(Cn,ei,ti){");
  const account = { id: "one", createdAt: 1 };
  const claim = { id: "owned-claim", attemptCount: 2, leaseExpiresAt: 9000 };
  const writes = [];
  let stopped = false;
  let claims = 0;
  let enqueues = 0;
  let failed = 0;
  const context = {
    Promise, Error, Date,
    __belmontLifecycleBlocked: () => stopped,
    AccountRegistry: { getAccount: () => account },
    settings: () => ({ get: () => ({ enabled: true }) }),
    MAX_JOBS_PER_PASS: 6,
    MAX_ATTEMPTS: 3,
    RETRY_DELAYS_MS: [60000, 300000],
    enqueueSummaryJobs() { enqueues += 1; return 2; },
    claimSummaryJob() { claims += 1; return claim; },
    async summarizeJob() {
      stopped = true;
      const error = Error("stopped");
      error.code = "BELMONT_LIFECYCLE_STOPPING";
      throw error;
    },
    failSummaryJob() { failed += 1; },
    ContextAwarenessSummaryTable: "summary-table",
    claimFence: (job) => ({ id: job.id, leaseExpiresAt: job.leaseExpiresAt }),
    ledgerDb: (accountId) => ({ update: (table) => ({ set: (values) => ({ where: (fence) => ({ run: () => writes.push({ accountId, table, values, fence }) }) }) }) }),
    logger: { warn() {}, info() {} },
  };
  const run = lifecycleExtraVm(`${defer}\n${pass}\nrunComprehensionPass`, context);
  const result = await run(account);
  lifecycleExtraAssert.equal(claims, 1);
  lifecycleExtraAssert.equal(failed, 0);
  lifecycleExtraAssert.equal(result.skipped, 1);
  lifecycleExtraAssert.equal(writes.length, 1);
  lifecycleExtraAssert.equal(writes[0].values.status, "pending");
  lifecycleExtraAssert.equal(writes[0].values.attemptCount, 1, "original defer restores the pre-claim attempt count");
  lifecycleExtraAssert.equal(writes[0].values.leaseExpiresAt, null);
  lifecycleExtraAssert.equal(writes[0].fence.id, claim.id);
  lifecycleExtraAssert.equal(writes[0].fence.leaseExpiresAt, claim.leaseExpiresAt);
  await run(account);
  lifecycleExtraAssert.equal(enqueues, 1, "a queued pass after stop cannot enqueue more jobs");
  lifecycleExtraAssert.equal(claims, 1);
});

test("observer shutdown attempts every original resource and propagates real cleanup failures", async () => {
  const r = runtime();
  await r.hooks.startContextAwareness();
  const attempts = [];
  r.context.unsubscribers = [() => { attempts.push("unsubscribe-one"); throw Error("unsubscribe failed"); }, () => attempts.push("unsubscribe-two")];
  r.context.observerBrowser = { async dispose() { attempts.push("dispose"); throw Error("browser failed"); } };
  r.context.observerCdp = { async close() { attempts.push("close"); throw Error("cdp failed"); } };
  await assert.rejects(r.hooks.stopContextAwareness(), (error) => {
    const observerFailure = error.errors.find((entry) => entry.message === "Context observer shutdown failed");
    assert.deepEqual(Array.from(observerFailure.errors, (entry) => entry.message), ["unsubscribe failed", "browser failed", "cdp failed"]);
    return true;
  });
  assert.deepEqual(attempts, ["unsubscribe-one", "unsubscribe-two", "dispose", "close"]);
  assert.equal(r.context.observerBrowser, null);
  assert.equal(r.context.observerCdp, null);
  await assert.rejects(r.hooks.startContextAwareness(), /stop_failed/);
});

test("maintenance keeps original five-minute cadence, drains pending work, and restarts one timer", async () => {
  const r = runtime();
  let purges = 0;
  let flushes = 0;
  const gate = deferred();
  r.context.__belmontOriginalPurgeEphemeralSessions = async () => { purges += 1; if (purges === 1) await gate.promise; };
  r.context.__belmontOriginalFlushIdleTabs = async () => { flushes += 1; };
  r.context.initializeSessionLifecycles = () => assert.fail("maintenance must not invoke detached run recovery");
  await r.hooks.startSessionMaintenance();
  assert.equal(purges, 0, "the original scheduler has no immediate maintenance tick");
  assert.equal(flushes, 0);
  const initialized = [...r.calls.initializers];
  const timer = r.timers.find("interval", 300_000);
  assert.ok(timer);
  r.timers.fire(timer);
  await tick();
  assert.equal(purges, 1);
  let stopped = false;
  const stop = r.hooks.stopSessionMaintenance().then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  assert.equal(r.timers.active.size, 0);
  gate.resolve();
  await stop;
  assert.equal(flushes, 0, "stop prevents starting the next maintenance operation");
  await r.hooks.startSessionMaintenance();
  assert.equal(r.timers.active.size, 1);
  assert.deepEqual(r.calls.initializers, initialized);
  r.timers.fire(r.timers.find("interval", 300_000));
  await tick();
  assert.equal(purges, 2);
  assert.equal(flushes, 1);
  await r.hooks.stopSessionMaintenance();
  assert.equal(r.timers.active.size, 0);
});

test("maintenance owns delayed reconciliation callbacks and blocks stopped bridge callbacks", async () => {
  let onConnect;
  const r = runtime({ globalExtensionBridge: { onConnect(callback) { onConnect = callback; } } });
  await r.hooks.startSessionMaintenance();
  r.context.registerStartupTabReconciliation();
  const gate = deferred();
  let retries = 0;
  r.context.__belmontLifecycleScheduleReconciliationRetry(async () => { retries += 1; await gate.promise; });
  r.timers.fire(r.timers.find("timeout", 2000));
  await tick();
  r.context.__belmontLifecycleScheduleReconciliationRetry(async () => { retries += 1; });
  let stopped = false;
  const stop = r.hooks.stopSessionMaintenance().then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false, "a fired retry Promise remains owned after its timer disappeared");
  assert.equal(r.timers.active.size, 0);
  gate.resolve();
  await stop;
  onConnect({ accountId: 7, profileId: "after-stop" });
  assert.equal(r.context.reconciliationByProfileKey.size, 0);
  assert.equal(r.context.reconciledProfileKeys.size, 0);
  r.context.__belmontLifecycleScheduleReconciliationRetry(async () => { retries += 1; });
  assert.equal(r.timers.active.size, 0);
  assert.equal(retries, 1);
});

test("routine stop prevents subsequent due dispatch and next-account discovery inside an active pass", async () => {
  const gate = deferred();
  const discoveries = [];
  const dispatched = [];
  const r = runtime({
    AccountRegistry: { getAll: () => ({ accounts: [{ id: "one" }, { id: "two" }] }) },
    runRoutineSuggestionDiscovery: async (id) => { discoveries.push(id); },
    listDueRoutines: () => [{ id: "first" }, { id: "second" }],
    runDueRoutine: async (accountId, routine) => { dispatched.push([accountId, routine.id]); await gate.promise; },
  });
  await r.hooks.startRoutineScheduler();
  r.timers.fire(r.timers.find("interval", 30_000));
  await tick();
  const stop = r.hooks.stopRoutineScheduler();
  gate.resolve();
  await stop;
  assert.deepEqual(dispatched, [["one", "first"]]);
  assert.deepEqual(discoveries, ["one"]);
});

test("synchronous resource callbacks reenter the already-owned stop Promise exactly once", async () => {
  const r = runtime();
  await r.hooks.startContextAwareness();
  let nested;
  let invocations = 0;
  r.context.nativeContextAwarenessHelper.stop = () => {
    invocations += 1;
    nested = r.hooks.stopContextAwareness();
  };
  const stop = r.hooks.stopContextAwareness();
  assert.equal(nested, stop);
  assert.equal(invocations, 1);
  assert.equal(r.timers.active.size, 0, "timer cancellation remains synchronous");
  await stop;
});

test("synchronous resource callbacks reenter the already-owned startup Promise exactly once", async () => {
  const r = runtime();
  let nested;
  let invocations = 0;
  r.context.nativeContextAwarenessHelper.reconcile = () => {
    invocations += 1;
    nested = r.hooks.startContextAwareness();
  };
  const start = r.hooks.startContextAwareness();
  assert.equal(nested, start);
  assert.equal(invocations, 1);
  await start;
  assert.equal(r.timers.active.size, 1);
  await r.hooks.stopContextAwareness();
});

test("original context settings gate work while the existing scheduler observes later enablement", async () => {
  let enabled = false;
  let summaries = 0;
  let claimed = false;
  const account = { id: 7, createdAt: "fixture-account" };
  const r = runtime({
    AccountRegistry: { getAll: () => ({ accounts: [account] }), getAccount: () => account, getCurrentAccountId: () => 7 },
    settings: () => ({ get: () => ({ enabled, retentionDays: 30 }) }),
    hasContextAwarenessLedger: () => true,
  });
  const readable = lifecycleExtraSlice(patched, "function isContextAwarenessReadable(Cn){", "function isCaptureAllowed(Cn,ei={}){");
  const queue = lifecycleExtraSlice(patched, "function __belmontOriginalRunContextAwarenessComprehension(Cn,ei={}){", "var MAX_JOBS_PER_PASS,");
  Object.assign(r.context, {
    passQueues: new Map(), accountGenerationKey: (value) => `${value.id}:${value.createdAt}`,
    MAX_JOBS_PER_PASS: 6, MAX_ATTEMPTS: 3, RETRY_DELAYS_MS: [60000, 300000],
    enqueueSummaryJobs: () => 1,
    claimSummaryJob: () => { if (claimed) return null; claimed = true; return { id: "fixture-job", attemptCount: 1 }; },
    summarizeJob: async () => { summaries += 1; return "completed"; },
    failSummaryJob: () => assert.fail("normal enabled summary must not fail"),
  });
  vm.runInContext(readable + "\n" + queue, r.context);
  assert.equal(r.hooks.contextSettingsManaged, true);
  await r.hooks.startContextAwareness();
  await r.hooks.startContextAwarenessComprehension();
  const comprehensionTimer = r.timers.find("interval", 60_000);
  assert.ok(comprehensionTimer);
  assert.equal(summaries, 0);
  assert.equal(r.timers.find("interval", 120_000), undefined, "disabled capture creates no sweep timer");
  enabled = true;
  r.context.reconcileContextAwareness(account.id);
  assert.ok(r.timers.find("interval", 120_000));
  r.timers.fire(comprehensionTimer);
  await tick();
  assert.equal(summaries, 1);
  assert.equal(r.timers.find("interval", 60_000), comprehensionTimer, "enablement uses the original existing loop");
  await Promise.all([r.hooks.stopContextAwareness(), r.hooks.stopContextAwarenessComprehension()]);
  assert.equal(r.timers.active.size, 0);
});
