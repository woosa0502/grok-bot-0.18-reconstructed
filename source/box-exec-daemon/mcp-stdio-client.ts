// Minimal MCP (Model Context Protocol) stdio client for the box exec daemon.
//
// The recovered deliverable ships the host-side MCP plumbing but no box binary,
// and the box daemon's loadMcpServers was a stub. Belmont routes command-based
// (stdio) MCP servers to the box, so the box must act as an MCP client host:
// spawn each configured server as a child process and speak JSON-RPC 2.0 over
// its stdin/stdout (newline-delimited, per the MCP stdio transport), then expose
// tools/list and tools/call to the daemon's exec handlers.
//
// This is a deliberately small client — initialize handshake, tools/list,
// tools/call — with no dependency on @modelcontextprotocol/sdk (which is not
// vendored). It is sufficient for the local stdio MCP servers that Claude/Codex
// use (e.g. @modelcontextprotocol/server-everything, or a plain node server).
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export interface McpStdioServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface McpCallContentItem {
  readonly type: "text" | "image";
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

export interface McpCallResult {
  readonly content: McpCallContentItem[];
  readonly isError: boolean;
  readonly structuredContent?: unknown;
}

const PROTOCOL_VERSION = "2024-11-05";
const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** A single spawned MCP server process and its JSON-RPC channel. */
export class McpStdioClient {
  readonly #config: McpStdioServerConfig;
  #child: ChildProcessWithoutNullStreams | undefined;
  #nextId = 1;
  #buffer = "";
  #pending = new Map<number, PendingRequest>();
  #tools: McpToolInfo[] = [];
  #instructions = "";
  #serverInfoName = "";
  #closed = false;
  #startError: string | undefined;

  constructor(config: McpStdioServerConfig) {
    this.#config = config;
  }

  get tools(): readonly McpToolInfo[] {
    return this.#tools;
  }
  get instructions(): string {
    return this.#instructions;
  }
  get serverInfoName(): string {
    return this.#serverInfoName;
  }
  get startError(): string | undefined {
    return this.#startError;
  }

  /** Spawn the process, run the initialize handshake, and cache tools/list. */
  async start(): Promise<void> {
    const child = spawn(this.#config.command, [...(this.#config.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.#config.env ?? {}) },
      ...(this.#config.cwd === undefined ? {} : { cwd: this.#config.cwd }),
    }) as ChildProcessWithoutNullStreams;
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => this.#onData(chunk as string));
    child.on("error", error => this.#fail(`spawn failed: ${error instanceof Error ? error.message : String(error)}`));
    child.on("close", () => this.#fail("server process exited"));

    const initResult = (await this.#request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "belmont-box", version: "0.1.0" },
    })) as { serverInfo?: { name?: string }; instructions?: string } | undefined;
    this.#serverInfoName = initResult?.serverInfo?.name ?? "";
    this.#instructions = initResult?.instructions ?? "";
    this.#notify("notifications/initialized", {});

    const listed = (await this.#request("tools/list", {})) as { tools?: McpToolInfo[] } | undefined;
    this.#tools = (listed?.tools ?? []).map(tool => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object" },
    }));
  }

  /** Invoke a tool and normalize the MCP result into McpCallResult. */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const raw = (await this.#request("tools/call", { name: toolName, arguments: args })) as
      | { content?: McpCallContentItem[]; isError?: boolean; structuredContent?: unknown }
      | undefined;
    const content = Array.isArray(raw?.content)
      ? raw!.content.map(item =>
          item.type === "image"
            ? { type: "image" as const, data: item.data, mimeType: item.mimeType }
            : { type: "text" as const, text: typeof item.text === "string" ? item.text : String(item.text ?? "") },
        )
      : [];
    return {
      content,
      isError: raw?.isError === true,
      ...(raw?.structuredContent === undefined ? {} : { structuredContent: raw.structuredContent }),
    };
  }

  stop(): void {
    this.#closed = true;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("client stopped"));
    }
    this.#pending.clear();
    try {
      this.#child?.kill("SIGTERM");
    } catch {
      // best effort
    }
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    let index: number;
    while ((index = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.length === 0) continue;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined) continue; // server-initiated request/notification: ignored
      const pending = this.#pending.get(message.id);
      if (pending === undefined) continue;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(message.error.message ?? "MCP error"));
      else pending.resolve(message.result);
    }
  }

  #request(method: string, params: unknown): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("client closed"));
    if (this.#startError !== undefined) return Promise.reject(new Error(this.#startError));
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#child?.stdin.write(payload);
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #notify(method: string, params: unknown): void {
    try {
      this.#child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    } catch {
      // best effort
    }
  }

  #fail(reason: string): void {
    if (this.#startError === undefined) this.#startError = reason;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
  }
}

/** Parse an mcpConfigJson blob into a map of {serverName: stdio config}. */
export function parseMcpStdioConfig(configJson: string): Map<string, McpStdioServerConfig> {
  const result = new Map<string, McpStdioServerConfig>();
  if (configJson.trim().length === 0) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return result;
  }
  // Accept both { mcpServers: {...} } and a bare {...} map of servers.
  const root = parsed as { mcpServers?: Record<string, unknown> } | Record<string, unknown> | null;
  const servers = (root && typeof root === "object" && "mcpServers" in root
    ? (root as { mcpServers?: Record<string, unknown> }).mcpServers
    : root) as Record<string, unknown> | undefined;
  if (servers == null || typeof servers !== "object") return result;
  for (const [name, value] of Object.entries(servers)) {
    if (value == null || typeof value !== "object") continue;
    const config = value as { command?: unknown; args?: unknown; env?: unknown; cwd?: unknown; url?: unknown };
    if (typeof config.command !== "string") continue; // stdio servers only (skip url/http)
    result.set(name, {
      command: config.command,
      ...(Array.isArray(config.args) ? { args: config.args.map(String) } : {}),
      ...(config.env != null && typeof config.env === "object"
        ? { env: Object.fromEntries(Object.entries(config.env as Record<string, unknown>).map(([k, v]) => [k, String(v)])) }
        : {}),
      ...(typeof config.cwd === "string" ? { cwd: config.cwd } : {}),
    });
  }
  return result;
}
