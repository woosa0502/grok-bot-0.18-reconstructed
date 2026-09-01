import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { createMobileServer, isAllowedMobileRoute } from "../server.mjs";

const serverSockets = new WeakMap();

test("mobile route allowlist stays narrow", () => {
  assert.equal(isAllowedMobileRoute("GET", "/api/bots"), true);
  assert.equal(isAllowedMobileRoute("POST", "/api/bots/b-1/messages"), true);
  assert.equal(isAllowedMobileRoute("GET", "/api/bots/b-1/computer"), true);
  assert.equal(isAllowedMobileRoute("POST", "/api/bots/b-1/computer/ensure"), true);
  assert.equal(isAllowedMobileRoute("GET", "/api/bots/b-1/computer/view/vnc.html"), true);
  assert.equal(isAllowedMobileRoute("GET", "/api/bots/b-1/computer/websockify"), true);
  assert.equal(isAllowedMobileRoute("POST", "/api/config"), false);
  assert.equal(isAllowedMobileRoute("GET", "/api/config"), false);
  assert.equal(isAllowedMobileRoute("GET", "/api/instances"), false);
  assert.equal(isAllowedMobileRoute("GET", "/api/internal/peer-agents"), false);
});

test("gateway keeps the device token server-side and forwards an authenticated mobile request", async (t) => {
  const observations = [];
  const upstream = createServer((request, response) => {
    observations.push({ url: request.url, authorization: request.headers.authorization, origin: request.headers.origin });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/pair") {
      response.end(JSON.stringify({ token: "upstream-secret-token", serverName: "Test computer", device: { id: "d1", name: "Phone" } }));
      return;
    }
    if (request.url === "/api/bots") {
      response.end(JSON.stringify({ bots: [
        { id: "belmont", threadId: "thread-belmont", name: "Belmont", chiefOfStaff: true, tasks: [{ threadId: "thread-worker", messages: [{ text: "nested task secret" }] }] },
        { id: "worker-7", threadId: "thread-worker", name: "Researcher", messages: [{ text: "worker secret" }], activeLeafId: "worker-leaf" }
      ], groups: [{ id: "group-1", messages: [{ text: "group secret" }] }] }));
      return;
    }
    if (request.url === "/api/bots/belmont/messages" && request.method === "POST") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/api/threads/thread-belmont/messages") {
      response.end(JSON.stringify({ messages: [], hasMore: false }));
      return;
    }
    if (request.url.startsWith("/api/events?")) {
      response.setHeader("Content-Type", "text/event-stream");
      const hiddenCursorEvents = Array.from({ length: 256 }, (_, index) =>
        `id: hidden-worker-${index}\nevent: message\ndata: {"kind":"message","threadId":"thread-worker","message":{"text":"hidden cursor secret"}}`
      );
      response.end([
        'event: META_EVENT_SECRET\nid: META_ID_SECRET\n: META_COMMENT_SECRET\ndata: {"kind":"message","threadId":"thread-worker","message":{"text":"worker secret"}}',
        'id: safe.cursor-2\nevent: message\ndata: {"kind":"message","threadId":"thread-belmont","message":{"text":"manager update"}}',
        'event: bot\ndata: {"kind":"bot","bot":{"id":"worker-7","name":"Researcher","messages":[{"text":"worker secret"}]}}',
        'event: group\ndata: {"kind":"group","group":{"id":"group-1","messages":[{"text":"group secret"}]}}',
        'event: message\ndata: {"kind":"message","message":{"text":"unowned secret"}}',
        'event: envelope\ndata: {"kind":"envelope","payload":{"threadId":"thread-worker","message":{"text":"nested secret"}}}',
        'event: unknown\ndata: {"kind":"unknown","botId":"worker-7","messages":[{"text":"plural secret"}],"activeLeafId":"leaf secret"}',
        ': COMMENT_ONLY_SECRET',
        ...hiddenCursorEvents
      ].join("\n\n") + "\n\n");
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "missing" }));
  });
  upstream.on("upgrade", (request, socket) => {
    observations.push({ url: request.url, authorization: request.headers.authorization, origin: request.headers.origin });
    const key = request.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "Sec-WebSocket-Protocol: binary",
      "",
      "",
    ].join("\r\n"));
  });
  await listen(upstream);
  t.after(() => close(upstream));

  const upstreamAddress = upstream.address();
  const gateway = createMobileServer({ upstream: `http://127.0.0.1:${upstreamAddress.port}` });
  await listen(gateway);
  t.after(() => close(gateway));
  const gatewayAddress = gateway.address();
  const origin = `http://127.0.0.1:${gatewayAddress.port}`;

  const pairResponse = await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ code: "123456", deviceName: "Phone" })
  });
  const pairPayload = await pairResponse.json();
  const cookie = pairResponse.headers.get("set-cookie").split(";", 1)[0];
  assert.equal(pairResponse.status, 200);
  assert.equal(pairPayload.session, true);
  assert.equal(pairPayload.serverName, "Test computer");
  assert.equal("token" in pairPayload, false);
  assert.match(pairResponse.headers.get("set-cookie"), /HttpOnly/);

  const eventsBeforeRoster = await fetch(`${origin}/api/events`, { headers: { Cookie: cookie } });
  assert.equal(eventsBeforeRoster.status, 409);

  const botsResponse = await fetch(`${origin}/api/bots`, { headers: { Cookie: cookie } });
  const botsPayload = await botsResponse.json();
  assert.equal(botsResponse.status, 200);
  assert.equal(botsPayload.bots[0].name, "Belmont");
  assert.equal("messages" in botsPayload.bots[1], false);
  assert.equal("activeLeafId" in botsPayload.bots[1], false);
  assert.equal("tasks" in botsPayload.bots[0], false);
  assert.equal(JSON.stringify(botsPayload).includes("nested task secret"), false);
  assert.deepEqual(botsPayload.groups, []);
  assert.equal(observations[0].origin, undefined);
  assert.equal(observations[1].authorization, "Bearer upstream-secret-token");

  const workerSend = await fetch(`${origin}/api/bots/worker-7/messages`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "bypass" })
  });
  assert.equal(workerSend.status, 403);

  const managerSend = await fetch(`${origin}/api/bots/belmont/messages`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "goal", threadId: "thread-belmont" })
  });
  assert.equal(managerSend.status, 200);

  const disguisedWorkerThread = await fetch(`${origin}/api/bots/belmont/messages`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "bypass", threadId: "thread-worker" })
  });
  assert.equal(disguisedWorkerThread.status, 403);

  const nestedWorkerThread = await fetch(`${origin}/api/bots/belmont/messages`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "bypass", message: { threadId: "thread-worker" } })
  });
  assert.equal(nestedWorkerThread.status, 400);

  const formWorkerThread = await fetch(`${origin}/api/bots/belmont/messages`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: "text=bypass&threadId=thread-worker"
  });
  assert.equal(formWorkerThread.status, 415);

  const queryWorkerThread = await fetch(`${origin}/api/bots/belmont/messages?threadId=thread-worker`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "bypass" })
  });
  assert.equal(queryWorkerThread.status, 400);

  // Reading a rostered worker's transcript now passes through (the upstream mock
  // has no such route, hence 404); acting on it is still refused at the gateway.
  const workerThread = await fetch(`${origin}/api/threads/thread-worker/messages`, { headers: { Cookie: cookie } });
  assert.equal(workerThread.status, 404);
  const ghostThread = await fetch(`${origin}/api/threads/thread-ghost/messages`, { headers: { Cookie: cookie } });
  assert.equal(ghostThread.status, 403);
  const workerRespond = await fetch(`${origin}/api/threads/thread-worker/respond`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "req-1", behavior: "allow" })
  });
  assert.equal(workerRespond.status, 403);
  const managerThread = await fetch(`${origin}/api/threads/thread-belmont/messages`, { headers: { Cookie: cookie } });
  assert.equal(managerThread.status, 200);

  const eventsResponse = await fetch(`${origin}/api/events`, { headers: { Cookie: cookie } });
  const eventsText = await eventsResponse.text();
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsText.includes("worker secret"), false);
  assert.equal(eventsText.includes("group secret"), false);
  assert.equal(eventsText.includes("unowned secret"), false);
  assert.equal(eventsText.includes('"kind":"message","threadId":"thread-belmont"'), true);
  assert.equal(eventsText.includes('"id":"worker-7"'), true);
  assert.equal(eventsText.includes("nested secret"), false);
  assert.equal(eventsText.includes("plural secret"), false);
  assert.equal(eventsText.includes("leaf secret"), false);
  assert.equal(eventsText.includes("META_EVENT_SECRET"), false);
  assert.equal(eventsText.includes("META_ID_SECRET"), false);
  assert.equal(eventsText.includes("META_COMMENT_SECRET"), false);
  assert.equal(eventsText.includes("COMMENT_ONLY_SECRET"), false);
  assert.equal(eventsText.includes("hidden cursor secret"), false);
  assert.equal(eventsText.includes(": keepalive"), true);
  assert.equal(eventsText.includes("safe.cursor-2"), false);
  const clientCursor = /^id: (mobile-[\w-]+)$/m.exec(eventsText)?.[1];
  assert.ok(clientCursor);

  const resumedEvents = await fetch(`${origin}/api/events?since=${encodeURIComponent(clientCursor)}&screens=off`, { headers: { Cookie: cookie } });
  assert.equal(resumedEvents.status, 200);
  await resumedEvents.text();
  assert.equal(observations.at(-1).url, "/api/events?since=safe.cursor-2&screens=off");

  const denied = await fetch(`${origin}/api/internal/peer-agents`, { headers: { Cookie: cookie } });
  assert.equal(denied.status, 404);

  const upgrade = await rawUpgrade({
    port: gateway.address().port,
    path: "/api/bots/belmont/computer/websockify",
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.match(upgrade, /^HTTP\/1\.1 101 /u);
  assert.equal(observations.at(-1).authorization, "Bearer upstream-secret-token");
  assert.equal(observations.at(-1).origin, undefined);
  assert.equal(observations.length, 8);
});

test("pairing failures back off exponentially against code brute force", async (t) => {
  const upstream = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      if (JSON.parse(body).code === "123456") {
        response.end(JSON.stringify({ token: "upstream-secret-token", serverName: "Test computer" }));
      } else {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "invalid pairing code" }));
      }
    });
  });
  await listen(upstream);
  t.after(() => close(upstream));

  const clock = { now: 1_000_000 };
  const gateway = createMobileServer({ upstream: `http://127.0.0.1:${upstream.address().port}`, now: () => clock.now });
  await listen(gateway);
  t.after(() => close(gateway));
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  const attempt = (code) => fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName: "Phone" })
  });

  assert.equal((await attempt("000000")).status, 401);
  // an immediate retry is refused without ever reaching the upstream
  assert.equal((await attempt("000001")).status, 429);
  assert.equal((await attempt("123456")).status, 429, "even the right code waits out the backoff");
  clock.now += 1_000;
  assert.equal((await attempt("000001")).status, 401);
  // the second failure doubles the wait: 1s is no longer enough
  clock.now += 1_000;
  assert.equal((await attempt("000002")).status, 429);
  clock.now += 1_100;
  assert.equal((await attempt("123456")).status, 200);
  // success resets the guard
  assert.equal((await attempt("123456")).status, 200);
});

test("gateway rejects cross-origin pairing", async (t) => {
  const upstream = createServer((_request, response) => response.end("{}"));
  await listen(upstream);
  t.after(() => close(upstream));
  const gateway = createMobileServer({ upstream: `http://127.0.0.1:${upstream.address().port}` });
  await listen(gateway);
  t.after(() => close(gateway));
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/api/pair`, {
    method: "POST",
    headers: { Origin: "https://foreign.example", "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 403);

  const schemeMismatch = await fetch(`http://127.0.0.1:${gateway.address().port}/api/pair`, {
    method: "POST",
    headers: { Origin: `https://127.0.0.1:${gateway.address().port}`, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(schemeMismatch.status, 403);

  const spoofedForwardedProtocol = await fetch(`http://127.0.0.1:${gateway.address().port}/api/pair`, {
    method: "POST",
    headers: {
      Origin: `https://127.0.0.1:${gateway.address().port}`,
      "X-Forwarded-Proto": "https",
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  assert.equal(spoofedForwardedProtocol.status, 403);

  const missingOrigin = await fetch(`http://127.0.0.1:${gateway.address().port}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(missingOrigin.status, 403);

  const queryPair = await fetch(`http://127.0.0.1:${gateway.address().port}/api/pair?unknown=x&unknown=y`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${gateway.address().port}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456", deviceName: "Phone" })
  });
  assert.equal(queryPair.status, 400);

  const oversizePair = await fetch(`http://127.0.0.1:${gateway.address().port}/api/pair`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${gateway.address().port}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456", deviceName: "x".repeat(1_048_576) })
  });
  assert.equal(oversizePair.status, 413);
});

function listen(server) {
  const sockets = new Set();
  serverSockets.set(server, sockets);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  for (const socket of serverSockets.get(server) || []) socket.destroy();
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

function rawUpgrade({ port, path, headers = {} }) {
  return new Promise((resolveUpgrade, rejectUpgrade) => {
    const socket = connect({ host: "127.0.0.1", port });
    let response = "";
    socket.setTimeout(5_000, () => socket.destroy(new Error("upgrade timed out")));
    socket.once("error", rejectUpgrade);
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      if (!response.includes("\r\n\r\n")) return;
      socket.destroy();
      resolveUpgrade(response);
    });
    socket.once("connect", () => {
      const key = Buffer.from("belmont-mobile-gateway-test").toString("base64");
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Protocol: binary",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ].join("\r\n"));
    });
  });
}
