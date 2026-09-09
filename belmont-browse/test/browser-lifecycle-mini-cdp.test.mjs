import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";
import { MiniCdp } from "../src/cdp-mini.mjs";

async function fixture(t, { request, upgrade, connection } = {}) {
  const sockets = new Set();
  const peers = [];
  let discoveries = 0;
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((req, res) => {
    discoveries++;
    if (request) return request(req, res);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/cdp` }));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    if (upgrade) {
      socket.on("end", () => socket.end());
      socket.resume();
      return upgrade(req, socket, head);
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    peers.push(ws);
    ws.on("error", () => {});
    if (connection) connection(ws, peers.length);
    else ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      ws.send(JSON.stringify({ id: msg.id, result: { method: msg.method, params: msg.params, sessionId: msg.sessionId } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const peer of peers) peer.terminate();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => wss.close(resolve));
  });
  return {
    server, peers, sockets,
    http: `http://127.0.0.1:${server.address().port}`,
    ws: `ws://127.0.0.1:${server.address().port}/cdp`,
    get discoveries() { return discoveries; },
  };
}

async function until(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Fixture condition timed out");
    await delay(5);
  }
}

function client(t, url, options) {
  const cdp = new MiniCdp(url, options);
  t.after(() => cdp.close());
  return cdp;
}

test("concurrent sends share discovery and socket while retaining replies and events", async (t) => {
  const f = await fixture(t);
  const cdp = client(t, f.http);
  const events = [];
  const unsubscribe = cdp.on((event) => events.push(event));
  cdp.on(() => { throw new Error("listener isolation"); });
  const replies = await Promise.all(Array.from({ length: 24 }, (_, i) => cdp.send(`Method.${i}`, { i }, "session")));
  assert.equal(f.discoveries, 1);
  assert.equal(f.peers.length, 1);
  assert.deepEqual(replies.map((reply) => reply.params.i), Array.from({ length: 24 }, (_, i) => i));
  assert.ok(replies.every((reply) => reply.sessionId === "session"));
  for (const malformed of ["broken json", "null", "[]", "123", '{"id":999}']) f.peers[0].send(malformed);
  f.peers[0].send(JSON.stringify({ method: "Target.created" }));
  await until(() => events.length === 1);
  unsubscribe();
  f.peers[0].send(JSON.stringify({ method: "Target.other" }));
  await delay(10);
  assert.equal(events.length, 1);
});

test("peer disconnect rejects in-flight commands and a later send reconnects without replay", async (t) => {
  const seen = [];
  const f = await fixture(t, { connection: (ws, count) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      seen.push(msg.method);
      if (count === 1) ws.terminate();
      else {
        ws.send(JSON.stringify({ id: msg.id, result: { recovered: true } }));
        ws.send(JSON.stringify({ method: "Recovered.event" }));
      }
    });
  } });
  const cdp = client(t, f.ws);
  const events = [];
  cdp.on((event) => events.push(event));
  await assert.rejects(cdp.send("Lost.command", {}, undefined, { timeoutMs: 60_000 }), /closed/);
  assert.deepEqual(await cdp.send("Next.command"), { recovered: true });
  await until(() => events.length === 1);
  assert.equal(f.peers.length, 2);
  assert.deepEqual(seen, ["Lost.command", "Next.command"]);
});

test("terminal close cancels discovery and cannot reconnect", async (t) => {
  let requestSeen = false;
  let requestClosed = false;
  const f = await fixture(t, { request: (req) => {
    requestSeen = true;
    req.on("close", () => { requestClosed = true; });
  } });
  const cdp = client(t, f.http, { connectTimeoutMs: 10_000 });
  const pending = assert.rejects(cdp.send("Never.sent"), /closed|abort/i);
  await until(() => requestSeen);
  const closing = cdp.close();
  assert.equal(cdp.close(), closing);
  await closing;
  await pending;
  await until(() => requestClosed);
  await assert.rejects(cdp.connect(), /closed/);
  await assert.rejects(cdp.send("Late.command"), /closed/);
  assert.throws(() => cdp.on(() => {}), /closed/);
  assert.equal(f.peers.length, 0);
  assert.equal(f.discoveries, 1);
});

test("terminal close aborts a stalled WebSocket handshake and releases the owned socket", async (t) => {
  let handshake;
  const f = await fixture(t, { upgrade: (_req, socket) => { handshake = socket; } });
  const cdp = client(t, f.ws, { connectTimeoutMs: 10_000, closeTimeoutMs: 30 });
  const pending = assert.rejects(cdp.connect(), /closed/);
  await until(() => handshake);
  await cdp.close();
  await pending;
  await until(() => handshake.destroyed);
  await assert.rejects(cdp.send("Never.sent"), /closed/);
});

test("handshake timeout terminates the socket and releases single-flight for a retry", async (t) => {
  let handshakes = 0;
  const f = await fixture(t, { upgrade: (_req, socket) => { handshakes++; socket.on("error", () => {}); } });
  const cdp = client(t, f.ws, { connectTimeoutMs: 35, closeTimeoutMs: 20 });
  await Promise.all([
    assert.rejects(cdp.connect(), /timeout/),
    assert.rejects(cdp.connect(), /timeout/),
  ]);
  assert.equal(handshakes, 1);
  await until(() => f.sockets.size === 0);
  await assert.rejects(cdp.connect(), /timeout/);
  assert.equal(handshakes, 2);
  await until(() => f.sockets.size === 0);
});

test("failed discovery can retry successfully", async (t) => {
  let fail = true;
  let wsUrl;
  const f = await fixture(t, { request: (_req, res) => {
    if (fail) { res.statusCode = 503; res.end("unavailable"); }
    else res.end(JSON.stringify({ webSocketDebuggerUrl: wsUrl }));
  } });
  wsUrl = f.ws;
  const cdp = client(t, f.http);
  await assert.rejects(cdp.send("First"), /HTTP 503/);
  fail = false;
  assert.equal((await cdp.send("Second")).method, "Second");
  assert.equal(f.discoveries, 2);
  assert.equal(f.peers.length, 1);
});

test("terminal close is bounded even when the peer does not acknowledge the close frame", async (t) => {
  const f = await fixture(t);
  const cdp = client(t, f.ws, { closeTimeoutMs: 30 });
  await cdp.connect();
  f.peers[0]._socket.pause();
  const started = Date.now();
  await cdp.close();
  assert.ok(Date.now() - started < 1000);
  assert.ok(Date.now() - started >= 20);
  await assert.rejects(cdp.connect(), /closed/);
});

test("command timeout, cyclic parameters, and socket send failures do not poison later commands", async (t) => {
  const f = await fixture(t, { connection: (ws) => ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method !== "Timeout") ws.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
  }) });
  const cdp = client(t, f.ws);
  await assert.rejects(cdp.send("Timeout", {}, undefined, { timeoutMs: 20 }), /timeout after 20ms/);
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(cdp.send("Cyclic", cyclic), /circular/i);
  const original = WebSocket.prototype.send;
  WebSocket.prototype.send = function (...args) {
    if (!this._isServer) throw new Error("forced send failure");
    return original.apply(this, args);
  };
  try {
    await assert.rejects(cdp.send("Throw", {}, undefined, { timeoutMs: 60_000 }), /forced send failure/);
    WebSocket.prototype.send = function (data, callback) {
      if (!this._isServer) return queueMicrotask(() => callback(new Error("forced callback failure")));
      return original.call(this, data, callback);
    };
    await assert.rejects(cdp.send("Callback", {}, undefined, { timeoutMs: 60_000 }), /forced callback failure/);
  } finally {
    WebSocket.prototype.send = original;
  }
  assert.deepEqual(await cdp.send("Okay"), { ok: true });
});

test("withTarget never carries an attached session across a peer reconnect", async (t) => {
  const received = [];
  const f = await fixture(t, { connection: (ws) => ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    received.push(msg.method);
    ws.send(JSON.stringify({ id: msg.id, result: msg.method === "Target.attachToTarget" ? { sessionId: "old-session" } : {} }));
  }) });
  const cdp = client(t, f.ws);
  await cdp.withTarget("target", async (send) => {
    const old = f.peers[0];
    const closed = once(old, "close");
    old.terminate();
    await closed;
    await delay(10);
    await cdp.send("Browser.getVersion");
    await assert.rejects(send("Runtime.evaluate", { expression: "1" }), /closed/);
  });
  assert.equal(f.peers.length, 2);
  assert.deepEqual(received, ["Target.attachToTarget", "Browser.getVersion"]);
});

test("closing inside withTarget preserves callback result and cannot reconnect for cleanup", async (t) => {
  const received = [];
  const f = await fixture(t, { connection: (ws) => ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    received.push(msg.method);
    ws.send(JSON.stringify({ id: msg.id, result: { sessionId: "session" } }));
  }) });
  const cdp = client(t, f.ws);
  assert.equal(await cdp.withTarget("target", async () => { await cdp.close(); return 42; }), 42);
  assert.deepEqual(received, ["Target.attachToTarget"]);
  assert.equal(f.peers.length, 1);
});

test("closing a pending 60-second command leaves no timer or socket keeping a child process alive", async (t) => {
  const f = await fixture(t, { connection: () => {} });
  const moduleUrl = new URL("../src/cdp-mini.mjs", import.meta.url).href;
  const script = `
    import { MiniCdp } from ${JSON.stringify(moduleUrl)};
    import { setTimeout as delay } from "node:timers/promises";
    const cdp = new MiniCdp(process.argv[1]);
    await cdp.connect();
    const pending = cdp.send("No.reply", {}, undefined, { timeoutMs: 60000 }).catch((error) => error.message);
    await delay(20);
    await cdp.close();
    if (!(await pending).includes("closed")) throw new Error("pending command was not cancelled");
    console.log("clean exit");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.ws], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const killer = setTimeout(() => child.kill("SIGKILL"), 2500);
  t.after(() => { clearTimeout(killer); if (child.exitCode === null) child.kill("SIGKILL"); });
  const [code, signal] = await once(child, "exit");
  clearTimeout(killer);
  assert.equal(signal, null, `child retained resources: ${stderr}`);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /clean exit/);
});


test("onConnect runs once per connection, supports recursive send, and stops after close", async (t) => {
  const f = await fixture(t);
  const cdp = client(t, f.ws);
  const results = [];
  let removedCalls = 0;
  const remove = cdp.onConnect(() => { removedCalls++; });
  remove();
  cdp.onConnect(async (connected) => {
    assert.equal(connected, cdp);
    results.push(await connected.send("Target.setDiscoverTargets", { discover: true }));
  });
  cdp.onConnect(async () => { throw new Error("async subscriber failure"); });
  await Promise.all([cdp.connect(), cdp.connect(), cdp.send("First")]);
  await until(() => results.length === 1);
  const closed = once(f.peers[0], "close");
  f.peers[0].terminate();
  await closed;
  await delay(10);
  await cdp.send("Second");
  await until(() => results.length === 2);
  assert.equal(f.peers.length, 2);
  assert.equal(removedCalls, 0);
  assert.ok(results.every((result) => result.method === "Target.setDiscoverTargets"));
  await cdp.close();
  await assert.rejects(cdp.connect(), /closed/);
  assert.throws(() => cdp.onConnect(() => {}), /closed/);
  await delay(10);
  assert.equal(results.length, 2);
});
