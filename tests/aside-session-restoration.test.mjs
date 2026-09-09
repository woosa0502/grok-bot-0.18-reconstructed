import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "aside-session-restoration-"));
const originalEnv = { ...process.env };
process.env.BELMONT_KNOWLEDGE_DIR = path.join(root, "knowledge");
process.env.BELMONT_BROWSE_SANDBOX = "passthrough";
const { DEFAULT_MODEL, resolveModelSelection, prepareAsideHome, ensureLocalAccount, initializeLocalLifecycle, installDaemonHooks } = await import("../belmont-browse/src/session.mjs");
test.after(() => {
  for (const name of ["BELMONT_KNOWLEDGE_DIR", "BELMONT_BROWSE_SANDBOX", "ASIDE_HOME", "BELMONT_CDP_URL", "ASIDE_API_URL", "DAEMON_URL", "BELMONT_BROWSE_DAEMON_PORT"]) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  rmSync(root, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function homeFixture(settings) {
  const asideHome = mkdtempSync(path.join(root, "home-"));
  const accountRoot = path.join(asideHome, "u", "0");
  mkdirSync(accountRoot, { recursive: true });
  writeFileSync(path.join(accountRoot, "settings.json"), JSON.stringify(settings));
  return { asideHome, cdpUrl: "http://127.0.0.1:12345" };
}

test("bootstrap retains original public API routing and the configured local daemon fallback", () => {
  delete process.env.ASIDE_API_URL;
  delete process.env.DAEMON_URL;
  process.env.BELMONT_BROWSE_DAEMON_PORT = "31420";
  prepareAsideHome(homeFixture({}));
  assert.equal(process.env.ASIDE_API_URL, undefined);
  assert.equal(process.env.DAEMON_URL, "http://127.0.0.1:31420");
  process.env.ASIDE_API_URL = "http://127.0.0.1:32123";
  process.env.DAEMON_URL = "http://127.0.0.1:32124";
  prepareAsideHome(homeFixture({}));
  assert.equal(process.env.ASIDE_API_URL, "http://127.0.0.1:32123");
  assert.equal(process.env.DAEMON_URL, "http://127.0.0.1:32124");
});

test("restart retains the saved model, fast mode and unrelated preferences", () => {
  const saved = {
    defaultModel: { provider: "anthropic", modelId: "saved-model", thinkingLevel: "low", fastMode: true },
    analytics: { enabled: true, additional: "retained" },
    contextAwareness: { enabled: false, retentionDays: 19 },
    routineSuggestions: { enabled: true, cadence: "saved" },
    custom: { nested: [1, 2] },
  };
  const args = homeFixture(saved);
  const home = prepareAsideHome(args);
  assert.deepEqual(JSON.parse(readFileSync(home.settingsPath, "utf8")), saved);
  assert.deepEqual(home.defaultModel, saved.defaultModel);
  const again = prepareAsideHome({ ...args, model: undefined });
  assert.deepEqual(again.defaultModel, saved.defaultModel);
});

test("an explicitly supplied startup model replaces only the model preference", () => {
  const saved = { defaultModel: DEFAULT_MODEL, analytics: { enabled: true }, routineSuggestions: { enabled: true }, contextAwareness: { enabled: true } };
  const model = { provider: "other", modelId: "explicit", fastMode: true };
  const home = prepareAsideHome({ ...homeFixture(saved), model });
  assert.deepEqual(JSON.parse(readFileSync(home.settingsPath, "utf8")), { ...saved, defaultModel: { ...DEFAULT_MODEL, ...model } });
});

test("partial startup thinking and fast overrides preserve the selected provider and model", () => {
  const savedModel = { provider: "custom-provider", modelId: "custom-model", thinkingLevel: "custom-level", fastMode: true };
  const args = homeFixture({ defaultModel: savedModel });
  const home = prepareAsideHome({ ...args, model: { provider: undefined, modelId: undefined, thinkingLevel: "changed-level", fastMode: false } });
  assert.deepEqual(home.defaultModel, { ...savedModel, thinkingLevel: "changed-level", fastMode: false });
  assert.deepEqual(resolveModelSelection(savedModel, { fastMode: false }), { ...savedModel, fastMode: false });
  const before = readFileSync(home.settingsPath, "utf8");
  for (const model of [{ provider: false }, { modelId: null }, { thinkingLevel: 1 }, { fastMode: "true" }, { provider: " " }, null, "model"]) {
    assert.throws(() => prepareAsideHome({ ...args, model }), TypeError);
    assert.equal(readFileSync(home.settingsPath, "utf8"), before);
  }
});

test("first startup fills missing defaults and migrates the old routine key without replacing its canonical choice", () => {
  const first = prepareAsideHome(homeFixture({}));
  assert.deepEqual(first.defaultModel, DEFAULT_MODEL);
  assert.deepEqual(JSON.parse(readFileSync(first.settingsPath, "utf8")).routineSuggestions, { enabled: false });
  const legacy = prepareAsideHome(homeFixture({ routineSuggestion: { enabled: false, legacy: 1 } }));
  const migrated = JSON.parse(readFileSync(legacy.settingsPath, "utf8"));
  assert.deepEqual(migrated.routineSuggestions, { enabled: false, legacy: 1 });
  assert.equal(Object.hasOwn(migrated, "routineSuggestion"), false);
  const canonical = prepareAsideHome(homeFixture({ routineSuggestion: { enabled: false }, routineSuggestions: { enabled: true } }));
  assert.deepEqual(JSON.parse(readFileSync(canonical.settingsPath, "utf8")).routineSuggestions, { enabled: true });
});

function bootstrapFixture() {
  const accountRoot = mkdtempSync(path.join(root, "account-"));
  const calls = [];
  const account = { id: 7, createdAt: "saved" };
  const A = {
    AccountRegistry: { getAccount: () => account, getAll: () => ({ accounts: [account] }) },
    tryMigrateStateDb: async (id) => { assert.equal(id, account.id); calls.push("migrate"); },
    getAccountRoot: () => accountRoot,
    initAccountDirectory: () => calls.push("directory"),
    syncAccountBuiltinSkills: async () => calls.push("skills"),
    MemoryManager: { init: async () => calls.push("memory") },
    __linux: { loadPwmSessionFromKeychain: async (id) => { assert.equal(id, account.id); calls.push("pwm"); return false; } },
  };
  return { A, calls, account };
}

test("local bootstrap awaits the original PWM keychain loader after migration and directory initialization", async () => {
  const { A, calls, account } = bootstrapFixture();
  const gate = deferred();
  A.__linux.loadPwmSessionFromKeychain = async () => { calls.push("pwm"); await gate.promise; };
  let finished = false;
  const pending = ensureLocalAccount(A).then((value) => { finished = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["migrate", "directory", "skills", "memory", "pwm"]);
  assert.equal(finished, false);
  gate.resolve();
  assert.equal(await pending, account);
  assert.deepEqual(account, { id: 7, createdAt: "saved" });
});

test("keychain failure does not fabricate authentication or completion, and memory initialization failure rejects", async () => {
  const { A, account } = bootstrapFixture();
  const logs = [];
  A.__linux.loadPwmSessionFromKeychain = async () => { throw new Error("private backend detail"); };
  assert.equal(await ensureLocalAccount(A, (message) => logs.push(message)), account);
  assert.deepEqual(account, { id: 7, createdAt: "saved" });
  assert.equal(logs.some((message) => message.includes("private backend detail")), false);
  assert.equal(logs.some((message) => message.includes("restore failed")), true);
  A.MemoryManager.init = async () => { throw new Error("watcher unavailable"); };
  await assert.rejects(ensureLocalAccount(A), /watcher unavailable/);
});

function lifecycleFixture(enabled = true) {
  const calls = [];
  const A = {
    SessionStore: { listFull: () => [], update: () => {} },
    GlobalAgentSessionServer: { getLoadedAgent: () => null, disposeAll: async () => calls.push("sessions:closed") },
    RecentSessionsStore: { loadCache: () => {} },
    settings: () => ({ get: () => ({ enabled }) }),
    MemoryManager: { closeForAccount: async (id) => calls.push(`memory:${id}`) },
  };
  return { A, calls };
}

test("startup awaits handles once; concurrent cleanup waits and closes every worker in reverse order", async () => {
  const { A, calls } = lifecycleFixture();
  const started = deferred();
  const stopped = deferred();
  A.startRoutineScheduler = async () => { calls.push("routine:start"); await started.promise; return async () => { calls.push("routine:stop"); await stopped.promise; }; };
  A.startContextAwareness = () => { calls.push("context:start"); return { stop: async () => calls.push("context:stop") }; };
  A.startContextAwarenessComprehension = () => { calls.push("comprehension:start"); return { close: async () => calls.push("comprehension:stop") }; };
  const first = initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  const second = initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["routine:start"]);
  started.resolve();
  const [lifecycle, duplicate] = await Promise.all([first, second]);
  assert.deepEqual(calls, ["routine:start", "context:start", "comprehension:start"]);
  let finished = false;
  const closing = lifecycle.close();
  assert.equal(duplicate.close(), closing);
  closing.then(() => { finished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.deepEqual(calls.slice(3), ["comprehension:stop", "context:stop", "routine:stop"]);
  stopped.resolve();
  await closing;
  assert.equal(calls.at(-1), "sessions:closed");
  assert.equal(calls.some((value) => value.startsWith("memory:")), false);
  assert.equal(lifecycle.background.startSessionMaintenance, "unsupported");
  assert.deepEqual(Object.values(lifecycle.background).filter((status) => status !== "unsupported"), ["stopped", "stopped", "stopped"]);
});

test("pure session maintenance uses its own starter and awaited cleanup without enabling original recovery", async () => {
  const { A, calls } = lifecycleFixture(false);
  A.__lifecycles = {
    startSessionMaintenance: async () => { calls.push("maintenance:start"); },
    stopSessionMaintenance: async () => { calls.push("maintenance:stop"); },
  };
  A.initializeSessionLifecycles = () => { throw new Error("must not start automatic recovery"); };
  A.GlobalAgentSessionServer.recoverInterruptedRuns = () => { throw new Error("must not replay interrupted actions"); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  assert.equal(lifecycle.background.startSessionMaintenance, "started");
  await lifecycle.close();
  assert.deepEqual(calls, ["maintenance:start", "maintenance:stop", "sessions:closed"]);
  assert.equal(lifecycle.background.startSessionMaintenance, "stopped");
});

test("native lifecycle exports support stop then restart; disabled saved context does not start capture", async () => {
  const { A, calls } = lifecycleFixture(false);
  A.__lifecycles = {
    startRoutineScheduler: () => calls.push("routine:start"),
    stopRoutineScheduler: async () => calls.push("routine:stop"),
    startContextAwareness: () => { throw new Error("must stay disabled"); },
    startContextAwarenessComprehension: () => { throw new Error("must stay disabled"); },
  };
  const first = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  assert.equal(first.background.startContextAwareness, "disabled-by-setting");
  assert.equal(first.background.startRoutineScheduler, "started");
  await first.close();
  const second = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  assert.notEqual(first, second);
  await second.close();
  assert.equal(calls.filter((value) => value === "routine:start").length, 2);
  assert.equal(calls.filter((value) => value === "routine:stop").length, 2);
});

test("known original context loops exist at disabled startup for a later settings enable", async () => {
  const { A, calls } = lifecycleFixture(false);
  let enabled = false;
  let captureStarts = 0;
  let comprehensions = 0;
  let comprehensionTick;
  const reconcile = () => { if (enabled) captureStarts++; };
  A.__lifecycles = {
    contextSettingsManaged: true,
    startContextAwareness: () => { calls.push("context:loop"); reconcile(); },
    stopContextAwareness: () => calls.push("context:stop"),
    startContextAwarenessComprehension: () => {
      calls.push("comprehension:loop");
      comprehensionTick = () => { if (enabled) comprehensions++; };
      comprehensionTick();
    },
    stopContextAwarenessComprehension: () => calls.push("comprehension:stop"),
  };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  assert.equal(captureStarts, 0);
  assert.equal(comprehensions, 0);
  enabled = true;
  reconcile();
  comprehensionTick();
  assert.equal(captureStarts, 1);
  assert.equal(comprehensions, 1);
  assert.equal(calls.filter((value) => value === "comprehension:loop").length, 1);
  await lifecycle.close();
});

test("failed startup remains failed and exposes cleanup for already started work", async () => {
  const { A, calls } = lifecycleFixture();
  A.startRoutineScheduler = () => { calls.push("routine:start"); return () => calls.push("routine:stop"); };
  A.startContextAwareness = async () => { throw new Error("capture startup failed"); };
  A.startContextAwarenessComprehension = () => () => calls.push("comprehension:stop");
  let failure;
  try { await initializeLocalLifecycle(A, { accountId: 7, startBackground: true }); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.lifecycle.background.startContextAwareness, "failed");
  assert.equal(failure.lifecycle.errors.startContextAwareness, "capture startup failed");
  await failure.lifecycle.close();
  assert.ok(calls.includes("routine:stop"));
  assert.ok(calls.includes("comprehension:stop"));
});

test("cleanup rejection is retained and never labels an unmanaged worker stopped", async () => {
  const { A, calls } = lifecycleFixture();
  A.startRoutineScheduler = () => {};
  A.startContextAwareness = () => async () => { throw new Error("observer could not close"); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  assert.equal(lifecycle.background.startRoutineScheduler, "started-unmanaged");
  const closing = lifecycle.close();
  await assert.rejects(closing, AggregateError);
  assert.equal(lifecycle.close(), closing);
  assert.equal(lifecycle.background.startRoutineScheduler, "stop-unsupported");
  assert.equal(lifecycle.background.startContextAwareness, "stop-failed");
  assert.ok(calls.includes("sessions:closed"));
});

test("account initialization is shared and shutdown drains a concurrently loading account", async () => {
  const { A, calls } = lifecycleFixture(false);
  const first = await initializeLocalLifecycle(A, { accountId: 7 });
  const gate = deferred();
  let loads = 0;
  let reconciliations = 0;
  A.RecentSessionsStore.loadCache = async () => { loads++; await gate.promise; };
  A.registerStartupTabReconciliation = () => { reconciliations++; };
  const next = initializeLocalLifecycle(A, { accountId: 8, startBackground: true });
  const duplicate = initializeLocalLifecycle(A, { accountId: 8, startBackground: true });
  const rejected = [assert.rejects(next, /closed during account initialization/), assert.rejects(duplicate, /closed during account initialization/)];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  let finished = false;
  const closing = first.close().then(() => { finished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  gate.resolve();
  await Promise.all([...rejected, closing]);
  assert.equal(reconciliations, 0);
  assert.equal(calls.some((value) => value.startsWith("memory:")), false);
});

test("full engine cleanup waits for original UI sessions and leaves memory ownership to hooks", async () => {
  const { A, calls } = lifecycleFixture(false);
  const gate = deferred();
  A.GlobalAgentSessionServer.disposeAll = async () => { calls.push("sessions:closing"); await gate.promise; calls.push("sessions:closed"); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
  const closing = lifecycle.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["sessions:closing"]);
  gate.resolve();
  await closing;
  assert.deepEqual(calls, ["sessions:closing", "sessions:closed"]);
});

test("shutdown invokes the native stop before waiting for an asynchronous starter", async () => {
  const { A, calls } = lifecycleFixture();
  const gate = deferred();
  A.__lifecycles = {
    startRoutineScheduler: async () => { calls.push("routine:start"); await gate.promise; },
    stopRoutineScheduler: async () => { calls.push("routine:stop"); gate.resolve(); },
    startContextAwareness: () => { throw new Error("must not start after close"); },
  };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
  const startup = initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  const rejection = assert.rejects(startup, /closed during background startup/);
  await new Promise((resolve) => setImmediate(resolve));
  await lifecycle.close();
  await rejection;
  assert.deepEqual(calls, ["routine:start", "routine:stop", "sessions:closed"]);
  assert.equal(lifecycle.background.startRoutineScheduler, "stopped");
});

test("late starter handles are closed even when a separate stop hook already ran", async () => {
  const { A, calls } = lifecycleFixture(false);
  const gate = deferred();
  A.startRoutineScheduler = async () => { await gate.promise; return () => calls.push("handle:stop"); };
  A.stopRoutineScheduler = () => { calls.push("named:stop"); gate.resolve(); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
  const startup = initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  const rejection = assert.rejects(startup, /closed during background startup/);
  await new Promise((resolve) => setImmediate(resolve));
  await lifecycle.close();
  await rejection;
  assert.deepEqual(calls, ["named:stop", "handle:stop", "sessions:closed"]);
});

for (const stopFails of [false, true]) {
  test(`late startup rejection preserves ${stopFails ? "failed" : "completed"} stop state`, async () => {
    const { A } = lifecycleFixture(false);
    const gate = deferred();
    A.startRoutineScheduler = () => gate.promise;
    A.stopRoutineScheduler = async () => { if (stopFails) throw new Error("stop failure"); };
    const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
    const startup = initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
    const startupFailure = assert.rejects(startup, AggregateError);
    await new Promise((resolve) => setImmediate(resolve));
    const closing = lifecycle.close();
    const closed = stopFails ? assert.rejects(closing, AggregateError) : closing;
    await new Promise((resolve) => setImmediate(resolve));
    gate.reject(new Error("late startup failure"));
    await Promise.all([startupFailure, closed]);
    assert.equal(lifecycle.background.startRoutineScheduler, stopFails ? "stop-failed" : "stopped");
    if (stopFails) assert.equal(lifecycle.errors.startRoutineScheduler, "stop failure");
    assert.equal(lifecycle.errors["startRoutineScheduler:startup"], "late startup failure");
  });
}

test("synchronous teardown reentry shares the existing close promise", async () => {
  const { A, calls } = lifecycleFixture(false);
  let lifecycle;
  let nested;
  let stops = 0;
  A.startRoutineScheduler = () => {};
  A.stopRoutineScheduler = () => {
    stops++;
    if (stops > 2) throw new Error("recursive stop guard");
    nested = lifecycle.close();
  };
  lifecycle = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  const closing = lifecycle.close();
  await closing;
  assert.equal(nested, closing);
  assert.equal(stops, 1);
  assert.deepEqual(calls, ["sessions:closed"]);
  assert.equal(lifecycle.background.startRoutineScheduler, "stopped");
});

function memoryFixture(close = async () => {}) {
  return { searchMany: async (args) => [args], capabilities: () => ({ mode: "native" }), description: () => "original ranking", close };
}

test("daemon hooks abort and drain web search, await memory cleanup and reject use after close", async () => {
  const released = deferred();
  const memoryReleased = deferred();
  const events = [];
  const hooks = installDaemonHooks({
    memorySearch: memoryFixture(async () => { events.push("memory:closing"); await memoryReleased.promise; events.push("memory:closed"); }),
    localWebSearch: {
      enabled: () => true,
      execute: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => { events.push("search:abort"); released.promise.then(() => reject(signal.reason)); }, { once: true });
      }),
      close: async () => events.push("web:closed"),
    },
  });
  assert.equal(globalThis.__belmontMemoryDescription(), "original ranking");
  const searching = hooks.webSearch.execute({});
  const rejection = assert.rejects(searching, /closing/);
  await new Promise((resolve) => setImmediate(resolve));
  const closing = hooks.close();
  assert.equal(hooks.close(), closing);
  assert.equal(globalThis.__belmontMemorySearch, undefined);
  assert.equal(hooks.webSearch.enabled(), false);
  assert.deepEqual(events, ["search:abort"]);
  released.resolve();
  await rejection;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.includes("memory:closing"));
  assert.equal(events.includes("memory:closed"), false);
  memoryReleased.resolve();
  await closing;
  await assert.rejects(hooks.webSearch.execute({}), /closed/);
  assert.ok(events.includes("web:closed"));
});

test("closing earlier hooks cannot remove another installation's globals; all closers run after one rejects", async () => {
  const first = installDaemonHooks({ memorySearch: memoryFixture() });
  const second = installDaemonHooks({ memorySearch: memoryFixture() });
  const currentSearch = globalThis.__belmontMemorySearch;
  await first.close();
  assert.equal(globalThis.__belmontMemorySearch, currentSearch);
  await second.close();
  let webClosed = false;
  const failing = installDaemonHooks({
    memorySearch: memoryFixture(async () => { throw new Error("memory teardown failed"); }),
    localWebSearch: { enabled: () => true, execute: async () => {}, close: async () => { webClosed = true; } },
  });
  await assert.rejects(failing.close(), AggregateError);
  assert.equal(webClosed, true);
});

test("closing hooks before queued work begins never starts the native operation", async () => {
  let starts = 0;
  const hooks = installDaemonHooks({
    memorySearch: { ...memoryFixture(), searchMany: async () => { starts++; } },
    localWebSearch: { enabled: () => true, execute: async () => { starts++; } },
  });
  const memory = assert.rejects(globalThis.__belmontMemorySearch({}), /closed/);
  const web = assert.rejects(hooks.webSearch.execute({}), /closed/);
  await hooks.close();
  await Promise.all([memory, web]);
  assert.equal(starts, 0);
});

test("hooks wait for in-flight original memory results before closing its manager", async () => {
  const gate = deferred();
  let managerClosed = false;
  const result = [{ chunkId: "native", score: 0.998, headings: ["original"] }];
  const hooks = installDaemonHooks({
    memorySearch: {
      ...memoryFixture(async () => { managerClosed = true; }),
      searchMany: async () => { await gate.promise; return result; },
    },
  });
  const pending = globalThis.__belmontMemorySearch({});
  await new Promise((resolve) => setImmediate(resolve));
  const closing = hooks.close();
  assert.equal(managerClosed, false);
  gate.resolve();
  assert.equal(await pending, result);
  await closing;
  assert.equal(managerClosed, true);
});

test("web-search abort callbacks can reenter hook cleanup without duplicate resource closes", async () => {
  let hooks;
  let nested;
  let memoryCloses = 0;
  hooks = installDaemonHooks({
    memorySearch: memoryFixture(async () => { memoryCloses++; }),
    localWebSearch: {
      enabled: () => true,
      execute: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => { nested = hooks.close(); reject(signal.reason); }, { once: true });
      }),
    },
  });
  const searching = assert.rejects(hooks.webSearch.execute({}), /closing/);
  await new Promise((resolve) => setImmediate(resolve));
  const closing = hooks.close();
  assert.equal(nested, closing);
  await Promise.all([closing, searching]);
  assert.equal(memoryCloses, 1);
});

// ---- Original startup recovery and memory backfill are called as-is (no reimplementation) ----

const suspendedRows = () => [
  { id: "answered", status: "suspended", suspension: { toolCallId: "t1", kind: "approval", response: { allow: true } } },
  { id: "errored", status: "suspended", suspension: { toolCallId: "t2", kind: "approval", error: "denied upstream" } },
  { id: "open", status: "suspended", suspension: { toolCallId: "t3", kind: "ask-user-question" } },
  { id: "running", status: "running", suspension: null },
  { id: "nodata", status: "suspended", suspension: null },
];

test("answered suspensions are handed to the original startup recovery; running work stays explicit", async () => {
  const { A, calls } = lifecycleFixture(false);
  A.SessionStore = { listFull: () => suspendedRows(), update: (accountId, id, patch) => calls.push(`update:${id}:${patch.status}`) };
  A.recoverSuspensionsOnStartup = async (accountId) => { assert.equal(accountId, 7); calls.push("original:recoverSuspensionsOnStartup"); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
  assert.deepEqual(lifecycle.recovered.map((row) => [row.id, row.mode, row.resumed]), [
    ["answered", "original-reentry-scheduled", true],
    ["errored", "original-reentry-scheduled", true],
    ["open", "awaiting-answer-reentry", false],
    ["running", "explicit-continuation-required", false],
    ["nodata", "original-reset-idle", false],
  ]);
  assert.deepEqual(calls.filter((call) => call.startsWith("update:")), ["update:running:interrupted"]);
  assert.equal(calls.filter((call) => call === "original:recoverSuspensionsOnStartup").length, 1);
  await lifecycle.close();
});

test("a bundle without the original recovery export keeps every non-open suspension explicit", async () => {
  const { A, calls } = lifecycleFixture(false);
  A.SessionStore = { listFull: () => suspendedRows(), update: (accountId, id, patch) => calls.push(`update:${id}:${patch.status}`) };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
  assert.deepEqual(calls.filter((call) => call.startsWith("update:")), ["update:answered:interrupted", "update:errored:interrupted", "update:running:interrupted", "update:nodata:interrupted"]);
  assert.ok(lifecycle.recovered.every((row) => row.resumed === false));
  await lifecycle.close();
});

test("a failing original recovery is recorded and does not block account initialization", async () => {
  const { A } = lifecycleFixture(false);
  A.SessionStore = { listFull: () => suspendedRows().slice(0, 1), update: () => {} };
  A.recoverSuspensionsOnStartup = async () => { throw new Error("reentry unavailable"); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7 });
  assert.equal(lifecycle.errors.recoverSuspensionsOnStartup, "reentry unavailable");
  assert.equal(lifecycle.recovered[0].mode, "original-reentry-scheduled");
  await lifecycle.close();
});

test("startup memory backfill uses the original start/stop pair and is stopped on cleanup", async () => {
  const { A, calls } = lifecycleFixture(false);
  let release;
  A.startSessionRunMemoryBackfill = async (accountId) => { assert.equal(accountId, 7); calls.push("backfill:start"); await new Promise((resolve) => { release = resolve; }); calls.push("backfill:done"); };
  A.stopSessionRunMemoryBackfill = async (accountId) => { assert.equal(accountId, 7); calls.push("backfill:stop"); release(); };
  const lifecycle = await initializeLocalLifecycle(A, { accountId: 7, startBackground: true });
  assert.equal(lifecycle.background.startSessionRunMemoryBackfill, "started");
  await lifecycle.close();
  assert.equal(lifecycle.background.startSessionRunMemoryBackfill, "stopped");
  assert.deepEqual(calls.filter((call) => call.startsWith("backfill")), ["backfill:start", "backfill:stop", "backfill:done"]);
});

test("a bundle without the backfill export reports it unsupported; a failing backfill is recorded, not fatal", async () => {
  const first = lifecycleFixture(false);
  const lifecycle = await initializeLocalLifecycle(first.A, { accountId: 7, startBackground: true });
  assert.equal(lifecycle.background.startSessionRunMemoryBackfill, "unsupported");
  await lifecycle.close();
  const second = lifecycleFixture(false);
  second.A.startSessionRunMemoryBackfill = async () => { throw new Error("projection cursor missing"); };
  const failing = await initializeLocalLifecycle(second.A, { accountId: 7, startBackground: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failing.background.startSessionRunMemoryBackfill, "started-unmanaged");
  assert.equal(failing.errors.startSessionRunMemoryBackfill, "projection cursor missing");
  await failing.close().catch(() => {});
});
