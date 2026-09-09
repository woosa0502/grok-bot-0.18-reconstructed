// belmont-browse: Chrome over --remote-debugging-pipe (no TCP port) + a token-gated local WebSocket relay (our code).
// Chrome reads CDP messages on fd 3 and writes replies/events on fd 4; each message is JSON followed by a NUL byte.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { findChromeBinary } from "./chrome.mjs";
import { createOwnedChromeStop, observeChild } from "./browser-lifecycle.mjs";

export function launchChromeWithPipe({ profileDir, display = ":99", windowSize = "1280,800", startUrl = "about:blank", log = console.error, chromeBinary, nativeComponentVersion, asideHome }) {
  mkdirSync(profileDir, { recursive: true });
  const bin = chromeBinary ?? findChromeBinary();
  const args = [
    "--remote-debugging-pipe",
    `--user-data-dir=${profileDir}`,
    `--window-size=${windowSize}`,
    "--window-position=0,0",
    "--no-first-run",
    ...(process.env.BELMONT_BROWSE_NO_SANDBOX ? ["--no-sandbox"] : []),
    // Original Aside Browsing Agent extension (built by tools/build-aside-ext.mjs). Branded Google Chrome ignores
    // --load-extension since 137; point BELMONT_BROWSE_CHROME at a Chromium/Chrome-for-Testing build.
    ...(process.env.BELMONT_BROWSE_EXTENSION ? [`--disable-extensions-except=${process.env.BELMONT_BROWSE_EXTENSION}`, `--load-extension=${process.env.BELMONT_BROWSE_EXTENSION}`] : []),
    "--no-default-browser-check",
    "--disable-features=TranslateUI",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--password-store=basic",
    ...(nativeComponentVersion ? [`--aside-component-version=${nativeComponentVersion}`] : []),
    startUrl,
  ];
  // stdio: 0 stdin, 1 stdout, 2 stderr, 3 = Chrome's CDP input (we write), 4 = Chrome's CDP output (we read)
  const child = spawn(bin, args, { env: { ...process.env, DISPLAY: display, ...(asideHome ? { ASIDE_HOME: path.resolve(asideHome) } : {}) }, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderrTail = "";
  child.stderr.on("data", (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-2000); });
  child.on("exit", (code, signal) => log(`[chrome] exited code=${code} signal=${signal} ${stderrTail.split("\n").slice(-2).join(" | ")}`));
  log(`[chrome] started ${path.basename(bin)} pid=${child.pid} display=${display} transport=pipe (no debugging port)`);
  return child;
}

/** Multiplexes clients and owned startup/shutdown probes on one Chrome pipe. */
export function createCdpRelay({ child, port = 9341, token = randomBytes(24).toString("hex"), log = console.error, drainTimeoutMs = 1000 }) {
  const toChrome = child.stdio?.[3];
  const fromChrome = child.stdio?.[4];
  if (!toChrome?.write || !fromChrome?.on) throw new Error("Chrome debugging pipe is unavailable");
  const clients = new Set();
  const sockets = new Set();
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  let closing = false;
  let closePromise = null;
  let actualPort = port;
  const stats = { sent: 0, received: 0, events: 0 };

  const finish = (id, error, result, packet) => {
    const route = pending.get(id);
    if (!route) return;
    pending.delete(id); clearTimeout(route.timer);
    if (route.client) {
      if (route.client.readyState === route.client.OPEN) route.client.send(JSON.stringify(packet ? { ...packet, id: route.id } : { id: route.id, ...(error ? { error: { code: -32000, message: error.message } } : { result: result ?? {} }) }));
    } else if (error) route.reject(error);
    else route.resolve(result ?? {});
  };
  const failAll = (error) => { for (const id of [...pending.keys()]) finish(id, error); };
  const onData = (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf("\0")) !== -1) {
      const raw = buffer.slice(0, cut); buffer = buffer.slice(cut + 1);
      if (!raw) continue;
      stats.received++;
      let message;
      try { message = JSON.parse(raw); } catch { continue; }
      if (!message || typeof message !== "object" || Array.isArray(message)) continue;
      if (typeof message.id === "number") finish(message.id, message.error ? new Error(message.error.message) : null, message.result, message);
      else {
        stats.events++;
        for (const client of clients) if (client.readyState === client.OPEN) client.send(raw);
      }
    }
  };
  const onPipeEnd = () => { failAll(new Error("Chrome debugging pipe closed")); void close().catch((error) => log(`[relay] close failed: ${error.message}`)); };
  const onPipeError = (error) => { failAll(error); void close().catch((value) => log(`[relay] close failed: ${value.message}`)); };
  const onChildExit = () => onPipeEnd();
  fromChrome.setEncoding("utf8");
  fromChrome.on("data", onData); fromChrome.on("end", onPipeEnd); fromChrome.on("error", onPipeError);
  toChrome.on("error", onPipeError);
  child.on("exit", onChildExit); child.on("error", onPipeError);

  const writeToChrome = (message) => {
    if (closing || toChrome.destroyed || !toChrome.writable) throw new Error("Chrome debugging pipe is closed");
    stats.sent++;
    toChrome.write(JSON.stringify(message) + "\0", (error) => { if (error) finish(message.id, error); });
  };
  const request = (method, params = {}, { timeoutMs = 20000, signal } = {}) => {
    if (closing || signal?.aborted) return Promise.reject(new Error("CDP relay is closed"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => finish(id, signal.reason instanceof Error ? signal.reason : new Error("CDP request aborted"));
      const settle = (callback) => (value) => { signal?.removeEventListener("abort", abort); callback(value); };
      const timer = setTimeout(() => finish(id, new Error(`${method}: Chrome pipe timeout after ${timeoutMs}ms`)), timeoutMs);
      pending.set(id, { resolve: settle(resolve), reject: settle(reject), timer });
      signal?.addEventListener("abort", abort, { once: true });
      try { writeToChrome({ id, method, params }); } catch (error) { finish(id, error); }
    });
  };

  const server = http.createServer((req, res) => {
    if (closing) { res.writeHead(503); res.end("relay closing"); return; }
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { res.writeHead(400); res.end(); return; }
    if (url.searchParams.get("token") !== token) { res.writeHead(401); res.end("unauthorized"); return; }
    if (url.pathname === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Browser: "belmont-browse relay (Chrome pipe)", "Protocol-Version": "1.3", webSocketDebuggerUrl: `ws://127.0.0.1:${actualPort}/cdp?token=${token}` }));
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
  const onUpgrade = (req, socket, head) => {
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { socket.destroy(); return; }
    if (closing || url.pathname !== "/cdp" || url.searchParams.get("token") !== token) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("error", () => {});
      ws.on("message", (data) => {
        if (closing) return;
        let message;
        try { message = JSON.parse(data.toString()); } catch { return; }
        if (!message || typeof message !== "object" || Array.isArray(message)) return;
        if (typeof message.id !== "number") return;
        const id = nextId++;
        pending.set(id, { client: ws, id: message.id });
        try { writeToChrome({ ...message, id }); } catch (error) { finish(id, error); }
      });
      ws.on("close", () => { clients.delete(ws); for (const [id, route] of pending) if (route.client === ws) { clearTimeout(route.timer); pending.delete(id); } });
    });
  };
  server.on("upgrade", onUpgrade);
  let onBindError;
  const ready = new Promise((resolve, reject) => {
    onBindError = reject;
    server.once("error", onBindError);
    server.listen(port, "127.0.0.1", () => {
      actualPort = server.address().port;
      server.off("error", onBindError);
      resolve();
    });
  });
  const onServerError = (error) => { if (!closing) log(`[relay] server error: ${error.message}`); };
  server.on("error", onServerError);

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    failAll(new Error("CDP relay is closing"));
    fromChrome.off("data", onData); fromChrome.off("end", onPipeEnd); fromChrome.off("error", onPipeError);
    toChrome.off("error", onPipeError);
    // Pending OS writes may fail after listeners are detached; these owned pipes can
    // remain alive with a preserved Chrome on timeout. Keep an error sink until close.
    for (const stream of [toChrome, fromChrome]) {
      const ignore = () => {};
      stream.on("error", ignore);
      stream.once("close", () => stream.off("error", ignore));
    }
    child.off("exit", onChildExit); child.off("error", onPipeError);
    server.off("upgrade", onUpgrade);
    closePromise = (async () => {
      await ready.catch(() => {});
      const drained = Promise.all([
        new Promise((resolve) => wss.close(() => resolve())),
        new Promise((resolve, reject) => server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve())),
      ]);
      for (const client of clients) client.close(1001, "relay closing");
      server.closeIdleConnections?.();
      const timer = setTimeout(() => {
        // These sockets belong to this relay; closing them does not kill Chrome.
        for (const client of clients) client.terminate();
        for (const socket of sockets) socket.destroy();
      }, drainTimeoutMs);
      try { await drained; }
      finally {
        clearTimeout(timer); clients.clear(); sockets.clear(); buffer = "";
        server.off("error", onBindError); server.off("error", onServerError);
      }
    })();
    return closePromise;
  }

  return {
    get port() { return actualPort; }, token,
    get wsUrl() { return `ws://127.0.0.1:${actualPort}/cdp?token=${token}`; },
    get httpUrl() { return `http://127.0.0.1:${actualPort}`; },
    ready, stats, request, clientCount: () => clients.size, close,
  };
}

export async function startPipedChrome({ profileDir, display, windowSize, startUrl, port, log = console.error, chromeBinary, nativeComponentVersion, asideHome, startupTimeoutMs = 20000, shutdownTimeoutMs = 10000, drainTimeoutMs = 1000 }) {
  const child = launchChromeWithPipe({ profileDir, display, windowSize, startUrl, log, chromeBinary, nativeComponentVersion, asideHome });
  const observed = observeChild(child);
  let relay;
  const stopChild = createOwnedChromeStop({ child, observed, profileDir, timeoutMs: shutdownTimeoutMs, log,
    requestClose: ({ signal }) => new Promise((resolve, reject) => {
      const input = child.stdio?.[3];
      if (!input?.writable || input.destroyed) { reject(new Error("Chrome debugging pipe is unavailable")); return; }
      const abort = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Browser close aborted"));
      const finish = (error) => { signal.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
      if (signal.aborted) { reject(signal.reason); return; }
      signal.addEventListener("abort", abort, { once: true });
      // Sending directly keeps an owned graceful recovery path after the public relay
      // has closed. Browser.close may end the pipe before sending an acknowledgement.
      try { input.write(JSON.stringify({ id: 2147483647, method: "Browser.close" }) + "\0", finish); }
      catch (error) { finish(error); }
    }),
  });
  const stop = async () => {
    try { await stopChild(); }
    finally { await relay?.close(); }
  };
  try {
    relay = createCdpRelay({ child, port, log, drainTimeoutMs });
    await relay.ready;
    if (observed.error) throw observed.error;
    await relay.request("Browser.getVersion", {}, { timeoutMs: startupTimeoutMs });
    log(`[relay] CDP relay listening on ${relay.httpUrl} (token-gated, loopback only)`);
    return { child, relay, wsUrl: relay.wsUrl, baseUrl: relay.httpUrl, token: relay.token, stop };
  } catch (error) {
    error = observed.error ?? error;
    try { await stop(); }
    catch (cleanupError) {
      const combined = new AggregateError([error, cleanupError], `Chrome pipe startup failed and graceful cleanup requires recovery: ${cleanupError.message}`);
      combined.recoverable = true; combined.pid = child.pid; combined.profileDir = profileDir; combined.stop = stop;
      throw combined;
    }
    throw error;
  }
}
