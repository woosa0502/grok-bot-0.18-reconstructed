import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: [
      'export { createCoordinatorRendererPortIpcRegistrar } from "./source/electron-main/coordinator/production-provider.ts";',
      'export { createCoordinatorRuntime } from "./source/electron-main/coordinator/coordinator-runtime.ts";',
    ].join("\n"),
    resolveDir: resolve(import.meta.dirname, ".."),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { createCoordinatorRendererPortIpcRegistrar, createCoordinatorRuntime } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const turn = () => new Promise((done) => setImmediate(done));

function messagePort() {
  return { closed: false, close() { this.closed = true; } };
}

function fixture(requestPort) {
  const contents = new EventEmitter();
  contents.mainFrame = {};
  contents.destroyed = false;
  contents.isDestroyed = () => contents.destroyed;
  const delivered = [];
  let transferError;
  contents.postMessage = (_channel, _message, ports) => {
    if (transferError) throw transferError;
    delivered.push(...ports);
  };
  const sinks = [];
  const handoffs = [];
  const failures = [];
  let handler;
  let removed = 0;
  const registrar = createCoordinatorRendererPortIpcRegistrar({
    ipcMain: {
      handle(_channel, callback) { handler = callback; },
      removeHandler() { removed += 1; },
    },
    getTrustedContents: () => contents,
    requestRendererPort(sink) {
      sinks.push(sink);
      requestPort?.(sink);
    },
    reportHandoff: (level, metadata) => handoffs.push({ level, ...metadata }),
    reportFailure: (area, leg, error) => failures.push({ area, leg, error }),
  });
  const registration = registrar.register({});
  return {
    contents, delivered, sinks, failures, handoffs, registrar, registration,
    invoke: (frame = contents.mainFrame) => Promise.resolve().then(() => handler({ sender: contents, senderFrame: frame })),
    failTransfers: (error) => { transferError = error; },
    destroy() { contents.destroyed = true; contents.emit("destroyed"); },
    removed: () => removed,
  };
}

function runtimeFixture() {
  const launches = [];
  const problems = [];
  const runtime = createCoordinatorRuntime({
    fork() { throw new Error("real child creation is forbidden in this test"); },
    createChannel() { throw new Error("launch handle supplies primitive test ports"); },
    executors: {},
    artifactPath: "/test-only/coordinator.cjs",
    processConfig: {},
    monotonicNow: () => 0,
    onMainDataPort() {},
    onLifecycle() {},
    onProblem: (message) => problems.push(message),
    onEvent: { "transport-connected"() {}, "transport-down"() {} },
    relaunchBackoff: { schedule() { throw new Error("no unexpected relaunch"); } },
    launch() {
      const exited = Promise.withResolvers();
      const handle = {
        rendererDataPort: messagePort(),
        mainDataPort: messagePort(),
        controlSettled: Promise.resolve(),
        processExited: exited.promise,
        dispose() { exited.resolve({ code: 0 }); },
      };
      launches.push(handle);
      return handle;
    },
  });
  return { runtime, launches, problems };
}

test("main IPC resolves only after the actual initial or delayed port transfer", async () => {
  const immediatePort = messagePort();
  const immediate = fixture((sink) => sink(immediatePort));
  assert.equal(await immediate.invoke(), null);
  assert.deepEqual(immediate.delivered, [immediatePort]);
  immediate.registration.dispose();

  const delayed = fixture();
  const pending = delayed.invoke();
  let settled = false;
  pending.then(() => { settled = true; });
  await turn();
  assert.equal(settled, false);
  const delayedPort = messagePort();
  delayed.sinks[0](delayedPort);
  assert.equal(await pending, null);
  assert.deepEqual(delayed.delivered, [delayedPort]);
  delayed.registration.dispose();
});

test("runtime swallowing a failed transfer cannot turn the IPC request into success", async () => {
  const { runtime, launches, problems } = runtimeFixture();
  const target = fixture((sink) => runtime.requestRendererPort(sink));
  target.failTransfers(new Error("injected postMessage failure"));
  await assert.rejects(target.invoke(), /injected postMessage failure/);
  assert.equal(target.delivered.length, 0);
  assert.equal(target.contents.listenerCount("destroyed"), 0);
  assert.equal(problems.length, 1, "the real runtime caught the sink exception");
  assert.equal(target.failures.length, 1);
  target.failTransfers(undefined);
  assert.equal(await target.invoke(), null);
  assert.equal(launches.length, 2);
  assert.deepEqual(target.delivered, [launches[1].rendererDataPort]);
  target.registration.dispose();
  await runtime.dispose();
});

test("delayed transfer failure rejects the still-pending IPC request", async () => {
  const target = fixture();
  const pending = assert.rejects(target.invoke(), /delayed postMessage failure/);
  await turn();
  target.failTransfers(new Error("delayed postMessage failure"));
  assert.throws(() => target.sinks[0](messagePort()), /delayed postMessage failure/);
  await pending;
  assert.equal(target.delivered.length, 0);
  assert.equal(target.contents.listenerCount("destroyed"), 0);
  target.registration.dispose();
});

test("a newer request settles superseded IPC and fences its late sink", async () => {
  const target = fixture();
  const first = assert.rejects(target.invoke(), /superseded/);
  await turn();
  const second = target.invoke();
  await first;
  assert.equal(target.contents.listenerCount("destroyed"), 1);
  const stalePort = messagePort();
  target.sinks[0](stalePort);
  assert.equal(stalePort.closed, true);
  assert.equal(target.delivered.length, 0);
  const activePort = messagePort();
  target.sinks[1](activePort);
  assert.equal(await second, null);
  assert.deepEqual(target.delivered, [activePort]);
  target.registration.dispose();
});

test("a successful sink receives runtime replacement ports until superseded", async () => {
  const { runtime, launches } = runtimeFixture();
  const target = fixture((sink) => runtime.requestRendererPort(sink));
  assert.equal(await target.invoke(), null);
  await runtime.restart();
  await runtime.restart();
  assert.deepEqual(target.delivered, launches.map(({ rendererDataPort }) => rendererDataPort));
  assert.equal(target.contents.listenerCount("destroyed"), 1);
  const previousSink = target.sinks[0];
  assert.equal(await target.invoke(), null);
  const stalePort = messagePort();
  previousSink(stalePort);
  assert.equal(stalePort.closed, true);
  assert.equal(target.delivered.length, 4);
  assert.equal(target.contents.listenerCount("destroyed"), 1);
  target.registration.dispose();
  await runtime.dispose();
});

test("destroying a requester settles pending IPC and prevents all late delivery", async () => {
  for (const deliverFirst of [false, true]) {
    const target = fixture();
    const request = target.invoke();
    const rejected = deliverFirst ? undefined : assert.rejects(request, /destroyed/);
    await turn();
    if (deliverFirst) {
      target.sinks[0](messagePort());
      await request;
    }
    target.destroy();
    if (rejected) await rejected;
    const latePort = messagePort();
    target.sinks[0](latePort);
    assert.equal(latePort.closed, true);
    assert.equal(target.delivered.length, deliverFirst ? 1 : 0);
    assert.equal(target.contents.listenerCount("destroyed"), 0);
    target.registration.dispose();
  }
  const alreadyDestroyed = fixture();
  alreadyDestroyed.destroy();
  await assert.rejects(alreadyDestroyed.invoke(), /destroyed/);
  assert.equal(alreadyDestroyed.sinks.length, 0);
  alreadyDestroyed.registration.dispose();
});

test("disposing a registration settles pending IPC and fences old sinks after reregistration", async () => {
  const target = fixture();
  const pending = target.invoke();
  await turn();
  const previousSink = target.sinks[0];
  target.registration.dispose();
  target.registration.dispose();
  assert.deepEqual(await pending, { status: "disposed" });
  assert.equal(target.removed(), 1);
  assert.equal(target.contents.listenerCount("destroyed"), 0);
  assert.deepEqual(await target.invoke(), { status: "disposed" });
  const nextRegistration = target.registrar.register({});
  const next = target.invoke();
  await turn();
  const stalePort = messagePort();
  previousSink(stalePort);
  assert.equal(stalePort.closed, true);
  const activePort = messagePort();
  target.sinks[1](activePort);
  await next;
  assert.deepEqual(target.delivered, [activePort]);
  nextRegistration.dispose();
});

test("requester exceptions reject IPC, while rejected foreign frames cannot supersede a trusted request", async () => {
  const throwing = fixture(() => { throw new Error("request setup failed"); });
  await assert.rejects(throwing.invoke(), /request setup failed/);
  assert.equal(throwing.contents.listenerCount("destroyed"), 0);
  throwing.registration.dispose();

  const target = fixture();
  const trusted = target.invoke();
  await turn();
  await assert.rejects(target.invoke({}), /only available from the Sand app window/);
  assert.equal(target.sinks.length, 1);
  target.sinks[0](messagePort());
  assert.equal(await trusted, null);
  target.registration.dispose();
});
