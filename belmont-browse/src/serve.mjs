// belmont-browse: local HTTP service exposing browse sessions to Belmont's browse-runtime extension (our code).
import http from "node:http";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { parseArgs } from "node:util";
import { createBrowseEngine } from "./core.mjs";
import { resolveModelSelection } from "./session.mjs";
import { modelOverrides } from "./model-options.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { values: opt } = parseArgs({
  allowNegative: true,
  options: {
    port: { type: "string", default: process.env.BELMONT_BROWSE_PORT || "9340" },
    engine: { type: "string", default: process.env.BELMONT_BROWSE_ENGINE || "909" },
    "state-dir": { type: "string", default: process.env.BELMONT_BROWSE_STATE_DIR || path.join(ROOT, ".state") },
    model: { type: "string", default: process.env.BELMONT_BROWSE_MODEL },
    provider: { type: "string", default: process.env.BELMONT_BROWSE_PROVIDER },
    thinking: { type: "string", default: process.env.BELMONT_BROWSE_THINKING },
    "fast-mode": { type: "boolean", default: process.env.BELMONT_BROWSE_FAST_MODE === undefined ? undefined : process.env.BELMONT_BROWSE_FAST_MODE === "1" },
    mode: { type: "string", default: process.env.BELMONT_BROWSE_MODE || "guard" },
    "auto-approve": { type: "boolean", default: process.env.BELMONT_BROWSE_AUTO_APPROVE === "1" },
    "cdp-port": { type: "string", default: "9333" },
    transport: { type: "string", default: process.env.BELMONT_BROWSE_TRANSPORT || "pipe" }, // pipe | port
    "relay-port": { type: "string", default: process.env.BELMONT_BROWSE_RELAY_PORT || "9341" },
  },
});
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
let shutdownPromise;
let shutdownQueued = false;
let serviceReady = false;
function requestShutdown() {
  shutdownQueued = true;
  if (serviceReady) return shutdown();
}
// Remain registered throughout the asynchronous drain. The bundled signal-exit
// library re-raises a signal if its listener becomes the only remaining owner;
// a once listener disappears before that library runs in the same emission.
process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);
const startupModel = modelOverrides({ model: opt.model, provider: opt.provider, thinking: opt.thinking, fastMode: opt["fast-mode"] });
const stateDir = path.resolve(opt["state-dir"]);
const engine = await createBrowseEngine({ engine: opt.engine, stateDir, transport: opt.transport, cdpPort: Number(opt["cdp-port"]), relayPort: Number(opt["relay-port"]), model: startupModel, onShutdown: requestShutdown, log });
const model = engine.model;
const token = randomBytes(24).toString("hex");
const serviceIdentity = { pid: process.pid, startedAt: new Date().toISOString(), instanceId: randomUUID() };
const stateFile = path.join(stateDir, "serve.json");

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
  req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(Object.assign(e, { code: "INVALID_JSON", statusCode: 400 })); } });
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: "unauthorized" });
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, ...serviceIdentity, engine: engine.version, model: engine.A.settings(engine.account.id).get("defaultModel") ?? model, ...engine.stats() });
    if (req.method === "POST" && url.pathname === "/memory/context") return json(res, 200, engine.memoryTaskContext((await readBody(req)).task));
    // Aside-side view: what the fork's own chat UI shows (sessions of the daemon account), for the bot mirror.
    if (parts[0] === "aside") {
      if (req.method === "GET" && parts[1] === "sessions" && parts.length === 2) return json(res, 200, engine.listAsideSessions(Number(url.searchParams.get("limit") ?? 20)));
      if (req.method === "GET" && parts[1] === "sessions" && parts[3] === "messages") {
        const since = Number(url.searchParams.get("since") ?? 0);
        return json(res, 200, await engine.asideMessages(parts[2], Number.isFinite(since) ? since : 0));
      }
      return json(res, 404, { error: "not found" });
    }
    if (parts[0] !== "sessions") return json(res, 404, { error: "not found" });
    if (req.method === "POST" && parts.length === 1) {
      const body = await readBody(req);
      const requestedModel = modelOverrides({ model: body.model, provider: body.provider, thinking: body.thinking, fastMode: body.fastMode });
      const h = engine.startSession({
        task: body.task,
        model: requestedModel === undefined ? undefined : resolveModelSelection(engine.A.settings(engine.account.id).get("defaultModel") ?? model, requestedModel),
        mode: body.mode ?? opt.mode,
        autoApprove: body.autoApprove ?? opt["auto-approve"],
        memoryContext: body.memoryContext,
      });
      log(`[session ${h.id}] start mode=${h.mode} model=${h.model.modelId}/${h.model.thinkingLevel}: ${h.task.slice(0, 100)}`);
      return json(res, 201, h.toJSON());
    }
    if (req.method === "GET" && parts.length === 1) return json(res, 200, engine.list());
    const h = engine.get(parts[1]);
    if (!h) return json(res, 404, { error: "unknown session", code: "SESSION_NOT_FOUND" });
    if (req.method === "GET" && parts.length === 2) return json(res, 200, h.toJSON());
    if (req.method === "POST" && parts[2] === "answer") {
      const body = await readBody(req);
      await h.answer(body.response, body.expectedToolCallId);
      log(`[session ${h.id}] answered`);
      return json(res, 200, h.toJSON());
    }
    if (req.method === "POST" && parts[2] === "continue") { const body = await readBody(req); h.continue(body.text, body.memoryContext); log(`[session ${h.id}] continue`); return json(res, 200, h.toJSON()); }
    // Explicit outcome producers can attach observed grades/candidate material.
    // Scope, authority, trial arrays and procedure acceptance never enter here.
    if (req.method === "POST" && parts[2] === "outcome") { const body = await readBody(req); h.reportOutcome(body.eventId, body.outcome); return json(res, 200, h.toJSON()); }
    if (req.method === "POST" && parts[2] === "steer") { await h.steer((await readBody(req)).text); return json(res, 200, h.toJSON()); }
    if (req.method === "POST" && parts[2] === "stop") { await h.stop(); log(`[session ${h.id}] stopped`); return json(res, 200, h.toJSON()); }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    log(`[http] ${req.method} ${req.url} failed: ${e.message}`);
    return json(res, e.statusCode ?? 500, { error: e.message, code: e.code ?? "INTERNAL_ERROR" });
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(opt.port), "127.0.0.1", () => {
    try {
      mkdirSync(path.dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify({ port: Number(opt.port), token, ...serviceIdentity, engine: engine.version, model, mode: opt.mode, transport: engine.transport, chromePid: engine.chrome.child?.pid ?? null, cdpWsUrl: engine.chrome.wsUrl ?? null }, null, 2), { mode: 0o600 });
      log(`[serve] listening on http://127.0.0.1:${opt.port} (token in ${stateFile})`);
      resolve();
    } catch (error) { reject(error); }
  });
}).catch(async (error) => {
  await shutdown();
  throw error;
});
serviceReady = true;
if (shutdownQueued) queueMicrotask(() => shutdown());
function shutdown() {
  return shutdownPromise ??= (async () => {
    log("[serve] shutting down");
    const serverClosed = new Promise((resolve, reject) => server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    const drainTimer = setTimeout(() => server.closeAllConnections?.(), 2000);
    drainTimer.unref?.();
    const results = await Promise.allSettled([serverClosed, engine.stop()]);
    clearTimeout(drainTimer);
    try {
      if (JSON.parse(readFileSync(stateFile, "utf8")).pid === process.pid) unlinkSync(stateFile);
    } catch (error) { if (error.code !== "ENOENT") log(`[serve] state cleanup: ${error.message}`); }
    const failures = results.filter((result) => result.status === "rejected");
    for (const failure of failures) log(`[serve] shutdown failed: ${failure.reason.message}`);
    process.exitCode = failures.length ? 1 : 0;
    log(`[serve] shutdown finished (exitCode=${process.exitCode})`);
    // The normal exit is the event loop draining on its own. Something can keep it alive after a finished
    // shutdown (2026-09-09 18:29: daemon 840655 logged this line, released every port, then sat idle until
    // SIGKILL): name what is still open and leave, so a run-fork.sh restart never inherits a ghost process.
    const graceMs = Number(process.env.BELMONT_BROWSE_EXIT_GRACE_MS || 5000);
    const forced = setTimeout(() => {
      const open = process.getActiveResourcesInfo?.() ?? (process._getActiveHandles?.() ?? []).map((handle) => handle?.constructor?.name ?? typeof handle);
      log(`[serve] event loop still alive ${graceMs}ms after shutdown; forcing exit (open: ${open.join(", ") || "none listed"})`);
      process.exit(process.exitCode ?? 0);
    }, graceMs);
    forced.unref();
  })();
}
