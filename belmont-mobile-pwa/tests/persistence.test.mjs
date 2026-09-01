import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBelmontCompanionAdapter } from "../belmont-adapter.mjs";
import { createMobileServer } from "../server.mjs";

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolveClose) => server.close(resolveClose));
}

test("paired sessions survive a restart of both layers", async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), "belmont-mobile-state-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const adapterPath = join(stateDir, "adapter-sessions.json");
  const gatewayPath = join(stateDir, "gateway-sessions.json");

  const dataRoot = await mkdtemp(join(tmpdir(), "belmont-mobile-data-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const belmont = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/health") return response.end(JSON.stringify({ ok: true, activeAgentId: "manager" }));
    if (request.url === "/api/listAgents") return response.end(JSON.stringify([{ id: "manager", name: "Belmont" }]));
    if (request.url === "/api/getAgentTranscriptTail") return response.end(JSON.stringify({ entries: [] }));
    response.end("{}");
  });
  await listen(belmont);
  t.after(() => close(belmont));
  await writeFile(join(dataRoot, "gateway.json"), JSON.stringify({ port: belmont.address().port, host: "127.0.0.1", scheme: "http" }));
  await writeFile(join(dataRoot, "manager.json"), JSON.stringify({ managerAgentId: "manager" }));

  const boot = async () => {
    const adapter = createBelmontCompanionAdapter({ dataRoot, pairCode: "123456", persistPath: adapterPath });
    await listen(adapter);
    const gateway = createMobileServer({ upstream: `http://127.0.0.1:${adapter.address().port}`, persistPath: gatewayPath });
    await listen(gateway);
    return { adapter, gateway, origin: `http://127.0.0.1:${gateway.address().port}` };
  };

  const first = await boot();
  const pairResponse = await fetch(`${first.origin}/api/pair`, {
    method: "POST",
    headers: { Origin: first.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456", deviceName: "Phone" })
  });
  assert.equal(pairResponse.status, 200);
  const cookie = pairResponse.headers.get("set-cookie").split(";", 1)[0];
  assert.equal((await fetch(`${first.origin}/api/bots`, { headers: { Cookie: cookie } })).status, 200);
  await close(first.gateway);
  await close(first.adapter);

  // A fresh boot from the same state dir must accept the old cookie unchanged.
  const second = await boot();
  t.after(() => close(second.gateway));
  t.after(() => close(second.adapter));
  const revived = await fetch(`${second.origin}/api/bots`, { headers: { Cookie: cookie } });
  assert.equal(revived.status, 200, "restart must not force a re-pair");
  const unauthenticated = await fetch(`${second.origin}/api/bots`);
  assert.equal(unauthenticated.status, 401, "persistence must not weaken auth");
});
