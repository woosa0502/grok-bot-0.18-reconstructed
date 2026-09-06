import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSandRootDir } from "../../host-paths.js";

export interface BrowseSessionView {
  readonly id: string;
  readonly status: "queued" | "running" | "suspended" | "done" | "error" | "stopped" | "interrupted";
  readonly result: string | null;
  readonly error: string | null;
  readonly errorCode?: string | null;
  /** False is an explicit lifetime guarantee from the service, never inferred from absent metrics. */
  readonly executionStarted?: boolean;
  readonly activity: readonly string[];
  readonly toolCalls: number;
  readonly modelCalls: number;
  readonly suspension: { readonly kind: string; readonly toolCallId: string; readonly description: string; readonly request?: unknown } | null;
}

export class BrowseServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "BrowseServiceError";
  }
}

export function isBrowseServiceError(error: unknown, code: string): boolean {
  return error instanceof BrowseServiceError && error.code === code;
}

/** Follow-ups affect the existing execution, including when it starts between GET and continue. */
export async function sendBrowseFollowUp(client: BrowseClient, id: string, text: string): Promise<BrowseSessionView> {
  const steer = async (): Promise<BrowseSessionView> => {
    try { return await client.steer(id, text); } catch (error) {
      if (!isBrowseServiceError(error, "SESSION_NOT_RUNNING")) throw error;
      const latest = await client.get(id);
      if (latest.status === "done" || latest.status === "error" || latest.status === "stopped" || latest.status === "interrupted") return client.continue(id, text);
      throw error;
    }
  };
  const view = await client.get(id);
  if (view.status === "running" || view.status === "queued") return steer();
  if (view.status === "suspended") throw new BrowseServiceError("The browser session is waiting for an answer.", 409, "SESSION_SUSPENDED");
  try { return await client.continue(id, text); } catch (error) {
    if (isBrowseServiceError(error, "SESSION_BUSY")) return steer();
    throw error;
  }
}

export interface AsideSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string | null;
  readonly unread: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly projectId: string | null;
}
export interface AsideMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: number;
  readonly id: string | null;
}

/** Thin HTTP client for belmont-browse's serve.mjs (local, bearer token from its serve.json). */
export class BrowseClient {
  constructor(readonly baseUrl: string, readonly token: string) {}

  /** Resolves the service from SAND_ASIDE_BROWSE_URL/TOKEN or belmont-browse/.state/serve.json next to the repo. */
  static fromEnvironment(): BrowseClient | null {
    const url = process.env.SAND_ASIDE_BROWSE_URL?.trim();
    const token = process.env.SAND_ASIDE_BROWSE_TOKEN?.trim();
    if (url && token) return new BrowseClient(url, token);
    const stateFile = process.env.SAND_ASIDE_BROWSE_STATE?.trim() || resolve(getSandRootDir(), "../../../belmont-browse/.state/serve.json");
    if (!existsSync(stateFile)) return null;
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as { port?: number; token?: string };
      if (typeof state.port !== "number" || typeof state.token !== "string") return null;
      return new BrowseClient(`http://127.0.0.1:${state.port}`, state.token);
    } catch {
      return null;
    }
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      let code: string | undefined;
      let detail = text.slice(0, 200);
      try {
        const body = JSON.parse(text) as { code?: unknown; error?: unknown };
        if (typeof body.code === "string") code = body.code;
        if (typeof body.error === "string") detail = body.error;
        else if (body.error !== null && typeof body.error === "object") {
          const nested = body.error as { code?: unknown; message?: unknown };
          if (typeof nested.code === "string") code = nested.code;
          if (typeof nested.message === "string") detail = nested.message;
        }
      } catch { /* Plain errors from older services retain their HTTP status without invented codes. */ }
      throw new BrowseServiceError(`browse service ${method} ${path} -> ${response.status}: ${detail.slice(0, 200)}`, response.status, code);
    }
    return JSON.parse(text) as T;
  }

  health(): Promise<{ ok: boolean; engine: string }> { return this.#request("GET", "/health"); }
  create(body: { task: string; model?: string; thinking?: string; mode?: string }): Promise<BrowseSessionView> { return this.#request("POST", "/sessions", body); }
  get(id: string): Promise<BrowseSessionView> { return this.#request("GET", `/sessions/${id}`); }
  answer(id: string, response: unknown, expectedToolCallId: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/answer`, { response, expectedToolCallId }); }
  steer(id: string, text: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/steer`, { text }); }
  /** Sends a follow-up user message into a finished session (same Aside conversation, full context kept). */
  continue(id: string, text: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/continue`, { text }); }
  stop(id: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/stop`, {}); }
  /** Sessions the Aside UI in the fork lists as recent chats (newest first). */
  asideSessions(limit = 20): Promise<AsideSessionSummary[]> { return this.#request("GET", `/aside/sessions?limit=${limit}`); }
  /** User/assistant messages of an Aside session newer than `since` (ms), oldest first. */
  asideMessages(id: string, since = 0): Promise<AsideMessage[]> { return this.#request("GET", `/aside/sessions/${id}/messages?since=${since}`); }
}
