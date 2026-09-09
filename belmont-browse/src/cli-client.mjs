// Thin authenticated client for the shared browse service. Never opens daemon DBs.
import { readFileSync } from "node:fs";

export function cliError(code, message, exitCode = 1) {
  return Object.assign(new Error(message), { code, exitCode });
}

export function readServiceState(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw cliError("INVALID_SERVICE_STATE", `Cannot read browse service identity: ${error.message}`);
  }
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

export function createHttpSessionClient(state, { fetchImpl = fetch, requestTimeoutMs = 10000 } = {}) {
  const baseUrl = `http://127.0.0.1:${state.port}`;
  async function request(method, route, body, { signal } = {}) {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await fetchImpl(baseUrl + route, {
      method,
      headers: { authorization: `Bearer ${state.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
    });
    let result;
    try { result = await response.json(); }
    catch { throw cliError("INVALID_SERVICE_RESPONSE", `Browse service returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok) throw cliError(result?.code ?? "SERVICE_REQUEST_FAILED", result?.error ?? `Browse service HTTP ${response.status}`);
    return result;
  }
  const route = (id) => `/sessions/${encodeURIComponent(id)}`;
  return {
    health: (options) => request("GET", "/health", undefined, options),
    start: (body, options) => request("POST", "/sessions", body, options),
    get: (id, options) => request("GET", route(id), undefined, options),
    answer: (id, response, expectedToolCallId, options) => request("POST", route(id) + "/answer", { response, expectedToolCallId }, options),
    stop: (id) => request("POST", route(id) + "/stop", {}),
  };
}

/** A live but unverified state must never cause a second daemon/account owner. */
export async function connectSharedService(state, { isProcessAlive = processAlive, fetchImpl, requestTimeoutMs, requestedEngine, signal } = {}) {
  if (state === null || state === undefined) return null;
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0) throw cliError("INVALID_SERVICE_STATE", "Browse service state has no valid process identity; cannot safely start a second owner");
  if (!isProcessAlive(state.pid)) return null;
  if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535 || typeof state.token !== "string" || !state.token || typeof state.engine !== "string" || !state.engine || typeof state.instanceId !== "string" || !state.instanceId || typeof state.startedAt !== "string" || !Number.isFinite(Date.parse(state.startedAt))) {
    throw cliError("SERVICE_IDENTITY_UNVERIFIED", `Browse service pid=${state.pid} is alive but its saved identity is incomplete; update or stop that service before standalone use`);
  }
  const client = createHttpSessionClient(state, { fetchImpl, requestTimeoutMs });
  let health;
  try { health = await client.health({ signal }); }
  catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw cliError("SERVICE_IDENTITY_UNVERIFIED", `Browse service pid=${state.pid} is alive but authenticated health could not be verified: ${error.message}`);
  }
  if (health?.ok !== true || health.ready !== true || health.pid !== state.pid || health.instanceId !== state.instanceId || health.startedAt !== state.startedAt || health.engine !== state.engine) {
    throw cliError("SERVICE_IDENTITY_MISMATCH", `Browse service pid=${state.pid} health does not match its saved ready identity; refusing a second daemon owner`);
  }
  if (requestedEngine !== undefined && requestedEngine !== health.engine && requestedEngine !== health.engine?.split(".")[2]) {
    throw cliError("ENGINE_MISMATCH", `Requested engine ${requestedEngine} differs from the shared service ${health.engine}`);
  }
  return { client, health };
}

export function createOwnedSessionClient(engine) {
  const handles = new Map();
  const get = (id) => {
    const handle = handles.get(id) ?? engine.get(id);
    if (!handle) throw cliError("SESSION_NOT_FOUND", `Unknown owned session ${id}`);
    return handle;
  };
  return {
    async start(body) { const handle = engine.startSession(body); handles.set(handle.id, handle); return handle.toJSON(); },
    async get(id) { return get(id).toJSON(); },
    async answer(id, response, expectedToolCallId) { const handle = get(id); await handle.answer(response, expectedToolCallId); return handle.toJSON(); },
    async stop(id) { await get(id).stop(); },
  };
}
