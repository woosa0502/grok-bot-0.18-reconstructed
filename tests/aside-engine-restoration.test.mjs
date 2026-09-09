import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { WebSocketServer } from "../belmont-browse/node_modules/ws/wrapper.mjs";
import { startDaemonServer } from "../belmont-browse/src/daemon-server.mjs";
import { createEngineCleanup } from "../belmont-browse/src/engine-cleanup.mjs";
import { modelOverrides } from "../belmont-browse/src/model-options.mjs";
import { resolveModelSelection } from "../belmont-browse/src/session.mjs";
import { createSessionController } from "../belmont-browse/src/core.mjs";

const facade = {
  WebSocketServer,
  createServer({ isReady, requestShutdown }) {
    return { fetch: async (request) => {
      if (new URL(request.url).pathname === "/shutdown") requestShutdown();
      return Response.json({ ready: isReady() });
    } };
  },
  serve({ hostname, port, fetch, websocket }, listening) {
    const server = http.createServer(async (request, response) => {
      const result = await fetch(new Request(`http://${request.headers.host}${request.url}`));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    });
    server.on("upgrade", (request, socket, head) => websocket.server.handleUpgrade(request, socket, head, (client) => websocket.server.emit("connection", client)));
    server.listen(port, hostname, () => listening(server.address()));
    return server;
  },
};

test("daemon lifecycle reports current readiness, drains a real WebSocket, and releases its port", async () => {
  let ready = false;
  const daemon = await startDaemonServer(facade, { port: 0, isReady: () => ready, log: () => {} });
  assert.deepEqual(await (await fetch(`${daemon.url}/health`)).json(), { ready: false });
  ready = true;
  assert.deepEqual(await (await fetch(`${daemon.url}/health`)).json(), { ready: true });
  const client = new WebSocket(daemon.url.replace("http:", "ws:"));
  await new Promise((resolve, reject) => { client.addEventListener("open", resolve, { once: true }); client.addEventListener("error", reject, { once: true }); });
  const closed = new Promise((resolve) => client.addEventListener("close", resolve, { once: true }));
  await daemon.close();
  await closed;
  await daemon.close();
  await assert.rejects(fetch(`${daemon.url}/health`));
});

test("router shutdown callback reaches the owner after its response", async () => {
  let called;
  const requested = new Promise((resolve) => { called = resolve; });
  const daemon = await startDaemonServer(facade, { port: 0, requestShutdown: called, log: () => {} });
  try {
    const response = await fetch(`${daemon.url}/shutdown`);
    assert.equal(response.status, 200);
    await requested;
  } finally { await daemon.close(); }
});

test("daemon listener collision rejects without closing the existing listener", async () => {
  const occupied = http.createServer((request, response) => response.end("existing-owner"));
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const port = occupied.address().port;
  try {
    await assert.rejects(startDaemonServer(facade, { port, log: () => {} }), { code: "EADDRINUSE" });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "existing-owner");
  } finally { await new Promise((resolve) => occupied.close(resolve)); }
});

test("partial startup cleanup closes all acquired resources in reverse order exactly once", async () => {
  const cleanup = createEngineCleanup();
  const calls = [];
  cleanup.add("first", async () => calls.push("first"));
  cleanup.add("failing", async () => { calls.push("failing"); throw new Error("fixture failure"); });
  cleanup.add("last", async () => calls.push("last"));
  const first = cleanup.close();
  assert.equal(cleanup.close(), first);
  await assert.rejects(first, (error) => error instanceof AggregateError && error.errors[0].message === "failing: fixture failure");
  assert.deepEqual(calls, ["last", "failing", "first"]);
});

test("cleanup callback reentry observes the same pending shutdown", async () => {
  const cleanup = createEngineCleanup();
  let nested;
  cleanup.add("reentrant", () => { nested = cleanup.close(); });
  const shutdown = cleanup.close();
  await shutdown;
  assert.equal(nested, shutdown);
});

test("engine shutdown closes the bundled agent CDP singleton before its browser transport", { timeout: 5000 }, async (t) => {
  const coreSource = readFileSync(new URL("../belmont-browse/src/core.mjs", import.meta.url), "utf8");
  const browserRegistration = coreSource.indexOf('cleanup.add("browser transport"');
  const daemonCdpRegistration = coreSource.indexOf('cleanup.add("daemon CDP client", () => A.globalCdpClient?.close())');
  const agentRegistration = coreSource.indexOf('cleanup.add("browse sessions"');
  assert.ok(browserRegistration >= 0 && browserRegistration < daemonCdpRegistration);
  assert.ok(agentRegistration > daemonCdpRegistration, "LIFO must drain agent sessions before the daemon singleton");

  const methods = [];
  const peers = new Set();
  let connections = 0;
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  wss.on("connection", (ws) => {
    connections += 1;
    peers.add(ws);
    ws.on("close", () => peers.delete(ws));
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      methods.push(message.method);
      const result = message.method === "Target.getTargets"
        ? { targetInfos: [{ targetId: "fixture-page", type: "page", title: "Fixture", url: "https://example.test/" }] }
        : {};
      ws.send(JSON.stringify({ id: message.id, result }));
    });
  });
  t.after(async () => {
    for (const peer of peers) peer.terminate();
    await new Promise((resolve) => wss.close(resolve));
  });

  const childSource = `
    process.env.BELMONT_CDP_URL = process.argv[1];
    const [{ loadDaemon }, { createEngineCleanup }] = await Promise.all([
      import(${JSON.stringify(new URL("../belmont-browse/src/session.mjs", import.meta.url).href)}),
      import(${JSON.stringify(new URL("../belmont-browse/src/engine-cleanup.mjs", import.meta.url).href)}),
    ]);
    const A = await loadDaemon("907");
    const cleanup = createEngineCleanup();
    const order = [];
    cleanup.add("browser transport", () => order.push({ name: "browser", connected: A.globalCdpClient.isConnected }));
    cleanup.add("daemon CDP client", async () => {
      order.push({ name: "daemon-before", connected: A.globalCdpClient.isConnected });
      await A.globalCdpClient.close();
      order.push({ name: "daemon-after", connected: A.globalCdpClient.isConnected });
    });
    const browser = new A.AsideBrowser(A.globalCdpClient, 0, { id: "fixture-agent" });
    cleanup.add("agent browser", async () => {
      order.push({ name: "agent", connected: A.globalCdpClient.isConnected });
      await browser.dispose({ closeOwnedTabs: false });
    });
    const tabs = await browser.listPageTargets();
    await cleanup.close();
    console.log(JSON.stringify({ tabs, order, connected: A.globalCdpClient.isConnected }));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", childSource, `ws://127.0.0.1:${wss.address().port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "FORCE_COLOR" && name !== "NO_COLOR")),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const killer = setTimeout(() => child.kill("SIGKILL"), 4000);
  t.after(() => { clearTimeout(killer); if (child.exitCode === null) child.kill("SIGKILL"); });
  const [code, signal] = await once(child, "exit");
  clearTimeout(killer);

  assert.equal(signal, null, `bundled CDP child retained a live handle: ${stderr}`);
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.deepEqual(result.tabs, [{ id: "fixture-page", url: "https://example.test/", title: "Fixture" }]);
  assert.deepEqual(result.order, [
    { name: "agent", connected: true },
    { name: "daemon-before", connected: true },
    { name: "daemon-after", connected: false },
    { name: "browser", connected: false },
  ]);
  assert.equal(result.connected, false);
  assert.equal(connections, 1, "shutdown must not reconnect the daemon singleton");
  assert.ok(methods.includes("Target.getTargets"), "the actual AsideBrowser must exercise the bundled singleton");
});

test("bundled daemon CDP close cancels a reconnect handshake already in flight", { timeout: 5000 }, async (t) => {
  const childSource = `
    import { createServer } from "node:http";
    import { once } from "node:events";
    import { setTimeout as delay } from "node:timers/promises";
    import { WebSocketServer } from ${JSON.stringify(new URL("../belmont-browse/node_modules/ws/wrapper.mjs", import.meta.url).href)};
    const wss = new WebSocketServer({ noServer: true });
    const server = createServer();
    const peers = [];
    let upgrades = 0;
    let secondUpgrade;
    server.on("upgrade", (request, socket, head) => {
      upgrades += 1;
      const accept = () => wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
      if (upgrades === 2) {
        secondUpgrade = { socket, accept };
        socket.on("error", () => {});
      } else {
        accept();
      }
    });
    wss.on("connection", (ws) => {
      peers.push(ws);
      ws.on("error", () => {});
      ws.on("message", (raw) => {
        const message = JSON.parse(String(raw));
        const result = message.method === "Target.getTargets" ? { targetInfos: [] } : {};
        ws.send(JSON.stringify({ id: message.id, result }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    process.env.BELMONT_CDP_URL = \`ws://127.0.0.1:\${server.address().port}\`;
    const { loadDaemon } = await import(${JSON.stringify(new URL("../belmont-browse/src/session.mjs", import.meta.url).href)});
    const A = await loadDaemon("907");
    await A.globalCdpClient.send("Target.getTargets");
    peers[0].terminate();
    await once(peers[0], "close");
    for (let attempt = 0; attempt < 100 && !secondUpgrade; attempt += 1) await delay(2);
    if (!secondUpgrade) throw new Error("reconnect handshake did not start");
    await A.globalCdpClient.close();
    secondUpgrade.accept();
    await delay(80);
    const result = {
      upgrades,
      connectedAfterClose: A.globalCdpClient.isConnected,
      peerStates: peers.map((peer) => peer.readyState),
      secondSocketDestroyed: secondUpgrade.socket.destroyed,
    };
    console.log(JSON.stringify(result));
    await A.globalCdpClient.close();
    for (const peer of peers) if (peer.readyState < 2) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => wss.close(resolve));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
    stdio: ["ignore", "pipe", "pipe"],
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "FORCE_COLOR" && name !== "NO_COLOR")),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const killer = setTimeout(() => child.kill("SIGKILL"), 4000);
  t.after(() => { clearTimeout(killer); if (child.exitCode === null) child.kill("SIGKILL"); });
  const [code, signal] = await once(child, "exit");
  clearTimeout(killer);

  assert.equal(signal, null, `reconnect cleanup retained a live handle: ${stderr}`);
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(result.upgrades, 2, "the test must reach the held replacement handshake");
  assert.equal(result.connectedAfterClose, false);
  assert.deepEqual(result.peerStates, [3, 3]);
  assert.equal(result.secondSocketDestroyed, true);
});

test("CLI and HTTP overrides retain saved provider and Fast settings", () => {
  const saved = { provider: "anthropic", modelId: "saved-model", thinkingLevel: "high", fastMode: true };
  assert.equal(modelOverrides({}), undefined);
  assert.deepEqual(resolveModelSelection(saved, modelOverrides({ thinking: "low" })), { ...saved, thinkingLevel: "low" });
  assert.deepEqual(resolveModelSelection(saved, modelOverrides({ model: { provider: "openai-codex", modelId: "chosen-model", fastMode: false } })), { provider: "openai-codex", modelId: "chosen-model", thinkingLevel: "high", fastMode: false });
  assert.throws(() => modelOverrides({ model: [] }), /model must/);
  assert.throws(() => resolveModelSelection(saved, { fastMode: "false" }), /fastMode/);
});

test("session creation reads the user's latest saved model and preserves explicit Fast selection", async () => {
  let saved = { provider: "openai-codex", modelId: "first-model", thinkingLevel: "high", fastMode: false };
  const records = new Map();
  const A = {
    settings: () => ({ get: () => saved }),
    SessionStore: { get: (accountId, id) => records.get(id) },
    GlobalAgentSessionServer: {
      getAgent: async () => { throw new Error("Fixture does not execute a provider"); },
      startRun() {}, waitForIdle() {}, getLoadedAgent() {}, steer() {}, abort() {},
    },
  };
  const engine = createSessionController({ A, account: { id: 0 }, profileId: "fixture", ext: { windowId: 1 }, model: saved,
    createRecord: (unused, row) => {
      const record = { ...row, id: `fixture-${records.size}`, status: "done" };
      records.set(record.id, record);
      return record;
    },
  });
  saved = { provider: "anthropic", modelId: "new-choice", thinkingLevel: "medium", fastMode: true };
  const one = engine.startSession({ task: "fixture" });
  assert.deepEqual(one.model, saved);
  const two = engine.startSession({ task: "fixture2", model: { fastMode: false }, thinking: "low" });
  assert.deepEqual(two.model, { ...saved, fastMode: false, thinkingLevel: "low" });
  await Promise.all([one.runPromise, two.runPromise]);
  await engine.close();
});
