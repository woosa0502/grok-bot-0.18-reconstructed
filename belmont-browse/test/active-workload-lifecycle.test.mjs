import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";

const root = path.resolve(import.meta.dirname, "../..");
const patcher = path.join(root, "belmont-browse/tools/patch-daemon-active-workloads.py");
const original = path.join(root, "data/artifacts/aside-full-restoration_20260907T225545Z/raw/AsideDaemon-mac-x64-1.26.907.1712.mjs");
const shim = execFileSync("python3", ["-c", "import importlib.util,sys;s=importlib.util.spec_from_file_location('p',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.SHIM)", patcher], { encoding: "utf8" });
const delay = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => Promise.withResolvers();

function extractBundledFunction(source, declaration, nextDeclaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing declaration: ${declaration}`);
  const end = source.indexOf(nextDeclaration, start + declaration.length);
  assert.notEqual(end, -1, `missing next declaration: ${nextDeclaration}`);
  return source.slice(start, end);
}

function routineTriggerFixture(source, overrides = {}) {
  const declaration = "async function buildRoutineTriggerMessage(Cn,ei,ti,ni={}){";
  const implementation = extractBundledFunction(
    source,
    declaration,
    "function buildRoutineExpiryMessage",
  );
  const context = vm.createContext({
    Date,
    JSON,
    getLastRun: async () => undefined,
    ensureRoutineMemory: async () => undefined,
    ...overrides,
  });
  vm.runInContext(
    `${implementation};globalThis.buildRoutineTriggerMessage=buildRoutineTriggerMessage`,
    context,
  );
  return context.buildRoutineTriggerMessage;
}

function fixture(overrides = {}) {
  const context = vm.createContext({
    console, setTimeout, clearTimeout, Map, Set, Promise, Error, AggregateError,
    activeBackfills: new Map(), websocketSessionCache: new Map(), sessionResourceCleanups: new Set(),
    __belmontOriginalExtractMemories: async (operation) => operation(),
    __belmontOriginalRunDreaming: async (operation) => operation(),
    __belmontOriginalDigestContextAwareness: async (operation) => operation(),
    __belmontOriginalStartSessionRunMemoryBackfill: async (operation) => operation(),
    __belmontOriginalAcquireWebSocket: async (lease) => lease,
    stopSessionRunMemoryBackfill: async () => {},
    ...overrides,
  });
  vm.runInContext(shim.replace("export const __belmontWorkloads =", "globalThis.workloads ="), context);
  return context;
}

class Socket extends EventTarget {
  readyState = 1;
  closeCalls = 0;
  constructor(ms = 20) { super(); this.ms = ms; }
  close() {
    this.closeCalls += 1;
    if (this.readyState !== 1) return;
    this.readyState = 2;
    if (this.ms === null) return;
    setTimeout(() => { this.readyState = 3; this.dispatchEvent(new Event("close")); }, this.ms);
  }
}

test("907 patch validates every anchor, is idempotent, rejects tamper, and parses", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aside-workload-patch-"));
  try {
    const output = path.join(directory, "daemon.mjs");
    execFileSync("python3", [patcher, original, output]);
    const first = readFileSync(output, "utf8");
    assert.match(first, /routineMemoryPath\?\?await ensureRoutineMemory\(Cn,ei\)/);
    assert.doesNotMatch(first, /routineMemoryPath\?\?ensureRoutineMemory\(Cn,ei\)/);
    execFileSync("python3", [patcher, output]);
    assert.equal(readFileSync(output, "utf8"), first);
    execFileSync(process.execPath, ["--check", output]);
    writeFileSync(output, first.replace(
      "routineMemoryPath??await ensureRoutineMemory(Cn,ei)",
      "routineMemoryPath??await Promise.resolve(ensureRoutineMemory(Cn,ei))",
    ));
    assert.throws(() => execFileSync("python3", [patcher, output], { stdio: "pipe" }), /Command failed/);
    writeFileSync(output, first.replace("__belmontWorkloadPrompt(pi,", "pi.prompt("));
    assert.throws(() => execFileSync("python3", [patcher, output], { stdio: "pipe" }), /Command failed/);
    assert.match(readFileSync(output, "utf8"), /try\{await pi\.prompt\(/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("907 routine trigger awaits routine memory initialization without Promise text", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aside-routine-memory-patch-"));
  try {
    const output = path.join(directory, "daemon.mjs");
    execFileSync("python3", [patcher, original, output]);
    const source = readFileSync(output, "utf8");
    const baseRoutine = {
      id: "routine-id",
      name: "Routine name",
      kind: "cron",
      scheduleKind: "once",
      prompt: "Do the work.",
    };

    let onceInitializations = 0;
    const buildOnce = routineTriggerFixture(source, {
      ensureRoutineMemory: async () => {
        onceInitializations += 1;
        return undefined;
      },
    });
    const once = await buildOnce(0, baseRoutine, null, { timestamp: 1 });
    assert.equal(onceInitializations, 1);
    assert.doesNotMatch(once.content, /Routine memory:/);
    assert.doesNotMatch(once.content, /\[object Promise\]/);

    const memory = deferred();
    let recurringInitializations = 0;
    const buildRecurring = routineTriggerFixture(source, {
      ensureRoutineMemory: () => {
        recurringInitializations += 1;
        return memory.promise;
      },
    });
    let recurringSettled = false;
    const recurringPromise = buildRecurring(
      0,
      { ...baseRoutine, scheduleKind: "recurring" },
      null,
      { timestamp: 2 },
    ).then((value) => {
      recurringSettled = true;
      return value;
    });
    await delay(0);
    assert.equal(recurringInitializations, 1);
    assert.equal(recurringSettled, false);
    memory.resolve("/memory/routines/routine-name-routine-id/MEMORY.md");
    const recurring = await recurringPromise;
    assert.match(
      recurring.content,
      /Routine memory: \/memory\/routines\/routine-name-routine-id\/MEMORY\.md/,
    );
    assert.doesNotMatch(recurring.content, /\[object Promise\]/);

    let explicitInitializations = 0;
    const buildExplicit = routineTriggerFixture(source, {
      ensureRoutineMemory: async () => {
        explicitInitializations += 1;
        throw Error("initializer must be bypassed");
      },
    });
    const explicit = await buildExplicit(0, baseRoutine, null, {
      timestamp: 3,
      routineMemoryPath: "/provided/MEMORY.md",
    });
    assert.equal(explicitInitializations, 0);
    assert.match(explicit.content, /Routine memory: \/provided\/MEMORY\.md/);

    const initializationError = Error("routine memory initialization failed");
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const buildRejecting = routineTriggerFixture(source, {
        ensureRoutineMemory: async () => { throw initializationError; },
      });
      await assert.rejects(
        buildRejecting(0, { ...baseRoutine, scheduleKind: "recurring" }, null, { timestamp: 4 }),
        (error) => error === initializationError,
      );
      await delay(0);
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("normal detached completion keeps extraction, digest, dreaming and their results", async () => {
  const f = fixture();
  const seen = [];
  const value = await f.__belmontWorkloadCompleted(async () => {
    await f.extractMemories(async () => seen.push("extract"));
    await f.digestContextAwareness(async () => seen.push("digest"));
    return f.runDreaming(async () => { seen.push("dream"); return 42; });
  });
  assert.equal(value, 42);
  assert.deepEqual(seen, ["extract", "digest", "dream"]);
  await f.workloads.closeSessionResources();
});

test("drain waits a detached pre-memory callback and blocks its late producer", async () => {
  const f = fixture();
  const gate = deferred();
  let created = 0;
  const run = f.__belmontWorkloadCompleted(async () => {
    await gate.promise;
    await f.extractMemories(() => { created += 1; });
  });
  const rejected = assert.rejects(run, { code: "BELMONT_WORKLOAD_STOPPING" });
  let closed = false;
  const drain = f.workloads.drain().then(() => { closed = true; });
  await delay();
  assert.equal(closed, false);
  gate.resolve();
  await Promise.all([rejected, drain]);
  assert.equal(created, 0);
  await f.workloads.closeSessionResources();
});

test("shutdown aborts an active local Agent and waits idle before resolving", async () => {
  const f = fixture();
  const prompt = deferred();
  const idle = deferred();
  let aborts = 0;
  let successEffects = 0;
  const agent = { prompt: () => prompt.promise, abort: () => { aborts += 1; prompt.resolve(); }, waitForIdle: () => idle.promise };
  const run = f.extractMemories(async () => { await f.__belmontWorkloadPrompt(agent, "request"); successEffects += 1; });
  const rejected = assert.rejects(run, { code: "BELMONT_WORKLOAD_STOPPING" });
  let done = false;
  const drain = f.workloads.drain().then(() => { done = true; });
  assert.equal(aborts, 1);
  await delay();
  assert.equal(done, false);
  idle.resolve();
  await Promise.all([drain, rejected]);
  assert.equal(successEffects, 0);
  assert.equal(f.workloads.stats().agents, 0);
  await f.workloads.closeSessionResources();
});

test("model resolution completing during shutdown cannot start a new Agent prompt", async () => {
  const f = fixture();
  const resolution = deferred();
  let calls = 0;
  const run = f.runDreaming(async () => {
    await resolution.promise;
    await f.__belmontWorkloadPrompt({ prompt: () => { calls += 1; }, waitForIdle: async () => {} });
  });
  const rejected = assert.rejects(run, { code: "BELMONT_WORKLOAD_STOPPING" });
  const drain = f.workloads.drain();
  resolution.resolve();
  await Promise.all([rejected, drain]);
  assert.equal(calls, 0);
  await f.workloads.closeSessionResources();
});

test("shutdown during final Agent idle wait blocks original success side effects", async () => {
  const f = fixture();
  const enteredIdle = deferred();
  const idle = deferred();
  let success = 0;
  const agent = { prompt: async () => {}, abort: () => {}, waitForIdle: () => { enteredIdle.resolve(); return idle.promise; } };
  const run = f.runDreaming(async () => { await f.__belmontWorkloadPrompt(agent); success += 1; });
  const rejected = assert.rejects(run, { code: "BELMONT_WORKLOAD_STOPPING" });
  await enteredIdle.promise;
  const drain = f.workloads.drain();
  idle.resolve();
  await Promise.all([rejected, drain]);
  assert.equal(success, 0);
  await f.workloads.closeSessionResources();
});

test("disposal writes admitted as teardown are retained during shutdown", async () => {
  const f = fixture();
  const write = deferred();
  f.workloads.beginShutdown();
  const increment = f.__belmontWorkloadTrack(() => write.promise, true);
  let drained = false;
  const drain = f.workloads.drain().then(() => { drained = true; });
  await delay();
  assert.equal(drained, false);
  write.resolve();
  await Promise.all([increment, drain]);
  await f.workloads.closeSessionResources();
});

test("backfill drain stops coordinators and waits literal Worker exit", async () => {
  let stops = 0;
  const f = fixture({ activeBackfills: new Map([[7, {}]]), stopSessionRunMemoryBackfill: async (id) => { assert.equal(id, 7); stops += 1; } });
  const worker = new EventEmitter();
  let terms = 0;
  worker.terminate = async () => { terms += 1; };
  f.__belmontWorkloadWorker(worker);
  let drained = false;
  const drain = f.workloads.drain().then(() => { drained = true; });
  await delay();
  assert.equal(drained, false);
  assert.equal(stops, 1);
  assert.equal(terms, 1);
  worker.emit("exit", 1);
  await drain;
  assert.equal(f.workloads.stats().workers, 0);
  await f.workloads.closeSessionResources();
});

test("a disposal hook error remains a shutdown failure when its caller catches it", async () => {
  const f = fixture();
  f.workloads.beginShutdown();
  await f.__belmontWorkloadTrack(async () => { throw Error("count write failed"); }, true).catch(() => {});
  await assert.rejects(f.workloads.drain(), (error) => error.errors.some((cause) => cause.message === "count write failed"));
  await assert.rejects(f.workloads.closeSessionResources(), /session resource cleanup failed/);
});

test("late backfill workers are still terminated and awaited", async () => {
  const f = fixture();
  const gate = deferred();
  const worker = new EventEmitter();
  let terms = 0;
  worker.terminate = async () => { terms += 1; setTimeout(() => worker.emit("exit", 1), 15); };
  const run = f.startSessionRunMemoryBackfill(async () => { await gate.promise; f.__belmontWorkloadWorker(worker); });
  const drain = f.workloads.drain();
  gate.resolve();
  await Promise.all([run, drain]);
  assert.equal(terms, 1);
  assert.equal(f.workloads.stats().workers, 0);
  await f.workloads.closeSessionResources();
});

test("registered model cleanup clears TTL and awaits cached and uncached sockets", async () => {
  const f = fixture();
  const cached = new Socket(35);
  const uncached = new Socket(55);
  const idleTimer = setTimeout(() => assert.fail("idle timer escaped shutdown"), 200);
  f.websocketSessionCache.set("aux-dream", new Map([["provider", { socket: cached, idleTimer }]]));
  f.__belmontWorkloadSocket(uncached);
  let cleanupCalls = 0;
  f.sessionResourceCleanups.add(() => { cleanupCalls += 1; clearTimeout(idleTimer); cached.close(); f.websocketSessionCache.clear(); });
  let done = false;
  const closing = f.workloads.closeSessionResources().then(() => { done = true; });
  await delay();
  assert.equal(done, false);
  await closing;
  assert.equal(cleanupCalls, 1);
  assert.equal(cached.readyState, 3);
  assert.equal(uncached.readyState, 3);
  assert.equal(f.workloads.stats().sockets, 0);
  assert.equal(idleTimer._destroyed, true);
});

test("socket failure is bounded and explicit, and a failed close cannot restart", async () => {
  const f = fixture();
  const socket = new Socket(null);
  f.__belmontWorkloadSocket(socket);
  let cleanupCalls = 0;
  f.sessionResourceCleanups.add(() => { cleanupCalls += 1; });
  await assert.rejects(f.workloads.closeSessionResources({ timeoutMs: 25 }), (error) => error.errors.some((cause) => /did not close within 25ms/.test(cause.message)));
  assert.equal(cleanupCalls, 1);
  assert.equal(f.workloads.stats().phase, "close_failed");
  assert.equal(f.workloads.stats().sockets, 1);
  assert.throws(() => f.workloads.start(), /Cannot restart/);
  socket.readyState = 3;
  socket.dispatchEvent(new Event("close"));
});

test("a lease released after resource cleanup cannot create a new cache TTL", async () => {
  const f = fixture();
  const releases = [];
  const lease = await f.acquireWebSocket({ release: (options) => releases.push(options.keep) });
  await f.workloads.closeSessionResources();
  lease.release({ keep: true });
  assert.deepEqual(releases, [false]);
});

test("an acquisition finishing during resource close is released and rejected", async () => {
  const gate = deferred();
  const f = fixture({ __belmontOriginalAcquireWebSocket: () => gate.promise });
  const releases = [];
  const acquiring = f.acquireWebSocket();
  const rejected = assert.rejects(acquiring, { code: "BELMONT_WORKLOAD_STOPPING" });
  const close = f.workloads.closeSessionResources();
  gate.resolve({ release: (options) => releases.push(options.keep) });
  await Promise.all([close, rejected]);
  assert.deepEqual(releases, [false]);
});

test("cleanup rejection does not skip other owners and close is single flight", async () => {
  const f = fixture();
  let second = 0;
  f.sessionResourceCleanups.add(() => { throw Error("cleanup failed"); });
  f.sessionResourceCleanups.add(async () => { await delay(); second += 1; });
  const first = f.workloads.closeSessionResources();
  assert.equal(first, f.workloads.closeSessionResources());
  await assert.rejects(first, /session resource cleanup failed/);
  assert.equal(second, 1);
});

test("clean shutdown allows a fresh lifecycle and blocks sockets while closing", async () => {
  const f = fixture();
  const close = f.workloads.closeSessionResources();
  assert.throws(() => f.__belmontWorkloadAssertResourcesOpen(), { code: "BELMONT_WORKLOAD_STOPPING" });
  await close;
  f.workloads.start();
  assert.equal(f.workloads.stats().phase, "running");
  assert.equal(await f.extractMemories(async () => 17), 17);
  await f.workloads.closeSessionResources();
});
