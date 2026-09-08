import crypto from "node:crypto";
import { createReadStream, promises as fs, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { readCodexUsage } from "./codex-usage.mjs";
import { createMobileSendLedger, unwrapMobileNonce } from "./mobile-send-ledger.mjs";
import { createMobilePushService, pushDeviceId } from "./mobile-push-service.mjs";
import { AVATAR_SHAPES, buildBotDescription, buildRoutineSpec, buildSkillMarkdown, parseMarketplaceBot, parseSharePage, slugFromUrl } from "../scripts/lib/grok-bot-template.mjs";
import { adaptationPrompt, validateAdaptedTemplate } from "../scripts/lib/grok-bot-adaptation.mjs";

const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PROFILE_DIR = resolve(APP_ROOT, "../.cache/belmont-wsl-profile/sand-data");
const DEFAULT_ICON_PATH = resolve(APP_ROOT, "public/assets/app-icon.png");
const SESSION_COOKIE = "belmont_mobile_session";
const BODY_LIMIT = 18 * 1024 * 1024;
const PAIR_WINDOW_MS = 60_000;
const PAIR_FAILURE_LIMIT = 6;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MOBILE_SHAPES = ["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf"];
const MOBILE_COLORS = ["brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"];
const ATTACHMENT_READ_LIMIT = 16 * 1024 * 1024;
const ATTACHMENT_READ_CHUNK = 1024 * 1024;
const FILESYSTEM_ENTRY_LIMIT = 500;
const FILESYSTEM_PREVIEW_LIMIT = 1024 * 1024;
const WINDOWS_GATEWAY_PREFIX = "/windows";
const WINDOWS_GATEWAY_USER_HEADER = "X-Belmont-User";
const DEFAULT_FILESYSTEM_ROOTS = {
  belmontRoot: resolve(APP_ROOT, ".."),
  windowsMountRoot: "/mnt",
};
const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function integer(value, fallback = 0) {
  return Number.isInteger(value) ? value : fallback;
}

function finiteNumber(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function attachmentKind(name, mime = "") {
  const lower = text(name).toLowerCase();
  const normalizedMime = text(mime).toLowerCase();
  if (normalizedMime.startsWith("image/") || /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/u.test(lower)) return "image";
  if (normalizedMime.startsWith("video/") || /\.(?:m4v|mov|mp4|ogv|webm)$/u.test(lower)) return "video";
  if (normalizedMime.startsWith("audio/") || /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/u.test(lower)) return "audio";
  if (normalizedMime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (normalizedMime === "text/markdown" || /\.(?:md|markdown|mdx)$/u.test(lower)) return "markdown";
  if (/\.(?:csv|tsv|xlsx?|ods)$/u.test(lower)) return "table";
  if (normalizedMime.includes("json") || /\.(?:json|jsonc|json5|ndjson)$/u.test(lower)) return "json";
  if (/\.(?:docx?|odt|rtf)$/u.test(lower)) return "document";
  if (/\.(?:zip|tar|gz|tgz|bz2|xz|zst|7z|rar)$/u.test(lower)) return "archive";
  if (normalizedMime.startsWith("text/") || /\.(?:txt|log|xml|ya?ml|toml|ini|cfg|conf|css|s?css|jsx?|tsx?|py|rb|go|rs|java|kt|swift|sql|sh)$/u.test(lower)) return "text";
  return "file";
}

function contentTypeFor(name, fallback = "application/octet-stream") {
  const lower = text(name).toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/u.test(lower)) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (/\.(?:md|txt|log)$/u.test(lower)) return "text/plain; charset=utf-8";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return fallback;
}

function inlineAttachmentDisposition(name) {
  const filename = name.toWellFormed();
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/gu, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function windowsGatewayOrigin(value) {
  const parsed = new URL(text(value, "http://127.0.0.1:4190"));
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Belmont Windows gateway URL must be an HTTP(S) origin");
  }
  return parsed.origin;
}

function windowsGatewayHeaders(request, trustProxy) {
  const headers = {};
  for (const name of ["accept", "accept-encoding", "accept-language", "content-length", "content-type", "cookie", "range", "user-agent"]) {
    const value = request.headers[name];
    if (value != null) headers[name] = value;
  }
  headers[WINDOWS_GATEWAY_USER_HEADER] = "hoon";
  headers["x-forwarded-host"] = request.headers.host || "localhost";
  headers["x-forwarded-proto"] = trustProxy
    ? text(request.headers["x-forwarded-proto"]).split(",")[0]?.trim() || "http"
    : request.socket.encrypted ? "https" : "http";
  return headers;
}

function fileSystemError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeFileSystemPath(value) {
  const source = text(value).replace(/\\/gu, "/");
  if (source.includes("\0")) throw fileSystemError("파일 경로가 올바르지 않습니다.", 400);
  const parts = source.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) throw fileSystemError("상위 범위로 이동할 수 없습니다.", 400);
  return parts.join("/");
}

function pathInside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

function mapFileSystemError(error) {
  if (["EACCES", "EPERM"].includes(error?.code)) return fileSystemError("이 위치를 읽을 권한이 없습니다.", 403);
  if (["ENOENT", "ENOTDIR"].includes(error?.code)) return fileSystemError("파일이나 폴더를 찾을 수 없습니다.", 404);
  return error;
}

async function realPathInside(root, target) {
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    if (!pathInside(realRoot, realTarget)) throw fileSystemError("허용된 파일 범위를 벗어날 수 없습니다.", 403);
    return { realRoot, realTarget };
  } catch (error) {
    if (Number.isInteger(error?.status)) throw error;
    throw mapFileSystemError(error);
  }
}

async function resolveFileSystemTarget(scope, requestedPath, roots) {
  const path = normalizeFileSystemPath(requestedPath);
  if (scope === "belmont") {
    const target = resolve(roots.belmontRoot, path);
    if (!pathInside(roots.belmontRoot, target)) throw fileSystemError("허용된 파일 범위를 벗어날 수 없습니다.", 403);
    const { realTarget } = await realPathInside(roots.belmontRoot, target);
    return {
      scope,
      path,
      target: realTarget,
      displayPath: path ? `Belmont/${path}` : "Belmont",
      parentPath: path ? path.split("/").slice(0, -1).join("/") : null,
    };
  }
  if (scope === "windows") {
    const parts = path.split("/").filter(Boolean);
    const drive = parts.shift()?.toLowerCase() ?? "";
    if (!/^[a-z]$/u.test(drive)) throw fileSystemError("Windows 드라이브를 선택하세요.", 400);
    const driveRoot = resolve(roots.windowsMountRoot, drive);
    const target = resolve(driveRoot, ...parts);
    if (!pathInside(driveRoot, target)) throw fileSystemError("허용된 Windows 드라이브를 벗어날 수 없습니다.", 403);
    const { realTarget } = await realPathInside(driveRoot, target);
    return {
      scope,
      path: [drive, ...parts].join("/"),
      target: realTarget,
      displayPath: `${drive.toUpperCase()}:\\${parts.join("\\")}`,
      parentPath: parts.length > 0 ? [drive, ...parts.slice(0, -1)].join("/") : "",
    };
  }
  throw fileSystemError("지원하지 않는 파일 범위입니다.", 400);
}

async function fileSystemEntry(directory, path, dirent) {
  const type = dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : dirent.isSymbolicLink() ? "link" : "other";
  let stat = null;
  try { stat = await fs.lstat(join(directory, dirent.name)); } catch {}
  return {
    name: dirent.name,
    path: path ? `${path}/${dirent.name}` : dirent.name,
    type,
    kind: type === "file" ? attachmentKind(dirent.name) : null,
    size: type === "file" ? stat?.size ?? null : null,
    modifiedAt: stat?.mtimeMs ?? null,
  };
}

async function listFileSystem(scope, requestedPath, roots, requestedOffset = 0) {
  const path = normalizeFileSystemPath(requestedPath);
  const offset = Math.max(0, Math.floor(Number(requestedOffset) || 0));
  if (scope === "windows" && path === "") {
    let dirents;
    try { dirents = await fs.readdir(roots.windowsMountRoot, { withFileTypes: true }); }
    catch (error) { throw mapFileSystemError(error); }
    const drives = dirents.filter((entry) => /^[a-z]$/iu.test(entry.name) && entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
    return {
      scope,
      label: "Windows 전체",
      path: "",
      displayPath: "Windows",
      parentPath: null,
      entries: drives.map((entry) => ({ name: `${entry.name.toUpperCase()}:`, path: entry.name.toLowerCase(), type: "directory", kind: null, size: null, modifiedAt: null })),
      totalEntries: drives.length,
      nextOffset: null,
    };
  }
  const resolved = await resolveFileSystemTarget(scope, path, roots);
  let stat;
  let dirents;
  try {
    stat = await fs.stat(resolved.target);
    if (!stat.isDirectory()) throw fileSystemError("폴더가 아닙니다.", 400);
    dirents = await fs.readdir(resolved.target, { withFileTypes: true });
  } catch (error) {
    if (Number.isInteger(error?.status)) throw error;
    throw mapFileSystemError(error);
  }
  dirents.sort((left, right) => {
    const leftRank = left.isDirectory() ? 0 : left.isFile() ? 1 : 2;
    const rightRank = right.isDirectory() ? 0 : right.isFile() ? 1 : 2;
    return leftRank - rightRank || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  const visible = dirents.slice(offset, offset + FILESYSTEM_ENTRY_LIMIT);
  return {
    scope,
    label: scope === "windows" ? "Windows 전체" : "Belmont 폴더",
    path: resolved.path,
    displayPath: resolved.displayPath,
    parentPath: resolved.parentPath,
    entries: await Promise.all(visible.map((entry) => fileSystemEntry(resolved.target, resolved.path, entry))),
    totalEntries: dirents.length,
    nextOffset: offset + visible.length < dirents.length ? offset + visible.length : null,
  };
}

async function previewFileSystemFile(scope, requestedPath, roots) {
  const resolved = await resolveFileSystemTarget(scope, requestedPath, roots);
  let stat;
  try { stat = await fs.stat(resolved.target); } catch (error) { throw mapFileSystemError(error); }
  if (!stat.isFile()) throw fileSystemError("파일이 아닙니다.", 400);
  const name = basename(resolved.target);
  const kind = attachmentKind(name);
  const contentUrl = `/api/filesystem/content?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(resolved.path)}`;
  const common = { scope, path: resolved.path, displayPath: resolved.displayPath, name, kind, bytes: stat.size, modifiedAt: stat.mtimeMs, contentUrl };
  if (["text", "markdown", "json", "table"].includes(kind)) {
    const length = Math.min(stat.size, FILESYSTEM_PREVIEW_LIMIT);
    const handle = await fs.open(resolved.target, "r").catch((error) => { throw mapFileSystemError(error); });
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return { ...common, kind: "text", text: buffer.subarray(0, bytesRead).toString("utf8"), truncated: stat.size > bytesRead };
    } finally {
      await handle.close();
    }
  }
  return { ...common, kind: kind === "image" ? "image" : kind === "pdf" ? "pdf" : ["video", "audio"].includes(kind) ? kind : "binary" };
}

function cookieMap(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function stableIndex(seed, length, salt = "") {
  const digest = crypto.createHash("sha256").update(`${salt}:${seed}`).digest();
  return digest.readUInt32BE(0) % length;
}

function avatarFor(agent, index = 0) {
  const seed = text(agent.id, `${text(agent.name, "bot")}:${index}`);
  const shape = MOBILE_SHAPES.includes(agent.avatarShape) ? agent.avatarShape : MOBILE_SHAPES[stableIndex(seed, MOBILE_SHAPES.length, "shape")];
  const color = MOBILE_COLORS.includes(agent.avatarColor) ? agent.avatarColor : MOBILE_COLORS[stableIndex(seed, MOBILE_COLORS.length, "color")];
  return { shape, color };
}

export function projectAgent(agent, { managerId = null, pinnedIds = [], index = 0 } = {}) {
  const avatar = avatarFor(agent, index);
  return {
    id: text(agent.id),
    name: text(agent.name, "Bot"),
    title: text(agent.title),
    description: text(agent.description),
    avatar,
    isManager: agent.id === managerId,
    isPinned: agent.id === managerId || pinnedIds.includes(agent.id),
    isRunning: agent.isRunning === true || agent.isRunningTurn === true,
    isUserStopped: agent.isUserStopped === true,
    stopGuard: typeof agent.stopGuard === "string" ? agent.stopGuard : null,
    userIntentRevision: Number.isSafeInteger(agent.userIntentRevision) ? agent.userIntentRevision : null,
    isComposing: agent.isComposingMessage === true,
    isHidden: agent.isHiddenFromSidebar === true,
    hasUnread: agent.hasUnread === true,
    unreadCount: integer(agent.unreadCount),
    awaitingUserResponse: agent.awaitingUserResponse === true || isRecord(agent.awaitingUserResponse),
    lastMessagePreview: text(agent.lastMessagePreview),
    lastActivityAt: integer(agent.lastActivityAt),
    notificationsEnabled: agent.notificationsEnabled !== false,
    notifyOnUpdatesEnabled: agent.notifyOnUpdatesEnabled !== false,
    isGroup: agent.isGroup === true,
    memberIds: Array.isArray(agent.memberIds) ? agent.memberIds.filter((id) => typeof id === "string") : [],
  };
}

/**
 * The viewer runs inside the app's computer screen, which has its own toolbar (keyboard, clipboard, pan, fit,
 * fullscreen, reconnect). noVNC's side bar, drag handle and status banner are hidden here; the app drives the
 * hidden controls through the same-origin frame document instead.
 */
export const VIEWER_CHROME_STYLE = `<style id="linear-vnc-chrome">
#noVNC_control_bar_anchor,#noVNC_control_bar_handle,#noVNC_status,#noVNC_hint_anchor{display:none!important}
html,body,#noVNC_container,#noVNC_screen{background:#000!important}
#noVNC_transition{background:#000!important;color:#8a8a8a!important;font:13px/1.5 system-ui,sans-serif!important}
</style>`;
/**
 * noVNC only starts a one-finger drag after the finger travelled 50 CSS px. On a phone showing a 1280 px desktop
 * at ~0.3 scale that is a 160 px dead zone on the desktop, which reads as lag. 24 px is still well above the
 * platform touch slop, so taps stay taps while drags begin promptly.
 */
export const VIEWER_DRAG_THRESHOLD_PX = 24;
export function tuneViewerScript(assetPath, source) {
  if (!/\/core\/input\/gesturehandler\.js$/u.test(assetPath)) return source;
  return source.replace(/const GH_MOVE_THRESHOLD = 50;/u, `const GH_MOVE_THRESHOLD = ${VIEWER_DRAG_THRESHOLD_PX};`);
}
export function brandViewerHtml(html) {
  if (html.includes('id="linear-vnc-chrome"')) return html;
  return html.includes("</head>") ? html.replace("</head>", `${VIEWER_CHROME_STYLE}</head>`) : `${VIEWER_CHROME_STYLE}${html}`;
}

/** Belmont stores a thread reply's parent as `replyTo` (bot echoes also carry `message.reply_to`); expose it as replyToId. */
export function threadParentId(entry) {
  for (const candidate of [entry?.replyToId, entry?.replyTo, entry?.message?.reply_to, entry?.message?.replyTo]) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

/** Task-tool subagents get a throwaway agent record ("New Agent", id `subagent-…`); they are not a Bot the user talks to. */
export function isTransientSubagent(agent) {
  return typeof agent?.id === "string" && agent.id.startsWith("subagent-");
}

function projectEntryMetadata(entry) {
  return {
    ...(threadParentId(entry) == null ? {} : { replyToId: threadParentId(entry) }),
    ...(entry.branched === true ? { branched: true } : {}),
    ...(Array.isArray(entry.reactions) ? { reactions: entry.reactions.filter(isRecord).flatMap((reaction) => typeof reaction.emoji === "string" && typeof reaction.by === "string" ? [{ emoji: reaction.emoji, by: reaction.by }] : []) } : {}),
  };
}

function projectApproval(entry, agentId) {
  const approval = isRecord(entry.message?.approval) ? entry.message.approval : {};
  return {
    id: text(entry.id),
    type: "approval",
    role: "assistant",
    timestampMs: integer(entry.timestampMs),
    agentId,
    requestId: text(approval.requestId),
    surface: text(approval.surface),
    summary: text(approval.summary, "승인이 필요한 작업입니다."),
    reason: text(approval.reason),
    command: text(approval.command),
    status: text(approval.status, "pending"),
    ...projectEntryMetadata(entry),
  };
}

function projectLocalPermission(entry, agentId) {
  const ask = isRecord(entry.message?.ask) ? entry.message.ask : {};
  return {
    id: text(entry.id),
    type: "local-permission",
    role: "assistant",
    timestampMs: integer(entry.timestampMs),
    agentId,
    requestId: text(ask.requestId),
    action: text(ask.action),
    target: text(ask.target),
    status: text(ask.status, "pending"),
    ...projectEntryMetadata(entry),
  };
}

function projectWidget(entry, agentId) {
  const widget = isRecord(entry.message?.widget) ? entry.message.widget : {};
  const options = Array.isArray(widget.options) ? widget.options.filter(isRecord).map((option) => ({
    label: text(option.label, text(option.value, "선택")),
    value: text(option.value, text(option.label)),
    style: text(option.style),
  })) : [];
  return {
    id: text(entry.id),
    type: "widget",
    role: "assistant",
    timestampMs: integer(entry.timestampMs),
    agentId,
    prompt: text(widget.prompt, "응답을 선택하세요."),
    options,
    skipped: entry.widgetSkipped === true,
    // The host records the chosen value on the entry (respondedValue). Without it the phone kept
    // showing both buttons after a tap (2026-09-05, the parked-task card).
    answered: typeof entry.respondedValue === "string" && entry.respondedValue.length > 0 ? entry.respondedValue : null,
    ...projectEntryMetadata(entry),
  };
}

function projectAttachment(entry, agentId) {
  const message = isRecord(entry.message) ? entry.message : {};
  return {
    id: text(entry.id),
    type: "attachment",
    role: entry.kind === "user-attachment" ? "user" : "assistant",
    timestampMs: integer(entry.timestampMs),
    agentId,
    name: text(entry.file_name, text(message.file_name, text(message.fileName, "Attachment"))),
    path: text(entry.file_path, text(message.url)),
    byteSize: integer(entry.byteSize),
    kind: attachmentKind(text(entry.file_name, text(message.file_name, text(message.fileName))), text(message.mime)),
    mime: typeof message.mime === "string" ? message.mime : null,
    width: finiteNumber(entry.width, finiteNumber(message.width)),
    height: finiteNumber(entry.height, finiteNumber(message.height)),
    ...projectEntryMetadata(entry),
  };
}

function projectAgentActivity(entry, agentId, content) {
  const incoming = isRecord(entry.fromAgent);
  const peer = incoming ? entry.fromAgent : isRecord(entry.toAgent) ? entry.toAgent : {};
  const job = /^\[job:([^\]]+)\]/u.exec(content);
  return {
    id: text(entry.id, crypto.randomUUID()),
    type: "agent-activity",
    role: incoming ? "user" : "assistant",
    timestampMs: integer(entry.timestampMs),
    agentId: text(peer.id, agentId),
    agentName: text(peer.name, "다른 Bot"),
    direction: incoming ? "incoming" : "outgoing",
    content,
    jobId: text(job?.[1]),
    isError: /(?:오류|error|failed|exception)/iu.test(content.slice(0, 240)),
    ...projectEntryMetadata(entry),
  };
}

export function projectTranscriptEntries(entries, agentId) {
  if (!Array.isArray(entries)) return [];
  const projected = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const message = isRecord(entry.message) ? entry.message : null;
    if (message?.type === "auto-review-approval") {
      projected.push(projectApproval(entry, agentId));
      continue;
    }
    if (message?.type === "local-tool-permission") {
      projected.push(projectLocalPermission(entry, agentId));
      continue;
    }
    if (message?.type === "widget") {
      projected.push(projectWidget(entry, agentId));
      continue;
    }
    if (entry.kind === "user-attachment" || message?.type === "attachment") {
      projected.push(projectAttachment(entry, agentId));
      continue;
    }
    const content = text(entry.content, text(message?.content));
    if ((isRecord(entry.fromAgent) || isRecord(entry.toAgent)) && content.length > 0) {
      projected.push(projectAgentActivity(entry, agentId, content));
      continue;
    }
    if (/^The local-computer permission request above expired without an answer/u.test(content)
      && projected.at(-1)?.type === "local-permission") {
      continue;
    }
    if (content.length > 0) {
      projected.push({
        id: text(entry.id, crypto.randomUUID()),
        type: "text",
        role: entry.role === "user" ? "user" : "assistant",
        content,
        timestampMs: integer(entry.timestampMs),
        isStreaming: entry.isStreaming === true,
        // lets the client retire its optimistic bubble once the desktop confirms the send
        ...(typeof entry.clientNonce === "string" && entry.clientNonce.length > 0 ? { clientNonce: unwrapMobileNonce(entry.clientNonce) } : {}),
        ...projectEntryMetadata(entry),
      });
    }
  }
  return projected;
}

export function createPairingGuard({ code, now = Date.now } = {}) {
  const failures = new Map();
  return {
    verify(candidate, key = "unknown") {
      const timestamp = now();
      const record = failures.get(key) ?? { count: 0, blockedUntil: 0 };
      if (record.blockedUntil > timestamp) return { ok: false, retryAfterMs: record.blockedUntil - timestamp };
      if (safeEqual(candidate, code)) {
        failures.delete(key);
        return { ok: true, retryAfterMs: 0 };
      }
      const count = record.count + 1;
      const blockedUntil = count >= PAIR_FAILURE_LIMIT ? timestamp + PAIR_WINDOW_MS : 0;
      failures.set(key, { count: blockedUntil > 0 ? 0 : count, blockedUntil });
      return { ok: false, retryAfterMs: blockedUntil > 0 ? PAIR_WINDOW_MS : Math.min(8_000, 500 * 2 ** Math.max(0, count - 1)) };
    },
  };
}

export function createGatewayTransport({ profileDir = DEFAULT_PROFILE_DIR, fetcher = fetch } = {}) {
  async function descriptor() {
    const raw = JSON.parse(await fs.readFile(join(profileDir, "gateway.json"), "utf8"));
    if (!Number.isInteger(raw.port) || typeof raw.token !== "string" || raw.token.length === 0) throw new Error("Belmont gateway descriptor is invalid");
    return { baseUrl: `${raw.scheme === "https" ? "https" : "http"}://${raw.host || "127.0.0.1"}:${raw.port}`, token: raw.token };
  }
  return {
    profileDir,
    descriptor,
    async managerId() {
      try {
        const value = JSON.parse(await fs.readFile(join(profileDir, "manager.json"), "utf8"));
        return text(value.managerAgentId, text(value.agentId)) || null;
      } catch {
        return null;
      }
    },
    async call(method, args = {}, signal) {
      const gateway = await descriptor();
      const response = await fetcher(`${gateway.baseUrl}/api/${method}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${gateway.token}`,
          "content-type": "application/json",
          "x-sand-slim-avatars": "1",
        },
        body: JSON.stringify(args ?? {}),
        signal,
      });
      const body = await response.text();
      if (!response.ok) {
        let detail = body;
        try { detail = JSON.parse(body).error ?? body; } catch {}
        const error = new Error(`Belmont ${method} failed: ${detail}`);
        error.status = response.status;
        throw error;
      }
      return body.length > 0 ? JSON.parse(body) : null;
    },
    async events(signal) {
      const gateway = await descriptor();
      return await fetcher(`${gateway.baseUrl}/events`, {
        headers: { authorization: `Bearer ${gateway.token}`, accept: "text/event-stream" },
        signal,
      });
    },
  };
}

function json(response, status, value, headers = {}) {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

function publicError(error) {
  if (typeof error?.publicMessage === "string") return error.publicMessage;
  if (error?.status === 400 || error?.status === 403 || error?.status === 404 || error?.status === 409 || error?.status === 413) return error.message;
  return "Belmont 데스크톱에 연결하지 못했습니다.";
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(parsed)) throw new Error("Expected a JSON object");
    return parsed;
  }
  catch {
    const error = new Error("Malformed JSON request");
    error.status = 400;
    throw error;
  }
}

function clientKey(request, trustProxy) {
  if (trustProxy) return text(request.headers["x-forwarded-for"]).split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
  return request.socket.remoteAddress || "unknown";
}

function sessionCookie(token, request, trustProxy) {
  const forwardedHttps = trustProxy && text(request.headers["x-forwarded-proto"]).split(",")[0]?.trim() === "https";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${forwardedHttps || request.socket.encrypted ? "; Secure" : ""}`;
}

function normalizeBotId(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function computerView(status, botId, computerTargets, requestedWindowIndex = null) {
  const windows = Array.isArray(status?.windows) ? status.windows : [];
  const selectedWindow = requestedWindowIndex == null ? null : windows.find((window) => integer(window?.windowIndex, -1) === requestedWindowIndex);
  const targetText = text(selectedWindow?.vncUrl, text(status?.vncUrl));
  if (targetText.length === 0) return { state: text(status?.state, "idle"), ready: false, viewerUrl: null, windows: [], handoff: status?.handoff ?? null };
  const target = new URL(targetText);
  computerTargets.set(botId, target);
  const params = new URLSearchParams(target.search);
  params.set("autoconnect", "1");
  params.set("resize", "scale");
  params.set("path", `api/bots/${encodeURIComponent(botId)}/computer/websockify`);
  return {
    state: text(status?.state, "running"),
    ready: true,
    viewerUrl: `/api/bots/${encodeURIComponent(botId)}/computer/proxy${target.pathname}?${params}`,
    windows: windows.map((window) => ({ windowIndex: integer(window.windowIndex), ready: typeof window.vncUrl === "string" })),
    handoff: status?.handoff ?? null,
  };
}

async function readAttachmentBytes(gateway, { path, agentId }) {
  const chunks = [];
  let offset = 0;
  let totalSize = null;
  let mime = null;
  while (offset < ATTACHMENT_READ_LIMIT) {
    const chunk = await gateway.call("readAttachmentChunk", { path, agentId, offset, length: Math.min(ATTACHMENT_READ_CHUNK, ATTACHMENT_READ_LIMIT - offset) });
    if (!isRecord(chunk) || typeof chunk.bytesBase64 !== "string") return null;
    const bytes = Buffer.from(chunk.bytesBase64, "base64");
    totalSize = integer(chunk.totalSize, bytes.length);
    mime = typeof chunk.mime === "string" ? chunk.mime : mime;
    chunks.push(bytes);
    offset += bytes.length;
    if (bytes.length === 0 || offset >= totalSize) break;
  }
  if (totalSize != null && totalSize > ATTACHMENT_READ_LIMIT) {
    const error = new Error("모바일에서 열 수 있는 파일 크기를 초과했습니다.");
    error.status = 413;
    throw error;
  }
  return { bytes: Buffer.concat(chunks), totalSize: totalSize ?? offset, mime };
}

async function gatewaySettings(gateway) {
  const [settings, host, plugins] = await Promise.all([
    gateway.call("getHostSettings"),
    gateway.call("getHostStatus"),
    gateway.call("getPluginSyncStatus").catch(() => ({})),
  ]);
  return {
    notificationsEnabled: settings?.notifications?.isEnabled !== false,
    autoReviewEnabled: settings?.autoReviewInstructions?.isEnabled === true,
    localToolPermission: text(settings?.localToolPermission, "ask"),
    userTimeZone: text(settings?.userTimeZone, Intl.DateTimeFormat().resolvedOptions().timeZone),
    userLanguage: text(settings?.userLanguage),
    agentDefaultModel: isRecord(settings?.agentDefaultModel) ? settings.agentDefaultModel : null,
    models: AVAILABLE_MODELS,
    pinnedAgentIds: Array.isArray(settings?.pinnedAgentIds) ? settings.pinnedAgentIds.filter((id) => typeof id === "string") : [],
    hostVersion: host?.hostVersion ?? null,
    latestHostVersion: text(host?.latestHostVersion),
    hostUpdateAvailable: host?.hostUpdateAvailable === true,
    hostBusy: host?.isBusy === true,
    pluginAuthBlocked: Array.isArray(plugins?.authBlocked) ? plugins.authBlocked.length : 0,
  };
}

/** The desktop may silently keep its own value (this build pins OS notifications off); surface that instead of a switch that snaps back. */
function assertSettingApplied(applied, key, value) {
  // Only judge a response that actually reports the field; a bare acknowledgement is taken as applied.
  const reported = key === "notificationsEnabled"
    ? (isRecord(applied?.notifications) && typeof applied.notifications.isEnabled === "boolean" ? applied.notifications.isEnabled : null)
    : key === "autoReviewEnabled"
      ? (isRecord(applied?.autoReviewInstructions) && typeof applied.autoReviewInstructions.isEnabled === "boolean" ? applied.autoReviewInstructions.isEnabled : null)
      : (typeof applied?.localToolPermission === "string" ? applied.localToolPermission : null);
  if (reported == null || reported === value) return;
  const error = new Error(key === "notificationsEnabled"
    ? "Belmont 데스크톱이 알림 설정 변경을 받지 않았습니다. 이 데스크톱은 알림을 꺼 둔 상태라 휴대폰에서 켤 수 없습니다."
    : "Belmont 데스크톱이 이 설정 변경을 받지 않았습니다.");
  error.status = 409;
  throw error;
}

async function updateGatewaySetting(gateway, body) {
  const settings = await gateway.call("getHostSettings");
  if (body.key === "notificationsEnabled" && typeof body.value === "boolean") {
    const applied = await gateway.call("setHostSettings", { notifications: { ...(isRecord(settings.notifications) ? settings.notifications : {}), isEnabled: body.value } });
    assertSettingApplied(applied, body.key, body.value);
    return applied;
  }
  if (body.key === "autoReviewEnabled" && typeof body.value === "boolean") {
    return await gateway.call("setHostSettings", { autoReviewInstructions: { ...(isRecord(settings.autoReviewInstructions) ? settings.autoReviewInstructions : { allowInstructions: [], blockInstructions: [] }), isEnabled: body.value } });
  }
  if (body.key === "localToolPermission" && ["always", "ask", "never"].includes(body.value)) {
    return await gateway.call("setHostSettings", { localToolPermission: body.value });
  }
  if (body.key === "userTimeZone" && typeof body.value === "string" && body.value.trim().length > 0) {
    const zone = body.value.trim();
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { const error = new Error("알 수 없는 시간대입니다."); error.status = 400; throw error; }
    return await gateway.call("setHostSettings", { userTimeZone: zone, userTimeZoneOverride: zone });
  }
  if (body.key === "userLanguage" && typeof body.value === "string") {
    return await gateway.call("setHostSettings", { userLanguage: body.value.trim().length > 0 ? body.value.trim().slice(0, 40) : null });
  }
  if (body.key === "agentDefaultModel") {
    const selection = body.value == null ? null : normalizeModelSelection(body.value);
    if (body.value != null && selection == null) { const error = new Error("지원하지 않는 모델 선택입니다."); error.status = 400; throw error; }
    return await gateway.call("setHostSettings", { agentDefaultModel: selection });
  }
  const error = new Error("지원하지 않는 설정입니다.");
  error.status = 400;
  throw error;
}

/** Models the local Codex provider serves (the desktop's picker list), with the efforts each accepts. */
export const AVAILABLE_MODELS = [
  { id: "gpt-5.5", label: "GPT-5.5", efforts: ["low", "medium", "high", "xhigh"] },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", efforts: ["low", "medium", "high", "xhigh"] },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: ["low", "medium", "high", "xhigh"] },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: ["low", "medium", "high", "xhigh", "max"] },
];

/** `{ modelId, effort?, maxMode? }` or a full selection → the host's `{ modelId, maxMode, parameters }`; null when the model or effort is unknown. */
export function normalizeModelSelection(value) {
  if (!isRecord(value)) return null;
  const modelId = text(value.modelId).trim();
  const model = AVAILABLE_MODELS.find((candidate) => candidate.id === modelId);
  if (model == null) return null;
  const fromParameters = Array.isArray(value.parameters) ? value.parameters.find((parameter) => isRecord(parameter) && parameter.id === "effort") : null;
  const effort = text(value.effort, text(fromParameters?.value)).trim();
  if (effort.length > 0 && !model.efforts.includes(effort)) return null;
  return { modelId, maxMode: value.maxMode === true, parameters: effort.length > 0 ? [{ id: "effort", value: effort }] : [] };
}

/** 추가 정보 폼 → the message the bot receives (a normal user turn, so it lands in the transcript and memory like anything the user types). */
export function formatFormPrompt(body) {
  const fields = isRecord(body?.fields) ? Object.entries(body.fields) : Array.isArray(body?.fields) ? body.fields.filter(isRecord).map((field) => [text(field.label), field.value]) : [];
  const lines = fields.map(([label, value]) => [text(label).trim(), text(value).trim()]).filter(([label, value]) => label.length > 0 && value.length > 0).map(([label, value]) => `- ${label}: ${value}`);
  if (lines.length === 0) return null;
  const note = text(body?.note).trim();
  return [`[추가 정보] 요청하신 정보야.`, ...lines, ...(note.length > 0 ? [note] : [])].join("\n");
}

const FEEDBACK_KINDS = new Set(["feedback", "rating", "report"]);
/** Feedback, app ratings and message reports go to a host-side log (the original sent them to xAI); nothing is lost on the phone. */
export async function appendFeedback(profileDir, body, now = Date.now) {
  const kind = FEEDBACK_KINDS.has(body?.kind) ? body.kind : null;
  if (kind == null) { const error = new Error("kind는 feedback, rating, report 중 하나여야 합니다."); error.status = 400; throw error; }
  const record = {
    kind, createdAt: now(),
    ...(text(body.category).trim() ? { category: text(body.category).trim().slice(0, 80) } : {}),
    ...(text(body.detail).trim() ? { detail: text(body.detail).trim().slice(0, 4000) } : {}),
    ...(Number.isFinite(Number(body.rating)) && body.rating != null ? { rating: Math.max(0, Math.min(5, Number(body.rating))) } : {}),
    ...(text(body.botId).trim() ? { botId: text(body.botId).trim() } : {}),
    ...(text(body.entryId).trim() ? { entryId: text(body.entryId).trim() } : {}),
  };
  if (kind === "rating" && record.rating == null) { const error = new Error("rating이 필요합니다."); error.status = 400; throw error; }
  if (kind !== "rating" && record.detail == null && record.category == null) { const error = new Error("내용이 비어 있습니다."); error.status = 400; throw error; }
  await fs.appendFile(join(profileDir, "mobile-feedback.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function templateSkillMarkdown(skill) {
  const name = text(skill.name).trim(); const description = text(skill.description).trim(); const body = text(skill.body).trim();
  if (body.length > 0) return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description || name)}\n---\n${body}\n`;
  return buildSkillMarkdown({ name, description }, undefined);
}

/** The bot as a template: persona, the skills enabled for it (with bodies), and its routines. The share-link shape the original app used, minus the server. */
export async function exportBotTemplate(gateway, botId) {
  const roster = await gateway.call("listAgents");
  const agents = Array.isArray(roster) ? roster : Array.isArray(roster?.agents) ? roster.agents : [];
  const agent = agents.find((candidate) => isRecord(candidate) && candidate.id === botId);
  if (agent == null) { const error = new Error("Bot을 찾을 수 없습니다."); error.status = 404; throw error; }
  const [workflows, automations] = await Promise.all([gateway.call("getAgentWorkflows", { id: botId }), gateway.call("getAgentAutomations", { id: botId })]);
  const skills = (Array.isArray(workflows) ? workflows : []).filter((workflow) => isRecord(workflow) && workflow.source !== "automation" && workflow.trigger == null && workflow.isEnabledForAgent !== false)
    .map((workflow) => ({ id: text(workflow.id), name: text(workflow.name), description: text(workflow.description), body: text(workflow.body) }));
  const routines = (Array.isArray(automations) ? automations : []).filter(isRecord).map((routine) => ({
    name: text(routine.name), prompt: text(routine.prompt), schedule: text(routine.schedule, text(routine.trigger?.schedule)), isEnabled: routine.isEnabled === true || routine.enabled === true,
  }));
  return {
    version: 1, exportedAt: Date.now(), name: text(agent.name), description: text(agent.description),
    avatar: { shape: text(agent.avatarShape) || null, color: text(agent.avatarColor) || null },
    skills, routines,
  };
}

function parseTemplateBody(value) {
  const raw = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!isRecord(raw) || text(raw.name).trim().length === 0) return null;
  if (raw.skills != null && (!Array.isArray(raw.skills) || raw.skills.some((skill) => !isRecord(skill) || text(skill.name).trim().length === 0))) return null;
  if (raw.routines != null && (!Array.isArray(raw.routines) || raw.routines.some((routine) => !isRecord(routine) || text(routine.name).trim().length === 0 || text(routine.prompt).trim().length === 0))) return null;
  return {
    name: text(raw.name).trim().slice(0, 80), description: text(raw.description).trim().slice(0, 20000),
    avatar: isRecord(raw.avatar) ? { shape: text(raw.avatar.shape) || null, color: text(raw.avatar.color) || null } : { shape: null, color: null },
    skills: (Array.isArray(raw.skills) ? raw.skills : []).filter((skill) => isRecord(skill) && text(skill.name).trim().length > 0).map((skill) => ({ name: text(skill.name).trim(), description: text(skill.description).trim(), body: text(skill.body) })),
    routines: (Array.isArray(raw.routines) ? raw.routines : []).filter((routine) => isRecord(routine) && text(routine.name).trim().length > 0 && text(routine.prompt).trim().length > 0)
      .map((routine) => ({ name: text(routine.name).trim(), prompt: text(routine.prompt).trim(), schedule: text(routine.schedule, "0 9 * * 1-5"), isEnabled: false })),
  };
}

async function templateFromUrl(url, fetchText) {
  const ref = slugFromUrl(url);
  if (ref === null) { const error = new Error("x.ai 마켓플레이스 주소나 공유 링크가 아닙니다."); error.status = 400; throw error; }
  if (ref.kind === "marketplace") {
    const record = parseMarketplaceBot(await fetchText(`https://x.ai/bot/marketplace/bots/${ref.slug}`));
    if (record === null) { const error = new Error("그 페이지에서 Bot 정보를 읽지 못했습니다."); error.status = 404; throw error; }
    return {
      name: text(record.name).trim().slice(0, 80), description: buildBotDescription(record),
      avatar: { shape: record.shape && AVATAR_SHAPES.has(String(record.shape)) ? String(record.shape) : null, color: record.color ? String(record.color) : null },
      skills: (record.skills ?? []).filter((skill) => isRecord(skill)).map((skill) => ({ name: text(skill.name).trim(), description: text(skill.description).trim(), body: "" })),
      routines: (record.routines ?? []).map(buildRoutineSpec).map((spec) => ({ name: spec.name, prompt: spec.prompt, schedule: spec.trigger.schedule, isEnabled: false })),
      source: `marketplace:${ref.slug}`,
    };
  }
  const record = parseSharePage(await fetchText(`https://x.ai/bot/${ref.id}`));
  if (!record.name) { const error = new Error("공유 페이지를 읽지 못했습니다."); error.status = 404; throw error; }
  return { name: record.name.slice(0, 80), description: buildBotDescription(record), avatar: { shape: null, color: null }, skills: [], routines: [], source: `share:${ref.id}` };
}

/** Creates a bot from a template (a URL to x.ai, or an exported template): persona, skills into the shared library enabled for this bot only, routines paused. */
export async function importBotTemplate(gateway, body, { fetchText, now = Date.now } = {}) {
  const fromUrl = text(body?.url).trim().length > 0;
  let template = fromUrl ? await templateFromUrl(text(body.url).trim(), fetchText) : parseTemplateBody(body?.template);
  if (template == null) { const error = new Error("템플릿(JSON)이나 주소를 입력하세요."); error.status = 400; throw error; }
  let adaptation = { status: "not_requested" };
  if ((fromUrl && body?.adapt !== false) || body?.adapt === true) {
    const draft = await gateway.call("generateBotTemplateDraft", { prompt: adaptationPrompt(template) });
    template = validateAdaptedTemplate(draft?.text, template);
    adaptation = { status: "generated", modelId: text(draft?.modelId), ...(draft?.reasoning ? { reasoning: text(draft.reasoning) } : {}), generatedAt: now(), source: template.source ?? "template", provenance: "new_procedures_from_source_material" };
  }
  const name = text(body?.name).trim().slice(0, 80) || template.name;
  const created = await gateway.call("createAgent", {
    name, description: template.description,
    ...(template.avatar.shape && MOBILE_SHAPES.includes(template.avatar.shape) ? { avatarShape: template.avatar.shape } : {}),
    ...(template.avatar.color && MOBILE_COLORS.includes(template.avatar.color) ? { avatarColor: template.avatar.color } : {}),
    origin: "user", isIntroductionSuppressed: false, isKickstartRequested: false, clientNonce: text(body?.clientNonce, `template:${now()}`),
  });
  const agentId = text(created?.agent?.id, text(created?.id));
  if (agentId.length === 0) throw new Error("Bot을 만들었지만 id를 받지 못했습니다.");
  const skills = [];
  const newWorkflowIds = new Set();
  const issues = [];
  const issue = (kind, name, error) => issues.push({ kind, name, message: error instanceof Error ? error.message : text(error, "저장 결과를 확인하지 못했습니다.") });
  let inheritedWorkflowIds = null;
  try {
    const inherited = await gateway.call("getAgentWorkflows", { id: agentId });
    if (!Array.isArray(inherited)) throw new Error("새 Bot의 기존 스킬 설정을 확인하지 못했습니다.");
    inheritedWorkflowIds = new Set(inherited.filter((workflow) => isRecord(workflow) && text(workflow.id).length > 0 && workflow.source !== "automation" && workflow.trigger == null && workflow.isEnabledForAgent !== false).map((workflow) => workflow.id));
  } catch (error) { issue("isolation", "새 Bot의 기존 스킬", error); }
  for (const skill of template.skills) {
    try {
      const result = await gateway.call("importAgentWorkflowText", { id: agentId, markdown: templateSkillMarkdown(skill), name: skill.name });
      const receipts = Array.isArray(result?.result?.imported) ? result.result.imported : [];
      const imported = receipts.filter((entry) => isRecord(entry) && text(entry.id).length > 0 && !newWorkflowIds.has(entry.id));
      const skipped = Array.isArray(result?.result?.skipped) ? result.result.skipped : [];
      if (imported.length > 0) {
        skills.push(skill.name);
        for (const entry of imported) newWorkflowIds.add(entry.id);
      }
      if (imported.length === 0 || imported.length !== receipts.length || skipped.length > 0) issue("skill", skill.name, skipped.map((entry) => text(entry?.reason)).filter(Boolean).join("; ") || "스킬 저장 결과를 확인하지 못했습니다.");
    } catch (error) { issue("skill", skill.name, error); }
  }
  if (inheritedWorkflowIds != null) {
    for (const workflowId of inheritedWorkflowIds) {
      if (newWorkflowIds.has(workflowId)) continue;
      try {
        const workflows = await gateway.call("setAgentWorkflowEnabled", { id: agentId, workflowId, isEnabled: false });
        if (!Array.isArray(workflows) || !workflows.some((workflow) => workflow?.id === workflowId && workflow.isEnabledForAgent === false)) throw new Error("새 Bot에서 상속 스킬이 꺼졌는지 확인하지 못했습니다.");
      } catch (error) { issue("isolation", `${name} / ${workflowId}`, error); }
    }
  }
  if (newWorkflowIds.size > 0) {
    try {
      const roster = await gateway.call("listAgents");
      const agents = Array.isArray(roster) ? roster : roster?.agents;
      if (!Array.isArray(agents)) throw new Error("다른 Bot의 스킬 설정을 확인하지 못했습니다.");
      const others = agents.filter((agent) => isRecord(agent) && agent.id !== agentId && agent.isGroup !== true);
      for (const other of others) for (const workflowId of newWorkflowIds) {
        try {
          const workflows = await gateway.call("setAgentWorkflowEnabled", { id: other.id, workflowId, isEnabled: false });
          if (!Array.isArray(workflows) || !workflows.some((workflow) => workflow?.id === workflowId && workflow.isEnabledForAgent === false)) throw new Error("다른 Bot에서 스킬이 꺼졌는지 확인하지 못했습니다.");
        } catch (error) { issue("isolation", `${text(other.name, other.id)} / ${workflowId}`, error); }
      }
    } catch (error) { issue("isolation", "스킬 사용 범위", error); }
  }
  const routines = [];
  for (const routine of template.routines) {
    try {
      const routineName = routine.name.replace(/\s+/gu, " ").trim().slice(0, 80);
      const schedule = routine.schedule.replace(/\s+/gu, " ").trim();
      const before = await gateway.call("getAgentAutomations", { id: agentId });
      if (!Array.isArray(before)) throw new Error("기존 루틴을 확인하지 못해 생성을 건너뛰었습니다.");
      const previousIds = new Set(before.filter(isRecord).map((entry) => entry.id));
      const created = await gateway.call("createAgentAutomation", { id: agentId, spec: { name: routineName, prompt: routine.prompt, trigger: { type: "cron", schedule }, isEnabled: false } });
      if (!Array.isArray(created) || !created.some((entry) => isRecord(entry) && text(entry.id).length > 0 && !previousIds.has(entry.id) && entry.name === routineName && entry.prompt === routine.prompt && entry.trigger?.type === "cron" && text(entry.trigger.schedule).replace(/\s+/gu, " ").trim() === schedule && entry.isEnabled === false)) throw new Error("꺼진 상태의 새 루틴 저장을 확인하지 못했습니다.");
      routines.push(routine.name);
    } catch (error) { issue("routine", routine.name, error); }
  }
  return { bot: { id: agentId, name }, status: issues.length > 0 ? "partial" : "complete", skills, newWorkflowIds: [...newWorkflowIds], routines, issues, source: template.source ?? "template", adaptation };
}

const TEMPLATE_FETCH_HEADERS = { "user-agent": "Mozilla/5.0 (Belmont mobile template import)" };
async function templateFetchText(url) {
  const response = await fetch(url, { headers: TEMPLATE_FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { const error = new Error(`${url} -> ${response.status}`); error.status = 502; throw error; }
  return response.text();
}

const DEFAULT_SESSION_FILE = resolve(APP_ROOT, ".sessions.json");

/** Pairing sessions (token → expiry) kept in a 0600 file so a server restart does not un-pair every phone. */
export function createSessionStore(filePath, now = Date.now) {
  const sessions = new Map();
  if (filePath) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      for (const [token, expiresAt] of Object.entries(parsed?.sessions ?? {})) {
        if (typeof token === "string" && Number.isFinite(expiresAt) && expiresAt > now()) sessions.set(token, expiresAt);
      }
    } catch {
      // first run or unreadable file: start empty
    }
  }
  function persist() {
    if (!filePath) return;
    try {
      writeFileSync(filePath, JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) }), { mode: 0o600 });
    } catch {
      // a failed write only costs re-pairing after the next restart
    }
  }
  return {
    get: (token) => sessions.get(token),
    set(token, expiresAt) { sessions.set(token, expiresAt); persist(); },
    delete(token) { if (sessions.delete(token)) persist(); },
    get size() { return sessions.size; },
  };
}

export function createMobileServer({
  profileDir = process.env.BELMONT_PROFILE_DIR || DEFAULT_PROFILE_DIR,
  distDir = resolve(APP_ROOT, "dist"),
  iconPath = DEFAULT_ICON_PATH,
  pairingCode = process.env.GROK_MOBILE_PAIRING_CODE || String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"),
  trustProxy = process.env.GROK_MOBILE_TRUST_PROXY === "1",
  skipPairing = process.env.GROK_MOBILE_SKIP_PAIRING === "1",
  gateway = createGatewayTransport({ profileDir }),
  codexUsageReader = readCodexUsage,
  filesystemRoots = DEFAULT_FILESYSTEM_ROOTS,
  windowsGatewayUrl = process.env.BELMONT_WINDOWS_GATEWAY_URL || "http://127.0.0.1:4190",
  now = Date.now,
  sessionFile = process.env.GROK_MOBILE_SESSION_FILE === undefined ? DEFAULT_SESSION_FILE : (process.env.GROK_MOBILE_SESSION_FILE || null),
  sendLedgerFile = sessionFile ? `${sessionFile}.sends.json` : null,
  pushFile = sessionFile ? `${sessionFile}.push.json` : null,
  pushSender,
  pushPollIntervalMs = 3000,
  pushErrorHandler = (error) => console.error(`Mobile push: ${error.message}`),
} = {}) {
  const configuredFilesystemRoots = {
    belmontRoot: resolve(text(filesystemRoots?.belmontRoot, DEFAULT_FILESYSTEM_ROOTS.belmontRoot)),
    windowsMountRoot: resolve(text(filesystemRoots?.windowsMountRoot, DEFAULT_FILESYSTEM_ROOTS.windowsMountRoot)),
  };
  const sessions = createSessionStore(sessionFile, now);
  const sends = createMobileSendLedger({ file: sendLedgerFile, now });
  const push = createMobilePushService({ file: pushFile, gateway, now, sender: pushSender, pollIntervalMs: pushPollIntervalMs, onError: pushErrorHandler });
  const pairing = createPairingGuard({ code: pairingCode, now });
  const computerTargets = new Map();
  const configuredWindowsGatewayOrigin = windowsGatewayOrigin(windowsGatewayUrl);
  const websocketServer = new WebSocketServer({ noServer: true });
  let codexUsageCache = null;
  let codexUsagePending = null;

  async function codexUsage() {
    if (codexUsageCache != null && codexUsageCache.expiresAt > now()) return codexUsageCache.value;
    if (codexUsagePending != null) return await codexUsagePending;
    codexUsagePending = Promise.resolve(codexUsageReader()).then((value) => {
      codexUsageCache = { value, expiresAt: now() + 30_000 };
      return value;
    }).finally(() => { codexUsagePending = null; });
    return await codexUsagePending;
  }

  function authorized(request) {
    if (skipPairing) return true;
    const token = cookieMap(request.headers.cookie)[SESSION_COOKIE];
    const expiresAt = token == null ? 0 : sessions.get(token) ?? 0;
    if (expiresAt <= now()) {
      if (token != null) { sessions.delete(token); push.logout(pushDeviceId(token)); }
      return false;
    }
    return true;
  }

  function deviceSession(request) {
    const token = cookieMap(request.headers.cookie)[SESSION_COOKIE];
    if (token && (sessions.get(token) ?? 0) > now()) return { id: pushDeviceId(token), expiresAt: sessions.get(token) };
    // Pairing bypass is only a shared preview identity; production devices use their paired session.
    if (skipPairing) return { id: "preview", expiresAt: now() + SESSION_TTL_MS };
    throw fileSystemError("pairing required", 401);
  }

  async function serveStatic(request, response, pathname) {
    if (pathname === "/icon-192.png" || pathname === "/icon-512.png") {
      const body = await fs.readFile(iconPath);
      response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
      response.end(body);
      return;
    }
    const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
    const distRoot = resolve(distDir);
    let target = resolve(distRoot, relative);
    if (target !== distRoot && !target.startsWith(`${distRoot}${sep}`)) {
      json(response, 404, { error: "not found" });
      return;
    }
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) target = join(target, "index.html");
      const body = await fs.readFile(target);
      response.writeHead(200, { "content-type": STATIC_TYPES[extname(target)] || "application/octet-stream", "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=3600" });
      response.end(body);
    } catch {
      try {
        const body = await fs.readFile(join(distDir, "index.html"));
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
        response.end(body);
      } catch {
        json(response, 503, { error: "Build the mobile app first with npm run build." });
      }
    }
  }

  async function proxyComputerAsset(request, response, botId, assetPath, search) {
    let target = computerTargets.get(botId);
    if (target == null) {
      target = new URL(text((await gateway.call("getForeverBoxStatus", { id: botId }))?.vncUrl));
      computerTargets.set(botId, target);
    }
    const upstream = new URL(assetPath || "/vnc.html", target.origin);
    upstream.search = search;
    const fetched = await fetch(upstream, { headers: { accept: text(request.headers.accept, "*/*") } });
    // Debian/Ubuntu's noVNC package keeps ui.js's optional version lookup but
    // omits the repository package.json from /usr/share/novnc. Keep that
    // packaging detail from surfacing as a false application error.
    if (fetched.status === 404 && assetPath === "/package.json") {
      json(response, 200, { name: "noVNC", version: "system-package" });
      return;
    }
    if (!fetched.ok) {
      json(response, fetched.status, { error: "computer asset unavailable" });
      return;
    }
    const contentType = text(fetched.headers.get("content-type"), "application/octet-stream");
    let body = Buffer.from(await fetched.arrayBuffer());
    if (contentType.includes("javascript")) body = Buffer.from(tuneViewerScript(assetPath, body.toString("utf8")));
    if (contentType.includes("text/html")) {
      const prefix = `/api/bots/${encodeURIComponent(botId)}/computer/proxy`;
      body = Buffer.from(brandViewerHtml(body.toString("utf8").replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${prefix}/`)));
    }
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  }

  function proxyWindowsRequest(request, response, url) {
    if (url.pathname === WINDOWS_GATEWAY_PREFIX) {
      response.writeHead(308, { location: `${WINDOWS_GATEWAY_PREFIX}/${url.search}` });
      response.end();
      return;
    }
    const upstreamUrl = new URL(`${url.pathname}${url.search}`, configuredWindowsGatewayOrigin);
    const transport = upstreamUrl.protocol === "https:" ? https : http;
    const upstream = transport.request(upstreamUrl, {
      method: request.method,
      headers: windowsGatewayHeaders(request, trustProxy),
    }, (upstreamResponse) => {
      if (response.writableEnded) return;
      response.writeHead(upstreamResponse.statusCode || 502, { ...upstreamResponse.headers, "cache-control": "no-store" });
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) json(response, 502, { error: "Windows 화면 게이트웨이에 연결하지 못했습니다." });
      else response.destroy();
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  }

  function requestWindowsGatewayText(path) {
    return new Promise((resolveRequest, rejectRequest) => {
      const upstreamUrl = new URL(path, configuredWindowsGatewayOrigin);
      const transport = upstreamUrl.protocol === "https:" ? https : http;
      const request = transport.get(upstreamUrl, {
        headers: { [WINDOWS_GATEWAY_USER_HEADER]: "hoon" },
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            request.destroy(new Error("Windows gateway response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolveRequest({
          status: response.statusCode || 502,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.setTimeout(5_000, () => request.destroy(new Error("Windows gateway request timed out")));
      request.on("error", rejectRequest);
    });
  }

  async function windowsDesktopLocation() {
    const hostsResponse = await requestWindowsGatewayText(`${WINDOWS_GATEWAY_PREFIX}/api/hosts`);
    if (hostsResponse.status < 200 || hostsResponse.status >= 300) throw fileSystemError("Windows 호스트 정보를 읽지 못했습니다.", 502);

    const hostsById = new Map();
    for (const line of hostsResponse.body.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      let update;
      try { update = JSON.parse(line); } catch { continue; }
      if (Array.isArray(update?.hosts)) {
        for (const host of update.hosts) {
          if (Number.isInteger(host?.host_id)) hostsById.set(host.host_id, host);
        }
      } else if (Number.isInteger(update?.host_id)) {
        hostsById.set(update.host_id, { ...(hostsById.get(update.host_id) || {}), ...update });
      }
    }

    const host = [...hostsById.values()].find((candidate) => candidate.paired === "Paired" && candidate.server_state !== "Offline");
    if (host == null) return `${WINDOWS_GATEWAY_PREFIX}/`;

    const appsResponse = await requestWindowsGatewayText(`${WINDOWS_GATEWAY_PREFIX}/api/apps?host_id=${encodeURIComponent(host.host_id)}`);
    if (appsResponse.status < 200 || appsResponse.status >= 300) throw fileSystemError("Windows 앱 정보를 읽지 못했습니다.", 502);
    const apps = JSON.parse(appsResponse.body)?.apps;
    if (!Array.isArray(apps)) return `${WINDOWS_GATEWAY_PREFIX}/`;

    const desktop = apps.find((app) => text(app?.title).toLocaleLowerCase() === "desktop")
      || apps.find((app) => integer(app?.app_id) === integer(host.current_game));
    if (!Number.isInteger(desktop?.app_id)) return `${WINDOWS_GATEWAY_PREFIX}/`;

    const query = new URLSearchParams({
      hostId: String(host.host_id),
      appId: String(desktop.app_id),
    });
    return `${WINDOWS_GATEWAY_PREFIX}/stream.html?${query}`;
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/session") {
      json(response, 200, { paired: authorized(request), pairingRequired: !skipPairing });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/pair") {
      const body = await readBody(request);
      const result = pairing.verify(text(body.code), clientKey(request, trustProxy));
      if (!result.ok) {
        json(response, 429, { error: "페어링 코드가 올바르지 않습니다.", retryAfterMs: result.retryAfterMs }, { "retry-after": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });
        return;
      }
      const token = crypto.randomBytes(32).toString("base64url");
      sessions.set(token, now() + SESSION_TTL_MS);
      json(response, 200, { paired: true }, { "set-cookie": sessionCookie(token, request, trustProxy) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      const token = cookieMap(request.headers.cookie)[SESSION_COOKIE];
      if (token != null) { sessions.delete(token); push.logout(pushDeviceId(token)); }
      else if (skipPairing) push.logout("preview");
      json(response, 200, { ok: true }, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
      return;
    }
    if (!authorized(request)) {
      json(response, 401, { error: "pairing required" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/push/config") {
      json(response, 200, push.config(deviceSession(request).id));
      return;
    }
    if (url.pathname === "/api/push/preferences") {
      const device = deviceSession(request);
      if (request.method === "GET") { json(response, 200, push.preferences(device.id)); return; }
      if (request.method === "PUT") { json(response, 200, push.setPreferences(device.id, device.expiresAt, await readBody(request))); return; }
    }
    if (url.pathname === "/api/push/subscriptions") {
      const device = deviceSession(request);
      if (request.method === "POST") {
        const body = await readBody(request);
        json(response, 201, await push.subscribe(device.id, device.expiresAt, body.subscription ?? body));
        return;
      }
      if (request.method === "DELETE") {
        const body = await readBody(request);
        push.unsubscribe(device.id, typeof body.endpoint === "string" ? body.endpoint : null);
        json(response, 200, { ok: true });
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/api/filesystem/list") {
      json(response, 200, await listFileSystem(text(url.searchParams.get("scope")), text(url.searchParams.get("path")), configuredFilesystemRoots, url.searchParams.get("offset")));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/filesystem/preview") {
      json(response, 200, await previewFileSystemFile(text(url.searchParams.get("scope")), text(url.searchParams.get("path")), configuredFilesystemRoots));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/filesystem/content") {
      const scope = text(url.searchParams.get("scope"));
      const resolved = await resolveFileSystemTarget(scope, text(url.searchParams.get("path")), configuredFilesystemRoots);
      let stat;
      try { stat = await fs.stat(resolved.target); } catch (error) { throw mapFileSystemError(error); }
      if (!stat.isFile()) throw fileSystemError("파일이 아닙니다.", 400);
      const name = basename(resolved.target);
      const fallbackName = name.replace(/[^\x20-\x7e]|[\\";\r\n]/gu, "_") || "file";
      response.writeHead(200, {
        "content-type": contentTypeFor(name),
        "content-length": String(stat.size),
        "content-disposition": `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "private, no-store",
      });
      const stream = createReadStream(resolved.target);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      const controller = new AbortController();
      request.on("close", () => controller.abort());
      const upstream = await gateway.events(controller.signal);
      if (!upstream.ok || upstream.body == null) {
        json(response, 502, { error: "Belmont event stream unavailable" });
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      const reader = upstream.body.getReader();
      try {
        while (!response.writableEnded) {
          const next = await reader.read();
          if (next.done) break;
          response.write(Buffer.from(next.value));
        }
      } finally {
        reader.releaseLock();
        response.end();
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/bots") {
      const [agents, managerId, settings] = await Promise.all([gateway.call("listAgents"), gateway.managerId(), gateway.call("getHostSettings").catch(() => ({}))]);
      const pinnedIds = Array.isArray(settings?.pinnedAgentIds) ? settings.pinnedAgentIds : [];
      const roster = Array.isArray(agents) ? agents.filter((agent) => !isTransientSubagent(agent)) : [];
      json(response, 200, { bots: roster.map((agent, index) => projectAgent(agent, { managerId, pinnedIds, index })), managerId });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/bots") {
      const body = await readBody(request);
      const name = text(body.name).trim().slice(0, 80);
      if (name.length === 0) {
        const error = new Error("Bot 이름을 입력하세요.");
        error.status = 400;
        throw error;
      }
      const created = await gateway.call("createAgent", {
        name,
        description: text(body.description).trim().slice(0, 500),
        avatarShape: MOBILE_SHAPES.includes(body.shape) ? body.shape : undefined,
        avatarColor: MOBILE_COLORS.includes(body.color) ? body.color : undefined,
        origin: "user",
        isIntroductionSuppressed: false,
        isKickstartRequested: false,
        clientNonce: text(body.clientNonce, crypto.randomUUID()),
      });
      json(response, 201, created);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/groups") {
      const body = await readBody(request);
      const name = text(body.name).trim().slice(0, 80);
      const memberAgentIds = Array.isArray(body.memberAgentIds) ? body.memberAgentIds.filter((id) => typeof id === "string").slice(0, 6) : [];
      if (name.length === 0 || memberAgentIds.length < 2) {
        const error = new Error("그룹 이름과 두 명 이상의 Bot이 필요합니다.");
        error.status = 400;
        throw error;
      }
      const created = await gateway.call("createGroup", { name, description: text(body.description).trim().slice(0, 500), memberAgentIds });
      json(response, 201, { bot: isRecord(created?.agent) ? projectAgent(created.agent) : null });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      json(response, 200, await gatewaySettings(gateway));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/codex/usage") {
      json(response, 200, await codexUsage());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/settings") {
      const body = await readBody(request);
      await updateGatewaySetting(gateway, body);
      json(response, 200, await gatewaySettings(gateway));
      return;
    }
    const messageMatch = /^\/api\/bots\/([^/]+)\/messages$/.exec(url.pathname);
    if (messageMatch != null) {
      const botId = normalizeBotId(messageMatch[1]);
      if (request.method === "GET") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
        const beforeSeq = url.searchParams.has("beforeSeq") ? Number(url.searchParams.get("beforeSeq")) : undefined;
        const page = await gateway.call("getAgentTranscriptTail", { id: botId, limit, ...(Number.isFinite(beforeSeq) ? { beforeSeq } : {}) });
        json(response, 200, { entries: projectTranscriptEntries(page?.entries, botId), nextBeforeSeq: page?.nextBeforeSeq ?? null });
        return;
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        json(response, 202, await sends.send(deviceSession(request).id, botId, body, gateway));
        return;
      }
    }
    const stopMatch = /^\/api\/bots\/([^/]+)\/stop$/.exec(url.pathname);
    if (request.method === "POST" && stopMatch != null) {
      const result = await sends.stop(deviceSession(request).id, normalizeBotId(stopMatch[1]), await readBody(request), gateway);
      json(response, 200, { ok: true, ...result });
      return;
    }
    const threadMatch = /^\/api\/bots\/([^/]+)\/threads\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && threadMatch != null) {
      const botId = normalizeBotId(threadMatch[1]);
      const rootId = normalizeBotId(threadMatch[2]);
      const page = await gateway.call("getAgentThread", { id: botId, rootId });
      json(response, 200, { entries: projectTranscriptEntries(page?.entries, botId) });
      return;
    }
    const reactionMatch = /^\/api\/bots\/([^/]+)\/messages\/([^/]+)\/reaction$/.exec(url.pathname);
    if (request.method === "POST" && reactionMatch != null) {
      const body = await readBody(request);
      const emoji = text(body.emoji).trim();
      if (emoji.length === 0 || emoji.length > 32) {
        const error = new Error("반응 이모지가 올바르지 않습니다.");
        error.status = 400;
        throw error;
      }
      await gateway.call("reactToMessage", { agentId: normalizeBotId(reactionMatch[1]), entryId: normalizeBotId(reactionMatch[2]), emoji });
      json(response, 200, { ok: true });
      return;
    }
    const widgetMatch = /^\/api\/bots\/([^/]+)\/widgets\/([^/]+)$/.exec(url.pathname);
    if (request.method === "POST" && widgetMatch != null) {
      const body = await readBody(request);
      await gateway.call("respondToWidget", { agentId: normalizeBotId(widgetMatch[1]), entryId: normalizeBotId(widgetMatch[2]), value: body.value });
      json(response, 200, { ok: true });
      return;
    }
    const approvalMatch = /^\/api\/bots\/([^/]+)\/approvals\/([^/]+)$/.exec(url.pathname);
    if (request.method === "POST" && approvalMatch != null) {
      const body = await readBody(request);
      const args = { agentId: normalizeBotId(approvalMatch[1]), entryId: normalizeBotId(approvalMatch[2]), requestId: text(body.requestId), resolution: text(body.resolution) };
      if (body.kind === "local-permission") await gateway.call("resolveLocalToolPermission", args);
      else await gateway.call("resolveAutoReviewApproval", args);
      json(response, 200, { ok: true });
      return;
    }
    const readMatch = /^\/api\/bots\/([^/]+)\/read$/.exec(url.pathname);
    if (request.method === "POST" && readMatch != null) {
      // The phone is looking at this conversation: clear the desktop's unread badge the same way the desktop does.
      await gateway.call("setAgentUnread", { id: normalizeBotId(readMatch[1]), isUnread: false, atMs: now() });
      json(response, 200, { ok: true });
      return;
    }
    const hiddenMatch = /^\/api\/bots\/([^/]+)\/hidden$/.exec(url.pathname);
    if (request.method === "POST" && hiddenMatch != null) {
      const body = await readBody(request);
      await gateway.call("setAgentHiddenFromSidebar", { id: normalizeBotId(hiddenMatch[1]), isHidden: body.hidden === true });
      json(response, 200, { ok: true });
      return;
    }
    const profileMatch = /^\/api\/bots\/([^/]+)\/profile$/.exec(url.pathname);
    if (request.method === "POST" && profileMatch != null) {
      const body = await readBody(request);
      const profile = isRecord(body.profile) ? body.profile : {};
      const name = text(profile.name).trim().slice(0, 80);
      if (name.length === 0) {
        const error = new Error("Bot 이름을 입력하세요.");
        error.status = 400;
        throw error;
      }
      const updated = await gateway.call("updateAgent", { id: normalizeBotId(profileMatch[1]), profile: { name, description: text(profile.description).trim().slice(0, 500) } });
      json(response, 200, { bot: isRecord(updated) ? projectAgent(updated) : null });
      return;
    }
    const notificationMatch = /^\/api\/bots\/([^/]+)\/notifications$/.exec(url.pathname);
    if (request.method === "POST" && notificationMatch != null) {
      const body = await readBody(request);
      await gateway.call("setAgentNotifyOnUpdates", { id: normalizeBotId(notificationMatch[1]), isEnabled: body.enabled === true });
      json(response, 200, { ok: true });
      return;
    }
    const membersMatch = /^\/api\/bots\/([^/]+)\/members$/.exec(url.pathname);
    if (request.method === "POST" && membersMatch != null) {
      const body = await readBody(request);
      const memberAgentIds = Array.isArray(body.memberAgentIds) ? body.memberAgentIds.filter((id) => typeof id === "string").slice(0, 6) : [];
      if (memberAgentIds.length === 0) {
        const error = new Error("그룹에는 한 명 이상의 Bot이 필요합니다.");
        error.status = 400;
        throw error;
      }
      const updated = await gateway.call("setGroupMembers", { id: normalizeBotId(membersMatch[1]), memberAgentIds });
      json(response, 200, { bot: isRecord(updated) ? projectAgent(updated) : null });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/search/messages") {
      const query = text(url.searchParams.get("query")).trim();
      json(response, 200, { results: query.length === 0 ? [] : await gateway.call("searchAgents", { query, limit: 50 }) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/search/media") {
      const query = text(url.searchParams.get("query")).trim();
      json(response, 200, { results: await gateway.call("searchMedia", { query, limit: 50 }) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/attachments/preview") {
      const body = await readBody(request);
      const agentId = text(body.agentId);
      const path = text(body.path);
      const name = text(body.name, "Attachment");
      const kind = attachmentKind(name, text(body.mime));
      if (kind === "image") {
        const image = await gateway.call("readAttachmentImage", { path });
        if (!isRecord(image) || typeof image.dataUrl !== "string") {
          const error = new Error("이미지를 읽을 수 없습니다.");
          error.status = 404;
          throw error;
        }
        json(response, 200, { kind: "image", bytes: integer(body.byteSize), dataUrl: image.dataUrl, width: finiteNumber(image.width), height: finiteNumber(image.height), mime: text(body.mime) || null });
        return;
      }
      if (["text", "markdown", "json"].includes(kind)) {
        const preview = await gateway.call("readAttachmentText", { path, agentId });
        if (preview?.kind === "text") {
          json(response, 200, { kind: "text", bytes: integer(preview.bytes, integer(body.byteSize)), text: text(preview.text), truncated: preview.truncated === true, mime: text(body.mime) || null });
          return;
        }
      }
      const contentUrl = `/api/attachments/content?agentId=${encodeURIComponent(agentId)}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
      json(response, 200, { kind: kind === "pdf" ? "pdf" : ["video", "audio"].includes(kind) ? "media" : "binary", bytes: integer(body.byteSize), contentUrl, mime: text(body.mime) || null });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/attachments/content") {
      const path = text(url.searchParams.get("path"));
      const agentId = text(url.searchParams.get("agentId"));
      const name = text(url.searchParams.get("name"), "attachment.bin").replace(/[\r\n"]/gu, "_");
      const result = await readAttachmentBytes(gateway, { path, agentId });
      if (result == null) {
        const error = new Error("첨부 파일을 읽을 수 없습니다.");
        error.status = 404;
        throw error;
      }
      response.writeHead(200, { "content-type": contentTypeFor(name, result.mime || undefined), "content-length": String(result.bytes.length), "content-disposition": inlineAttachmentDisposition(name), "cache-control": "private, no-store" });
      response.end(result.bytes);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/attachments/share") {
      const body = await readBody(request);
      const source = await readAttachmentBytes(gateway, { path: text(body.path), agentId: text(body.agentId) });
      if (source == null) {
        const error = new Error("공유할 파일을 읽을 수 없습니다.");
        error.status = 404;
        throw error;
      }
      const targetAgentId = text(body.targetAgentId);
      const name = text(body.name, "attachment.bin").slice(0, 255);
      const uploaded = await gateway.call("uploadAttachment", { filename: name, bytesBase64: source.bytes.toString("base64"), agentId: targetAgentId });
      await gateway.call("sendPrompt", { agentId: targetAgentId, prompt: text(body.message).trim(), attachmentPaths: [uploaded.path], attachmentNames: [name], directAddressedAcceptance: true, clientNonce: crypto.randomUUID(), enterEpochMs: now(), composedAtMs: now() });
      json(response, 202, { accepted: true });
      return;
    }
    const routinesMatch = /^\/api\/bots\/([^/]+)\/routines$/.exec(url.pathname);
    if (routinesMatch != null) {
      const botId = normalizeBotId(routinesMatch[1]);
      if (request.method === "GET") {
        json(response, 200, { routines: await gateway.call("getAgentAutomations", { id: botId }) });
        return;
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        json(response, 201, { routines: await gateway.call("createAgentAutomation", { id: botId, spec: body.spec }) });
        return;
      }
    }
    const routineMatch = /^\/api\/bots\/([^/]+)\/routines\/([^/]+)$/.exec(url.pathname);
    if (routineMatch != null) {
      const botId = normalizeBotId(routineMatch[1]);
      const routineId = normalizeBotId(routineMatch[2]);
      if (request.method === "PATCH") {
        const body = await readBody(request);
        json(response, 200, { routines: await gateway.call("updateAgentAutomation", { id: botId, automationId: routineId, spec: body.spec }) });
        return;
      }
      if (request.method === "DELETE") {
        await gateway.call("deleteAgentAutomation", { id: botId, automationId: routineId });
        json(response, 200, { routines: await gateway.call("getAgentAutomations", { id: botId }) });
        return;
      }
    }
    const routineEnabledMatch = /^\/api\/bots\/([^/]+)\/routines\/([^/]+)\/enabled$/.exec(url.pathname);
    if (request.method === "POST" && routineEnabledMatch != null) {
      const body = await readBody(request);
      const botId = normalizeBotId(routineEnabledMatch[1]);
      await gateway.call("setAgentAutomationEnabled", { id: botId, automationId: normalizeBotId(routineEnabledMatch[2]), isEnabled: body.isEnabled === true });
      json(response, 200, { routines: await gateway.call("getAgentAutomations", { id: botId }) });
      return;
    }
    const routineRunMatch = /^\/api\/bots\/([^/]+)\/routines\/([^/]+)\/run$/.exec(url.pathname);
    if (request.method === "POST" && routineRunMatch != null) {
      await gateway.call("runAgentAutomationNow", { id: normalizeBotId(routineRunMatch[1]), automationId: normalizeBotId(routineRunMatch[2]) });
      json(response, 200, { ok: true });
      return;
    }
    const templateMatch = /^\/api\/bots\/([^/]+)\/template$/.exec(url.pathname);
    if (request.method === "GET" && templateMatch != null) {
      json(response, 200, { template: await exportBotTemplate(gateway, normalizeBotId(templateMatch[1])) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/templates/import") {
      const body = await readBody(request);
      json(response, 201, await importBotTemplate(gateway, body, { fetchText: templateFetchText, now }));
      return;
    }
    const formMatch = /^\/api\/bots\/([^/]+)\/form$/.exec(url.pathname);
    if (request.method === "POST" && formMatch != null) {
      const botId = normalizeBotId(formMatch[1]);
      const body = await readBody(request);
      const prompt = formatFormPrompt(body);
      if (prompt == null) { const error = new Error("보낼 항목이 없습니다."); error.status = 400; throw error; }
      await sends.send(deviceSession(request).id, botId, { text: prompt, clientNonce: text(body.clientNonce, crypto.randomUUID()) }, gateway);
      json(response, 200, { ok: true, prompt });
      return;
    }
    const memoriesMatch = /^\/api\/bots\/([^/]+)\/memories(?:\/([^/]+))?$/.exec(url.pathname);
    if (memoriesMatch != null) {
      const botId = normalizeBotId(memoriesMatch[1]);
      if (request.method === "GET" && memoriesMatch[2] == null) { json(response, 200, { memories: await gateway.call("getAgentMemories", { id: botId }) }); return; }
      if (request.method === "POST" && memoriesMatch[2] == null) {
        const body = await readBody(request);
        const content = text(body.content).trim();
        if (content.length === 0) { const error = new Error("내용이 비어 있습니다."); error.status = 400; throw error; }
        json(response, 201, { memory: await gateway.call("addAgentMemory", { id: botId, content: content.slice(0, 2000), tier: body.tier === "profile" ? "profile" : "log" }) });
        return;
      }
      if (request.method === "DELETE" && memoriesMatch[2] != null) {
        await gateway.call("deleteAgentMemory", { id: botId, memoryId: normalizeBotId(memoriesMatch[2]) });
        json(response, 200, { ok: true });
        return;
      }
    }
    const modelMatch = /^\/api\/bots\/([^/]+)\/model$/.exec(url.pathname);
    if (modelMatch != null) {
      const botId = normalizeBotId(modelMatch[1]);
      if (request.method === "GET") { json(response, 200, { ...(await gateway.call("getAgentModelSelection", { id: botId })), models: AVAILABLE_MODELS }); return; }
      if (request.method === "POST") {
        const body = await readBody(request);
        const selection = body.selection == null ? null : normalizeModelSelection(body.selection);
        if (body.selection != null && selection == null) { const error = new Error("지원하지 않는 모델 선택입니다."); error.status = 400; throw error; }
        json(response, 200, { ...(await gateway.call("setAgentModelSelection", { id: botId, selection })), models: AVAILABLE_MODELS });
        return;
      }
    }
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      json(response, 201, { ok: true, record: await appendFeedback(profileDir, await readBody(request), now) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/skills") {
      const query = text(url.searchParams.get("query")).trim().toLocaleLowerCase();
      const catalog = await gateway.call("skillsCatalog");
      const skills = Array.isArray(catalog) ? catalog.filter((skill) => isRecord(skill) && (query.length === 0 || `${text(skill.name)} ${text(skill.description)} ${text(skill.publisher)}`.toLocaleLowerCase().includes(query))).slice(0, 100) : [];
      json(response, 200, { skills });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/tools") {
      const tools = await gateway.call("listRoutedMcpTools");
      json(response, 200, { tools: Array.isArray(tools) ? tools : [] });
      return;
    }
    const computerMatch = /^\/api\/bots\/([^/]+)\/computer$/.exec(url.pathname);
    if (request.method === "GET" && computerMatch != null) {
      const botId = normalizeBotId(computerMatch[1]);
      const requestedWindowIndex = url.searchParams.has("windowIndex") ? Number(url.searchParams.get("windowIndex")) : null;
      json(response, 200, computerView(await gateway.call("getForeverBoxStatus", { id: botId }), botId, computerTargets, Number.isInteger(requestedWindowIndex) ? requestedWindowIndex : null));
      return;
    }
    const ensureMatch = /^\/api\/bots\/([^/]+)\/computer\/ensure$/.exec(url.pathname);
    if (request.method === "POST" && ensureMatch != null) {
      const botId = normalizeBotId(ensureMatch[1]);
      json(response, 200, computerView(await gateway.call("ensureForeverBox", { id: botId }), botId, computerTargets));
      return;
    }
    const resetMatch = /^\/api\/bots\/([^/]+)\/computer\/reset$/.exec(url.pathname);
    if (request.method === "POST" && resetMatch != null) {
      const botId = normalizeBotId(resetMatch[1]);
      await gateway.call("resetForeverBox", { id: botId });
      computerTargets.delete(botId);
      json(response, 200, computerView(await gateway.call("getForeverBoxStatus", { id: botId }), botId, computerTargets));
      return;
    }
    const proxyMatch = /^\/api\/bots\/([^/]+)\/computer\/proxy(\/.*)?$/.exec(url.pathname);
    if (request.method === "GET" && proxyMatch != null) {
      await proxyComputerAsset(request, response, normalizeBotId(proxyMatch[1]), proxyMatch[2] || "/vnc.html", url.search);
      return;
    }
    json(response, 404, { error: "not found" });
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/health") {
        json(response, 200, { ok: true, app: "grok-mobile-belmont-pwa" });
      } else if (url.pathname === `${WINDOWS_GATEWAY_PREFIX}/desktop`) {
        if (!authorized(request)) json(response, 401, { error: "pairing required" });
        else {
          response.writeHead(302, { location: await windowsDesktopLocation(), "cache-control": "no-store" });
          response.end();
        }
      } else if (url.pathname === WINDOWS_GATEWAY_PREFIX || url.pathname.startsWith(`${WINDOWS_GATEWAY_PREFIX}/`)) {
        if (!authorized(request)) json(response, 401, { error: "pairing required" });
        else proxyWindowsRequest(request, response, url);
      } else if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
      } else {
        await serveStatic(request, response, url.pathname);
      }
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      json(response, status, { error: publicError(error) });
    }
  });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith(`${WINDOWS_GATEWAY_PREFIX}/`)) {
      if (!authorized(request)) return socket.destroy();
      try {
        const origin = new URL(configuredWindowsGatewayOrigin);
        const upstreamUrl = `${origin.protocol === "https:" ? "wss" : "ws"}://${origin.host}${url.pathname}${url.search}`;
        websocketServer.handleUpgrade(request, socket, head, (client) => {
          const upstream = new WebSocket(upstreamUrl, { headers: windowsGatewayHeaders(request, trustProxy) });
          const pending = [];
          let pendingBytes = 0;
          client.on("message", (data, binary) => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
            else if (upstream.readyState === WebSocket.CONNECTING && pendingBytes + data.byteLength <= 1024 * 1024) {
              pending.push({ data, binary });
              pendingBytes += data.byteLength;
            }
          });
          upstream.on("open", () => {
            for (const message of pending.splice(0)) {
              if (upstream.readyState !== WebSocket.OPEN) break;
              upstream.send(message.data, { binary: message.binary });
            }
            pendingBytes = 0;
          });
          upstream.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
          const close = () => {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
            if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
          };
          client.on("close", close);
          client.on("error", close);
          upstream.on("close", close);
          upstream.on("error", close);
        });
      } catch {
        socket.destroy();
      }
      return;
    }
    const match = /^\/api\/bots\/([^/]+)\/computer\/websockify$/.exec(url.pathname);
    if (match == null || !authorized(request)) return socket.destroy();
    const botId = normalizeBotId(match[1]);
    try {
      let target = computerTargets.get(botId);
      if (target == null) {
        const status = await gateway.call("getForeverBoxStatus", { id: botId });
        target = new URL(text(status?.vncUrl));
        computerTargets.set(botId, target);
      }
      const upstreamPath = target.searchParams.get("path") || "websockify";
      const upstreamUrl = `${target.protocol === "https:" ? "wss" : "ws"}://${target.host}/${upstreamPath.replace(/^\/+/, "")}`;
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        const upstream = new WebSocket(upstreamUrl);
        const pending = [];
        let pendingBytes = 0;
        client.on("message", (data, binary) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary });
            return;
          }
          const size = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
          if (upstream.readyState === WebSocket.CONNECTING && pendingBytes + size <= 1024 * 1024) {
            pending.push({ data, binary });
            pendingBytes += size;
          }
        });
        upstream.on("open", () => {
          for (const message of pending.splice(0)) {
            if (upstream.readyState !== WebSocket.OPEN) break;
            upstream.send(message.data, { binary: message.binary });
          }
          pendingBytes = 0;
        });
        upstream.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
        const close = () => {
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
        };
        client.on("close", close);
        client.on("error", close);
        upstream.on("close", close);
        upstream.on("error", close);
      });
    } catch {
      socket.destroy();
    }
  });

  server.on("listening", () => push.start());
  server.on("close", () => push.close());
  return { server, pairingCode, sessions, computerTargets, push };
}

async function main() {
  const port = Number(process.env.GROK_MOBILE_PORT || "4187");
  const host = process.env.GROK_MOBILE_HOST || "127.0.0.1";
  const app = createMobileServer();
  app.server.listen(port, host, () => {
    console.log(`Linear Grok Mobile: http://${host}:${port}`);
    console.log(`Pairing code: ${app.pairingCode}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
