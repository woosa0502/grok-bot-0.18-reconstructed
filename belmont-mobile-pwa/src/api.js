import { createSendId, normalizeBaseUrl, normalizeFleet } from "./core.js";

export class CompanionApi {
  constructor({ baseUrl }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  static async pair({ baseUrl, code, deviceName }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const credential = String(code ?? "").trim();
    if (!credential) throw new Error("페어링 코드를 입력해주세요.");
    const key = /^\d{6}$/.test(credential) ? "code" : "credential";
    const response = await fetch(`${normalizedBaseUrl}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [key]: credential,
        deviceName: String(deviceName || "Belmont PWA").trim(),
        pairRequestId: createSendId()
      })
    });
    return parseResponse(response);
  }

  async health() {
    return this.request("/api/health", { authenticated: false });
  }

  async fleet(messageLimit = 50) {
    const payload = await this.request(`/api/bots?messages=${encodeURIComponent(messageLimit)}`);
    return normalizeFleet(payload);
  }

  async messages(threadId, { before = null, limit = 50 } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set("before", before);
    const payload = await this.request(`/api/threads/${safeId(threadId)}/messages?${query}`);
    return {
      messages: Array.isArray(payload?.messages) ? payload.messages : [],
      hasMore: Boolean(payload?.hasMore),
      before: typeof payload?.before === "string" && payload.before ? payload.before : null,
      state: payload?.state && typeof payload.state === "object"
        ? {
          busy: Boolean(payload.state.busy),
          composing: Boolean(payload.state.composing),
          activity: payload.state.activity && typeof payload.state.activity === "object" ? payload.state.activity : null
        }
        : null
    };
  }

  async send({ botId, threadId, text }) {
    return this.request(`/api/bots/${safeId(botId)}/messages`, {
      method: "POST",
      body: {
        text,
        threadId: safeId(threadId),
        sendId: createSendId()
      }
    });
  }

  async respond({ threadId, requestId, behavior, message = null, reviewedSha256 = null }) {
    return this.request(`/api/threads/${safeId(threadId)}/respond`, {
      method: "POST",
      body: {
        requestId,
        behavior,
        ...(message ? { message } : {}),
        ...(reviewedSha256 ? { reviewedSha256 } : {})
      }
    });
  }

  async alwaysAllow({ botId, allowKey }) {
    return this.request(`/api/bots/${safeId(botId)}/always-allow`, {
      method: "POST",
      body: { allowKey }
    });
  }

  async logout() {
    return this.request("/api/mobile/session", { method: "DELETE", body: {} });
  }

  async request(path, { method = "GET", body, authenticated = true, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
    return parseResponse(response);
  }

  subscribe({ cursor = null, onEvent, onStatus, signal } = {}) {
    const controller = new AbortController();
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
    const run = async () => {
      let resumeCursor = cursor;
      let retry = 1_000;
      while (!controller.signal.aborted) {
        try {
          const query = new URLSearchParams({ screens: "off" });
          if (resumeCursor) query.set("since", resumeCursor);
          const headers = { Accept: "text/event-stream" };
          const response = await fetch(`${this.baseUrl}/api/events?${query}`, {
            headers,
            credentials: "include",
            signal: controller.signal
          });
          if (response.status === 409 && resumeCursor) {
            resumeCursor = null;
            onStatus?.("reconnecting", new Error("이벤트 이력을 다시 동기화합니다."));
            continue;
          }
          if (!response.ok || !response.body) throw new Error(`이벤트 연결 실패 (${response.status})`);
          onStatus?.("connected");
          retry = 1_000;
          for await (const frame of parseEventStream(response.body)) {
            if (frame.id) resumeCursor = frame.id;
            onEvent?.(frame);
          }
        } catch (error) {
          if (controller.signal.aborted) break;
          onStatus?.("reconnecting", error);
          await wait(retry, controller.signal).catch(() => {});
          retry = Math.min(retry * 2, 15_000);
        }
      }
      onStatus?.("closed");
    };
    run();
    return () => controller.abort();
  }
}

export async function* parseEventStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = { id: "", event: "message", data: [] };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let split;
      while ((split = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, split);
        buffer = buffer.slice(split + 1);
        if (!line) {
          if (event.data.length) {
            const raw = event.data.join("\n");
            let data = raw;
            try { data = JSON.parse(raw); } catch {}
            yield { id: event.id || null, event: event.event, data };
          }
          event = { id: "", event: "message", data: [] };
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const valueText = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "id") event.id = valueText;
        if (field === "event") event.event = valueText;
        if (field === "data") event.data.push(valueText);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function safeId(value) {
  const id = String(value ?? "");
  if (!/^[\w-]+$/.test(id)) throw new Error("잘못된 리소스 식별자입니다.");
  return id;
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" ? payload.error : payload;
    throw new Error(message || `요청 실패 (${response.status})`);
  }
  return payload;
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
