import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const compiled = await build({
  stdin: {
    contents: [
      'export { createCoordinatorPortBroker } from "./source/electron-preload/coordinator-port-bridge.ts";',
      'export { installPrimaryPreload, installPrimaryPreloadEntrypoint } from "./source/electron-preload/preload.ts";',
      'export { createCoordinatorSourceClaimant } from "./frontend/src/recovered/runtime/coordinator-source-claimant.ts";',
      'export { createCoordinatorClient } from "./frontend/src/production/coordinator-client.ts";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const {
  createCoordinatorPortBroker,
  installPrimaryPreload,
  installPrimaryPreloadEntrypoint,
  createCoordinatorSourceClaimant,
  createCoordinatorClient,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const tick = () => new Promise((resolveTask) => setImmediate(resolveTask));

function portFixture() {
  const listeners = new Map();
  const sent = [];
  let closed = false;
  const port = {
    postMessage(frame) { sent.push(frame); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    start() {},
    close() { closed = true; },
  };
  return {
    port,
    sent,
    closed: () => closed,
    ready: () => listeners.get("message")({ data: { kind: "lifecycle", phase: "ready", protocolVersion: 1 } }),
    reply: (requestId, value) => listeners.get("message")({ data: { kind: "reply", requestId, outcome: { status: "ok", value } } }),
    disconnect: () => listeners.get("close")({}),
  };
}

function controlledBridge() {
  let consumer;
  const requests = [];
  let releases = 0;
  return {
    requests,
    bridge: {
      claim(value) {
        consumer = value;
        return { request: (id) => requests.push(id), release: () => { releases += 1; } };
      },
    },
    deliver: (port) => consumer.onPort(port),
    fail: (requestId, message = "injected handoff failure") => consumer.onRequestError(message, requestId),
    releases: () => releases,
  };
}

test("both primary preload installers preserve coordinator IPC rejection for the claimant", async () => {
  for (const entrypoint of [false, true]) {
    const ipc = {
      invoke: async (channel) => { throw new Error(`missing handler: ${channel}`); },
      on() {}, off() {}, send() {}, sendSync() { return {}; },
    };
    const runtime = { ipcRenderer: ipc, webFrame: { getZoomFactor: () => 1 }, contextBridge: { exposeInMainWorld() {} } };
    const installed = entrypoint
      ? installPrimaryPreloadEntrypoint(runtime, {})
      : installPrimaryPreload({ ipc, webFrame: runtime.webFrame, contextBridge: runtime.contextBridge, mainEdge: {}, env: {}, initialState: {} });
    const failures = [];
    installed.coordinatorPort.claim({ onPort() {}, onRequestError: (...args) => failures.push(args) }).request(17);
    await tick();
    assert.deepEqual(failures, [["missing handler: sand:coordinator-port-request", 17]]);
  }
});

test("broker catches synchronous failure and isolates requests across delivery, replacement, and release", async () => {
  const pending = [];
  const errors = [];
  const broker = createCoordinatorPortBroker({ invokeRequest() {
    if (pending.length === 0) {
      pending.push(null);
      throw new Error("synchronous failure");
    }
    const request = Promise.withResolvers();
    pending.push(request);
    return request.promise;
  } });
  const consumer = { onPort() {}, onRequestError: (...args) => errors.push(args) };
  const first = broker.bridge.claim(consumer);
  first.request(1);
  assert.deepEqual(errors, [["synchronous failure", 1]]);
  first.request(2);
  first.request(3);
  pending[1].reject(new Error("superseded"));
  broker.deliver({});
  pending[2].reject(new Error("already delivered"));
  await tick();
  assert.equal(errors.length, 1);
  first.release();
  const second = broker.bridge.claim(consumer);
  first.release();
  first.request(4);
  second.request(5);
  assert.equal(pending.length, 4, "old same-consumer claim cannot release or request through a replacement lease");
  second.release();
  pending[3].reject(new Error("released"));
  await tick();
  assert.equal(errors.length, 1);
});

test("legacy broker consumers without an error callback do not leak rejected request promises", async () => {
  const broker = createCoordinatorPortBroker({ invokeRequest: () => Promise.reject(new Error("legacy failure")) });
  broker.bridge.claim({ onPort() {} }).request();
  await tick();
});

test("recovered claimant settles queued and future calls when its current port request fails", async () => {
  const target = controlledBridge();
  const claimant = createCoordinatorSourceClaimant(target.bridge);
  const queued = assert.rejects(claimant.source.listAgents(), /coordinator port never adopted/);
  target.fail(target.requests[0]);
  await queued;
  assert.equal(claimant.activeRoute(), "failed");
  await assert.rejects(claimant.source.listAgents(), /coordinator port never adopted/);
  claimant.dispose();
});

test("recovered claimant ignores old-identity and adopted-port request failures", async () => {
  const target = controlledBridge();
  const claimant = createCoordinatorSourceClaimant(target.bridge);
  const oldRequest = target.requests[0];
  claimant.beginIdentityChange();
  const pendingCall = claimant.source.listAgents();
  let settled = false;
  pendingCall.catch(() => { settled = true; });
  target.fail(oldRequest);
  await tick();
  assert.equal(settled, false);
  claimant.completeIdentityChange({ acceptPort: true });
  const newRequest = target.requests[1];
  assert.notEqual(newRequest, oldRequest);
  target.fail(oldRequest);
  await tick();
  assert.equal(settled, false);
  const delivered = portFixture();
  target.deliver(delivered.port);
  delivered.ready();
  await assert.rejects(pendingCall, /coordinator port never adopted/);
  target.fail(newRequest);
  assert.equal(claimant.activeRoute(), "coordinator");
  const response = claimant.source.listAgents();
  delivered.reply(delivered.sent.at(-1).requestId, []);
  assert.deepEqual(await response, []);
  claimant.dispose();
  target.fail(newRequest);
  assert.equal(target.releases(), 1);
});

test("production client rejects readiness and queued calls and reports down on request failure", async () => {
  const target = controlledBridge();
  const client = createCoordinatorClient(target.bridge);
  const states = [];
  client.subscribeTransport((state) => states.push(state));
  const ready = assert.rejects(client.ready, /coordinator port request failed/);
  const queued = assert.rejects(client.call("listAgents"), /coordinator port request failed/);
  target.fail(target.requests[0]);
  await Promise.all([ready, queued]);
  await assert.rejects(client.call("listAgents"), /coordinator port request failed/);
  assert.deepEqual(states, ["down"]);
  const lateStates = [];
  client.subscribeTransport((state) => lateStates.push(state));
  assert.deepEqual(lateStates, ["down"]);
  client.dispose();
});

test("production client can adopt a successful port after failure and ignores stale errors", async () => {
  const target = controlledBridge();
  const client = createCoordinatorClient(target.bridge);
  const oldReady = assert.rejects(client.ready, /coordinator port request failed/);
  const firstRequest = target.requests[0];
  target.fail(firstRequest);
  await oldReady;
  const delivered = portFixture();
  target.deliver(delivered.port);
  delivered.ready();
  await client.ready;
  target.fail(firstRequest);
  const response = client.call("listAgents");
  await tick();
  delivered.reply(delivered.sent.at(-1).requestId, []);
  assert.deepEqual(await response, []);
  client.dispose();
  target.fail(firstRequest);
});

test("production reconnect rejection settles the new readiness generation", async () => {
  const target = controlledBridge();
  const client = createCoordinatorClient(target.bridge);
  const delivered = portFixture();
  target.deliver(delivered.port);
  delivered.ready();
  await client.ready;
  delivered.disconnect();
  const ready = assert.rejects(client.ready, /coordinator port request failed/);
  const call = assert.rejects(client.call("listAgents"), /coordinator port request failed/);
  target.fail(target.requests.at(-1));
  await Promise.all([ready, call]);
  assert.equal(target.requests.length, 2, "failure must not produce an unbounded restart/request loop");
  client.dispose();
});
