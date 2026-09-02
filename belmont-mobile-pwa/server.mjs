import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { proxyWebSocketUpgrade, writeUpgradeError } from "./websocket-tunnel.mjs";
import { loadSessions, saveSessions } from "./session-store.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = "belmont_mobile_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_LIMIT = 64;
const MAX_BODY_BYTES = 1_048_576;
const PAIR_BACKOFF_BASE_MS = 1_000;
const PAIR_BACKOFF_MAX_MS = 60_000;

const ALLOWED_API_ROUTES = [
  ["GET", /^\/api\/(?:health|events)$/],
  ["GET", /^\/api\/bots$/],
  ["POST", /^\/api\/bots\/[\w-]+\/(?:messages|always-allow|attachments)$/],
  ["GET", /^\/api\/bots\/[\w-]+\/computer$/],
  ["POST", /^\/api\/bots\/[\w-]+\/computer\/(?:ensure|hand-back)$/],
  ["GET", /^\/api\/bots\/[\w-]+\/computer\/view\/.+$/],
  ["GET", /^\/api\/bots\/[\w-]+\/computer\/websockify$/],
  ["GET", /^\/api\/bots\/[\w-]+\/computer\/screen$/],
  ["GET", /^\/api\/threads\/[\w-]+\/messages$/],
  ["GET", /^\/api\/threads\/[\w-]+\/attachments\/[\w-]+$/],
  ["GET", /^\/api\/bots\/[\w-]+\/files(?:\/read)?$/],
  ["POST", /^\/api\/threads\/[\w-]+\/respond$/]
];

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"]
]);

export function isAllowedMobileRoute(method, pathname) {
  return ALLOWED_API_ROUTES.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(pathname));
}

export function createMobileServer({ upstream, root = ROOT, fetchImpl = fetch, now = () => Date.now(), trustProxy = false, persistPath = null }) {
  const upstreamOrigin = normalizedOrigin(upstream);
  const staticRoot = resolve(root);
  const sessions = new Map();
  if (persistPath) {
    for (const [id, stored] of Object.entries(loadSessions(persistPath) ?? {})) {
      if (!/^[\w-]{16,}$/.test(id) || typeof stored?.token !== "string" || !stored.token) continue;
      sessions.set(id, {
        token: stored.token,
        createdAt: Number(stored.createdAt) || now(),
        lastSeenAt: Number(stored.lastSeenAt) || now(),
        tokenHash: createHash("sha256").update(stored.token).digest("hex"),
        clientCursorByUpstream: new Map(),
        upstreamCursorByClient: new Map()
      });
    }
    expireSessions(sessions, now());
  }
  const persistSessions = () => {
    if (!persistPath) return;
    saveSessions(persistPath, Object.fromEntries([...sessions].map(([id, session]) => [
      id,
      { token: session.token, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt }
    ])));
  };
  // A six-digit pairing code has only a million values, so the gateway is the
  // one place that must make guessing slow. Failures double a global wait
  // (this is a single-user surface; griefing your own gateway only delays pairing).
  const pairGuard = { failures: 0, nextAllowedAt: 0 };

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://mobile.invalid");
      expireSessions(sessions, now());

      if (requestUrl.pathname === "/api/mobile/session" && request.method === "DELETE") {
        if (!sameOriginRequest(request, trustProxy)) return json(response, 403, { error: "cross-origin request refused" });
        const sessionId = cookieValue(request, SESSION_COOKIE);
        if (sessionId) sessions.delete(sessionId);
        persistSessions();
        response.setHeader("Set-Cookie", clearSessionCookie(request, trustProxy));
        return json(response, 200, { ok: true });
      }

      if (requestUrl.pathname === "/api/pair" && request.method === "POST") {
        if ([...requestUrl.searchParams].length > 0) return json(response, 400, { error: "pairing does not accept query parameters" });
        if (!sameOriginRequest(request, trustProxy)) return json(response, 403, { error: "cross-origin request refused" });
        const pairRequest = parseJsonBody(request, await readBody(request));
        if (pairRequest.error) return json(response, pairRequest.status, { error: pairRequest.error });
        const pairBody = publicPairRequest(pairRequest.payload);
        if (pairBody.error) return json(response, 400, { error: pairBody.error });
        if (now() < pairGuard.nextAllowedAt) {
          const waitSeconds = Math.ceil((pairGuard.nextAllowedAt - now()) / 1_000);
          return json(response, 429, { error: `too many pairing attempts; wait ${waitSeconds}s` });
        }
        const upstreamResponse = await fetchImpl(`${upstreamOrigin}/api/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(pairBody.payload))
        });
        const text = await upstreamResponse.text();
        const payload = parseJson(text);
        if (!upstreamResponse.ok) {
          if (upstreamResponse.status >= 400 && upstreamResponse.status < 500) {
            pairGuard.failures += 1;
            pairGuard.nextAllowedAt = now() + Math.min(PAIR_BACKOFF_BASE_MS * 2 ** (pairGuard.failures - 1), PAIR_BACKOFF_MAX_MS);
          }
          return json(response, upstreamResponse.status, publicError(payload));
        }
        pairGuard.failures = 0;
        pairGuard.nextAllowedAt = 0;
        if (!payload?.token || typeof payload.token !== "string") {
          return json(response, 502, { error: "upstream did not return a device token" });
        }
        if (sessions.size >= SESSION_LIMIT) evictOldestSession(sessions);
        const sessionId = randomBytes(32).toString("base64url");
        sessions.set(sessionId, {
          token: payload.token,
          createdAt: now(),
          lastSeenAt: now(),
          tokenHash: createHash("sha256").update(payload.token).digest("hex"),
          clientCursorByUpstream: new Map(),
          upstreamCursorByClient: new Map()
        });
        persistSessions();
        response.setHeader("Set-Cookie", sessionCookie(sessionId, request, trustProxy));
        const serverName = typeof payload.serverName === "string" ? payload.serverName : "Belmont computer";
        const device = payload.device && typeof payload.device === "object"
          ? { id: String(payload.device.id || ""), name: String(payload.device.name || "") }
          : null;
        return json(response, 200, { serverName, ...(device ? { device } : {}), session: true });
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        if (!isAllowedMobileRoute(request.method || "GET", requestUrl.pathname)) {
          return json(response, 404, { error: `no mobile route: ${request.method} ${requestUrl.pathname}` });
        }
        if (request.method !== "GET" && !sameOriginRequest(request, trustProxy)) {
          return json(response, 403, { error: "cross-origin request refused" });
        }
        const isHealth = requestUrl.pathname === "/api/health";
        const session = isHealth ? null : authenticatedSession(request, sessions, now());
        if (!isHealth && !session) return json(response, 401, { error: "pair this browser again" });
        const method = request.method || "GET";
        const bodyLimit = /\/attachments$/.test(requestUrl.pathname) ? 24 * 1024 * 1024 : MAX_BODY_BYTES;
        const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request, bodyLimit);
        const boundaryError = session ? managerBoundaryError(method, requestUrl.pathname, session) : null;
        if (boundaryError) return json(response, boundaryError.status, { error: boundaryError.message });
        const prepared = prepareMobileRequest({ request, method, pathname: requestUrl.pathname, searchParams: requestUrl.searchParams, body, session });
        if (prepared.error) return json(response, prepared.status, { error: prepared.error });
        return proxyApi({
          request,
          response,
          pathname: requestUrl.pathname,
          search: prepared.search,
          upstreamOrigin,
          session,
          fetchImpl,
          body: prepared.body
        });
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return json(response, 405, { error: "method not allowed" });
      }
      return serveStatic(response, requestUrl.pathname, staticRoot, request.method === "HEAD");
    } catch (error) {
      const status = error?.code === "BODY_TOO_LARGE" ? 413 : 502;
      return json(response, status, { error: status === 413 ? "request body too large" : "mobile gateway unavailable" });
    }
  });
  server.on("upgrade", (request, socket, head) => {
    void handleMobileUpgrade({ request, socket, head, upstreamOrigin, sessions, now, trustProxy });
  });
  return server;
}

async function handleMobileUpgrade({ request, socket, head, upstreamOrigin, sessions, now, trustProxy }) {
  try {
    const requestUrl = new URL(request.url || "/", "http://mobile.invalid");
    const match = /^\/api\/bots\/([\w-]+)\/computer\/(?:websockify|screen)$/.exec(requestUrl.pathname);
    if (request.method !== "GET" || match == null || [...requestUrl.searchParams].length > 0) {
      return writeUpgradeError(socket, 404, "no mobile WebSocket route");
    }
    if (!sameOriginRequest(request, trustProxy)) return writeUpgradeError(socket, 403, "cross-origin WebSocket refused");
    expireSessions(sessions, now());
    const session = authenticatedSession(request, sessions, now());
    if (session == null) return writeUpgradeError(socket, 401, "pair this browser again");
    if (!session.managerBotId) return writeUpgradeError(socket, 409, "load the Belmont roster before opening the computer");
    if (match[1] !== session.managerBotId) return writeUpgradeError(socket, 403, "worker computers are not available on mobile");
    const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);
    proxyWebSocketUpgrade({
      request,
      socket,
      head,
      target,
      extraHeaders: { Authorization: `Bearer ${session.token}` },
    });
  } catch {
    writeUpgradeError(socket, 502, "mobile WebSocket gateway unavailable");
  }
}

async function proxyApi({ request, response, pathname, search, upstreamOrigin, session, fetchImpl, body }) {
  const headers = { Accept: request.headers.accept || "application/json" };
  if (request.headers["content-type"]) headers["Content-Type"] = request.headers["content-type"];
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const method = request.method || "GET";
  const upstreamResponse = await fetchImpl(`${upstreamOrigin}${pathname}${search}`, { method, headers, body });
  response.statusCode = upstreamResponse.status;
  response.setHeader("Cache-Control", "no-store");
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) response.setHeader("Content-Type", contentType);
  if (method === "GET" && /^\/api\/(?:threads\/[\w-]+\/attachments\/[\w-]+|bots\/[\w-]+\/files\/read)$/.test(pathname)) {
    // Attachment bytes carry their own caching, disposition and sandbox policy.
    for (const name of ["content-length", "content-disposition", "content-security-policy", "x-content-type-options", "cache-control"]) {
      const value = upstreamResponse.headers.get(name);
      if (value) response.setHeader(name, value);
    }
  }
  if (method === "GET" && pathname === "/api/bots" && upstreamResponse.body) {
    const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
    const payload = parseJson(bytes.toString("utf8"));
    if (upstreamResponse.ok && session) updateManagerScope(session, payload);
    const publicPayload = upstreamResponse.ok && session ? sanitizeRoster(payload, session) : payload;
    return response.end(publicPayload ? JSON.stringify(publicPayload) : bytes);
  }
  if (method === "GET" && pathname === "/api/events" && upstreamResponse.body && session) {
    return Readable.from(filteredEventChunks(upstreamResponse.body, session)).pipe(response);
  }
  if (!upstreamResponse.body) return response.end();
  return Readable.fromWeb(upstreamResponse.body).pipe(response);
}

function managerBoundaryError(method, pathname, session) {
  const botRoute = /^\/api\/bots\/([\w-]+)\/(?:messages|always-allow|attachments|files(?:\/read)?|computer(?:\/(?:ensure|hand-back|websockify|screen|view\/.+))?)$/.exec(pathname);
  const threadRoute = /^\/api\/threads\/([\w-]+)\/(messages|respond|attachments\/[\w-]+)$/.exec(pathname);
  const eventRoute = method === "GET" && pathname === "/api/events";
  if (!botRoute && !threadRoute && !eventRoute) return null;
  if (!session.managerBotId) {
    return { status: 409, message: "load the Belmont roster before using a conversation route" };
  }
  if (botRoute && botRoute[1] !== session.managerBotId) {
    return { status: 403, message: "worker bots are read-only on the mobile gateway" };
  }
  if (threadRoute) {
    // Reading is open to every bot on the roster; acting (respond) stays Belmont-only.
    const readable = session.managerThreadIds?.has(threadRoute[1])
      || ((threadRoute[2] === "messages" || threadRoute[2].startsWith("attachments/")) && session.readableThreadIds?.has(threadRoute[1]));
    if (!readable) return { status: 403, message: "only Belmont conversation threads accept actions" };
  }
  return null;
}

function updateManagerScope(session, payload) {
  const bots = Array.isArray(payload?.bots) ? payload.bots.filter((bot) => bot && bot.hidden !== true) : [];
  const manager = bots.find((bot) => bot.chiefOfStaff === true)
    ?? bots.find((bot) => String(bot.name || "").trim().toLowerCase() === "belmont")
    ?? null;
  session.managerBotId = typeof manager?.id === "string" ? manager.id : null;
  session.managerThreadIds = new Set();
  session.readableThreadIds = new Set();
  for (const bot of bots) {
    if (typeof bot.id === "string") session.readableThreadIds.add(bot.id);
    if (typeof bot.threadId === "string") session.readableThreadIds.add(bot.threadId);
  }
  if (!manager) return;
  session.managerThreadIds.add(typeof manager.threadId === "string" ? manager.threadId : manager.id);
}

function sanitizeRoster(payload, session) {
  if (!payload || !Array.isArray(payload.bots)) return payload;
  return {
    groups: [],
    bots: payload.bots.filter((bot) => bot && typeof bot.id === "string").map((bot) => publicBot(bot, bot.id === session.managerBotId))
  };
}

function publicBot(bot, includeMessages) {
  return {
    id: String(bot.id || ""),
    threadId: typeof bot.threadId === "string" ? bot.threadId : String(bot.id || ""),
    name: String(bot.name || ""),
    title: String(bot.title || ""),
    description: String(bot.description || ""),
    color: String(bot.color || "neutral"),
    ...(typeof bot.shape === "string" && bot.shape ? { shape: bot.shape } : {}),
    unread: Boolean(bot.unread),
    busy: Boolean(bot.busy),
    composing: Boolean(bot.composing),
    ...(bot.activity && typeof bot.activity === "object" ? { activity: {
      ...(typeof bot.activity.kind === "string" ? { kind: bot.activity.kind } : {}),
      ...(typeof bot.activity.tool === "string" ? { tool: bot.activity.tool } : {}),
      ...(typeof bot.activity.verb === "string" ? { verb: bot.activity.verb } : {})
    } } : {}),
    chiefOfStaff: Boolean(bot.chiefOfStaff),
    hidden: Boolean(bot.hidden),
    pinned: Boolean(bot.pinned),
    ...(typeof bot.taskSummary === "string" ? { taskSummary: bot.taskSummary } : {}),
    ...(typeof bot.taskStatus === "string" ? { taskStatus: bot.taskStatus } : {}),
    ...(includeMessages && Array.isArray(bot.messages) ? { messages: bot.messages } : {})
  };
}

async function* filteredEventChunks(webStream, session) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of Readable.fromWeb(webStream)) {
    pending += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = nextEventBoundary(pending))) {
      const frame = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary.length);
      const filtered = filterEventFrame(frame, session);
      if (filtered !== null) yield `${filtered}\n\n`;
    }
  }
  pending += decoder.decode();
  if (pending.trim()) {
    const filtered = filterEventFrame(pending, session);
    if (filtered !== null) yield `${filtered}\n\n`;
  }
}

function nextEventBoundary(value) {
  const match = /\r?\n\r?\n/.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function filterEventFrame(frame, session) {
  const lines = frame.split(/\r?\n/);
  const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!data) return ": keepalive";
  const payload = parseJson(data);
  if (!payload || typeof payload !== "object") return null;
  const upstreamId = lines.find((line) => line.startsWith("id:"))?.slice(3).trim();
  const upstreamCursor = isSafeCursor(upstreamId)
    ? upstreamId
    : payload.kind === "hello" && isSafeCursor(payload.cursor)
      ? payload.cursor
      : null;
  let clientCursor = null;
  let publicPayload;
  if (payload.kind === "hello") {
    if (!upstreamCursor) return null;
    clientCursor = rememberEventCursor(session, upstreamCursor);
    publicPayload = publicEvent(payload, session, clientCursor);
  } else {
    publicPayload = publicEvent(payload, session, null);
    if (publicPayload && upstreamCursor) {
      clientCursor = rememberEventCursor(session, upstreamCursor);
    }
  }
  if (!publicPayload) return null;
  return [
    ...(clientCursor ? [`id: ${clientCursor}`] : []),
    `event: ${publicPayload.kind}`,
    `data: ${JSON.stringify(publicPayload)}`
  ].join("\n");
}

function publicEvent(payload, session, clientCursor) {
  const seq = Number.isInteger(payload.seq) ? payload.seq : undefined;
  const withSeq = (value) => seq === undefined ? value : { ...value, seq };
  switch (payload.kind) {
    case "hello":
      if (!clientCursor) return null;
      return withSeq({ kind: "hello", cursor: clientCursor, resumed: Boolean(payload.resumed) });
    case "message":
    case "message.patch":
    case "thread":
      if (!session.managerThreadIds?.has(payload.threadId)) return null;
      return withSeq({ kind: payload.kind, threadId: payload.threadId });
    case "runtime":
      if (!session.managerThreadIds?.has(payload.event?.threadId)) return null;
      return withSeq({ kind: "runtime", event: { type: String(payload.event.type || ""), threadId: payload.event.threadId } });
    case "notify":
      if (!session.managerThreadIds?.has(payload.notification?.threadId)) return null;
      return withSeq({ kind: "notify", notification: {
        kind: String(payload.notification.kind || ""),
        botId: session.managerBotId,
        botName: String(payload.notification.botName || "Belmont"),
        threadId: payload.notification.threadId,
        title: String(payload.notification.title || ""),
        body: String(payload.notification.body || "")
      } });
    case "bot":
      if (!payload.bot || typeof payload.bot.id !== "string") return null;
      return withSeq({ kind: "bot", bot: publicBot(payload.bot, false) });
    case "bot.deleted":
      if (typeof payload.botId !== "string") return null;
      return withSeq({ kind: "bot.deleted", botId: payload.botId });
    case "computer":
      if (payload.botId !== session.managerBotId) return null;
      return withSeq({ kind: "computer", botId: session.managerBotId, state: String(payload.state || "") });
    default:
      return null;
  }
}

function prepareMobileRequest({ request, method, pathname, searchParams, body, session }) {
  const query = publicQuery(pathname, searchParams, session);
  if (query.error) return query;
  if (method === "GET" || method === "HEAD") return { search: query.search, body: undefined };

  const parsed = parseJsonBody(request, body);
  if (parsed.error) return parsed;
  const payload = parsed.payload;
  const managerThreadId = session?.managerThreadIds?.values().next().value;

  if (/^\/api\/bots\/[\w-]+\/messages$/.test(pathname)) {
    if (!hasOnlyKeys(payload, ["text", "threadId", "sendId", "attachments"])) return invalidBody("unsupported message field");
    const attachments = payload.attachments === undefined ? [] : payload.attachments;
    if (!Array.isArray(attachments) || attachments.length > 4 || !attachments.every(isSafeIdentifier)) return invalidBody("invalid attachments");
    if (typeof payload.text !== "string" || (!payload.text.trim() && attachments.length === 0) || payload.text.length > 12_000) return invalidBody("invalid message text");
    if (payload.threadId !== undefined && payload.threadId !== managerThreadId) return { status: 403, error: "message thread does not belong to Belmont" };
    if (payload.sendId !== undefined && !isSafeIdentifier(payload.sendId)) return invalidBody("invalid send identifier");
    return encodedBody(query.search, {
      text: payload.text,
      threadId: managerThreadId,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(payload.sendId ? { sendId: payload.sendId } : {})
    });
  }

  if (/^\/api\/bots\/[\w-]+\/attachments$/.test(pathname)) {
    if (!hasOnlyKeys(payload, ["name", "dataBase64"])) return invalidBody("unsupported attachment field");
    if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 180) return invalidBody("invalid attachment name");
    if (typeof payload.dataBase64 !== "string" || payload.dataBase64.length === 0 || payload.dataBase64.length > 24_000_000 || !/^[A-Za-z0-9+/=]+$/.test(payload.dataBase64)) {
      return invalidBody("invalid attachment data");
    }
    return encodedBody(query.search, { name: payload.name, dataBase64: payload.dataBase64 });
  }

  if (/^\/api\/bots\/[\w-]+\/always-allow$/.test(pathname)) {
    if (!hasOnlyKeys(payload, ["allowKey"]) || typeof payload.allowKey !== "string" || !payload.allowKey.trim() || payload.allowKey.length > 512) {
      return invalidBody("invalid always-allow key");
    }
    return encodedBody(query.search, { allowKey: payload.allowKey });
  }

  if (/^\/api\/bots\/[\w-]+\/computer\/ensure$/.test(pathname)) {
    if (!hasOnlyKeys(payload, [])) return invalidBody("computer ensure body must be empty");
    return encodedBody(query.search, {});
  }

  if (/^\/api\/bots\/[\w-]+\/computer\/hand-back$/.test(pathname)) {
    if (!hasOnlyKeys(payload, ["resolution"])) return invalidBody("unsupported computer hand-back field");
    const resolution = payload.resolution ?? "completed";
    if (!["completed", "cancelled"].includes(resolution)) return invalidBody("invalid computer hand-back resolution");
    return encodedBody(query.search, { resolution });
  }

  if (/^\/api\/threads\/[\w-]+\/respond$/.test(pathname)) {
    if (!hasOnlyKeys(payload, ["requestId", "behavior", "message", "reviewedSha256"])) return invalidBody("unsupported response field");
    if (!isSafeIdentifier(payload.requestId) || !["allow", "deny", "answer"].includes(payload.behavior)) return invalidBody("invalid approval response");
    if (payload.behavior === "answer" && (typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 12_000)) {
      return invalidBody("answer text is required");
    }
    if (payload.reviewedSha256 !== undefined && !/^[a-f\d]{64}$/i.test(payload.reviewedSha256)) return invalidBody("invalid reviewed digest");
    return encodedBody(query.search, {
      requestId: payload.requestId,
      behavior: payload.behavior,
      ...(payload.behavior === "answer" ? { message: payload.message } : {}),
      ...(payload.behavior === "allow" && payload.reviewedSha256 ? { reviewedSha256: payload.reviewedSha256 } : {})
    });
  }

  return invalidBody("unsupported mobile mutation");
}

function publicQuery(pathname, searchParams, session) {
  const viewerMatch = /^\/api\/bots\/([\w-]+)\/computer\/view\/vnc\.html$/.exec(pathname);
  if (viewerMatch != null) return publicViewerQuery(viewerMatch[1], searchParams);
  const allowed = pathname === "/api/bots"
    ? new Set(["messages"])
    : pathname === "/api/events"
      ? new Set(["since", "screens"])
      : /^\/api\/threads\/[\w-]+\/messages$/.test(pathname)
        ? new Set(["before", "around", "limit"])
        : /^\/api\/threads\/[\w-]+\/attachments\/[\w-]+$/.test(pathname)
          ? new Set(["download"])
          : /^\/api\/bots\/[\w-]+\/files$/.test(pathname)
            ? new Set(["path"])
            : /^\/api\/bots\/[\w-]+\/files\/read$/.test(pathname)
              ? new Set(["path", "download"])
              : new Set();
  for (const key of new Set(searchParams.keys())) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) return { status: 400, error: "unsupported or repeated query parameter" };
  }
  const clean = new URLSearchParams();
  for (const key of allowed) {
    const value = searchParams.get(key);
    if (value === null) continue;
    if (key === "messages" || key === "limit") {
      if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100) return { status: 400, error: "invalid page size" };
      clean.set(key, String(Number(value)));
    } else if (key === "screens") {
      if (value !== "off") return { status: 400, error: "mobile screen events are disabled" };
      clean.set("screens", "off");
    } else if (key === "path") {
      // A workspace-relative path: the adapter resolves it inside the workspace root; here only sanity.
      if (value.length > 1_024 || /[\0-\x1f\x7f]/u.test(value)) return { status: 400, error: "invalid path" };
      clean.set("path", value);
    } else if (key === "download") {
      if (value !== "1") return { status: 400, error: "invalid download flag" };
      clean.set("download", "1");
    } else {
      if (!isSafeCursor(value)) return { status: 400, error: "invalid cursor" };
      if (key === "since") {
        const upstreamCursor = session?.upstreamCursorByClient?.get(value);
        if (!upstreamCursor) return { status: 409, error: "event cursor expired; reload the Belmont roster" };
        clean.set(key, upstreamCursor);
      } else clean.set(key, value);
    }
  }
  if (pathname === "/api/events" && !clean.has("screens")) clean.set("screens", "off");
  const encoded = clean.toString();
  return { search: encoded ? `?${encoded}` : "" };
}

function publicViewerQuery(botId, searchParams) {
  const allowed = new Set(["autoconnect", "resize", "path", "view_only"]);
  for (const key of new Set(searchParams.keys())) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) return { status: 400, error: "unsupported or repeated viewer query parameter" };
  }
  const expectedPath = `api/bots/${botId}/computer/websockify`;
  const values = {
    autoconnect: searchParams.get("autoconnect") ?? "1",
    resize: searchParams.get("resize") ?? "scale",
    path: searchParams.get("path") ?? expectedPath,
    view_only: searchParams.get("view_only") ?? "1",
  };
  if (values.autoconnect !== "1" || values.resize !== "scale" || values.path !== expectedPath || !["0", "1"].includes(values.view_only)) {
    return { status: 400, error: "invalid computer viewer query" };
  }
  return { search: `?${new URLSearchParams(values)}`, body: undefined };
}

function parseJsonBody(request, body) {
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") return { status: 415, error: "mobile mutations require application/json" };
  const payload = parseJson(Buffer.from(body || "").toString("utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: 400, error: "invalid JSON object" };
  return { payload };
}

function publicPairRequest(payload) {
  if (!hasOnlyKeys(payload, ["code", "credential", "deviceName", "pairRequestId"])) return { error: "unsupported pairing field" };
  const credential = typeof payload.code === "string" ? payload.code : typeof payload.credential === "string" ? payload.credential : "";
  if (!credential.trim() || credential.length > 4096) return { error: "pairing credential is required" };
  if (typeof payload.deviceName !== "string" || !payload.deviceName.trim() || payload.deviceName.length > 120) return { error: "device name is required" };
  if (payload.pairRequestId !== undefined && !isSafeIdentifier(payload.pairRequestId)) return { error: "invalid pairing request identifier" };
  return { payload: {
    ...(typeof payload.code === "string" ? { code: credential } : { credential }),
    deviceName: payload.deviceName,
    ...(payload.pairRequestId ? { pairRequestId: payload.pairRequestId } : {})
  } };
}

function hasOnlyKeys(payload, allowed) {
  const allow = new Set(allowed);
  return Object.keys(payload).every((key) => allow.has(key));
}

function isSafeIdentifier(value) {
  return typeof value === "string" && /^[\w-]{1,128}$/.test(value);
}

function invalidBody(error) {
  return { status: 400, error };
}

function encodedBody(search, payload) {
  return { search, body: Buffer.from(JSON.stringify(payload)) };
}

function isSafeCursor(value) {
  return typeof value === "string" && /^[\w.:-]{1,256}$/.test(value);
}

function rememberEventCursor(session, upstreamCursor) {
  const existing = session.clientCursorByUpstream?.get(upstreamCursor);
  if (existing) return existing;
  const clientCursor = `mobile-${randomBytes(18).toString("base64url")}`;
  session.clientCursorByUpstream.set(upstreamCursor, clientCursor);
  session.upstreamCursorByClient.set(clientCursor, upstreamCursor);
  while (session.clientCursorByUpstream.size > 256) {
    const oldestUpstream = session.clientCursorByUpstream.keys().next().value;
    const oldestClient = session.clientCursorByUpstream.get(oldestUpstream);
    session.clientCursorByUpstream.delete(oldestUpstream);
    session.upstreamCursorByClient.delete(oldestClient);
  }
  return clientCursor;
}

async function serveStatic(response, pathname, root, headOnly) {
  const decoded = decodeURIComponent(pathname);
  const candidate = decoded === "/" ? join(root, "index.html") : resolve(root, `.${normalize(decoded)}`);
  if (candidate !== join(root, "index.html") && !candidate.startsWith(`${root}/`)) {
    return json(response, 404, { error: "not found" });
  }
  let info;
  try { info = await stat(candidate); } catch { return json(response, 404, { error: "not found" }); }
  if (!info.isFile()) return json(response, 404, { error: "not found" });
  response.statusCode = 200;
  response.setHeader("Content-Type", MIME_TYPES.get(extname(candidate)) || "application/octet-stream");
  // Always revalidate: a 5-minute HTTP cache made every deploy look broken for
  // up to 5 minutes. Offline durability comes from the service worker, not here.
  response.setHeader("Cache-Control", "no-cache");
  if (headOnly) return response.end();
  return createReadStream(candidate).pipe(response);
}

function authenticatedSession(request, sessions, timestamp) {
  const sessionId = cookieValue(request, SESSION_COOKIE);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) return null;
  session.lastSeenAt = timestamp;
  return session;
}

function expireSessions(sessions, timestamp) {
  const cutoff = timestamp - SESSION_MAX_AGE_SECONDS * 1_000;
  for (const [id, session] of sessions) if (session.lastSeenAt < cutoff) sessions.delete(id);
}

function evictOldestSession(sessions) {
  const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0];
  if (oldest) sessions.delete(oldest[0]);
}

function sameOriginRequest(request, trustProxy) {
  const origin = request.headers.origin;
  if (!origin) return false;
  const forwardedProtocol = String(trustProxy ? request.headers["x-forwarded-proto"] || "" : "")
    .split(",", 1)[0]
    .trim()
    .toLowerCase();
  const protocol = request.socket.encrypted || forwardedProtocol === "https" ? "https:" : "http:";
  try { return new URL(origin).origin === `${protocol}//${request.headers.host}`; } catch { return false; }
}

function sessionCookie(sessionId, request, trustProxy) {
  const secure = request.socket.encrypted || trustProxy && request.headers["x-forwarded-proto"] === "https";
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(request, trustProxy) {
  const secure = request.socket.encrypted || trustProxy && request.headers["x-forwarded-proto"] === "https";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure ? "; Secure" : ""}`;
}

function cookieValue(request, name) {
  for (const pair of String(request.headers.cookie || "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function readBody(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        chunks.length = 0;
        const error = new Error("body too large");
        error.code = "BODY_TOO_LARGE";
        rejectBody(error);
      } else chunks.push(chunk);
    });
    request.on("end", () => { if (!rejected) resolveBody(Buffer.concat(chunks)); });
    request.on("error", (error) => { if (!rejected) rejectBody(error); });
  });
}

function normalizedOrigin(value) {
  const url = new URL(String(value || "http://127.0.0.1:8810"));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid upstream protocol");
  return url.origin;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function publicError(payload) {
  return { error: typeof payload?.error === "string" ? payload.error : "upstream request failed" };
}

export function warnIfPlaintextExposed(host, trustProxy, warn = console.warn) {
  if (["127.0.0.1", "localhost", "::1"].includes(host) || trustProxy) return;
  warn(`경고: ${host} 주소로 평문 HTTP를 열었습니다. 세션 쿠키가 암호화 없이 전송되니 Tailscale 또는 HTTPS 프록시 뒤에서만 사용하세요.`);
}

function json(response, status, payload) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

async function main() {
  const port = Number(process.env.BELMONT_MOBILE_PORT || "4173");
  const host = process.env.BELMONT_MOBILE_HOST || "127.0.0.1";
  const upstream = process.env.BELMONT_MOBILE_UPSTREAM || "http://127.0.0.1:8810";
  const trustProxy = process.env.BELMONT_MOBILE_TRUST_PROXY === "1";
  const server = createMobileServer({ upstream, trustProxy });
  server.listen(port, host, () => {
    console.log(`Belmont Mobile PWA: http://${host}:${port}`);
    console.log(`Mobile API upstream: ${new URL(upstream).origin}`);
    warnIfPlaintextExposed(host, trustProxy);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
