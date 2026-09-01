import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";

const CONNECT_TIMEOUT_MS = 5_000;
const FORWARDED_WEBSOCKET_HEADERS = [
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "sec-websocket-extensions",
  "user-agent",
];

export function proxyWebSocketUpgrade({
  request,
  socket,
  head,
  target,
  extraHeaders = {},
  timeoutMs = CONNECT_TIMEOUT_MS,
}) {
  const targetUrl = target instanceof URL ? target : new URL(target);
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return writeUpgradeError(socket, 502, "unsupported WebSocket upstream");
  }

  const port = Number(targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return writeUpgradeError(socket, 502, "invalid WebSocket upstream port");
  }
  const host = targetUrl.hostname;
  const connect = targetUrl.protocol === "https:"
    ? () => connectTls({ host, port, servername: host })
    : () => connectTcp({ host, port });
  const upstream = connect();
  let connected = false;
  const deadline = setTimeout(() => {
    if (!connected) writeUpgradeError(socket, 504, "WebSocket upstream timed out");
    upstream.destroy();
  }, timeoutMs);
  deadline.unref?.();

  const fail = () => {
    clearTimeout(deadline);
    if (!connected) writeUpgradeError(socket, 502, "WebSocket upstream unavailable");
    else socket.destroy();
  };
  upstream.once("error", fail);
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());

  const onConnected = () => {
    connected = true;
    clearTimeout(deadline);
    const lines = [
      `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1`,
      `Host: ${targetUrl.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
    ];
    for (const name of FORWARDED_WEBSOCKET_HEADERS) {
      const value = singleHeader(request.headers[name]);
      if (value != null) lines.push(`${canonicalHeaderName(name)}: ${value}`);
    }
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (typeof value === "string" && value.length > 0) lines.push(`${name}: ${value}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  };
  if (targetUrl.protocol === "https:") upstream.once("secureConnect", onConnected);
  else upstream.once("connect", onConnected);
}

export function writeUpgradeError(socket, status, message) {
  if (socket.destroyed || socket.writableEnded) return;
  const reason = status === 401 ? "Unauthorized"
    : status === 403 ? "Forbidden"
      : status === 404 ? "Not Found"
        : status === 409 ? "Conflict"
          : status === 504 ? "Gateway Timeout"
            : "Bad Gateway";
  const body = `${message}\n`;
  socket.end([
    `HTTP/1.1 ${status} ${reason}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"));
}

function singleHeader(value) {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" && !/[\r\n]/u.test(value) ? value : null;
}

function canonicalHeaderName(name) {
  return name.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join("-");
}
