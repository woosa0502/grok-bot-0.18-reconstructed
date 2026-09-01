import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { proxyWebSocketUpgrade, writeUpgradeError } from "./websocket-tunnel.mjs";
import { loadSessions, saveSessions } from "./session-store.mjs";

const MAX_BODY_BYTES = 1_048_576;
const SESSION_LIMIT = 64;
const ACTION_LIMIT = 512;
const EVENT_CURSOR_LIMIT = 256;
const EVENT_CHANNELS = "transcript,agents,agent-upserted,subagents,async-tasks,forever-box";
const LOOPBACK_VNC_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function resolveBelmontDataRoot(env = process.env, cwd = process.cwd()) {
  const direct = env.BELMONT_DATA_ROOT?.trim() || env.SAND_DATA_ROOT?.trim();
  if (direct) return resolve(direct);
  const profile = env.BELMONT_WSL_PROFILE?.trim();
  if (profile) return resolve(profile, "sand-data");
  const repo = env.BELMONT_REPO_ROOT?.trim();
  if (repo) return resolve(repo, ".cache", "belmont-wsl-profile", "sand-data");
  return resolve(cwd, ".cache", "belmont-wsl-profile", "sand-data");
}

export function createBelmontCompanionAdapter({
  dataRoot,
  pairCode,
  fetchImpl = fetch,
  now = () => Date.now(),
  tokenFactory = () => randomBytes(32).toString("base64url"),
  persistPath = null,
}) {
  if (!dataRoot) throw new Error("Belmont data root is required.");
  if (typeof pairCode !== "string" || pairCode.trim().length < 6) {
    throw new Error("Belmont mobile pairing code must contain at least 6 characters.");
  }
  const gateway = createGatewayClient({ dataRoot: resolve(dataRoot), fetchImpl });
  const sessions = new Map();
  if (persistPath) {
    for (const [token, stored] of Object.entries(loadSessions(persistPath) ?? {})) {
      if (typeof token !== "string" || token.length < 16) continue;
      const session = createAdapterSession(token, Number(stored?.createdAt) || now());
      session.lastSeenAt = Number(stored?.lastSeenAt) || session.createdAt;
      sessions.set(token, session);
    }
  }
  const persistSessions = () => {
    if (!persistPath) return;
    saveSessions(persistPath, Object.fromEntries([...sessions].map(([token, session]) => [
      token,
      { createdAt: session.createdAt, lastSeenAt: session.lastSeenAt }
    ])));
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://belmont-adapter.invalid");
      if (request.method === "GET" && url.pathname === "/api/health") {
        const health = await gateway.health();
        return json(response, 200, { ok: true, app: "Belmont Mobile Adapter", activeAgentId: health.activeAgentId ?? null });
      }
      if (request.method === "POST" && url.pathname === "/api/pair") {
        const payload = await readJsonBody(request);
        const supplied = typeof payload.code === "string" ? payload.code : typeof payload.credential === "string" ? payload.credential : "";
        if (!secretEquals(supplied.trim(), pairCode.trim())) return json(response, 401, { error: "invalid pairing code" });
        const runtime = await gateway.runtime();
        const token = tokenFactory();
        if (sessions.size >= SESSION_LIMIT) sessions.delete(sessions.keys().next().value);
        sessions.set(token, createAdapterSession(token, now()));
        persistSessions();
        return json(response, 200, {
          token,
          serverName: "Belmont WSL",
          device: { id: String(runtime.discovery.pid ?? "belmont-host"), name: "Belmont" },
        });
      }

      const session = adapterSession(request, sessions, now());
      if (session == null) return json(response, 401, { error: "unauthorized" });
      const managerId = await gateway.managerId();

      if (request.method === "GET" && url.pathname === "/api/bots") {
        const limit = pageSize(url.searchParams.get("messages"), 50);
        const agents = await gateway.call("listAgents", {});
        if (!Array.isArray(agents)) throw new Error("Belmont listAgents returned an invalid roster.");
        const manager = agents.find((agent) => agent?.id === managerId);
        if (manager == null) return json(response, 503, { error: "designated Belmont manager is not present" });
        const page = await gateway.call("getAgentTranscriptTail", { id: managerId, limit });
        const projected = projectBelmontTranscriptPage(page, {
          agentId: managerId,
          registerAction: (action) => registerAction(session, action),
        });
        const bots = agents.map((agent) => projectBelmontAgent(agent, managerId, agent.id === managerId ? projected.messages : undefined));
        return json(response, 200, { bots, groups: [] });
      }

      const threadMatch = /^\/api\/threads\/([\w-]+)\/messages$/.exec(url.pathname);
      if (request.method === "GET" && threadMatch) {
        const threadId = threadMatch[1];
        const limit = pageSize(url.searchParams.get("limit"), 50);
        const before = beforeSequence(url.searchParams.get("before"));
        // Every page carries the bot's live turn state so a polling client can
        // drive its status line without depending on the SSE channel.
        const agents = await gateway.call("listAgents", {});
        const entry = Array.isArray(agents) ? agents.find((agent) => agent?.id === threadId) : null;
        const turnState = {
          busy: entry?.isRunning === true || entry?.isComposingMessage === true,
          composing: entry?.isComposingMessage === true,
          activity: publicActivity(entry?.currentActivity),
        };
        if (threadId !== managerId) {
          // Worker transcripts are readable but never writable: agent-to-agent
          // traffic is the conversation there, so it stays visible, while no
          // action (respond/send) route accepts a worker thread.
          if (entry == null) return json(response, 403, { error: "unknown bot transcript" });
          const page = await gateway.call("getAgentTranscriptTail", {
            id: threadId,
            limit,
            ...(before == null ? {} : { beforeSeq: before }),
          });
          return json(response, 200, { ...projectBelmontTranscriptPage(page, { agentId: threadId, includeAgentTraffic: true }), state: turnState });
        }
        const page = await gateway.call("getAgentTranscriptTail", {
          id: managerId,
          limit,
          ...(before == null ? {} : { beforeSeq: before }),
        });
        const projected = projectBelmontTranscriptPage(page, {
          agentId: managerId,
          registerAction: (action) => registerAction(session, action),
        });
        return json(response, 200, { ...projected, state: turnState });
      }

      const sendMatch = /^\/api\/bots\/([\w-]+)\/messages$/.exec(url.pathname);
      if (request.method === "POST" && sendMatch) {
        if (sendMatch[1] !== managerId) return json(response, 403, { error: "mobile messages can only target Belmont" });
        const payload = await readJsonBody(request);
        if (payload.threadId !== undefined && payload.threadId !== managerId) return json(response, 403, { error: "message thread does not belong to Belmont" });
        if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 12_000) return json(response, 400, { error: "invalid message text" });
        const result = await gateway.call("sendPrompt", {
          agentId: managerId,
          prompt: payload.text,
          ...(typeof payload.sendId === "string" ? { clientNonce: payload.sendId } : {}),
        });
        return json(response, 200, result);
      }

      const computerMatch = /^\/api\/bots\/([\w-]+)\/computer$/.exec(url.pathname);
      if (request.method === "GET" && computerMatch) {
        if (computerMatch[1] !== managerId) return json(response, 403, { error: "mobile computer access can only target Belmont" });
        const status = await gateway.call("getForeverBoxStatus", { id: managerId });
        return json(response, 200, projectMobileComputerStatus({ session, managerId, status }));
      }

      const ensureComputerMatch = /^\/api\/bots\/([\w-]+)\/computer\/ensure$/.exec(url.pathname);
      if (request.method === "POST" && ensureComputerMatch) {
        if (ensureComputerMatch[1] !== managerId) return json(response, 403, { error: "mobile computer access can only target Belmont" });
        const payload = await readJsonBody(request);
        if (Object.keys(payload).length > 0) throw badRequest("computer ensure body must be empty");
        const status = await gateway.call("ensureForeverBox", { id: managerId });
        return json(response, 200, projectMobileComputerStatus({ session, managerId, status }));
      }

      const handBackMatch = /^\/api\/bots\/([\w-]+)\/computer\/hand-back$/.exec(url.pathname);
      if (request.method === "POST" && handBackMatch) {
        if (handBackMatch[1] !== managerId) return json(response, 403, { error: "mobile computer access can only target Belmont" });
        const payload = await readJsonBody(request);
        if (!Object.keys(payload).every((key) => key === "resolution")) throw badRequest("unsupported computer hand-back field");
        const resolution = payload.resolution ?? "completed";
        if (!["completed", "cancelled"].includes(resolution)) throw badRequest("invalid computer hand-back resolution");
        await gateway.call("handBackForeverBox", {
          id: managerId,
          trigger: { resolution, trigger: "mobile" },
        });
        const status = await gateway.call("getForeverBoxStatus", { id: managerId });
        return json(response, 200, { accepted: true, computer: projectMobileComputerStatus({ session, managerId, status }) });
      }

      const viewerMatch = /^\/api\/bots\/([\w-]+)\/computer\/view\/(.+)$/.exec(url.pathname);
      if (request.method === "GET" && viewerMatch) {
        if (viewerMatch[1] !== managerId) return json(response, 403, { error: "mobile computer access can only target Belmont" });
        return await proxyNoVncAsset({ request, response, url, session, managerId, assetPath: viewerMatch[2], fetchImpl });
      }

      const interruptMatch = /^\/api\/bots\/([\w-]+)\/interrupt$/.exec(url.pathname);
      if (request.method === "POST" && interruptMatch) {
        if (interruptMatch[1] !== managerId) return json(response, 403, { error: "mobile actions can only target Belmont" });
        return json(response, 501, { error: "the Belmont gateway does not expose a user turn interrupt command" });
      }

      const alwaysMatch = /^\/api\/bots\/([\w-]+)\/always-allow$/.exec(url.pathname);
      if (request.method === "POST" && alwaysMatch) {
        if (alwaysMatch[1] !== managerId) return json(response, 403, { error: "mobile actions can only target Belmont" });
        const payload = await readJsonBody(request);
        const requestId = session.allowKeys.get(payload.allowKey);
        const action = requestId == null ? null : session.actions.get(requestId);
        if (action?.kind !== "local-tool") return json(response, 409, { error: "this request cannot be permanently allowed from mobile" });
        session.remembered.add(requestId);
        return json(response, 200, { accepted: true });
      }

      const respondMatch = /^\/api\/threads\/([\w-]+)\/respond$/.exec(url.pathname);
      if (request.method === "POST" && respondMatch) {
        if (respondMatch[1] !== managerId) return json(response, 403, { error: "mobile actions can only target Belmont" });
        const payload = await readJsonBody(request);
        const action = typeof payload.requestId === "string" ? session.actions.get(payload.requestId) : null;
        if (action == null || action.agentId !== managerId) return json(response, 409, { error: "approval request is stale or unknown" });
        const result = await resolveMobileAction({ gateway, session, publicRequestId: payload.requestId, action, payload });
        return json(response, 200, result);
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        return streamBelmontEvents({ request, response, url, gateway, session, managerId });
      }

      return json(response, 404, { error: `no Belmont adapter route: ${request.method} ${url.pathname}` });
    } catch (error) {
      const status = error?.code === "BODY_TOO_LARGE" ? 413 : error?.code === "BAD_REQUEST" ? 400 : 502;
      return json(response, status, { error: status === 502 ? "Belmont gateway unavailable" : error.message });
    }
  });
  server.on("upgrade", (request, socket, head) => {
    void handleComputerUpgrade({ request, socket, head, gateway, sessions, now });
  });
  return server;
}

export function projectMobileComputerStatus({ session, managerId, status }) {
  const target = rememberComputerTarget(session, managerId, status);
  const handoff = projectComputerHandoff(status?.handoff);
  const interactive = handoff != null;
  return {
    botId: managerId,
    state: typeof status?.state === "string" ? status.state : "unknown",
    ready: target != null,
    interactive,
    viewerUrl: target == null ? null : mobileViewerUrl(managerId, interactive),
    handoff,
    windowCount: Array.isArray(status?.windows) ? status.windows.length : target == null ? 0 : 1,
  };
}

async function proxyNoVncAsset({ request, response, url, session, managerId, assetPath, fetchImpl }) {
  const target = session.computerTargets.get(managerId);
  if (target == null) return json(response, 409, { error: "start the Belmont computer before opening its mobile viewer" });
  const upstream = target.assetUrl(assetPath, url.search);
  const headers = { Accept: request.headers.accept || "*/*" };
  for (const name of ["accept-language", "if-modified-since", "if-none-match", "range", "user-agent"]) {
    const value = request.headers[name];
    if (typeof value === "string" && !/[\r\n]/u.test(value)) headers[name] = value;
  }
  const upstreamResponse = await fetchImpl(upstream, { method: "GET", headers, redirect: "error" });
  response.statusCode = upstreamResponse.status;
  for (const name of ["content-type", "etag", "last-modified", "content-range", "accept-ranges"]) {
    const value = upstreamResponse.headers.get(name);
    if (value != null) response.setHeader(name, value);
  }
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (upstreamResponse.body == null) return response.end();
  return Readable.fromWeb(upstreamResponse.body).pipe(response);
}

async function handleComputerUpgrade({ request, socket, head, gateway, sessions, now }) {
  try {
    const url = new URL(request.url || "/", "http://belmont-adapter.invalid");
    const match = /^\/api\/bots\/([\w-]+)\/computer\/websockify$/.exec(url.pathname);
    if (request.method !== "GET" || match == null || [...url.searchParams].length > 0) {
      return writeUpgradeError(socket, 404, "no Belmont computer WebSocket route");
    }
    const session = adapterSession(request, sessions, now());
    if (session == null) return writeUpgradeError(socket, 401, "pair this mobile client again");
    const managerId = await gateway.managerId();
    if (match[1] !== managerId) return writeUpgradeError(socket, 403, "mobile computer access can only target Belmont");
    let target = session.computerTargets.get(managerId);
    if (target == null) {
      const status = await gateway.call("getForeverBoxStatus", { id: managerId });
      target = rememberComputerTarget(session, managerId, status);
    }
    if (target == null) return writeUpgradeError(socket, 409, "start the Belmont computer before opening its mobile viewer");
    proxyWebSocketUpgrade({ request, socket, head, target: target.websocketUrl });
  } catch {
    writeUpgradeError(socket, 502, "Belmont computer WebSocket unavailable");
  }
}

function rememberComputerTarget(session, managerId, status) {
  const raw = typeof status?.vncUrl === "string" ? status.vncUrl.trim() : "";
  if (!raw) {
    session.computerTargets.delete(managerId);
    return null;
  }
  const target = parseLoopbackVncTarget(raw);
  session.computerTargets.set(managerId, target);
  return target;
}

export function parseLoopbackVncTarget(value) {
  let viewer;
  try { viewer = new URL(value); } catch { throw badRequest("Belmont returned an invalid computer viewer URL"); }
  const normalizedHost = viewer.hostname.toLowerCase();
  const port = Number(viewer.port);
  if (
    viewer.protocol !== "http:"
    || !LOOPBACK_VNC_HOSTS.has(normalizedHost)
    || viewer.username !== ""
    || viewer.password !== ""
    || !Number.isInteger(port)
    || port < 1_024
    || port > 65_535
    || !viewer.pathname.endsWith("/vnc.html")
  ) throw badRequest("Belmont computer viewer is not a trusted loopback noVNC endpoint");

  const assetBasePath = viewer.pathname.slice(0, viewer.pathname.lastIndexOf("/") + 1);
  const websocketRelative = viewer.searchParams.get("path") || `${assetBasePath}websockify`;
  const websocketUrl = new URL(websocketRelative, `${viewer.origin}${assetBasePath}`);
  if (websocketUrl.origin !== viewer.origin || !safeViewerPath(websocketUrl.pathname.slice(1))) {
    throw badRequest("Belmont computer WebSocket path is invalid");
  }
  return {
    websocketUrl,
    assetUrl(assetPath, search = "") {
      if (!safeViewerPath(assetPath)) throw badRequest("invalid noVNC asset path");
      const target = new URL(viewer.origin);
      target.pathname = `${assetBasePath}${assetPath}`;
      target.search = search;
      return target;
    },
  };
}

function safeViewerPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024 || value.includes("\\") || value.includes("\0")) return false;
  try {
    return decodeURIComponent(value).split("/").every((segment) => segment !== ".." && segment !== ".");
  } catch {
    return false;
  }
}

function mobileViewerUrl(managerId, interactive) {
  const path = `api/bots/${managerId}/computer/websockify`;
  const query = new URLSearchParams({
    autoconnect: "1",
    resize: "scale",
    path,
    view_only: interactive ? "0" : "1",
  });
  return `/api/bots/${managerId}/computer/view/vnc.html?${query}`;
}

function projectComputerHandoff(value) {
  if (value == null || typeof value !== "object") return null;
  const instruction = typeof value.instruction === "string" && value.instruction.trim()
    ? value.instruction.trim().slice(0, 1_000)
    : "Belmont가 사용자 조작을 기다립니다.";
  return { instruction, snapshotAvailable: typeof value.snapshotDataUrl === "string" && value.snapshotDataUrl.length > 0 };
}

function createGatewayClient({ dataRoot, fetchImpl }) {
  const runtime = async () => {
    const [discovery, manager] = await Promise.all([
      readJson(join(dataRoot, "gateway.json")),
      readJson(join(dataRoot, "manager.json")),
    ]);
    if (!Number.isInteger(discovery.port) || discovery.port <= 0) throw new Error("Belmont gateway discovery has no usable port.");
    if (typeof manager.managerAgentId !== "string" || !manager.managerAgentId) throw new Error("Belmont manager is not designated.");
    const rawHost = typeof discovery.host === "string" ? discovery.host : "127.0.0.1";
    const host = rawHost === "0.0.0.0" || rawHost === "::" || rawHost === "[::]" ? "127.0.0.1" : rawHost;
    const scheme = discovery.scheme === "https" ? "https" : "http";
    return { discovery, manager, origin: `${scheme}://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${discovery.port}` };
  };
  const request = async (pathname, init = {}) => {
    const state = await runtime();
    const headers = { Accept: "application/json", ...(init.headers ?? {}) };
    if (typeof state.discovery.token === "string" && state.discovery.token) headers.Authorization = `Bearer ${state.discovery.token}`;
    const response = await fetchImpl(`${state.origin}${pathname}`, { ...init, headers });
    return { response, state };
  };
  return {
    runtime,
    async managerId() { return (await runtime()).manager.managerAgentId; },
    async health() {
      const { response } = await request("/health");
      if (!response.ok) throw new Error(`Belmont health failed (${response.status}).`);
      return await response.json();
    },
    async call(command, args) {
      const { response } = await request(`/api/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args ?? {}),
      });
      const payload = await parseResponse(response);
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `${command} failed (${response.status}).`);
      return payload;
    },
    async openEvents(signal) {
      const { response } = await request(`/events?channels=${encodeURIComponent(EVENT_CHANNELS)}`, {
        headers: { Accept: "text/event-stream" },
        signal,
      });
      if (!response.ok || !response.body) throw new Error(`Belmont events failed (${response.status}).`);
      return response.body;
    },
  };
}

function publicActivity(value) {
  if (value == null || typeof value !== "object") return null;
  const activity = {
    ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
    ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
    ...(typeof value.verb === "string" ? { verb: value.verb } : {}),
  };
  return Object.keys(activity).length > 0 ? activity : null;
}

export function projectBelmontAgent(agent, managerId, messages) {
  const busy = agent?.isRunning === true || agent?.isComposingMessage === true;
  const waiting = agent?.awaitingUserResponse != null;
  const activity = publicActivity(agent?.currentActivity);
  return {
    composing: agent?.isComposingMessage === true,
    ...(activity ? { activity } : {}),
    id: String(agent?.id ?? ""),
    threadId: String(agent?.id ?? ""),
    name: String(agent?.name ?? ""),
    title: String(agent?.title ?? ""),
    description: String(agent?.description ?? ""),
    color: typeof agent?.avatarColor === "string" ? agent.avatarColor : "neutral",
    ...(typeof agent?.avatarShape === "string" && agent.avatarShape ? { shape: agent.avatarShape } : {}),
    unread: agent?.hasUnread === true,
    busy,
    chiefOfStaff: agent?.id === managerId,
    hidden: agent?.isHiddenFromSidebar === true,
    pinned: false,
    ...(waiting ? { taskStatus: "승인 대기" } : busy ? { taskStatus: "진행 중" } : {}),
    ...(Array.isArray(messages) ? { messages } : {}),
  };
}

export function projectBelmontTranscriptPage(page, { agentId, registerAction = () => ({ requestId: "unavailable" }), includeAgentTraffic = false } = {}) {
  const entries = Array.isArray(page?.entries) ? page.entries : [];
  const messages = entries.flatMap((entry, index) => {
    const projected = projectBelmontEntry(entry, { agentId, registerAction, index, includeAgentTraffic });
    return projected == null ? [] : [projected];
  });
  const next = Number.isInteger(page?.nextBeforeSeq) && page.nextBeforeSeq >= 0 ? page.nextBeforeSeq : null;
  return { messages, hasMore: next != null, ...(next == null ? {} : { before: String(next) }) };
}

function projectBelmontEntry(entry, { agentId, registerAction, index, includeAgentTraffic = false }) {
  if (!entry || typeof entry !== "object" || entry.hidden === true) return null;
  // In the manager view, agent-to-agent traffic is internal machinery and stays
  // hidden. In a worker's read-only view it IS the conversation: instructions
  // arriving from the manager keep their user role (right side), the worker's
  // replies their assistant role (left side).
  if ((entry.fromAgent != null || entry.toAgent != null) && !includeAgentTraffic) return null;
  const id = typeof entry.id === "string" ? entry.id : `entry-${index}`;
  const at = finiteNumber(entry.timestampMs, Date.now());
  if (entry.kind === "event") return null;
  if (entry.kind === "tool-call") {
    const status = String(entry.status ?? "pending");
    return {
      id,
      role: "bot",
      kind: "activity",
      at,
      tool: {
        name: String(entry.name ?? entry.toolName ?? "작업"),
        ok: ["done", "success"].includes(status) ? true : ["failed", "error", "aborted", "cancelled"].includes(status) ? false : null,
        spoken: typeof entry.summary === "string" ? entry.summary : statusLabel(status),
      },
    };
  }
  if (entry.kind === "thinking") {
    const text = textContent(entry);
    return text ? { id, role: "bot", kind: "activity", at, tool: { name: "생각 중", ok: null, spoken: text } } : null;
  }
  if (entry.kind === "notice") {
    const text = textContent(entry);
    return text ? { id, role: "bot", kind: "text", at, text } : null;
  }
  if (entry.kind === "send-message" && entry.message && typeof entry.message === "object") {
    const message = entry.message;
    if (message.type === "text") {
      const text = textContent(message);
      return text ? { id, role: "bot", kind: "text", at, text } : null;
    }
    if (message.type === "widget" && message.widget && typeof message.widget === "object") {
      const options = Array.isArray(message.widget.options) ? message.widget.options.filter((option) => option && typeof option.label === "string") : [];
      const action = {
        kind: "widget",
        agentId,
        entryId: id,
        values: Object.fromEntries(options.map((option) => [option.label, typeof option.value === "string" ? option.value : option.label])),
      };
      const ids = registerAction(action);
      return optionCard({
        id,
        at,
        requestId: ids.requestId,
        title: String(message.widget.prompt || "선택 필요"),
        subtitle: String(message.widget.helpText || "Belmont가 답을 기다립니다."),
        options: options.map((option) => option.label),
        answered: typeof entry.respondedValue === "string" ? entry.respondedValue : null,
        dismissed: entry.widgetDismissed === true || entry.widgetSkipped === true,
      });
    }
    if (message.type === "auto-review-approval" && message.approval && typeof message.approval === "object") {
      const approval = message.approval;
      const action = { kind: "auto-review", agentId, entryId: id, requestId: String(approval.requestId || "") };
      const ids = registerAction(action);
      return optionCard({
        id,
        at,
        requestId: ids.requestId,
        title: String(approval.summary || "작업 승인 필요"),
        subtitle: String(approval.reason || approval.surface || "이 작업을 진행할까요?"),
        options: ["Allow", "Deny"],
        tool: String(approval.surface || "Belmont"),
        answered: approval.status && approval.status !== "pending" ? String(approval.status) : null,
      });
    }
    if (message.type === "local-tool-permission" && message.ask && typeof message.ask === "object") {
      const ask = message.ask;
      const action = { kind: "local-tool", agentId, entryId: id, requestId: String(ask.requestId || "") };
      const ids = registerAction(action);
      return optionCard({
        id,
        at,
        requestId: ids.requestId,
        title: "로컬 도구 실행",
        subtitle: `Belmont가 컴퓨터에서 ${summarize(ask.action, "작업")}을(를) 실행하려 합니다.`,
        code: typeof ask.target === "string" && ask.target.trim() ? ask.target.trim().slice(0, 2_000) : null,
        options: ["Allow", "Deny"],
        tool: "LocalTool",
        allowKey: ids.allowKey,
        answered: ask.status && ask.status !== "pending" ? String(ask.status) : null,
      });
    }
    if (message.type === "permission-request") {
      const title = typeof message.permission?.title === "string" ? message.permission.title : "데스크톱 승인이 필요합니다.";
      return { id, role: "bot", kind: "text", at, text: title };
    }
    return fallbackCardMessage(id, at, message);
  }
  const text = textContent(entry);
  if (!text) return null;
  return { id, role: entry.role === "assistant" ? "bot" : "user", kind: "text", at, text };
}

function fallbackCardMessage(id, at, message) {
  if (message.type === "secret-request") return { id, role: "bot", kind: "text", at, text: `데스크톱에서 비밀정보 입력이 필요합니다: ${String(message.secretRequest?.label || "보안 입력")}` };
  if (message.type === "email-draft") return { id, role: "bot", kind: "text", at, text: `이메일 초안: ${String(message.draft?.subject || "제목 없음")}` };
  if (message.type === "slack-draft") return { id, role: "bot", kind: "text", at, text: `Slack 초안: ${String(message.draft?.target || "대상 없음")}` };
  if (message.type === "attachment") return { id, role: "bot", kind: "text", at, text: `첨부파일: ${String(message.fileName || message.alt || "파일")}` };
  if (message.type === "listener-connect") return { id, role: "bot", kind: "text", at, text: `${String(message.platform || "서비스")} 연결은 데스크톱에서 완료해야 합니다.` };
  if (message.type === "connector" || message.type === "connectors") return { id, role: "bot", kind: "text", at, text: "커넥터 연결은 데스크톱에서 완료해야 합니다." };
  if (message.type === "cursor-agent") return { id, role: "bot", kind: "activity", at, tool: { name: String(message.title || "에이전트"), ok: null, spoken: "에이전트 작업" } };
  return null;
}

function optionCard({ id, at, requestId, title, subtitle, code, options, tool, allowKey, answered, dismissed = false }) {
  return {
    id,
    role: "bot",
    kind: "options",
    at,
    card: {
      title,
      subtitle,
      options,
      requestId,
      ...(code ? { code } : {}),
      ...(tool ? { tool } : {}),
      ...(allowKey ? { allowKey } : {}),
      ...(answered ? { answered } : {}),
      ...(dismissed ? { dismissed: true } : {}),
    },
  };
}

function registerAction(session, action) {
  const fingerprint = `${action.kind}|${action.agentId}|${action.entryId}|${action.requestId ?? ""}`;
  const digest = createHash("sha256").update(session.token).update("|").update(fingerprint).digest("base64url").slice(0, 30);
  const requestId = `mobile-${digest}`;
  session.actions.set(requestId, action);
  let allowKey;
  if (action.kind === "local-tool") {
    allowKey = `allow-${digest}`;
    session.allowKeys.set(allowKey, requestId);
  }
  trimMap(session.actions, ACTION_LIMIT);
  trimMap(session.allowKeys, ACTION_LIMIT);
  return { requestId, ...(allowKey ? { allowKey } : {}) };
}

async function resolveMobileAction({ gateway, session, publicRequestId, action, payload }) {
  if (action.kind === "widget") {
    if (payload.behavior !== "answer" || typeof payload.message !== "string") throw badRequest("widget answers require a selected value");
    const value = action.values[payload.message] ?? payload.message;
    return await gateway.call("respondToWidget", { entryId: action.entryId, value, agentId: action.agentId });
  }
  if (action.kind === "auto-review") {
    if (!action.requestId) throw badRequest("approval request has no Belmont request id");
    const resolution = payload.behavior === "deny" ? "denied" : payload.behavior === "allow" ? "approved" : null;
    if (resolution == null) throw badRequest("invalid auto-review response");
    return await gateway.call("resolveAutoReviewApproval", { entryId: action.entryId, requestId: action.requestId, resolution, agentId: action.agentId });
  }
  if (action.kind === "local-tool") {
    if (!action.requestId) throw badRequest("permission request has no Belmont request id");
    const resolution = payload.behavior === "deny" ? "deny" : payload.behavior === "allow"
      ? session.remembered.delete(publicRequestId) ? "always" : "allow-once"
      : null;
    if (resolution == null) throw badRequest("invalid local-tool response");
    return await gateway.call("resolveLocalToolPermission", { entryId: action.entryId, requestId: action.requestId, resolution, agentId: action.agentId });
  }
  throw badRequest("unsupported mobile action");
}

async function streamBelmontEvents({ request, response, url, gateway, session, managerId }) {
  const since = url.searchParams.get("since");
  if (since != null && !session.eventCursors.includes(since)) return json(response, 409, { error: "event cursor expired; reload state" });
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  const currentCursor = session.eventCursors.at(-1) ?? "belmont-0";
  response.write(`id: ${currentCursor}\nevent: hello\ndata: ${JSON.stringify({ kind: "hello", cursor: currentCursor, resumed: since != null })}\n\n`);
  const controller = new AbortController();
  response.on("close", () => controller.abort());
  const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(":ping\n\n"); }, 15_000);
  try {
    const stream = await gateway.openEvents(controller.signal);
    for await (const frame of parseSseData(stream)) {
      const event = projectBelmontEvent(frame, managerId);
      if (event == null || response.writableEnded) continue;
      const cursor = rememberEventCursor(session);
      response.write(`id: ${cursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    if (!controller.signal.aborted && !response.writableEnded) response.write(`event: thread\ndata: ${JSON.stringify({ kind: "thread", threadId: managerId })}\n\n`);
  } finally {
    clearInterval(heartbeat);
    if (!response.writableEnded) response.end();
  }
}

export function projectBelmontEvent(frame, managerId) {
  if (!frame || typeof frame !== "object") return null;
  const channel = frame.channel;
  const payload = frame.payload;
  if (channel === "transcript") {
    const owner = payload?.agentId ?? payload?.activeAgentId;
    return owner === managerId ? { kind: "message", threadId: managerId } : null;
  }
  if (["agents", "agent-upserted", "subagents", "async-tasks", "forever-box"].includes(channel)) {
    return { kind: "thread", threadId: managerId };
  }
  return null;
}

async function* parseSseData(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try { yield JSON.parse(data); } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function createAdapterSession(token, timestamp) {
  return {
    token,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    actions: new Map(),
    allowKeys: new Map(),
    remembered: new Set(),
    computerTargets: new Map(),
    eventSequence: 0,
    eventCursors: ["belmont-0"],
  };
}

function adapterSession(request, sessions, timestamp) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const session = sessions.get(token);
  if (session) session.lastSeenAt = timestamp;
  return session ?? null;
}

function rememberEventCursor(session) {
  const cursor = `belmont-${++session.eventSequence}`;
  session.eventCursors.push(cursor);
  if (session.eventCursors.length > EVENT_CURSOR_LIMIT) session.eventCursors.splice(0, session.eventCursors.length - EVENT_CURSOR_LIMIT);
  return cursor;
}

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, "utf8"));
}

async function readJsonBody(request) {
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw badRequest("application/json is required");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw badRequest("invalid JSON object"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw badRequest("invalid JSON object");
  return payload;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function pageSize(raw, fallback) {
  if (raw == null) return fallback;
  if (!/^\d{1,3}$/.test(raw)) throw badRequest("invalid page size");
  const value = Number(raw);
  if (value < 1 || value > 100) throw badRequest("invalid page size");
  return value;
}

function beforeSequence(raw) {
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) throw badRequest("invalid transcript cursor");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw badRequest("invalid transcript cursor");
  return value;
}

function textContent(value) {
  if (typeof value?.content === "string") return value.content.trim();
  if (typeof value?.text === "string") return value.text.trim();
  if (typeof value?.message?.content === "string") return value.message.content.trim();
  return "";
}

function statusLabel(status) {
  if (["done", "success"].includes(status)) return "완료";
  if (["failed", "error"].includes(status)) return "실패";
  if (["aborted", "cancelled"].includes(status)) return "중단됨";
  return "진행 중";
}

function summarize(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  if (value && typeof value === "object") {
    try { return JSON.stringify(value).slice(0, 240); } catch {}
  }
  return fallback;
}

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function trimMap(map, limit) {
  while (map.size > limit) map.delete(map.keys().next().value);
}

function secretEquals(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function badRequest(message) {
  const error = new Error(message);
  error.code = "BAD_REQUEST";
  return error;
}

function json(response, status, payload) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}
