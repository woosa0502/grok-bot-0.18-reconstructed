import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSandRootDir } from "../../host-paths.js";

export interface BrowseSessionView {
  readonly id: string;
  readonly status: "queued" | "running" | "suspended" | "done" | "error" | "stopped";
  readonly result: string | null;
  readonly error: string | null;
  readonly activity: readonly string[];
  readonly toolCalls: number;
  readonly modelCalls: number;
  readonly suspension: { readonly kind: string; readonly description: string; readonly request?: unknown } | null;
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
    if (!response.ok) throw new Error(`browse service ${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  health(): Promise<{ ok: boolean; engine: string }> { return this.#request("GET", "/health"); }
  create(body: { task: string; model?: string; thinking?: string; mode?: string }): Promise<BrowseSessionView> { return this.#request("POST", "/sessions", body); }
  get(id: string): Promise<BrowseSessionView> { return this.#request("GET", `/sessions/${id}`); }
  answer(id: string, response: unknown): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/answer`, { response }); }
  steer(id: string, text: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/steer`, { text }); }
  stop(id: string): Promise<BrowseSessionView> { return this.#request("POST", `/sessions/${id}/stop`, {}); }
}
