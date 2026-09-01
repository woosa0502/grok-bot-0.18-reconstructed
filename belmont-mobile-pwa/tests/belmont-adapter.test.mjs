import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createBelmontCompanionAdapter,
  parseLoopbackVncTarget,
  projectBelmontAgent,
  projectBelmontEvent,
  resolveBelmontDataRoot,
} from "../belmont-adapter.mjs";

const serverSockets = new WeakMap();

test("resolves the existing Belmont profile without modifying it", () => {
  assert.equal(resolveBelmontDataRoot({ BELMONT_DATA_ROOT: "/tmp/direct" }, "/repo"), "/tmp/direct");
  assert.equal(resolveBelmontDataRoot({ BELMONT_WSL_PROFILE: "/tmp/profile" }, "/repo"), "/tmp/profile/sand-data");
  assert.equal(resolveBelmontDataRoot({ BELMONT_REPO_ROOT: "/tmp/belmont" }, "/repo"), "/tmp/belmont/.cache/belmont-wsl-profile/sand-data");
});

test("rejects non-loopback noVNC targets", () => {
  assert.throws(() => parseLoopbackVncTarget("https://example.com/vnc.html?path=websockify"), /trusted loopback/u);
  assert.throws(() => parseLoopbackVncTarget("http://127.0.0.1:6080/not-vnc.html"), /trusted loopback/u);
});

test("projects roster and event state without inventing completed work", () => {
  assert.deepEqual(projectBelmontAgent({
    id: "manager",
    name: "Belmont",
    description: "Manager",
    avatarColor: "cyan",
    isRunning: true,
    hasUnread: true,
  }, "manager", []), {
    composing: false,
    id: "manager",
    threadId: "manager",
    name: "Belmont",
    title: "",
    description: "Manager",
    color: "cyan",
    unread: true,
    busy: true,
    chiefOfStaff: true,
    hidden: false,
    pinned: false,
    taskStatus: "진행 중",
    messages: [],
  });
  assert.deepEqual(projectBelmontEvent({ channel: "transcript", payload: { agentId: "manager" } }, "manager"), { kind: "message", threadId: "manager" });
  assert.equal(projectBelmontEvent({ channel: "transcript", payload: { agentId: "worker" } }, "manager"), null);
});

test("adapts the real Belmont gateway contract to the mobile contract", async (t) => {
  const calls = [];
  const gateway = createServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer host-secret") {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: "unauthorized" }));
    }
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/health") return response.end(JSON.stringify({ ok: true, activeAgentId: "manager" }));
    if (request.method === "GET" && request.url?.startsWith("/events?")) {
      response.setHeader("Content-Type", "text/event-stream");
      response.end('data: {"channel":"transcript","payload":{"agentId":"manager","type":"appended"}}\n\n');
      return;
    }
    const command = /^\/api\/([\w-]+)$/.exec(request.url || "")?.[1];
    const body = await jsonBody(request);
    calls.push({ command, body });
    if (command === "listAgents") return response.end(JSON.stringify([
      { id: "manager", name: "Belmont", title: "Manager", description: "Coordinates work", avatarColor: "cyan", isRunning: false },
      { id: "worker", name: "Researcher", title: "Research", description: "Researches", isRunning: true },
    ]));
    if (command === "getAgentTranscriptTail") return response.end(JSON.stringify({
      entries: [
        { id: "u1", kind: "message", role: "user", content: "목표", timestampMs: 1 },
        { id: "hidden-out", kind: "message", role: "assistant", content: "worker에게 보낸 내부 지시", toAgent: "worker", timestampMs: 2 },
        { id: "hidden-in", kind: "message", role: "user", content: "worker 내부 결과", fromAgent: "worker", timestampMs: 3 },
        { id: "a1", kind: "send-message", message: { type: "text", content: "확인했습니다." }, timestampMs: 4 },
        { id: "tool1", kind: "tool-call", name: "Research", status: "done", summary: "조사 완료", timestampMs: 5 },
        { id: "widget1", kind: "send-message", message: { type: "widget", widget: { prompt: "형식을 고르세요", helpText: "결과 형식", options: [{ label: "짧게", value: "short" }, { label: "길게", value: "long" }] } }, timestampMs: 6 },
        { id: "approval1", kind: "send-message", message: { type: "auto-review-approval", approval: { requestId: "approval-real", status: "pending", surface: "host_shell", summary: "명령 실행", reason: "검증 필요", proposedRule: "allow command" } }, timestampMs: 7 },
        { id: "permission1", kind: "send-message", message: { type: "local-tool-permission", ask: { requestId: "permission-real", status: "pending", action: "write", target: "/workspace/report.md" } }, timestampMs: 8 },
        { id: "secret1", kind: "send-message", message: { type: "secret-request", secretRequest: { label: "API key" } }, timestampMs: 9 },
      ],
      nextBeforeSeq: 41,
    }));
    if (["sendPrompt", "respondToWidget", "resolveAutoReviewApproval", "resolveLocalToolPermission"].includes(command)) {
      return response.end(JSON.stringify({ accepted: true }));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "missing" }));
  });
  await listen(gateway);
  t.after(() => close(gateway));

  const dataRoot = await mkdtemp(join(tmpdir(), "belmont-mobile-adapter-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await writeFile(join(dataRoot, "gateway.json"), JSON.stringify({ port: gateway.address().port, host: "127.0.0.1", scheme: "http", token: "host-secret", pid: 123 }));
  await writeFile(join(dataRoot, "manager.json"), JSON.stringify({ managerAgentId: "manager" }));

  const adapter = createBelmontCompanionAdapter({ dataRoot, pairCode: "123456", tokenFactory: () => "adapter-token" });
  await listen(adapter);
  t.after(() => close(adapter));
  const origin = `http://127.0.0.1:${adapter.address().port}`;

  const badPair = await fetch(`${origin}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "654321" }) });
  assert.equal(badPair.status, 401);
  const paired = await fetch(`${origin}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456", deviceName: "Phone" }) });
  assert.equal(paired.status, 200);
  assert.equal((await paired.json()).token, "adapter-token");
  const headers = { Authorization: "Bearer adapter-token" };

  const rosterResponse = await fetch(`${origin}/api/bots?messages=50`, { headers });
  const roster = await rosterResponse.json();
  assert.equal(rosterResponse.status, 200);
  assert.equal(roster.bots[0].chiefOfStaff, true);
  assert.equal(roster.bots[1].chiefOfStaff, false);
  assert.equal("messages" in roster.bots[1], false);
  const serializedMessages = JSON.stringify(roster.bots[0].messages);
  assert.equal(serializedMessages.includes("worker에게 보낸 내부 지시"), false);
  assert.equal(serializedMessages.includes("worker 내부 결과"), false);
  assert.equal(serializedMessages.includes("확인했습니다"), true);
  assert.equal(serializedMessages.includes("데스크톱에서 비밀정보 입력"), true);

  const widget = roster.bots[0].messages.find((message) => message.card?.title === "형식을 고르세요");
  const approval = roster.bots[0].messages.find((message) => message.card?.title === "명령 실행");
  const permission = roster.bots[0].messages.find((message) => message.card?.tool === "LocalTool");
  assert.ok(widget?.card.requestId);
  assert.ok(approval?.card.requestId);
  assert.equal("allowKey" in approval.card, false);
  assert.ok(permission?.card.allowKey);

  await post(`${origin}/api/bots/manager/messages`, headers, { text: "새 목표", threadId: "manager", sendId: "send-1" });
  await post(`${origin}/api/threads/manager/respond`, headers, { requestId: widget.card.requestId, behavior: "answer", message: "짧게" });
  await post(`${origin}/api/threads/manager/respond`, headers, { requestId: approval.card.requestId, behavior: "allow" });
  await post(`${origin}/api/bots/manager/always-allow`, headers, { allowKey: permission.card.allowKey });
  await post(`${origin}/api/threads/manager/respond`, headers, { requestId: permission.card.requestId, behavior: "allow" });

  assert.deepEqual(calls.find((call) => call.command === "sendPrompt")?.body, { agentId: "manager", prompt: "새 목표", clientNonce: "send-1" });
  assert.deepEqual(calls.find((call) => call.command === "respondToWidget")?.body, { entryId: "widget1", value: "short", agentId: "manager" });
  assert.deepEqual(calls.find((call) => call.command === "resolveAutoReviewApproval")?.body, { entryId: "approval1", requestId: "approval-real", resolution: "approved", agentId: "manager" });
  assert.deepEqual(calls.find((call) => call.command === "resolveLocalToolPermission")?.body, { entryId: "permission1", requestId: "permission-real", resolution: "always", agentId: "manager" });

  const page = await fetch(`${origin}/api/threads/manager/messages?limit=20&before=41`, { headers }).then((response) => response.json());
  assert.equal(page.hasMore, true);
  assert.equal(page.before, "41");
  assert.equal(calls.filter((call) => call.command === "getAgentTranscriptTail").at(-1).body.beforeSeq, 41);

  const workerTranscript = await fetch(`${origin}/api/threads/worker/messages`, { headers });
  assert.equal(workerTranscript.status, 200);
  const workerPage = await workerTranscript.json();
  const workerSerialized = JSON.stringify(workerPage.messages);
  assert.equal(workerSerialized.includes("worker에게 보낸 내부 지시"), true, "agent traffic is the worker conversation");
  assert.equal(workerSerialized.includes("worker 내부 결과"), true);
  const unknownTranscript = await fetch(`${origin}/api/threads/ghost/messages`, { headers });
  assert.equal(unknownTranscript.status, 403);
  const workerRespond = await fetch(`${origin}/api/threads/worker/respond`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "x", behavior: "allow" }),
  });
  assert.equal(workerRespond.status, 403, "worker threads stay read-only");
  const eventsText = await fetch(`${origin}/api/events`, { headers }).then((response) => response.text());
  assert.match(eventsText, /event: hello/);
  assert.match(eventsText, /"kind":"message","threadId":"manager"/);
});

test("exposes an authenticated manager-only noVNC bridge and hand-back contract", async (t) => {
  const vncRequests = [];
  const vnc = createServer((request, response) => {
    vncRequests.push({ kind: "http", url: request.url });
    response.setHeader("Content-Type", request.url?.includes(".js") ? "text/javascript" : "text/html");
    response.end(request.url?.includes(".js") ? "export const ready = true;" : "<title>noVNC test</title>");
  });
  vnc.on("upgrade", (request, socket) => {
    vncRequests.push({ kind: "websocket", url: request.url, authorization: request.headers.authorization });
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
  await listen(vnc);
  t.after(() => close(vnc));

  const calls = [];
  const gateway = createServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer host-secret") {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: "unauthorized" }));
    }
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/health") return response.end(JSON.stringify({ ok: true, activeAgentId: "manager" }));
    const command = /^\/api\/([\w-]+)$/.exec(request.url || "")?.[1];
    const body = await jsonBody(request);
    calls.push({ command, body });
    if (command === "getForeverBoxStatus") return response.end(JSON.stringify({ agentId: "manager", state: "absent", vncUrl: null }));
    if (command === "ensureForeverBox") return response.end(JSON.stringify({
      agentId: "manager",
      state: "running",
      vncUrl: `http://127.0.0.1:${vnc.address().port}/vnc.html?path=websockify`,
      handoff: { instruction: "로그인을 완료해 주세요.", snapshotDataUrl: "data:image/webp;base64,AA==" },
    }));
    if (command === "handBackForeverBox") return response.end(JSON.stringify({ ok: true }));
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "missing" }));
  });
  await listen(gateway);
  t.after(() => close(gateway));

  const dataRoot = await mkdtemp(join(tmpdir(), "belmont-mobile-computer-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await writeFile(join(dataRoot, "gateway.json"), JSON.stringify({ port: gateway.address().port, host: "127.0.0.1", scheme: "http", token: "host-secret" }));
  await writeFile(join(dataRoot, "manager.json"), JSON.stringify({ managerAgentId: "manager" }));

  const adapter = createBelmontCompanionAdapter({ dataRoot, pairCode: "123456", tokenFactory: () => "adapter-token" });
  await listen(adapter);
  t.after(() => close(adapter));
  const origin = `http://127.0.0.1:${adapter.address().port}`;
  await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456" }),
  });
  const headers = { Authorization: "Bearer adapter-token" };

  const before = await fetch(`${origin}/api/bots/manager/computer`, { headers }).then((response) => response.json());
  assert.equal(before.ready, false);
  assert.equal(before.viewerUrl, null);

  const workerEnsure = await fetch(`${origin}/api/bots/worker/computer/ensure`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(workerEnsure.status, 403);

  const ensuredResponse = await fetch(`${origin}/api/bots/manager/computer/ensure`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  const ensured = await ensuredResponse.json();
  assert.equal(ensuredResponse.status, 200);
  assert.equal(ensured.ready, true);
  assert.equal(ensured.interactive, true);
  assert.equal(ensured.handoff.instruction, "로그인을 완료해 주세요.");
  assert.equal(ensured.handoff.snapshotAvailable, true);
  assert.match(ensured.viewerUrl, /^\/api\/bots\/manager\/computer\/view\/vnc\.html\?/u);
  assert.equal(ensured.viewerUrl.includes("127.0.0.1"), false);
  assert.equal(new URL(ensured.viewerUrl, origin).searchParams.get("view_only"), "0");

  const unauthenticatedViewer = await fetch(new URL(ensured.viewerUrl, origin));
  assert.equal(unauthenticatedViewer.status, 401);
  const viewer = await fetch(new URL(ensured.viewerUrl, origin), { headers });
  assert.equal(viewer.status, 200);
  assert.match(await viewer.text(), /noVNC test/u);
  assert.equal(vncRequests[0].kind, "http");

  const upgrade = await rawUpgrade({
    port: adapter.address().port,
    path: "/api/bots/manager/computer/websockify",
    headers: { Authorization: "Bearer adapter-token" },
  });
  assert.match(upgrade, /^HTTP\/1\.1 101 /u);
  assert.deepEqual(vncRequests.find((entry) => entry.kind === "websocket"), {
    kind: "websocket",
    url: "/websockify",
    authorization: undefined,
  });

  const handBack = await fetch(`${origin}/api/bots/manager/computer/hand-back`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ resolution: "completed" }),
  });
  assert.equal(handBack.status, 200);
  assert.deepEqual(calls.find((call) => call.command === "handBackForeverBox")?.body, {
    id: "manager",
    trigger: { resolution: "completed", trigger: "mobile" },
  });
});

async function post(url, headers, payload) {
  const response = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, await response.text());
}

function jsonBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function listen(server) {
  const sockets = new Set();
  serverSockets.set(server, sockets);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  for (const socket of serverSockets.get(server) || []) socket.destroy();
  server.closeAllConnections?.();
  return new Promise((resolveClose) => server.close(resolveClose));
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
      const key = Buffer.from("belmont-mobile-test").toString("base64");
      const lines = [
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
      ];
      socket.write(lines.join("\r\n"));
    });
  });
}
