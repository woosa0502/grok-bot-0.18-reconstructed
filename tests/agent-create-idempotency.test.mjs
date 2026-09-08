import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".build"), { recursive: true });
const temporary = await mkdtemp(path.join(root, ".build/agent-create-test-"));
const output = path.join(temporary, "gateway.mjs");
await build({ entryPoints: [path.join(root, "source/host/host-gateway-api.ts")], outfile: output, bundle: true, platform: "node", format: "esm", target: "node26" });
const { createHostGatewayApi, CREATE_AGENT_NONCE_LEDGER_CAP } = await import(pathToFileURL(output).href);
test.after(() => rm(temporary, { recursive: true, force: true }));

function gateway(createAgent) {
  return createHostGatewayApi({ extensions: { api: (name) => name === "transcript" ? { createAgent } : name === "telemetry" ? { analytics: { markActive() {}, trackEvent() {} } } : {} } });
}

test("pending agent creation remains idempotent when completed history exceeds its cap", async () => {
  let finish;
  const held = new Promise((resolve) => { finish = resolve; });
  let heldCalls = 0;
  const api = gateway(async ({ name }) => {
    if (name === "held") { heldCalls += 1; await held; }
    return { agent: { id: name } };
  });
  const pending = api.createAgent({ name: "held", clientNonce: "held" });
  for (let index = 0; index < CREATE_AGENT_NONCE_LEDGER_CAP + 1; index += 1) {
    await api.createAgent({ name: `other-${index}`, clientNonce: `other-${index}` });
  }
  const retry = api.createAgent({ name: "held", clientNonce: "held" });
  finish();
  await Promise.all([pending, retry]);
  assert.equal(heldCalls, 1);
  assert.equal(pending, retry);
});

test("failed creation can retry while a successful recent nonce stays deduplicated", async () => {
  let calls = 0;
  const api = gateway(async () => {
    calls += 1;
    if (calls === 1) throw new Error("fixture disk failure");
    return { agent: { id: "created" } };
  });
  await assert.rejects(api.createAgent({ clientNonce: "retry" }), /fixture disk failure/);
  const created = await api.createAgent({ clientNonce: "retry" });
  assert.deepEqual(await api.createAgent({ clientNonce: "retry" }), created);
  assert.equal(calls, 2);
});
