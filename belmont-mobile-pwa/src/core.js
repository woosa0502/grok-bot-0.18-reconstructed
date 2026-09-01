export const STORAGE_KEY = "belmont.mobile.connection.v1";

const MAUS_COLORS = Object.freeze({
  green: "#009957",
  blue: "#377FE6",
  red: "#D94B52",
  orange: "#E78531",
  purple: "#8057C8",
  cyan: "#0EA5C6",
  pink: "#D84F8B",
  yellow: "#D8A729",
  teal: "#01A492",
  coral: "#E5634E",
  neutral: "#8E8E93"
});

export function resolveMausColor(value, fallback = "neutral") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  return MAUS_COLORS[normalized] ?? MAUS_COLORS[fallback] ?? MAUS_COLORS.neutral;
}

export function parsePairingInvite(value) {
  let url;
  try { url = new URL(String(value ?? "")); } catch { return null; }
  if (url.protocol.toLowerCase() !== "openmausbot:" || url.hostname.toLowerCase() !== "pair") return null;
  const values = new Map();
  for (const [key, item] of url.searchParams) {
    if (values.has(key)) return null;
    values.set(key, item);
  }
  const address = values.get("address");
  const token = values.get("token");
  const code = values.get("code");
  const credential = token && /^omb_pair_[A-Za-z0-9_-]{43}$/.test(token)
    ? token
    : !token && /^\d{6}$/.test(code ?? "") ? code : null;
  if (!address || /[\s/?#]/.test(address) && !/^https?:\/\//i.test(address) || !credential) return null;

  let baseUrl = null;
  const encodedEndpoints = values.get("endpoints");
  if (values.has("endpoints")) {
    if (!encodedEndpoints || !/^[A-Za-z0-9_-]{1,8192}$/.test(encodedEndpoints)) return null;
    try {
      const padded = encodedEndpoints.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - encodedEndpoints.length % 4) % 4);
      const endpoints = JSON.parse(atob(padded));
      if (!Array.isArray(endpoints) || endpoints.length === 0 || endpoints.length > 8) return null;
      const normalized = endpoints.map((entry, index) => {
        if (!entry || typeof entry.url !== "string" || !Number.isFinite(Number(entry.priority ?? 0))) throw new Error("invalid endpoint");
        return { baseUrl: normalizeBaseUrl(entry.url), priority: Number(entry.priority ?? 0), index };
      });
      const candidate = normalized.sort((a, b) => a.priority - b.priority || a.index - b.index)[0];
      baseUrl = candidate.baseUrl;
    } catch { return null; }
  }
  try {
    if (!baseUrl) baseUrl = /^https?:\/\//i.test(address)
      ? normalizeBaseUrl(address)
      : normalizeBaseUrl(`http://${address}${/(:\d+|\]:\d+)$/.test(address) ? "" : ":8810"}`);
  } catch { return null; }

  const rawName = String(values.get("name") ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return { baseUrl, credential, name: rawName.slice(0, 80) || "Belmont computer" };
}

export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return window.location.origin;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("HTTPS 또는 HTTP 주소만 사용할 수 있습니다.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function createSendId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `send-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export function normalizeFleet(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const bots = Array.isArray(source.bots) ? source.bots.filter(validBot).map(normalizeBot) : [];
  const groups = Array.isArray(source.groups) ? source.groups.filter(validGroup) : [];
  return { bots, groups };
}

function validBot(bot) {
  return bot && typeof bot === "object" && typeof bot.id === "string" && typeof bot.name === "string";
}

function validGroup(group) {
  return group && typeof group === "object" && typeof group.id === "string";
}

function normalizeBot(bot) {
  return {
    ...bot,
    id: bot.id,
    threadId: typeof bot.threadId === "string" ? bot.threadId : bot.id,
    name: bot.name,
    title: typeof bot.title === "string" ? bot.title : "",
    description: typeof bot.description === "string" ? bot.description : "",
    color: typeof bot.color === "string" ? bot.color : "neutral",
    ...(typeof bot.shape === "string" && bot.shape ? { shape: bot.shape } : {}),
    unread: Boolean(bot.unread),
    busy: Boolean(bot.busy),
    composing: Boolean(bot.composing),
    activity: bot.activity && typeof bot.activity === "object" ? bot.activity : null,
    chiefOfStaff: Boolean(bot.chiefOfStaff),
    hidden: Boolean(bot.hidden),
    pinned: Boolean(bot.pinned),
    messages: Array.isArray(bot.messages) ? bot.messages : []
  };
}

export function getManagerBot(fleet) {
  const visible = (fleet?.bots ?? []).filter((bot) => !bot.hidden);
  return visible.find((bot) => bot.chiefOfStaff)
    ?? visible.find((bot) => bot.name.trim().toLowerCase() === "belmont")
    ?? null;
}

export function getWorkerBots(fleet, managerId) {
  return (fleet?.bots ?? []).filter((bot) => !bot.hidden && bot.id !== managerId);
}

export function responseBehavior(choice, isPermission = true) {
  if (!isPermission) return "answer";
  const normalized = String(choice ?? "").trim().toLowerCase();
  return ["deny", "cancel", "dismiss", "거절"].includes(normalized) ? "deny" : "allow";
}

export function pendingApproval(messages) {
  return [...(messages ?? [])].reverse().find((message) => {
    const card = message?.card;
    return message?.kind === "options" && card?.requestId && !card?.answered && card?.dismissed !== true;
  }) ?? null;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Minimal safe markdown for bot messages: everything is HTML-escaped first,
   then a small set of structures is recognized — fenced code, lists, tables,
   headings, inline bold/italic/code. No raw HTML ever passes through. */
export function renderMarkdown(source) {
  const lines = String(source ?? "").split("\n");
  const html = [];
  let index = 0;
  const inline = (value) => escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  const isList = (line) => /^\s*[-*]\s+/.test(line);
  const isOrdered = (line) => /^\s*\d+[.)]\s+/.test(line);
  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isHeading = (line) => /^#{1,4}\s+/.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      const buffer = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) buffer.push(lines[index++]);
      index += 1;
      html.push(`<div class="md-code-wrap"><pre class="md-code">${escapeHtml(buffer.join("\n"))}</pre><button class="code-copy" type="button" data-action="copy-code" aria-label="코드 복사"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg></button></div>`);
      continue;
    }
    if (isList(line)) {
      const items = [];
      while (index < lines.length && isList(lines[index])) items.push(`<li>${inline(lines[index++].replace(/^\s*[-*]\s+/, ""))}</li>`);
      html.push(`<ul class="md-list">${items.join("")}</ul>`);
      continue;
    }
    if (isOrdered(line)) {
      const items = [];
      while (index < lines.length && isOrdered(lines[index])) items.push(`<li>${inline(lines[index++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      html.push(`<ol class="md-list">${items.join("")}</ol>`);
      continue;
    }
    if (isTableRow(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? "")) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && isTableRow(lines[index])) rows.push(cells(lines[index++]));
      html.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (isHeading(line)) {
      html.push(`<p class="md-heading">${inline(line.replace(/^#{1,4}\s+/, ""))}</p>`);
      index += 1;
      continue;
    }
    if (!line.trim()) { index += 1; continue; }
    const buffer = [];
    while (index < lines.length && lines[index].trim()
      && !/^\s*```/.test(lines[index]) && !isList(lines[index]) && !isOrdered(lines[index]) && !isHeading(lines[index]) && !isTableRow(lines[index])) {
      buffer.push(inline(lines[index++]));
    }
    html.push(`<p>${buffer.join("<br />")}</p>`);
  }
  return html.join("");
}

export function formatClock(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatDay(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short" }).format(date);
}

export function messageText(message) {
  if (typeof message?.text === "string" && message.text.trim()) return message.text.trim();
  if (message?.kind === "activity" && message?.tool?.spoken) return message.tool.spoken;
  return "";
}

export function endsMessageRun(messages, index) {
  const current = messages?.[index];
  const next = messages?.[index + 1];
  if (!current || !next) return true;
  return current.role !== next.role || !messageText(next) || next.kind === "options" || next.kind === "activity";
}
