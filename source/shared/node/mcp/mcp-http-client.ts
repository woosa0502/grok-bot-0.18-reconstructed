import { createMcpTlsFetch } from "./mcp-http-fetch.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { CallToolResultSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

export interface McpHttpConfig {
  readonly url: string;
  readonly type?: "http" | "sse";
  readonly headers?: Readonly<Record<string, string>>;
  readonly tls?: { readonly caBundle: string };
}

/** Remote MCP uses the SDK's protocol negotiation, cancellation and SSE resumption.
 * Tool calls are never replayed after an ambiguous network failure. Only an explicit
 * HTTP 404 session-expired rejection permits one new initialize and retry. */
export class McpHttpClient {
  #client: Client | undefined;
  #transport: StreamableHTTPClientTransport | SSEClientTransport | undefined;
  #starting: Promise<void> | undefined;
  #closed = false;
  #disposing: Promise<void> | undefined;
  #startError: string | undefined;
  #tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
  #refreshing: Promise<void> | undefined;
  #toolsGeneration = 0;
  #instructions = "";
  readonly #tls: ReturnType<typeof createMcpTlsFetch>;
  constructor(readonly config: McpHttpConfig, readonly authProvider?: OAuthClientProvider, readonly fetchFn: typeof fetch = fetch, readonly onToolsChanged?: () => void) {
    const url = new URL(config.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("MCP URL must use HTTP(S) without embedded credentials.");
    this.#tls = createMcpTlsFetch(config.tls?.caBundle, fetchFn);
  }
  #operation<T>(task: () => Promise<T>): Promise<T> {
    const provider = this.authProvider as (OAuthClientProvider & { runWithOAuthContext?<R>(operation: () => Promise<R>): Promise<R> }) | undefined;
    return provider?.runWithOAuthContext === undefined ? task() : provider.runWithOAuthContext(task);
  }
  get tools() { return this.#tools; }
  get instructions() { return this.#instructions; }
  get startError() { return this.#startError; }
  get sessionId() { return this.#transport instanceof StreamableHTTPClientTransport ? this.#transport.sessionId : undefined; }
  async start(): Promise<void> {
    if (this.#closed) throw new Error("MCP client disposed");
    if (this.#client !== undefined && this.#startError === undefined) return;
    return this.#starting ??= this.#connect().finally(() => { this.#starting = undefined; });
  }
  async #connect(): Promise<void> {
    await this.#client?.close();
    this.#client = undefined;
    if (this.#closed) throw new Error("MCP client disposed");
    const connect = async (legacy: boolean) => {
      const client = new Client({ name: "belmont-local", version: "0.18.0" }, { capabilities: {} });
      // Do not forward MCP headers to OAuth discovery/registration/token endpoints.
      const endpoint = new URL(this.config.url);
      const scopedFetch: typeof fetch = async (input, init) => {
        const destination = new URL(input instanceof Request ? input.url : String(input));
        const headers = new Headers(init?.headers);
        let rpc = false;
        try { rpc = typeof init?.body === "string" && JSON.parse(init.body).jsonrpc === "2.0"; } catch {}
        if (destination.origin === endpoint.origin && (destination.pathname === endpoint.pathname || rpc)) {
          for (const [key, value] of Object.entries(this.config.headers ?? {})) if (!headers.has(key)) headers.set(key, value);
        }
        return this.#tls.fetch(input, { ...init, headers, redirect: "error" });
      };
      const options = { fetch: scopedFetch, ...(this.authProvider === undefined ? {} : { authProvider: this.authProvider }) };
      const transport = legacy
        ? new SSEClientTransport(new URL(this.config.url), options)
        : new StreamableHTTPClientTransport(new URL(this.config.url), options);
      this.#transport = transport;
      try {
        await this.#operation(() => client.connect(transport as Transport, { timeout: 30_000 }));
        if (this.#closed) throw new Error("MCP client disposed during initialization");
        this.#client = client;
        this.#startError = undefined;
        client.onclose = () => { if (!this.#closed && this.#client === client) this.#startError = "MCP connection closed"; };
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { await this.refreshTools(); this.onToolsChanged?.(); });
        this.#instructions = client.getInstructions() ?? "";
        await this.refreshTools();
      } catch (error) { await client.close().catch(() => {}); throw error; }
    };
    try {
      try { await connect(this.config.type === "sse"); }
      catch (error) {
        // Authentication errors are not an indication of the legacy transport.
        if (this.config.type === undefined && error instanceof StreamableHTTPError && [400, 404, 405].includes(error.code ?? -1)) await connect(true);
        else throw error;
      }
    } catch (error) {
      this.#startError = error instanceof Error ? error.message : String(error);
      this.#client = undefined;
      this.#tools = [];
      throw error;
    }
  }
  async refreshTools(): Promise<void> {
    if (this.#client === undefined) throw new Error("MCP client is not connected");
    this.#toolsGeneration += 1;
    const client = this.#client;
    return this.#refreshing ??= (async () => {
      if (!client.getServerCapabilities()?.tools) { this.#tools = []; return; }
      // A list_changed arriving while a list is in flight makes that response
      // stale. Coalesce notifications but always perform one final fresh pass.
      for (;;) {
        const generation = this.#toolsGeneration;
        const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [], seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const result = await this.#operation(() => client.listTools(cursor === undefined ? {} : { cursor }, { timeout: 30_000 }));
          tools.push(...result.tools);
          cursor = result.nextCursor;
          if (cursor !== undefined) {
            if (seen.has(cursor) || seen.size >= 64) throw new Error("MCP tools pagination did not terminate");
            seen.add(cursor);
          }
        } while (cursor !== undefined);
        if (this.#closed || client !== this.#client) return;
        if (generation !== this.#toolsGeneration) continue;
        this.#tools = tools;
        return;
      }
    })().finally(() => { this.#refreshing = undefined; });
  }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new Error("MCP request aborted");
    await this.start();
    const call = () => this.#operation(() => this.#client!.request({ method: "tools/call", params: { name, arguments: args } }, CallToolResultSchema, { timeout: 60 * 60_000, ...(signal === undefined ? {} : { signal }) }));
    try { return await call(); }
    catch (error) {
      if (!(error instanceof StreamableHTTPError) || error.code !== 404 || !(this.#transport instanceof StreamableHTTPClientTransport)) throw error;
      this.#startError = "MCP session expired";
      await this.start();
      return call();
    }
  }
  async dispose(): Promise<void> {
    this.#closed = true;
    return this.#disposing ??= this.#disposeInner();
  }
  async #disposeInner(): Promise<void> {
    // Closing the client is bounded and never waits on a session DELETE endpoint.
    // Termination is best effort; abort releases any persistent event stream.
    if (this.#transport instanceof StreamableHTTPClientTransport && this.#transport.sessionId !== undefined) {
      const termination = this.#transport.terminateSession().catch(() => {});
      await Promise.race([termination, new Promise<void>(resolve => { const timer = setTimeout(resolve, 1_000); timer.unref(); })]);
    }
    await this.#client?.close();
    await this.#transport?.close();
    await this.#starting?.catch(() => {});
    this.#client = undefined;
    await this.#tls.dispose();
  }
}
