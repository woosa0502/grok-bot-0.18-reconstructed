import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: [
      'export { createCoordinatorRendererPortIpcRegistrar } from "./source/electron-main/coordinator/production-provider.ts";',
      'export { createCoordinatorPortBroker } from "./source/electron-preload/coordinator-port-bridge.ts";',
      'export { createCoordinatorClient } from "./frontend/src/production/coordinator-client.ts";',
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
const { createCoordinatorRendererPortIpcRegistrar, createCoordinatorPortBroker, createCoordinatorClient } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const tick = () => new Promise((done) => setImmediate(done));

function fixture() {
  const contents = new EventEmitter();
  contents.mainFrame = {};
  contents.isDestroyed = () => false;
  contents.postMessage = () => { throw new Error("No port is delivered during this pending-acquisition case."); };
  let handler;
  let removed = 0;
  const registration = createCoordinatorRendererPortIpcRegistrar({
    ipcMain: {
      handle(_channel, listener) { handler = listener; },
      removeHandler() { removed += 1; },
    },
    getTrustedContents: () => contents,
    requestRendererPort() {},
    reportHandoff() {},
    reportFailure() { assert.fail("Ordinary disposal is not a transfer failure."); },
  }).register({});
  const outcomes = [];
  const broker = createCoordinatorPortBroker({
    invokeRequest() {
      const result = handler({ sender: contents, senderFrame: contents.mainFrame });
      Promise.resolve(result).then(
        (value) => outcomes.push({ status: "fulfilled", value }),
        (error) => outcomes.push({ status: "rejected", message: error.message }),
      );
      return result;
    },
  });
  return { registration, broker, contents, outcomes, removed: () => removed };
}

test("ordinary app disposal fulfills pending IPC but settles renderer readiness as unavailable", async () => {
  const target = fixture();
  const client = createCoordinatorClient(target.broker.bridge);
  const states = [];
  client.subscribeTransport((state) => states.push(state));
  const ready = assert.rejects(client.ready, /IPC has been disposed/);
  const queued = assert.rejects(client.call("listAgents"), /IPC has been disposed/);
  target.registration.dispose();
  target.registration.dispose();
  await Promise.all([ready, queued]);
  await tick();
  assert.deepEqual(target.outcomes, [{ status: "fulfilled", value: { status: "disposed" } }]);
  assert.deepEqual(states, ["down"]);
  assert.equal(target.contents.listenerCount("destroyed"), 0);
  assert.equal(target.removed(), 1);
  client.dispose();
});

test("renderer disposal before main disposal releases the claimant and settles its own waiters", async () => {
  const target = fixture();
  const client = createCoordinatorClient(target.broker.bridge);
  const states = [];
  client.subscribeTransport((state) => states.push(state));
  const ready = assert.rejects(client.ready, /coordinator source disposed/);
  client.dispose();
  target.registration.dispose();
  await ready;
  await tick();
  assert.deepEqual(target.outcomes, [{ status: "fulfilled", value: { status: "disposed" } }]);
  assert.deepEqual(states, []);
  assert.equal(target.contents.listenerCount("destroyed"), 0);
});
