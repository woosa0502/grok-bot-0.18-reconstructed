import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createMobileServer } from "../server.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("Windows gateway HTTP traffic stays behind Belmont pairing and receives the trusted user", async (context) => {
  const requests = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, path: request.url, user: request.headers["x-belmont-user"], body: Buffer.concat(chunks).toString("utf8") });
    response.writeHead(200, { "content-type": "application/json", "x-upstream": "moonlight-web" });
    response.end(JSON.stringify(requests.at(-1)));
  });
  const upstreamOrigin = await listen(upstream);
  context.after(() => close(upstream));

  const locked = createMobileServer({ pairingCode: "123456", sessionFile: null, windowsGatewayUrl: upstreamOrigin });
  const lockedOrigin = await listen(locked.server);
  context.after(() => close(locked.server));
  assert.equal((await fetch(`${lockedOrigin}/windows/`)).status, 401);

  const app = createMobileServer({ skipPairing: true, sessionFile: null, windowsGatewayUrl: upstreamOrigin });
  const origin = await listen(app.server);
  context.after(() => close(app.server));

  const redirect = await fetch(`${origin}/windows?mode=desktop`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/windows/?mode=desktop");

  const response = await fetch(`${origin}/windows/api/host?address=localhost`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: "Desktop" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-upstream"), "moonlight-web");
  assert.deepEqual(await response.json(), {
    method: "POST",
    path: "/windows/api/host?address=localhost",
    user: "hoon",
    body: JSON.stringify({ app: "Desktop" }),
  });
});

test("Windows gateway WebSocket signaling is authenticated and bridged", async (context) => {
  let forwardedUser = null;
  const upstreamServer = http.createServer();
  const upstreamWebSocket = new WebSocketServer({ noServer: true });
  upstreamServer.on("upgrade", (request, socket, head) => {
    forwardedUser = request.headers["x-belmont-user"];
    upstreamWebSocket.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (message) => client.send(`upstream:${message.toString()}`));
    });
  });
  const upstreamOrigin = await listen(upstreamServer);
  context.after(() => new Promise((resolve) => upstreamWebSocket.close(resolve)));
  context.after(() => close(upstreamServer));

  const app = createMobileServer({ skipPairing: true, sessionFile: null, windowsGatewayUrl: upstreamOrigin });
  const origin = await listen(app.server);
  context.after(() => close(app.server));

  const client = new WebSocket(`${origin.replace("http:", "ws:")}/windows/api/host/stream/web_socket`);
  await once(client, "open");
  client.send("offer");
  const [reply] = await once(client, "message");
  assert.equal(reply.toString(), "upstream:offer");
  assert.equal(forwardedUser, "hoon");
  client.close();
  await once(client, "close");
});

test("Windows desktop route discovers the paired host and opens Desktop directly", async (context) => {
  const upstream = http.createServer((request, response) => {
    if (request.url === "/windows/api/hosts") {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end([
        JSON.stringify({ hosts: [{ host_id: 41, name: "PC", paired: "Paired", server_state: null }] }),
        JSON.stringify({ host_id: 41, paired: "Paired", server_state: "Busy", current_game: 73 }),
        "",
      ].join("\n"));
      return;
    }
    if (request.url === "/windows/api/apps?host_id=41") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ apps: [{ app_id: 73, title: "Desktop" }] }));
      return;
    }
    response.writeHead(404).end();
  });
  const upstreamOrigin = await listen(upstream);
  context.after(() => close(upstream));

  const app = createMobileServer({ skipPairing: true, sessionFile: null, windowsGatewayUrl: upstreamOrigin });
  const origin = await listen(app.server);
  context.after(() => close(app.server));

  const response = await fetch(`${origin}/windows/desktop`, { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/windows/stream.html?hostId=41&appId=73");
});
