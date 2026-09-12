import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSandRootDir } from "../../host-paths.js";
import type { ExperienceEnvelope } from "../memory/kernel/index.js";

export interface BrowseMemoryContext {
  authority: "belmont";
  version: 1;
  agentId: string;
  conversationId: string;
  expectedEpoch?: number;
  domain?: string;
  environment?: string;
  procedure?: { id: string; version: number; steps: unknown[] };
  [key: string]: unknown;
}

export interface BrowseClientMemoryHooks {
  isCanonical(): boolean;
  prepare(task: string, metadata: { domain?: string; environment?: string; context?: Record<string, string>; conditions?: string[] }): Promise<BrowseMemoryContext>;
  validate(context: BrowseMemoryContext): Promise<void>;
  observe(view: BrowseSessionView): Promise<void>;
}

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
  readonly usage?: { input: number; output: number; cacheRead: number };
  readonly startedAt?: number | null;
  readonly endedAt?: number | null;
  readonly memoryContext?: BrowseMemoryContext | null;
  readonly memoryObservation?: { eventId: string; at: number; status: string; trajectory: unknown[]; experience?: ExperienceEnvelope; [key: string]: unknown } | null;
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
  constructor(readonly baseUrl: string, readonly token: string, readonly memory?: BrowseClientMemoryHooks) {}

  /** Resolves the service from SAND_ASIDE_BROWSE_URL/TOKEN or belmont-browse/.state/serve.json next to the repo. */
  static fromEnvironment(memory?: BrowseClientMemoryHooks): BrowseClient | null {
    const url = process.env.SAND_ASIDE_BROWSE_URL?.trim();
    const token = process.env.SAND_ASIDE_BROWSE_TOKEN?.trim();
    if (url && token) return new BrowseClient(url, token, memory);
    const stateFile = process.env.SAND_ASIDE_BROWSE_STATE?.trim() || resolve(getSandRootDir(), "../../../belmont-browse/.state/serve.json");
    if (!existsSync(stateFile)) return null;
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as { port?: number; token?: string };
      if (typeof state.port !== "number" || typeof state.token !== "string") return null;
      return new BrowseClient(`http://127.0.0.1:${state.port}`, state.token, memory);
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
    const result = JSON.parse(text) as T;
    if (path.startsWith("/sessions/") || path === "/sessions") {
      const view = result as unknown as BrowseSessionView;
      if (typeof view?.id === "string") await this.memory?.observe(view);
    }
    return result;
  }

  health(): Promise<{ ok: boolean; engine: string; memoryAuthority?: string; memoryProtocolVersion?: number }> { return this.#request("GET", "/health"); }
  async #prepareMemory(task: string): Promise<BrowseMemoryContext | undefined> {
    if (!this.memory?.isCanonical()) return undefined;
    const service = await this.health();
    if (service.memoryAuthority !== "belmont" || service.memoryProtocolVersion !== 1) throw new BrowseServiceError("The browse service has not enabled Belmont canonical memory authority; apply its daemon guard and restart through the service owner's workflow.", 409, "MEMORY_AUTHORITY_MISMATCH");
    const metadata = await this.#request<{ domain?: string; environment?: string; context?: Record<string, string>; conditions?: string[] }>("POST", "/memory/context", { task });
    return this.memory.prepare(task, metadata);
  }
  async create(body: { task: string; model?: string; thinking?: string; mode?: string }): Promise<BrowseSessionView> {
    const memoryContext = await this.#prepareMemory(body.task);
    return this.#request("POST", "/sessions", { ...body, ...(memoryContext ? { memoryContext } : {}) });
  }
  get(id: string): Promise<BrowseSessionView> { return this.#request("GET", `/sessions/${id}`); }
  async #validateSessionMemory(id: string): Promise<void> {
    if (!this.memory?.isCanonical()) return;
    const view = await this.get(id);
    if (!view.memoryContext) throw new BrowseServiceError("This existing Aside execution has no Belmont memory binding; start a newly bound task.", 409, "MEMORY_CONTEXT_REQUIRED");
    await this.memory.validate(view.memoryContext);
  }
  async answer(id: string, response: unknown, expectedToolCallId: string): Promise<BrowseSessionView> { await this.#validateSessionMemory(id); return this.#request("POST", `/sessions/${id}/answer`, { response, expectedToolCallId }); }
  async steer(id: string, text: string): Promise<BrowseSessionView> { await this.#validateSessionMemory(id); return this.#request("POST", `/sessions/${id}/steer`, { text }); }
  /** Sends a follow-up user message into a finished session (same Aside conversation, full context kept). */
  async continue(id: string, text: string): Promise<BrowseSessionView> {
    const memoryContext = await this.#prepareMemory(text);
    return this.#request("POST", `/sessions/${id}/continue`, { text, ...(memoryContext ? { memoryContext } : {}) });
  }
  stop(id: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/stop`, {}); }
  /** A real outcome producer supplies a grade; the service owns usage/timing. */
  reportOutcome(id: string, eventId: string, outcome: { success: boolean; criticalFailure: boolean; condition?: string; siteKnowledge?: string[]; candidate?: ExperienceEnvelope["candidate"] }): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/outcome`, { eventId, outcome }); }
  /** Sessions the Aside UI in the fork lists as recent chats (newest first). */
  asideSessions(limit = 20): Promise<AsideSessionSummary[]> { return this.#request("GET", `/aside/sessions?limit=${limit}`); }
  /** User/assistant messages of an Aside session newer than `since` (ms), oldest first. */
  asideMessages(id: string, since = 0): Promise<AsideMessage[]> { return this.#request("GET", `/aside/sessions/${id}/messages?since=${since}`); }
}
