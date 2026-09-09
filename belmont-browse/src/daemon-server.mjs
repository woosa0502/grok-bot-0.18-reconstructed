// belmont-browse: run the Aside daemon's own HTTP/tRPC/WebSocket server (127.0.0.1:21420) so the original
// "Aside Browsing Agent" extension can talk to it, plus the installation key pair that stands in for the
// macOS keychain on Linux (our code).
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import path from "node:path";

/** P-256 key pair persisted next to the service state; the public half is what the daemon trusts. */
export function ensureInstallationKeys(stateDir) {
  const file = path.join(stateDir, "installation-keys.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  // The daemon expects the raw uncompressed point (65 bytes, 0x04 || X || Y): the SPKI's trailing 65 bytes.
  const raw = spki.subarray(spki.length - 65);
  if (raw[0] !== 4) throw new Error("unexpected P-256 SPKI layout");
  const keys = { version: 1, scheme: "p256_v1", privateJwk, publicRawBase64: raw.toString("base64"), createdAt: new Date().toISOString() };
  mkdirSync(stateDir, { recursive: true });
  const temporary = path.join(stateDir, `.installation-keys-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    // Link a complete file atomically. Competing first starts reuse the winner's
    // identity; they cannot overwrite it or observe a partially written key.
    try { linkSync(temporary, file); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Starts the daemon's Hono app with its WebSocket upgrade handling on the loopback port the extension expects. */
export async function startDaemonServer(server, { host = "127.0.0.1", port = 21420, isReady = () => true, requestShutdown, log = console.error } = {}) {
  if (!server?.serve || !server.WebSocketServer || !server.createServer) throw new Error("daemon bundle lacks __belmontServer (run tools/patch-daemon-linux.py)");
  let closing = false;
  let closePromise;
  let httpServer;
  const close = () => closePromise ??= Promise.resolve().then(async () => {
    closing = true;
    const failures = [];
    const attempt = (operation) => {
      try { operation(); }
      catch (error) { failures.push(error); }
    };
    for (const client of wss.clients ?? []) {
      try { client.close(1001, "Daemon shutting down"); }
      catch (error) {
        failures.push(error);
        attempt(() => client.terminate());
      }
    }
    const forceSockets = setTimeout(() => {
      for (const client of wss.clients ?? []) attempt(() => client.terminate());
      attempt(() => httpServer?.closeAllConnections?.());
    }, 2000);
    forceSockets.unref?.();
    try {
      const results = await Promise.allSettled([
        new Promise((resolve, reject) => wss.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve())),
        new Promise((resolve, reject) => httpServer ? httpServer.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()) : resolve()),
      ]);
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
      if (failures.length) throw new AggregateError(failures, "Aside daemon server cleanup failed");
    } finally { clearTimeout(forceSockets); }
  });
  const app = server.createServer({
    isReady: () => !closing && isReady(),
    requestShutdown: () => {
      // Let the authenticated shutdown response flush before draining its server.
      setImmediate(() => Promise.resolve().then(() => requestShutdown ? requestShutdown() : close())
        .catch((error) => log(`[daemon-server] shutdown failed: ${error?.message ?? String(error)}`)));
    },
  });
  const wss = new server.WebSocketServer({ noServer: true });
  return await new Promise((resolve, reject) => {
    try {
      httpServer = server.serve({ hostname: host, port, fetch: app.fetch, websocket: { server: wss } }, (address) => {
        // Some server adapters invoke this callback synchronously.
        queueMicrotask(() => {
          log(`[daemon-server] Aside daemon API listening at http://${host}:${address?.port ?? port}`);
          resolve({ app, wss, httpServer, close, url: `http://${host}:${address?.port ?? port}` });
        });
      });
      httpServer.once("error", (error) => { void close().catch(() => {}); reject(error); });
    } catch (error) { void close().catch(() => {}); reject(error); }
  });
}
