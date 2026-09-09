// belmont-browse: tiny CDP client used only by the extension-bridge shim (our code).
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchJson(url, { timeoutMs = 3000, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export class MiniCdp {
  #ws = null;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();
  #connectListeners = new Set();
  #closed = false;
  #connectPromise = null;
  #connectAbort = null;
  #closePromise = null;
  #connectTimeoutMs;
  #closeTimeoutMs;

  constructor(baseUrl, { connectTimeoutMs = 3000, closeTimeoutMs = 1000 } = {}) {
    for (const [name, value] of Object.entries({ connectTimeoutMs, closeTimeoutMs })) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.id = `mini-cdp-${randomUUID().slice(0, 8)}`;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#closeTimeoutMs = closeTimeoutMs;
  }

  connect() {
    if (this.#closed) return Promise.reject(new Error("CDP client closed"));
    if (this.#connectPromise) return this.#connectPromise;
    if (this.#ws?.readyState === WebSocket.OPEN) return Promise.resolve(this);
    const controller = new AbortController();
    this.#connectAbort = controller;
    const promise = this.#openConnection(controller).finally(() => {
      if (this.#connectPromise === promise) {
        this.#connectPromise = null;
        this.#connectAbort = null;
      }
    });
    this.#connectPromise = promise;
    // Notify after finally has released single-flight; callbacks may themselves send.
    promise.then(() => {
      if (this.#closed || this.#ws?.readyState !== WebSocket.OPEN) return;
      for (const listener of this.#connectListeners) {
        if (this.#closed) break;
        try { Promise.resolve(listener(this)).catch(() => {}); } catch {}
      }
    }, () => {});
    return promise;
  }

  async #openConnection(controller) {
    const timer = setTimeout(() => controller.abort(new Error("CDP connect timeout")), this.#connectTimeoutMs);
    const { signal } = controller;
    let ws;
    try {
      const wsUrl = /^wss?:\/\//.test(this.baseUrl)
        ? this.baseUrl
        : (await fetchJson(`${this.baseUrl}/json/version`, { timeoutMs: this.#connectTimeoutMs, signal })).webSocketDebuggerUrl;
      signal.throwIfAborted();
      if (this.#closed) throw new Error("CDP client closed");
      ws = new WebSocket(wsUrl);
      this.#ws = ws;
      const onMessage = (data) => {
        if (this.#ws === ws && !this.#closed) this.#onMessage(String(data));
      };
      const onError = (error) => {
        if (this.#ws === ws) this.#rejectPending(error);
        ws.terminate();
      };
      const onClose = () => {
        if (this.#ws === ws) {
          this.#ws = null;
          this.#rejectPending(new Error("CDP socket closed"));
        }
        ws.off("message", onMessage);
        ws.off("error", onError);
        ws.off("close", onClose);
      };
      ws.on("message", onMessage);
      ws.on("error", onError);
      ws.on("close", onClose);
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          ws.off("open", opened);
          ws.off("error", failed);
          ws.off("close", disconnected);
          signal.removeEventListener("abort", aborted);
        };
        const opened = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("CDP connect failed")); };
        const disconnected = () => { cleanup(); reject(new Error("CDP socket closed during connect")); };
        const aborted = () => { cleanup(); reject(signal.reason); };
        ws.once("open", opened);
        ws.once("error", failed);
        ws.once("close", disconnected);
        signal.addEventListener("abort", aborted, { once: true });
      });
      signal.throwIfAborted();
      if (this.#closed) throw new Error("CDP client closed");
      if (ws.readyState !== WebSocket.OPEN) throw new Error("CDP socket closed during connect");
      return this;
    } catch (error) {
      if (ws) {
        ws.terminate();
        await this.#shutdownSocket(ws);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  #rejectPending(error) {
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.#pending.clear();
  }

  #onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    for (const fn of this.#listeners) {
      try { fn(msg); } catch {}
    }
  }

  on(listener) {
    if (this.#closed) throw new Error("CDP client closed");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onConnect(listener) {
    if (this.#closed) throw new Error("CDP client closed");
    this.#connectListeners.add(listener);
    return () => this.#connectListeners.delete(listener);
  }

  async send(method, params = {}, sessionId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    await this.connect();
    return this.#sendConnected(this.#ws, method, params, sessionId, timeoutMs);
  }

  async #sendConnected(ws, method, params, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (this.#closed) throw new Error("CDP client closed");
    if (!ws || this.#ws !== ws || ws.readyState !== WebSocket.OPEN) throw new Error("CDP socket closed");
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const text = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error(`${method}: CDP timeout after ${timeoutMs}ms`)), timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      try {
        ws.send(text, (error) => { if (error) fail(error); });
      } catch (error) {
        fail(error);
      }
    });
  }

  // Run a command inside a page target (attach, run, detach).
  async withTarget(targetId, fn) {
    await this.connect();
    const ws = this.#ws;
    const { sessionId } = await this.#sendConnected(ws, "Target.attachToTarget", { targetId, flatten: true });
    try {
      return await fn((method, params) => this.#sendConnected(ws, method, params, sessionId));
    } finally {
      if (this.#ws === ws && !this.#closed && ws.readyState === WebSocket.OPEN) {
        await this.#sendConnected(ws, "Target.detachFromTarget", { sessionId }).catch(() => {});
      }
    }
  }

  async pageTargets() {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page" && !t.url.startsWith("devtools://") && !t.url.startsWith("chrome-extension://"));
  }

  #shutdownSocket(ws) {
    if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      const finished = () => {
        clearTimeout(timer);
        ws.off("close", finished);
        resolve();
      };
      const timer = setTimeout(() => ws.terminate(), this.#closeTimeoutMs);
      ws.once("close", finished);
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  }

  close() {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#listeners.clear();
    this.#connectListeners.clear();
    const error = new Error("CDP client closed");
    this.#rejectPending(error);
    this.#connectAbort?.abort(error);
    const connection = this.#connectPromise;
    const ws = this.#ws;
    this.#closePromise = Promise.allSettled([
      connection,
      ws ? this.#shutdownSocket(ws) : undefined,
    ]).then(() => {});
    return this.#closePromise;
  }
}
