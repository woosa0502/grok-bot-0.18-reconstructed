import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: [
      'export { createCoordinatorClient } from "./frontend/src/production/coordinator-client.ts";',
      'export { createCoordinatorConnectionController, createCoordinatorConnectionSource } from "./frontend/src/recovered/features/root-resilience/connection-state.ts";',
    ].join("\n"),
    resolveDir: resolve(import.meta.dirname, ".."),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
  write: false,
  logLevel: "silent",
});
const { createCoordinatorClient, createCoordinatorConnectionController, createCoordinatorConnectionSource } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const tick = () => new Promise((resolveTask) => setImmediate(resolveTask));

function fixture() {
  let consumer;
  let accountListener;
  const requests = [];
  const sent = [];
  const listeners = new Map();
  let rosterCalls = 0;
  let transportGeneration = 0;
  const capturedGenerations = [];
  const client = createCoordinatorClient({ claim(value) {
    consumer = value;
    return { request: (id) => requests.push(id), release() {} };
  } });
  const bridge = { cursorAccount: {
    getStatus: async () => ({ kind: "logged-in", authId: "account-a" }),
    onStatusChanged(listener) { accountListener = listener; return () => {}; },
  } };
  const controller = createCoordinatorConnectionController(createCoordinatorConnectionSource(client, bridge, async () => {
    rosterCalls += 1;
    capturedGenerations.push(transportGeneration);
    await client.call("listAgents");
  }));
  controller.start();
  client.subscribeTransport((state) => { if (state === "connected") transportGeneration += 1; });
  const port = {
    start() {},
    close() {},
    postMessage(frame) { sent.push(frame); },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  return {
    client, controller, requests, sent, capturedGenerations,
    rosterCalls: () => rosterCalls,
    fail: () => consumer.onRequestError("injected transfer failure", requests.at(-1)),
    deliver() { consumer.onPort(port); },
    ready() { listeners.get("message")({ data: { kind: "lifecycle", phase: "ready", protocolVersion: 1 } }); },
    reply(requestId = sent.findLast((frame) => frame.kind === "request").requestId) {
      listeners.get("message")({ data: { kind: "reply", requestId, outcome: { status: "ok", value: [] } } });
    },
    account: (authId) => accountListener({ kind: "logged-in", authId }),
    dispose() { controller.dispose(); client.dispose(); },
  };
}

test("manual retry after failed acquisition requests one fresh port and refreshes after transport subscribers", async () => {
  const target = fixture();
  await tick();
  target.fail();
  await tick();
  assert.equal(target.controller.get().phase, "unreachable");
  const first = target.controller.retry();
  const repeated = target.controller.retry();
  assert.equal(first, repeated);
  await tick();
  assert.equal(target.requests.length, 2);
  assert.equal(target.rosterCalls(), 0);
  target.deliver();
  target.ready();
  await tick();
  assert.equal(target.rosterCalls(), 1);
  assert.deepEqual(target.capturedGenerations, [1]);
  target.reply();
  assert.equal(await first, true);
  assert.equal(target.controller.get().phase, "connected");
  assert.equal(target.controller.get().isRetrying, false);
  await target.client.retryConnection();
  assert.equal(target.requests.length, 2, "healthy transport must not be replaced by manual retry");
  target.dispose();
});

test("rejected manual reacquisition settles the retry and never starts an automatic request loop", async () => {
  const target = fixture();
  await tick();
  target.fail();
  await tick();
  const failedRetry = target.controller.retry();
  await tick();
  target.fail();
  assert.equal(await failedRetry, false);
  await tick();
  assert.equal(target.controller.get().isRetrying, false);
  assert.equal(target.requests.length, 2);
  assert.equal(target.rosterCalls(), 0);
  const nextRetry = target.controller.retry();
  await tick();
  assert.equal(target.requests.length, 3);
  target.deliver();
  target.ready();
  await tick();
  target.reply();
  assert.equal(await nextRetry, true);
  target.dispose();
});

test("retry during initial pending acquisition coalesces and does not supersede its port request", async () => {
  const target = fixture();
  await tick();
  const retry = target.controller.retry();
  await tick();
  assert.equal(target.requests.length, 1);
  target.deliver();
  target.ready();
  await tick();
  target.reply();
  assert.equal(await retry, true);
  target.dispose();
});

test("account change or disposal before retry dispatch fences the deferred reacquisition", async () => {
  for (const mode of ["account", "dispose"]) {
    const target = fixture();
    await tick();
    target.fail();
    await tick();
    const retry = target.controller.retry();
    if (mode === "account") target.account("account-b");
    else target.dispose();
    assert.equal(await retry, false);
    await tick();
    assert.equal(target.requests.length, 1);
    assert.equal(target.rosterCalls(), 0);
    if (mode === "account") target.dispose();
  }
});

test("disposal settles a pending reacquisition and future client retry rejects", async () => {
  const target = fixture();
  await tick();
  target.fail();
  await tick();
  const retry = target.controller.retry();
  await tick();
  assert.equal(target.requests.length, 2);
  target.dispose();
  assert.equal(await retry, false);
  await assert.rejects(target.client.retryConnection(), /disposed/);
  await tick();
  assert.equal(target.rosterCalls(), 0);
});

test("new account retry owns settlement while an old account reacquisition is pending", async () => {
  const target = fixture();
  await tick();
  target.fail();
  await tick();
  const oldRetry = target.controller.retry();
  await tick();
  target.account("account-b");
  assert.equal(await oldRetry, false);
  const currentRetry = target.controller.retry();
  let outcome = "pending";
  currentRetry.then((value) => { outcome = value; });
  await tick();
  target.fail();
  await tick();
  assert.equal(outcome, false, "new account waiter must settle when the shared acquisition rejects");
  assert.equal(target.controller.get().isRetrying, false);
  const recovered = target.controller.retry();
  await tick();
  assert.equal(target.requests.length, 3);
  target.deliver();
  target.ready();
  await tick();
  target.reply();
  assert.equal(await recovered, true);
  target.dispose();
});

test("new account connected retry does not reuse the prior account roster request", async () => {
  const target = fixture();
  await tick();
  target.deliver();
  target.ready();
  await tick();
  const oldRetry = target.controller.retry();
  await tick();
  const oldRequest = target.sent.findLast((frame) => frame.kind === "request").requestId;
  target.account("account-b");
  const currentRetry = target.controller.retry();
  await tick();
  assert.equal(target.rosterCalls(), 2);
  target.reply();
  assert.equal(await currentRetry, true);
  target.reply(oldRequest);
  assert.equal(await oldRetry, false);
  target.dispose();
});

test("an immediate retry after rejected reacquisition starts a new request", async () => {
  const target = fixture();
  await tick();
  target.fail();
  await tick();
  const first = target.controller.retry();
  const second = first.then(() => target.controller.retry());
  await tick();
  target.fail();
  assert.equal(await first, false);
  await tick();
  assert.equal(target.requests.length, 3);
  target.deliver();
  target.ready();
  await tick();
  target.reply();
  assert.equal(await second, true);
  target.dispose();
});

test("controller disposal immediately settles a connected retry without cancelling its upstream", async () => {
  const target = fixture();
  await tick();
  target.deliver();
  target.ready();
  await tick();
  const retry = target.controller.retry();
  await tick();
  assert.equal(target.rosterCalls(), 1);
  target.controller.dispose();
  let settled = "pending";
  retry.then((value) => { settled = value; });
  await tick();
  assert.equal(settled, false);
  target.reply();
  await tick();
  assert.equal(settled, false);
  target.dispose();
});
