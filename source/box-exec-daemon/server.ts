import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { appendFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { connectNodeAdapter } from "@connectrpc/connect-node";
import { MethodKind, Struct, Value, type JsonValue, type ServiceType } from "@bufbuild/protobuf";

import { ControlService } from "../packages/proto/generated/agent/v1/control_service_connect.js";
import { ExecService } from "../packages/proto/generated/agent/v1/exec_service_connect.js";
import {
  GetCapabilitiesResponse,
  LoadMcpServersResponse,
  PingResponse,
  UpdateEnvironmentVariablesResponse,
  type LoadMcpServersRequest,
  type UpdateEnvironmentVariablesRequest,
} from "../packages/proto/generated/agent/v1/control_service_pb.js";
import {
  McpError,
  McpImageContent,
  McpResult,
  McpServerNotFound,
  McpStateExecResult,
  McpStateServer,
  McpStateSuccess,
  McpSuccess,
  McpTextContent,
  McpToolNotFound,
  McpToolResultContentItem,
  type McpArgs,
  type McpStateExecArgs,
} from "../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import {
  McpInstructions,
  McpToolDefinition,
} from "../packages/proto/generated/agent/v1/mcp_pb.js";
import { McpStdioClient, parseMcpStdioConfig } from "./mcp-stdio-client.js";
import {
  ExecClientControlMessage,
  ExecClientMessage,
  ExecClientStreamClose,
  ExecClientThrow,
  ExecuteHookResponse,
  ExecuteHookResult,
  type ExecuteHookArgs,
  type ExecServerMessage,
} from "../packages/proto/generated/agent/v1/exec_pb.js";
import {
  AfterAgentThoughtRequestResponse,
  BeforeSubmitPromptRequestResponse,
  PostToolUseFailureRequestResponse,
  PostToolUseRequestResponse,
  PreToolUseRequestResponse,
  StopRequestResponse,
  SubagentStartRequestResponse,
  SubagentStopRequestResponse,
} from "../packages/proto/generated/agent/v1/agent_pb.js";
import { ExecStreamElement } from "../packages/proto/generated/agent/v1/exec_service_pb.js";
import {
  BackgroundShellSpawnError,
  BackgroundShellSpawnResult,
  BackgroundShellSpawnSuccess,
  WriteShellStdinError,
  WriteShellStdinResult,
  WriteShellStdinSuccess,
  type BackgroundShellSpawnArgs,
  type WriteShellStdinArgs,
} from "../packages/proto/generated/agent/v1/background_shell_exec_pb.js";
import {
  ReadError,
  ReadFileNotFound,
  ReadInvalidFile,
  ReadPermissionDenied,
  ReadRejected,
  ReadResult,
  ReadSuccess,
  type ReadArgs,
} from "../packages/proto/generated/agent/v1/read_exec_pb.js";
import {
  LsDirectoryTreeNode,
  LsDirectoryTreeNode_File,
  LsError,
  LsRejected,
  LsResult,
  LsSuccess,
  TerminalMetadata,
  TerminalMetadata_Command,
  type LsArgs,
} from "../packages/proto/generated/agent/v1/ls_exec_pb.js";
import {
  DeleteError,
  DeleteFileBusy,
  DeleteFileNotFound,
  DeleteNotFile,
  DeletePermissionDenied,
  DeleteRejected,
  DeleteResult,
  DeleteSuccess,
  type DeleteArgs,
} from "../packages/proto/generated/agent/v1/delete_exec_pb.js";
import {
  GrepContentMatch,
  GrepContentResult,
  GrepCountResult,
  GrepError,
  GrepFileCount,
  GrepFileMatch,
  GrepFilesResult,
  GrepResult,
  GrepSuccess,
  GrepUnionResult,
  type GrepArgs,
} from "../packages/proto/generated/agent/v1/grep_exec_pb.js";
import {
  WriteError,
  WriteNoSpace,
  WritePermissionDenied,
  WriteResult,
  WriteSuccess,
  type WriteArgs,
} from "../packages/proto/generated/agent/v1/write_exec_pb.js";
import {
  ShellBackgroundReason,
  ShellFailure,
  ShellResult,
  ShellSpawnError,
  ShellStream,
  ShellStreamBackgrounded,
  ShellStreamExit,
  ShellStreamStart,
  ShellStreamStderr,
  ShellStreamStdout,
  ShellSuccess,
  ShellTimeout,
  TimeoutBehavior,
  type ShellArgs,
} from "../packages/proto/generated/agent/v1/shell_exec_pb.js";

// Recovered generated descriptors predate `satisfies ServiceType` and therefore
// widen MethodKind during TypeScript reconstruction. Re-declaring only the
// daemon-owned routes preserves their exact names/message types and restores the
// literal method kinds required by Connect's implementation type inference.
const BoxControlService = {
  typeName: ControlService.typeName,
  methods: {
    ping: { ...ControlService.methods.ping, kind: MethodKind.Unary },
    getCapabilities: { ...ControlService.methods.getCapabilities, kind: MethodKind.Unary },
    updateEnvironmentVariables: { ...ControlService.methods.updateEnvironmentVariables, kind: MethodKind.Unary },
    loadMcpServers: { ...ControlService.methods.loadMcpServers, kind: MethodKind.Unary },
  },
} as const satisfies ServiceType;

const BoxExecService = {
  typeName: ExecService.typeName,
  methods: { exec: { ...ExecService.methods.exec, kind: MethodKind.ServerStreaming } },
} as const satisfies ServiceType;

export const BOX_EXEC_DAEMON_HOST = "127.0.0.1";
export const BOX_EXEC_DAEMON_PORT = 1337;
export const BOX_EXEC_DAEMON_AUTH_TOKEN = "local";
export const BOX_TERMINAL_VIRTUAL_PREFIX = "/root/.cursor/projects/workspace/terminals/";

export interface BoxExecDaemonOptions {
  readonly host?: string;
  readonly port?: number;
  readonly authToken?: string;
  readonly workspaceRoot: string;
  readonly terminalsDirectory?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface BoxExecDaemonHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly workspaceRoot: string;
  readonly terminalsDirectory: string;
  readonly ready: Promise<void>;
  isReady(): boolean;
  stop(): Promise<void>;
}

interface BackgroundProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly terminalPath: string;
  readonly startedAt: number;
  writeQueue: Promise<void>;
}

// One hook-script entry from .cursor/hooks.json (repo validator shape). `type`
// omitted means "command". `matcher` is a regex on the tool name; `timeout` is in
// seconds; `failClosed` makes a non-zero exit deny the action.
interface HookScript {
  readonly type?: string;
  readonly command?: string;
  readonly matcher?: string;
  readonly timeout?: number;
  readonly failClosed?: boolean;
}
// Default per-hook wall-clock timeout when a script does not set `timeout`.
const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

interface ProcessOutcome {
  readonly code: number;
  readonly signal: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

class PathRejectedError extends Error {}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function globToIgnoreRegExp(glob: string): RegExp {
  // Match the original ls ignore semantics: patterns not starting with "**/" (or "/") are
  // prepended with "**/" so they match anywhere in the tree.
  const anchored = glob.startsWith("**/") || glob.startsWith("/") ? glob : `**/${glob}`;
  let out = "";
  for (let i = 0; i < anchored.length; i += 1) {
    const c = anchored[i] as string;
    if (c === "*") {
      if (anchored[i + 1] === "*") {
        if (anchored[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
      } else { out += "[^/]*"; }
    } else if (c === "?") { out += "[^/]"; }
    else if (".+^${}()|[]\\".includes(c)) { out += `\\${c}`; }
    else { out += c; }
  }
  return new RegExp(`^${out}$`);
}
function buildIgnoreMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(globToIgnoreRegExp);
  return relPath => regexes.some(re => re.test(relPath));
}
async function parseTerminalMetadata(filePath: string): Promise<TerminalMetadata | undefined> {
  let text: string;
  let mtimeMs: number;
  try {
    text = await readFile(filePath, "utf8");
    mtimeMs = (await stat(filePath)).mtimeMs;
  } catch { return undefined; }
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  const body = frontmatter?.[1];
  if (body === undefined) return undefined;
  const field = (key: string): string | undefined => {
    const raw = body.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1];
    if (raw === undefined) return undefined;
    let value = raw.trim();
    if (value.startsWith("\"") && value.endsWith("\"")) {
      try { value = JSON.parse(value) as string; } catch { /* keep the raw value */ }
    }
    return value;
  };
  const cwd = field("cwd");
  const command = field("command");
  const startedAt = field("started_at");
  const startedMs = startedAt !== undefined ? Date.parse(startedAt) : Number.NaN;
  const footer = text.match(/---\nexit_code:[ \t]*(-?\d+)\nelapsed_ms:[ \t]*(\d+)/);
  const metadata = new TerminalMetadata({ lastCommands: [], lastModifiedMs: BigInt(Math.round(mtimeMs)), ...(cwd === undefined ? {} : { cwd }) });
  if (command !== undefined) {
    const timestamp = Number.isFinite(startedMs) ? { timestampMs: BigInt(startedMs) } : {};
    const exitCode = footer?.[1];
    const elapsed = footer?.[2];
    if (exitCode !== undefined && elapsed !== undefined) {
      metadata.lastCommands = [new TerminalMetadata_Command({ command, exitCode: Number(exitCode), durationMs: BigInt(Number(elapsed)), ...timestamp })];
    } else {
      metadata.currentCommand = new TerminalMetadata_Command({ command, ...timestamp });
    }
  }
  return metadata;
}
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function terminalFrontmatter(args: { readonly command: string; readonly workingDirectory: string }, pid: number | undefined, startedAt: number): string {
  return `---\n${pid == null ? "" : `pid: ${pid}\n`}cwd: ${yamlString(args.workingDirectory)}\ncommand: ${yamlString(args.command)}\nstatus: running\nstarted_at: ${new Date(startedAt).toISOString()}\nrunning_for_ms: 0\n---\n`;
}

function terminalFooter(exitCode: number, startedAt: number): string {
  return `\n---\nexit_code: ${exitCode}\nelapsed_ms: ${Date.now() - startedAt}\nended_at: ${new Date().toISOString()}\n---\n`;
}

function client(id: number, execId: string, message: ExecClientMessage["message"], elapsedMs?: number): ExecStreamElement {
  return new ExecStreamElement({
    element: {
      case: "execClientMessage",
      value: new ExecClientMessage({ id, execId, message, ...(elapsedMs == null ? {} : { localExecutionTimeMs: elapsedMs }) }),
    },
  });
}

function control(id: number, message: ExecClientControlMessage["message"]): ExecStreamElement {
  return new ExecStreamElement({
    element: { case: "execClientControlMessage", value: new ExecClientControlMessage({ message }) },
  });
}

function close(id: number): ExecStreamElement {
  return control(id, { case: "streamClose", value: new ExecClientStreamClose({ id }) });
}

function thrown(id: number, error: unknown, errorCode = "BOX_EXEC_DAEMON_ERROR"): ExecStreamElement {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return control(id, {
    case: "throw",
    value: new ExecClientThrow({ id, error: normalized.message, ...(normalized.stack == null ? {} : { stackTrace: normalized.stack }), errorCode }),
  });
}

class BoxExecRuntime {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #foreground = new Set<ChildProcessWithoutNullStreams>();
  readonly #background = new Map<number, BackgroundProcess>();
  readonly #mcpServers = new Map<string, { client: McpStdioClient; configKey: string }>();
  #nextShellId = 1;

  constructor(readonly workspaceRoot: string, readonly terminalsDirectory: string, environment: NodeJS.ProcessEnv) {
    this.#environment = { ...environment };
  }

  // --- MCP host: spawn stdio MCP servers and route tool calls to them. ---

  async loadMcpServers(request: LoadMcpServersRequest): Promise<LoadMcpServersResponse> {
    const configured = parseMcpStdioConfig(request.mcpConfigJson);
    if (request.removeMissing) {
      for (const [name, entry] of this.#mcpServers) {
        if (!configured.has(name)) {
          entry.client.stop();
          this.#mcpServers.delete(name);
        }
      }
    }
    const loadedServerNames: string[] = [];
    for (const [name, config] of configured) {
      const resolved = { ...config, cwd: config.cwd ?? this.resolvePath("/workspace") };
      const configKey = JSON.stringify(resolved);
      const existing = this.#mcpServers.get(name);
      // Reuse a healthy server only when its resolved config is unchanged; a config
      // change or a previously-failed start (re)spawns it.
      if (existing !== undefined && existing.configKey === configKey && existing.client.startError === undefined) {
        loadedServerNames.push(name);
        continue;
      }
      if (existing !== undefined) existing.client.stop();
      const client = new McpStdioClient(resolved);
      try {
        await client.start();
        loadedServerNames.push(name);
      } catch {
        // Keep the failed client so mcpState reports its startError as a status.
      }
      this.#mcpServers.set(name, { client, configKey });
    }
    return new LoadMcpServersResponse({ loadedServerNames });
  }

  mcpState(args: McpStateExecArgs): McpStateExecResult {
    const wanted = args.serverIdentifiers.length > 0 ? new Set(args.serverIdentifiers) : undefined;
    const servers: McpStateServer[] = [];
    for (const [name, { client }] of this.#mcpServers) {
      if (wanted !== undefined && !wanted.has(name)) continue;
      const startError = client.startError;
      servers.push(new McpStateServer({
        serverName: name,
        serverIdentifier: name,
        tools: client.tools.map(tool => new McpToolDefinition({
          name: tool.name,
          providerIdentifier: name,
          toolName: tool.name,
          description: tool.description,
          inputSchema: Value.fromJson((tool.inputSchema ?? { type: "object" }) as JsonValue),
          inputSchemaJson: JSON.stringify(tool.inputSchema ?? { type: "object" }),
        })),
        instructions: client.instructions.length > 0 ? [new McpInstructions({ serverName: name, serverIdentifier: name, instructions: client.instructions })] : [],
        status: startError === undefined ? "connected" : "error",
        ...(startError === undefined ? {} : { errorMessage: startError }),
      }));
    }
    return new McpStateExecResult({ result: { case: "success", value: new McpStateSuccess({ servers }) } });
  }

  async callMcpTool(args: McpArgs, signal?: AbortSignal): Promise<McpResult> {
    const serverName = args.serverIdentifier.length > 0 ? args.serverIdentifier : args.providerIdentifier;
    const entry = this.#mcpServers.get(serverName);
    if (entry === undefined) {
      return new McpResult({ result: { case: "serverNotFound", value: new McpServerNotFound({ name: serverName, availableServers: [...this.#mcpServers.keys()] }) } });
    }
    const client = entry.client;
    if (client.startError !== undefined) {
      return new McpResult({ result: { case: "error", value: new McpError({ error: `MCP server '${serverName}' failed to start: ${client.startError}` }) } });
    }
    const toolName = args.toolName.length > 0 ? args.toolName : args.name;
    if (!client.tools.some(tool => tool.name === toolName)) {
      return new McpResult({ result: { case: "toolNotFound", value: new McpToolNotFound({ name: toolName, availableTools: client.tools.map(tool => tool.name) }) } });
    }
    const toolArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.args)) toolArgs[key] = value.toJson();
    try {
      const result = await client.callTool(toolName, toolArgs, signal);
      const content = result.content.map(item =>
        item.type === "image"
          ? new McpToolResultContentItem({ content: { case: "image", value: new McpImageContent({ data: item.data != null ? Uint8Array.from(Buffer.from(item.data, "base64")) : new Uint8Array(), mimeType: item.mimeType ?? "" }) } })
          : new McpToolResultContentItem({ content: { case: "text", value: new McpTextContent({ text: item.text ?? "" }) } }));
      const success = new McpSuccess({ content, isError: result.isError });
      // Preserve tool-provided structuredContent when present.
      if (result.structuredContent !== undefined) {
        try { success.structuredContent = Struct.fromJson(result.structuredContent as JsonValue); } catch { /* non-JSON structured content: skip */ }
      }
      return new McpResult({ result: { case: "success", value: success } });
    } catch (error) {
      return new McpResult({ result: { case: "error", value: new McpError({ error: error instanceof Error ? error.message : String(error) }) } });
    }
  }

  stopMcpServers(): void {
    for (const [, { client }] of this.#mcpServers) client.stop();
    this.#mcpServers.clear();
  }

  applyEnvironment(request: UpdateEnvironmentVariablesRequest): { applied: number; removed: number } {
    let removed = 0;
    if (request.replace) {
      for (const key of Object.keys(this.#environment)) {
        if (!(key in request.env)) {
          delete this.#environment[key];
          removed += 1;
        }
      }
    }
    for (const [key, value] of Object.entries(request.env)) this.#environment[key] = value;
    return { applied: Object.keys(request.env).length, removed };
  }

  resolvePath(requested: string): string {
    const logical = requested.length === 0 ? "/workspace" : requested;
    if (logical === BOX_TERMINAL_VIRTUAL_PREFIX || logical === BOX_TERMINAL_VIRTUAL_PREFIX.replace(/\/$/, "")) {
      return this.terminalsDirectory;
    }
    if (logical.startsWith(BOX_TERMINAL_VIRTUAL_PREFIX)) {
      const terminalName = logical.slice(BOX_TERMINAL_VIRTUAL_PREFIX.length);
      if (!/^\d+\.txt$/.test(terminalName)) throw new PathRejectedError(`Rejected terminal virtual path: ${requested}`);
      return path.join(this.terminalsDirectory, terminalName);
    }
    const mapped = logical === "/workspace"
      ? this.workspaceRoot
      : logical.startsWith("/workspace/")
        ? path.join(this.workspaceRoot, logical.slice("/workspace/".length))
        : path.isAbsolute(logical)
          ? logical
          : path.join(this.workspaceRoot, logical);
    const resolved = path.resolve(mapped);
    const relative = path.relative(this.workspaceRoot, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return resolved;
    throw new PathRejectedError(`Path escapes configured workspace root: ${requested}`);
  }

  assertRealPathAllowed(target: string, requested: string): void {
    for (const allowedRoot of [this.workspaceRoot, this.terminalsDirectory]) {
      const relative = path.relative(allowedRoot, target);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
    }
    throw new PathRejectedError(`Resolved path escapes configured roots: ${requested}`);
  }

  // Canonicalize `target` and assert the canonical path stays within the allowed
  // roots. The final segment may not exist yet (write/mkdir), so the deepest
  // existing ancestor is realpath'd and the non-existent tail re-appended — this
  // makes a symlinked parent directory unable to redirect a write/delete/list
  // outside the workspace. EACCES/EPERM (an inaccessible host dir, e.g. a box
  // virtual path) surfaces to the caller rather than being treated as an escape.
  async #assertCanonicalWithinRoots(target: string, requested: string): Promise<void> {
    let probe = path.resolve(target);
    for (let i = 0; i < 64; i += 1) {
      let canonicalProbe: string;
      try {
        canonicalProbe = await realpath(probe);
      } catch (error) {
        const code = typeof error === "object" && error != null && "code" in error ? String((error as { code: unknown }).code) : undefined;
        if (code === "ENOENT" || code === "ENOTDIR") {
          const parent = path.dirname(probe);
          if (parent === probe) break;
          probe = parent;
          continue;
        }
        throw error;
      }
      const tail = path.relative(probe, path.resolve(target));
      this.assertRealPathAllowed(tail === "" ? canonicalProbe : path.join(canonicalProbe, tail), requested);
      return;
    }
    // No existing ancestor was found; fall back to the lexical resolution.
    this.assertRealPathAllowed(path.resolve(target), requested);
  }

  // Hook config lives in the workspace's .cursor/hooks.json — the same shape the
  // repo's own validator (packages/hooks/validators/hooksConfig.ts) accepts:
  //   { version, hooks: { <step>: [ { command, matcher?, timeout?, failClosed? }
  //                                  | { type: "prompt", prompt, ... } ] } }.
  // `type` defaults to "command" when omitted. Malformed JSON is logged (not
  // silently swallowed) so a broken config is diagnosable.
  async #readHooksConfig(): Promise<Record<string, HookScript[]>> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.workspaceRoot, ".cursor", "hooks.json"), "utf8");
    } catch {
      return {}; // no hooks configured
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error(`[box-hooks] .cursor/hooks.json is not valid JSON, ignoring: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
    const hooks = parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>).hooks : undefined;
    if (hooks == null || typeof hooks !== "object") return {};
    const result: Record<string, HookScript[]> = {};
    for (const [stepName, arr] of Object.entries(hooks as Record<string, unknown>)) {
      if (Array.isArray(arr)) result[stepName] = arr.filter((entry): entry is HookScript => entry != null && typeof entry === "object");
    }
    return result;
  }

  // Run a hook command shell-style with the hook input JSON on stdin, capturing
  // stdout and exit code (hook convention: stdout is the hook's JSON response;
  // exit code 2 = block). Enforces a wall-clock timeout, honors the request abort
  // signal, and caps captured stdout to avoid an unbounded hook stalling/flooding.
  #runHookCommand(command: string, inputJson: string, timeoutMs: number, signal?: AbortSignal): Promise<{ stdout: string; exitCode: number; timedOut: boolean }> {
    return new Promise(resolve => {
      let child: ChildProcessWithoutNullStreams;
      try { child = spawn("sh", ["-c", command], { cwd: this.resolvePath("/workspace"), env: this.#environment }); }
      catch { resolve({ stdout: "", exitCode: 1, timedOut: false }); return; }
      let out = "", done = false, timedOut = false;
      const MAX_OUTPUT = 1_000_000; // 1 MB cap on captured stdout
      const finish = (result: { stdout: string; exitCode: number; timedOut: boolean }): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (signal !== undefined) signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const kill = (): void => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
      const onAbort = (): void => { kill(); finish({ stdout: out, exitCode: 130, timedOut: false }); };
      const timer = setTimeout(() => { timedOut = true; kill(); finish({ stdout: out, exitCode: 124, timedOut: true }); }, timeoutMs);
      if (signal !== undefined) {
        if (signal.aborted) { kill(); resolve({ stdout: "", exitCode: 130, timedOut: false }); clearTimeout(timer); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      child.stdout.on("data", d => { if (out.length < MAX_OUTPUT) out += d.toString(); });
      child.stderr.on("data", () => {});
      child.on("error", () => finish({ stdout: "", exitCode: 1, timedOut: false }));
      child.on("close", code => finish({ stdout: out, exitCode: code ?? 0, timedOut }));
      try { child.stdin.write(inputJson); child.stdin.end(); } catch { /* stdin closed early */ }
    });
  }

  async executeHook(args: ExecuteHookArgs, signal?: AbortSignal): Promise<ExecuteHookResult> {
    const req = args.request?.request;
    if (req == null || req.case === undefined) return new ExecuteHookResult({});
    const step = req.case;
    const q = req.value as unknown as Record<string, unknown>;
    const toolName = typeof q.toolName === "string" ? q.toolName : "";
    // `matcher` is a regex tested against the tool name; "", "*", or absent means
    // "all tools". Only command hooks whose matcher matches this call are run.
    const matcherMatches = (matcher: unknown): boolean => {
      if (matcher === undefined || matcher === "" || matcher === "*") return true;
      if (typeof matcher !== "string") return true;
      // An invalid matcher regex is a config error; treat it as matching NOTHING
      // (fail safe) rather than every tool, and log it so it is diagnosable.
      try { return new RegExp(matcher).test(toolName); }
      catch (error) { console.error(`[box-hooks] invalid matcher "${matcher}" for step ${step}, skipping: ${error instanceof Error ? error.message : String(error)}`); return false; }
    };
    const scripts = (await this.#readHooksConfig())[step] ?? [];
    const commands = scripts.filter(entry => (entry.type === undefined || entry.type === "command") && typeof entry.command === "string" && matcherMatches(entry.matcher));
    if (commands.length === 0) return new ExecuteHookResult({});

    const toJson = (v: unknown): unknown => v != null && typeof (v as { toJson?: () => unknown }).toJson === "function" ? (v as { toJson: () => unknown }).toJson() : v;
    const input: Record<string, unknown> = {
      hook_event_name: step,
      ...(q.toolName != null ? { tool_name: q.toolName } : {}),
      ...(q.toolInput != null ? { tool_input: toJson(q.toolInput) } : {}),
      ...(q.toolOutput != null ? { tool_output: q.toolOutput } : {}),
      ...(q.errorMessage != null ? { error: q.errorMessage } : {}),
      ...(q.failureType != null ? { failure_type: q.failureType } : {}),
      ...(q.durationMs != null ? { duration_ms: typeof q.durationMs === "bigint" ? Number(q.durationMs) : q.durationMs } : {}),
      ...(q.isInterrupt != null ? { is_interrupt: q.isInterrupt } : {}),
      ...(q.toolUseId != null ? { tool_use_id: q.toolUseId } : {}),
      ...(q.subagentId != null ? { subagent_id: q.subagentId } : {}),
      ...(q.subagentType != null ? { subagent_type: q.subagentType } : {}),
      ...(q.status != null ? { status: q.status } : {}),
      ...(q.summary != null ? { summary: q.summary } : {}),
      ...(q.task != null ? { task: q.task } : {}),
      ...(q.description != null ? { description: q.description } : {}),
      ...(q.text != null ? { text: q.text } : {}),
      ...(q.conversationId != null ? { conversation_id: q.conversationId } : {}),
      ...(q.prompt != null ? { prompt: q.prompt } : {}),
    };
    const inputJson = JSON.stringify(input);

    // Compose the hook scripts deterministically: run them in order, MERGE each
    // one's additionalContext, and let the FIRST deny (exit 2, a failClosed
    // non-zero exit, or an explicit block/deny permission) short-circuit the rest.
    // A fail-open non-zero exit is non-blocking and does NOT stop later hooks.
    const pickFrom = (parsed: Record<string, unknown>, ...keys: readonly string[]): string | undefined => {
      for (const key of keys) { const v = parsed[key]; if (typeof v === "string" && v.length > 0) return v; }
      return undefined;
    };
    const contexts: string[] = [];
    let permission: string | undefined;
    let userMessage: string | undefined;
    let agentMessage: string | undefined;
    let followupMessage: string | undefined;
    let updatedInput: string | undefined;
    for (const entry of commands) {
      const timeoutMs = typeof entry.timeout === "number" && entry.timeout > 0
        ? Math.min(entry.timeout * 1000, 3_600_000)
        : DEFAULT_HOOK_TIMEOUT_MS;
      const r = await this.#runHookCommand(entry.command!, inputJson, timeoutMs, signal);
      const out = r.stdout.trim();
      let parsed: Record<string, unknown> = {};
      try { parsed = out ? JSON.parse(out) as Record<string, unknown> : {}; }
      catch { parsed = out ? { additional_context: out } : {}; }
      const hookOut = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
      const ac = pickFrom(parsed, "additional_context", "additionalContext", "system_message", "systemMessage")
        ?? (typeof hookOut?.additionalContext === "string" ? hookOut.additionalContext : undefined);
      if (ac !== undefined) contexts.push(ac);
      userMessage ??= pickFrom(parsed, "user_message", "userMessage");
      agentMessage ??= pickFrom(parsed, "agent_message", "agentMessage");
      followupMessage ??= pickFrom(parsed, "followup_message", "followupMessage");
      const rawUpdated = parsed.updated_input ?? parsed.updatedInput;
      if (updatedInput === undefined && rawUpdated != null) updatedInput = typeof rawUpdated === "string" ? rawUpdated : JSON.stringify(rawUpdated);
      const rawPermission = pickFrom(parsed, "permission", "decision")
        ?? (typeof hookOut?.permissionDecision === "string" ? hookOut.permissionDecision : undefined);
      const deniesHere = r.exitCode === 2
        || (entry.failClosed === true && r.exitCode !== 0)
        || rawPermission === "block" || rawPermission === "deny";
      if (deniesHere) { permission = "deny"; break; } // deny short-circuits remaining hooks
      if (permission === undefined && (rawPermission === "ask" || rawPermission === "allow")) permission = rawPermission;
    }
    const additionalContext = contexts.length > 0 ? contexts.join("\n") : undefined;

    let response: ExecuteHookResponse["response"];
    switch (step) {
      case "preToolUse": {
        const value = new PreToolUseRequestResponse();
        if (permission !== undefined) value.permission = permission;
        if (additionalContext !== undefined) value.additionalContext = additionalContext;
        if (userMessage !== undefined) value.userMessage = userMessage;
        if (agentMessage !== undefined) value.agentMessage = agentMessage;
        if (updatedInput !== undefined) value.updatedInput = updatedInput;
        response = { case: "preToolUse", value };
        break;
      }
      case "postToolUse": {
        const value = new PostToolUseRequestResponse();
        if (additionalContext !== undefined) value.additionalContext = additionalContext;
        response = { case: "postToolUse", value };
        break;
      }
      case "postToolUseFailure": {
        const value = new PostToolUseFailureRequestResponse();
        if (additionalContext !== undefined) value.additionalContext = additionalContext;
        response = { case: "postToolUseFailure", value };
        break;
      }
      case "beforeSubmitPrompt": {
        const value = new BeforeSubmitPromptRequestResponse();
        if (additionalContext !== undefined) value.additionalContext = additionalContext;
        response = { case: "beforeSubmitPrompt", value };
        break;
      }
      case "subagentStart": {
        const value = new SubagentStartRequestResponse();
        if (permission !== undefined) value.permission = permission;
        if (additionalContext !== undefined) value.additionalContext = additionalContext;
        if (userMessage !== undefined) value.userMessage = userMessage;
        response = { case: "subagentStart", value };
        break;
      }
      case "subagentStop": {
        const value = new SubagentStopRequestResponse();
        if (additionalContext !== undefined) value.additionalContext = additionalContext;
        if (followupMessage !== undefined) value.followupMessage = followupMessage;
        response = { case: "subagentStop", value };
        break;
      }
      case "afterAgentThought":
        response = { case: "afterAgentThought", value: new AfterAgentThoughtRequestResponse() };
        break;
      case "stop": {
        const value = new StopRequestResponse();
        if (followupMessage !== undefined) value.followupMessage = followupMessage;
        response = { case: "stop", value };
        break;
      }
      default:
        return new ExecuteHookResult({});
    }
    return new ExecuteHookResult({ response: new ExecuteHookResponse({ response }) });
  }

  // Central preToolUse gate for box tools (Read/Grep/Shell/Write/Delete/LS/...).
  // Unlike the host-wired WebSearch hook, this lets a .cursor/hooks.json preToolUse
  // entry — optionally matcher-scoped ("Read", "Shell", "*") — gate ANY box tool
  // with no code change. Returns a deny message when the action is blocked, else
  // undefined. Errors in hook infrastructure fail open (the tool still runs).
  async #preToolUseGate(toolName: string, toolInput: unknown, signal?: AbortSignal): Promise<string | undefined> {
    let scripts: HookScript[];
    try { scripts = (await this.#readHooksConfig()).preToolUse ?? []; }
    catch { return undefined; }
    const matches = (matcher: unknown): boolean => {
      if (matcher === undefined || matcher === "" || matcher === "*" || typeof matcher !== "string") return true;
      try { return new RegExp(matcher).test(toolName); }
      catch { console.error(`[box-hooks] invalid preToolUse matcher "${String(matcher)}", skipping`); return false; }
    };
    const commands = scripts.filter(entry => (entry.type === undefined || entry.type === "command") && typeof entry.command === "string" && matches(entry.matcher));
    if (commands.length === 0) return undefined;
    const inputJson = JSON.stringify({ hook_event_name: "preToolUse", tool_name: toolName, tool_input: toolInput });
    for (const entry of commands) {
      const timeoutMs = typeof entry.timeout === "number" && entry.timeout > 0 ? Math.min(entry.timeout * 1000, 3_600_000) : DEFAULT_HOOK_TIMEOUT_MS;
      const r = await this.#runHookCommand(entry.command!, inputJson, timeoutMs, signal);
      let parsed: Record<string, unknown> = {};
      try { parsed = r.stdout.trim() ? JSON.parse(r.stdout.trim()) as Record<string, unknown> : {}; } catch { /* non-JSON */ }
      const rawPermission = typeof parsed.permission === "string" ? parsed.permission : typeof parsed.decision === "string" ? parsed.decision : undefined;
      const denies = r.exitCode === 2 || (entry.failClosed === true && r.exitCode !== 0) || rawPermission === "block" || rawPermission === "deny";
      if (denies) {
        const message = typeof parsed.user_message === "string" && parsed.user_message.length > 0 ? parsed.user_message
          : typeof parsed.userMessage === "string" && parsed.userMessage.length > 0 ? parsed.userMessage
          : `Blocked by preToolUse hook`;
        return message;
      }
    }
    return undefined;
  }

  async *execute(request: ExecServerMessage, signal: AbortSignal): AsyncGenerator<ExecStreamElement> {
    try {
      switch (request.message.case) {
        case "readArgs":
        case "redactedReadArgs": {
          const args = request.message.value;
          const denyMsg = await this.#preToolUseGate("Read", { path: args.path }, signal);
          const result = denyMsg !== undefined
            ? new ReadResult({ result: { case: "rejected", value: new ReadRejected({ path: args.path, reason: denyMsg }) } })
            : await this.read(args);
          const resultCase = request.message.case === "readArgs" ? "readResult" : "redactedReadResult";
          yield client(request.id, request.execId, { case: resultCase, value: result } as ExecClientMessage["message"]);
          break;
        }
        case "lsArgs": {
          const args = request.message.value;
          const denyMsg = await this.#preToolUseGate("LS", { path: args.path }, signal);
          const result = denyMsg !== undefined
            ? new LsResult({ result: { case: "rejected", value: new LsRejected({ path: args.path, reason: denyMsg }) } })
            : await this.ls(args);
          yield client(request.id, request.execId, { case: "lsResult", value: result });
          break;
        }
        case "deleteArgs": {
          const args = request.message.value;
          const denyMsg = await this.#preToolUseGate("Delete", { path: args.path }, signal);
          const result = denyMsg !== undefined
            ? new DeleteResult({ result: { case: "rejected", value: new DeleteRejected({ path: args.path, reason: denyMsg }) } })
            : await this.delete(args);
          yield client(request.id, request.execId, { case: "deleteResult", value: result });
          break;
        }
        case "grepArgs": {
          const args = request.message.value;
          const denyMsg = await this.#preToolUseGate("Grep", { pattern: args.pattern, path: args.path }, signal);
          const result = denyMsg !== undefined
            ? new GrepResult({ result: { case: "error", value: new GrepError({ error: denyMsg }) } })
            : await this.grep(args, signal);
          yield client(request.id, request.execId, { case: "grepResult", value: result });
          break;
        }
        case "writeArgs": {
          const args = request.message.value;
          const denyMsg = await this.#preToolUseGate("Write", { path: args.path }, signal);
          const result = denyMsg !== undefined
            ? new WriteResult({ result: { case: "error", value: new WriteError({ path: args.path, error: denyMsg }) } })
            : await this.write(args);
          yield client(request.id, request.execId, { case: "writeResult", value: result });
          break;
        }
        case "shellArgs":
        case "miniSweAgentBashArgs": {
          const args = request.message.value;
          const denyMsg = await this.#preToolUseGate("Shell", { command: args.command, workingDirectory: args.workingDirectory }, signal);
          const result = denyMsg !== undefined
            ? new ShellResult({ result: { case: "spawnError", value: new ShellSpawnError({ command: args.command, workingDirectory: args.workingDirectory, error: denyMsg }) } })
            : await this.shell(args, signal);
          const resultCase = request.message.case === "shellArgs" ? "shellResult" : "miniSweAgentBashResult";
          yield client(request.id, request.execId, { case: resultCase, value: result } as ExecClientMessage["message"]);
          break;
        }
        case "shellStreamArgs":
          yield* this.shellStream(request, request.message.value, signal);
          break;
        case "backgroundShellSpawnArgs":
          yield client(request.id, request.execId, { case: "backgroundShellSpawnResult", value: await this.spawnBackground(request.message.value) });
          break;
        case "writeShellStdinArgs":
          yield client(request.id, request.execId, { case: "writeShellStdinResult", value: await this.writeStdin(request.message.value) });
          break;
        case "executeHookArgs":
          yield client(request.id, request.execId, { case: "executeHookResult", value: await this.executeHook(request.message.value, signal) });
          break;
        case "mcpArgs":
          yield client(request.id, request.execId, { case: "mcpResult", value: await this.callMcpTool(request.message.value, signal) });
          break;
        case "mcpStateExecArgs":
          yield client(request.id, request.execId, { case: "mcpStateExecResult", value: this.mcpState(request.message.value) });
          break;
        default:
          yield thrown(request.id, `Unsupported ExecServerMessage case: ${request.message.case ?? "unset"}`, "BOX_EXEC_UNSUPPORTED");
      }
    } catch (error) {
      yield thrown(request.id, error);
    } finally {
      yield close(request.id);
    }
  }

  async read(args: ReadArgs): Promise<ReadResult> {
    try {
      const target = this.resolvePath(args.path);
      const directInfo = await lstat(target);
      if (directInfo.isSymbolicLink()) throw new PathRejectedError(`Symbolic-link reads are not permitted: ${args.path}`);
      const canonical = await realpath(target);
      this.assertRealPathAllowed(canonical, args.path);
      const info = await stat(canonical);
      if (!info.isFile()) return new ReadResult({ result: { case: "invalidFile", value: new ReadInvalidFile({ path: args.path, reason: "Path is not a regular file" }) } });
      if (args.encodingHint != null && args.encodingHint !== "utf8" && args.encodingHint !== "utf-8" && args.encodingHint !== "latin1") {
        return new ReadResult({ result: { case: "invalidFile", value: new ReadInvalidFile({ path: args.path, reason: `Unsupported encoding hint: ${args.encodingHint}` }) } });
      }
      const data = await readFile(canonical);
      // A binary PDF has no wired text extractor here, so reading it as text returns unusable bytes.
      // Fail cleanly with an actionable message instead of handing the model garbage.
      const looksLikePdf = (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) || /\.pdf$/i.test(args.path);
      if (looksLikePdf) {
        return new ReadResult({ result: { case: "invalidFile", value: new ReadInvalidFile({ path: args.path, reason: "Binary PDF — text extraction is not available in this build, so reading it would return unusable bytes. Ask the user for a text export (e.g. run pdftotext on the file) or the relevant pages pasted as text." }) } });
      }
      const text = data.toString(args.encodingHint === "latin1" ? "latin1" : "utf8");
      const lines = text.split("\n");
      const offset = Math.max(0, args.offset ?? 0);
      const limit = args.limit == null ? lines.length : Math.max(0, args.limit);
      const content = lines.slice(offset, offset + limit).join("\n");
      return new ReadResult({ result: { case: "success", value: new ReadSuccess({
        path: args.path,
        output: { case: "content", value: content },
        totalLines: lines.length,
        fileSize: BigInt(data.byteLength),
        truncated: offset > 0 || offset + limit < lines.length,
        rangeApplied: args.offset != null || args.limit != null,
      }) } });
    } catch (error) {
      if (error instanceof PathRejectedError) return new ReadResult({ result: { case: "rejected", value: new ReadRejected({ path: args.path, reason: error.message }) } });
      const code = typeof error === "object" && error != null && "code" in error ? String(error.code) : undefined;
      if (code === "ENOENT" || code === "ENOTDIR") return new ReadResult({ result: { case: "fileNotFound", value: new ReadFileNotFound({ path: args.path }) } });
      if (code === "EACCES" || code === "EPERM") return new ReadResult({ result: { case: "permissionDenied", value: new ReadPermissionDenied({ path: args.path }) } });
      if (code === "EISDIR" || code === "EINVAL" || code === "ENAMETOOLONG") return new ReadResult({ result: { case: "invalidFile", value: new ReadInvalidFile({ path: args.path, reason: errorText(error) }) } });
      return new ReadResult({ result: { case: "error", value: new ReadError({ path: args.path, error: errorText(error) }) } });
    }
  }

  async ls(args: LsArgs): Promise<LsResult> {
    const LS_MAX_DEPTH = 4;
    let budget = 2_000;
    let root: string;
    try {
      root = this.resolvePath(args.path);
      await this.#assertCanonicalWithinRoots(root, args.path);
    } catch (error) {
      if (error instanceof PathRejectedError) return new LsResult({ result: { case: "rejected", value: new LsRejected({ path: args.path, reason: error.message }) } });
      return new LsResult({ result: { case: "error", value: new LsError({ path: args.path, error: errorText(error) }) } });
    }
    try {
      const info = await stat(root);
      if (!info.isDirectory()) return new LsResult({ result: { case: "error", value: new LsError({ path: args.path, error: "Path is not a directory" }) } });
      const isIgnored = buildIgnoreMatcher(args.ignore ?? []);
      const build = async (dir: string, depth: number): Promise<LsDirectoryTreeNode> => {
        const node = new LsDirectoryTreeNode({ absPath: dir, childrenDirs: [], childrenFiles: [], fullSubtreeExtensionCounts: {}, numFiles: 0, childrenWereProcessed: false });
        if (depth > LS_MAX_DEPTH || budget <= 0) return node;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); }
        catch { return node; }
        node.childrenWereProcessed = true;
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (budget <= 0) break;
          if (isIgnored(path.relative(root, path.join(dir, entry.name)))) continue;
          budget -= 1;
          if (entry.isDirectory()) {
            const child = await build(path.join(dir, entry.name), depth + 1);
            node.childrenDirs.push(child);
            // numFiles is rendered as "files in subtree", so roll the child's
            // subtree file count up into this node (not just direct children).
            node.numFiles += child.numFiles;
            for (const [ext, count] of Object.entries(child.fullSubtreeExtensionCounts)) {
              node.fullSubtreeExtensionCounts[ext] = (node.fullSubtreeExtensionCounts[ext] ?? 0) + count;
            }
          } else {
            const fileNode = new LsDirectoryTreeNode_File({ name: entry.name });
            if (dir === this.terminalsDirectory) {
              const terminalMetadata = await parseTerminalMetadata(path.join(dir, entry.name));
              if (terminalMetadata !== undefined) fileNode.terminalMetadata = terminalMetadata;
            }
            node.childrenFiles.push(fileNode);
            node.numFiles += 1;
            const ext = path.extname(entry.name) || "(no extension)";
            node.fullSubtreeExtensionCounts[ext] = (node.fullSubtreeExtensionCounts[ext] ?? 0) + 1;
          }
        }
        return node;
      };
      const directoryTreeRoot = await build(root, 0);
      return new LsResult({ result: { case: "success", value: new LsSuccess({ directoryTreeRoot }) } });
    } catch (error) {
      return new LsResult({ result: { case: "error", value: new LsError({ path: args.path, error: errorText(error) }) } });
    }
  }

  async delete(args: DeleteArgs): Promise<DeleteResult> {
    let target: string;
    try {
      target = this.resolvePath(args.path);
      await this.#assertCanonicalWithinRoots(target, args.path);
    } catch (error) {
      if (error instanceof PathRejectedError) return new DeleteResult({ result: { case: "rejected", value: new DeleteRejected({ path: args.path, reason: error.message }) } });
      return new DeleteResult({ result: { case: "error", value: new DeleteError({ path: args.path, error: errorText(error) }) } });
    }
    try {
      const info = await lstat(target);
      if (info.isDirectory()) return new DeleteResult({ result: { case: "notFile", value: new DeleteNotFile({ path: args.path }) } });
      const fileSize = BigInt(info.size);
      let prevContent = "";
      try { prevContent = (await readFile(target)).toString("utf8").slice(0, 100_000); } catch {}
      await rm(target);
      return new DeleteResult({ result: { case: "success", value: new DeleteSuccess({ path: args.path, deletedFile: target, fileSize, prevContent }) } });
    } catch (error) {
      const code = typeof error === "object" && error != null && "code" in error ? String((error as { code: unknown }).code) : undefined;
      if (code === "ENOENT" || code === "ENOTDIR") return new DeleteResult({ result: { case: "fileNotFound", value: new DeleteFileNotFound({ path: args.path }) } });
      if (code === "EACCES" || code === "EPERM") return new DeleteResult({ result: { case: "permissionDenied", value: new DeletePermissionDenied({ path: args.path }) } });
      if (code === "EBUSY") return new DeleteResult({ result: { case: "fileBusy", value: new DeleteFileBusy({ path: args.path }) } });
      return new DeleteResult({ result: { case: "error", value: new DeleteError({ path: args.path, error: errorText(error) }) } });
    }
  }

  async grep(args: GrepArgs, signal: AbortSignal): Promise<GrepResult> {
    let cwd: string;
    try {
      cwd = this.resolvePath(args.path !== undefined && args.path.length > 0 ? args.path : "/workspace");
    } catch (error) {
      return new GrepResult({ result: { case: "error", value: new GrepError({ error: errorText(error) }) } });
    }
    const headLimit = args.headLimit !== undefined && args.headLimit > 0 ? args.headLimit : 200;
    const rgArgs: string[] = ["--json"];
    if (args.caseInsensitive === true) rgArgs.push("-i");
    if (args.multiline === true) rgArgs.push("-U", "--multiline-dotall");
    if (args.glob !== undefined && args.glob.length > 0) rgArgs.push("-g", args.glob);
    if (args.type !== undefined && args.type.length > 0) rgArgs.push("-t", args.type);
    const before = args.contextBefore ?? args.context;
    const after = args.contextAfter ?? args.context;
    if (before !== undefined && before > 0) rgArgs.push("-B", String(before));
    if (after !== undefined && after > 0) rgArgs.push("-A", String(after));
    rgArgs.push("--", args.pattern, cwd);
    // rg searches the absolute target (file or directory); spawn from a real directory so a
    // single-file target does not fail with ENOTDIR.
    const spawnCwd = this.resolvePath("/workspace");
    const outcome = await new Promise<{ stdout: string; stderr: string; exitCode: number | null; spawnError?: string; aborted: boolean }>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try { child = spawn("rg", rgArgs, { cwd: spawnCwd, env: this.#environment }); }
      catch (error) { resolve({ stdout: "", stderr: "", exitCode: null, spawnError: errorText(error), aborted: false }); return; }
      let out = "", err = "";
      child.stdout.on("data", data => { out += String(data); });
      child.stderr.on("data", data => { err += String(data); });
      const abort = () => this.kill(child);
      signal.addEventListener("abort", abort, { once: true });
      child.once("close", code => { signal.removeEventListener("abort", abort); resolve({ stdout: out, stderr: err, exitCode: code, aborted: signal.aborted }); });
      child.once("error", error => { signal.removeEventListener("abort", abort); resolve({ stdout: out, stderr: err, exitCode: null, spawnError: errorText(error), aborted: signal.aborted }); });
    });
    // Distinguish "no matches" from "search failed": ripgrep exits 0 (matches),
    // 1 (no matches — a legitimate empty result), and >=2 on error (e.g. an
    // invalid regex). A spawn error or abort is likewise a failure, not empty.
    if (outcome.spawnError !== undefined) {
      return new GrepResult({ result: { case: "error", value: new GrepError({ error: `ripgrep failed to start: ${outcome.spawnError}` }) } });
    }
    if (outcome.aborted) {
      return new GrepResult({ result: { case: "error", value: new GrepError({ error: "grep was aborted" }) } });
    }
    if (outcome.exitCode !== 0 && outcome.exitCode !== 1) {
      const detail = outcome.stderr.trim();
      return new GrepResult({ result: { case: "error", value: new GrepError({ error: `ripgrep exited ${outcome.exitCode ?? "with a signal"}${detail.length > 0 ? `: ${detail}` : ""}` }) } });
    }
    const byFile = new Map<string, GrepContentMatch[]>();
    let totalSeen = 0;   // total match events emitted by ripgrep (post-offset)
    let retained = 0;    // match lines kept within the head limit
    const offset = Math.max(0, args.offset ?? 0);
    let matchIndex = 0;
    for (const line of outcome.stdout.split("\n")) {
      if (line.length === 0) continue;
      let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      try { event = JSON.parse(line); } catch { continue; }
      // Keep ripgrep "context" events (-A/-B lines) alongside matches so requested context reaches
      // the model; begin/end/summary are still skipped. Offset, totalSeen, and the head-limit count
      // apply to matches only — context lines ride along with the retained matches they surround.
      const isMatch = event.type === "match";
      const isContext = event.type === "context";
      if (!isMatch && !isContext) continue;
      if (isMatch && matchIndex++ < offset) continue;
      if (isMatch) totalSeen += 1;
      const file = event.data?.path?.text ?? "";
      const lineNumber = event.data?.line_number ?? 0;
      const content = (event.data?.lines?.text ?? "").replace(/\n$/, "");
      const list = byFile.get(file) ?? [];
      if (list.length === 0) byFile.set(file, list);
      if (retained < headLimit) {
        list.push(new GrepContentMatch({ lineNumber, content: content.slice(0, 2000), contentTruncated: content.length > 2000, ...(isContext ? { isContextLine: true } : {}) }));
        if (isMatch) retained += 1;
      }
    }
    const outputMode = args.outputMode ?? "content";
    // Truncated only when there were genuinely more matches than we retained.
    const clientTruncated = totalSeen > retained;
    let union: GrepUnionResult;
    if (outputMode === "files_with_matches" || outputMode === "files") {
      const files = [...byFile.keys()];
      union = new GrepUnionResult({ result: { case: "files", value: new GrepFilesResult({ files, totalFiles: files.length, clientTruncated, ripgrepTruncated: false }) } });
    } else if (outputMode === "count") {
      const counts = [...byFile.entries()].map(([file, fileMatches]) => new GrepFileCount({ file, count: fileMatches.filter(entry => !entry.isContextLine).length }));
      union = new GrepUnionResult({ result: { case: "count", value: new GrepCountResult({ counts, totalFiles: counts.length, totalMatches: totalSeen, clientTruncated }) } });
    } else {
      const matches = [...byFile.entries()].map(([file, fileMatches]) => new GrepFileMatch({ file, matches: fileMatches }));
      union = new GrepUnionResult({ result: { case: "content", value: new GrepContentResult({ matches, totalLines: totalSeen, totalMatchedLines: totalSeen, clientTruncated, ripgrepTruncated: false }) } });
    }
    return new GrepResult({ result: { case: "success", value: new GrepSuccess({ pattern: args.pattern, path: cwd, outputMode, workspaceResults: { workspace: union } }) } });
  }

  async write(args: WriteArgs): Promise<WriteResult> {
    let target: string;
    try {
      target = this.resolvePath(args.path);
      await this.#assertCanonicalWithinRoots(target, args.path);
    } catch (error) {
      return new WriteResult({ result: { case: "error", value: new WriteError({ path: args.path, error: errorText(error) }) } });
    }
    try {
      await mkdir(path.dirname(target), { recursive: true });
      const data = args.fileBytes !== undefined && args.fileBytes.length > 0 ? Buffer.from(args.fileBytes) : Buffer.from(args.fileText ?? "", args.encodingHint === "latin1" ? "latin1" : "utf8");
      // Atomic write: a crash mid-write must never leave a truncated file. Write a sibling temp
      // file, then rename it over the target (rename is atomic within a filesystem). Clean up the
      // temp on failure so a failed write leaves no debris.
      const tempTarget = `${target}.tmp-${process.pid}-${Date.now()}`;
      try {
        await writeFile(tempTarget, data);
        await rename(tempTarget, target);
      } catch (writeError) {
        await rm(tempTarget, { force: true }).catch(() => {});
        throw writeError;
      }
      const linesCreated = args.fileText === undefined ? 0 : args.fileText.length === 0 ? 0 : args.fileText.split("\n").length;
      return new WriteResult({ result: { case: "success", value: new WriteSuccess({ path: args.path, linesCreated }) } });
    } catch (error) {
      const code = typeof error === "object" && error != null && "code" in error ? String((error as { code: unknown }).code) : undefined;
      if (code === "ENOSPC") return new WriteResult({ result: { case: "noSpace", value: new WriteNoSpace({ path: args.path }) } });
      if (code === "EACCES" || code === "EPERM") {
        const existing = await stat(target).catch(() => null);
        const isReadonly = existing !== null && existing.isFile() && (Number(existing.mode) & 0o200) === 0;
        return new WriteResult({ result: { case: "permissionDenied", value: new WritePermissionDenied({ path: args.path, isReadonly }) } });
      }
      return new WriteResult({ result: { case: "error", value: new WriteError({ path: args.path, error: errorText(error) }) } });
    }
  }

  async shell(args: ShellArgs, signal: AbortSignal): Promise<ShellResult> {
    let cwd: string;
    try {
      cwd = this.resolvePath(args.workingDirectory);
    } catch (error) {
      return new ShellResult({ result: { case: "spawnError", value: new ShellSpawnError({ command: args.command, workingDirectory: args.workingDirectory, error: errorText(error) }) } });
    }
    const outcome = await this.run(args.command, cwd, args.timeout > 0 ? args.timeout : undefined, signal);
    if (outcome.timedOut) return new ShellResult({ result: { case: "timeout", value: new ShellTimeout({ command: args.command, workingDirectory: args.workingDirectory, timeoutMs: args.timeout }) } });
    const common = {
      command: args.command,
      workingDirectory: args.workingDirectory,
      exitCode: outcome.code,
      signal: outcome.signal,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      executionTime: outcome.elapsedMs,
      interleavedOutput: `${outcome.stdout}${outcome.stderr}`,
      localExecutionTimeMs: outcome.elapsedMs,
    };
    return outcome.code === 0 && !outcome.aborted
      ? new ShellResult({ result: { case: "success", value: new ShellSuccess(common) } })
      : new ShellResult({ result: { case: "failure", value: new ShellFailure({ ...common, aborted: outcome.aborted }) } });
  }

  async *shellStream(request: ExecServerMessage, args: ShellArgs, signal: AbortSignal): AsyncGenerator<ExecStreamElement> {
    const cwd = this.resolvePath(args.workingDirectory);
    yield client(request.id, request.execId, { case: "shellStream", value: new ShellStream({ event: { case: "start", value: new ShellStreamStart() } }) });
    const child = this.spawnShell(args.command, cwd);
    this.#foreground.add(child);
    const startedAt = Date.now();
    const events: Array<{ case: "stdout" | "stderr"; data: string }> = [];
    let wake: (() => void) | undefined;
    let done = false;
    let exitCode = 1;
    let exitSignal = "";
    let backgroundRequested = false;
    let backgrounded = false;
    const notify = () => { wake?.(); wake = undefined; };
    const onStdout = (data: unknown) => { events.push({ case: "stdout", data: String(data) }); notify(); };
    const onStderr = (data: unknown) => { events.push({ case: "stderr", data: String(data) }); notify(); };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("close", (code, childSignal) => { exitCode = code ?? 1; exitSignal = childSignal ?? ""; done = true; notify(); });
    const abort = () => this.kill(child);
    signal.addEventListener("abort", abort, { once: true });
    // is_background / block_until_ms: when the tool asks for background behaviour
    // (timeoutBehavior BACKGROUND) we hand a still-running shell back to the agent
    // as a background handle (shellId/pid/output file) instead of killing it.
    // args.timeout is the block window in ms; 0 means background immediately.
    const backgroundOnTimeout = args.timeoutBehavior === TimeoutBehavior.BACKGROUND;
    const backgroundAfterMs = args.timeout > 0
      ? args.timeout
      : (args.isBackground || backgroundOnTimeout || (args.hardTimeout != null && args.hardTimeout > 0) ? 0 : -1);
    let timer: NodeJS.Timeout | undefined;
    if (backgroundOnTimeout && backgroundAfterMs >= 0) {
      timer = setTimeout(() => { backgroundRequested = true; notify(); }, backgroundAfterMs);
    } else if (args.timeout > 0) {
      timer = setTimeout(() => this.kill(child), args.timeout);
    }
    try {
      while ((!done && !backgroundRequested) || events.length > 0) {
        while (events.length > 0) {
          const event = events.shift()!;
          yield client(request.id, request.execId, {
            case: "shellStream",
            value: new ShellStream({ event: event.case === "stdout"
              ? { case: "stdout", value: new ShellStreamStdout({ data: event.data }) }
              : { case: "stderr", value: new ShellStreamStderr({ data: event.data }) } }),
          });
        }
        if (!done && !backgroundRequested) await new Promise<void>(resolve => { wake = resolve; });
      }
      if (backgroundRequested && !done) {
        backgrounded = true;
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        await mkdir(this.terminalsDirectory, { recursive: true });
        const shellId = this.#nextShellId++;
        const terminalPath = path.join(this.terminalsDirectory, `${shellId}.txt`);
        const backgroundProcess: BackgroundProcess = {
          child,
          terminalPath,
          startedAt,
          writeQueue: writeFile(terminalPath, terminalFrontmatter(args, child.pid ?? undefined, startedAt)),
        };
        this.#background.set(shellId, backgroundProcess);
        const queueWrite = (data: string | Uint8Array) => {
          backgroundProcess.writeQueue = backgroundProcess.writeQueue.then(() => appendFile(terminalPath, data));
        };
        for (const buffered of events) queueWrite(buffered.data);
        events.length = 0;
        child.stdout.on("data", data => { queueWrite(data); });
        child.stderr.on("data", data => { queueWrite(data); });
        child.once("close", code => { this.#background.delete(shellId); queueWrite(terminalFooter(code ?? 1, startedAt)); });
        this.#foreground.delete(child);
        yield client(request.id, request.execId, { case: "shellStream", value: new ShellStream({ event: { case: "backgrounded", value: new ShellStreamBackgrounded({
          shellId,
          command: args.command,
          workingDirectory: args.workingDirectory,
          ...(child.pid == null ? {} : { pid: child.pid }),
          msToWait: Date.now() - startedAt,
          reason: args.isBackground ? ShellBackgroundReason.USER_REQUEST : ShellBackgroundReason.TIMEOUT,
        }) } }) });
        return;
      }
      yield client(request.id, request.execId, { case: "shellStream", value: new ShellStream({ event: { case: "exit", value: new ShellStreamExit({
        code: exitCode,
        cwd: args.workingDirectory,
        aborted: signal.aborted,
        localExecutionTimeMs: Date.now() - startedAt,
      }) } }) });
      void exitSignal;
    } finally {
      if (timer != null) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (!backgrounded) {
        this.#foreground.delete(child);
        if (!done) this.kill(child);
      }
    }
  }

  async spawnBackground(args: BackgroundShellSpawnArgs): Promise<BackgroundShellSpawnResult> {
    try {
      const cwd = this.resolvePath(args.workingDirectory);
      await mkdir(this.terminalsDirectory, { recursive: true });
      const shellId = this.#nextShellId++;
      const terminalPath = path.join(this.terminalsDirectory, `${shellId}.txt`);
      const startedAt = Date.now();
      const child = this.spawnShell(args.command, cwd);
      const process: BackgroundProcess = {
        child,
        terminalPath,
        startedAt,
        writeQueue: writeFile(terminalPath, terminalFrontmatter(args, child.pid, startedAt)),
      };
      this.#background.set(shellId, process);
      const queueWrite = (data: string | Uint8Array) => {
        process.writeQueue = process.writeQueue.then(() => appendFile(terminalPath, data));
      };
      child.stdout.on("data", data => { queueWrite(data); });
      child.stderr.on("data", data => { queueWrite(data); });
      child.once("close", code => {
        this.#background.delete(shellId);
        queueWrite(terminalFooter(code ?? 1, startedAt));
      });
      return new BackgroundShellSpawnResult({ result: { case: "success", value: new BackgroundShellSpawnSuccess({ shellId, command: args.command, workingDirectory: args.workingDirectory, ...(child.pid == null ? {} : { pid: child.pid }) }) } });
    } catch (error) {
      return new BackgroundShellSpawnResult({ result: { case: "error", value: new BackgroundShellSpawnError({ command: args.command, workingDirectory: args.workingDirectory, error: errorText(error) }) } });
    }
  }

  async writeStdin(args: WriteShellStdinArgs): Promise<WriteShellStdinResult> {
    const running = this.#background.get(args.shellId);
    if (running == null) return new WriteShellStdinResult({ result: { case: "error", value: new WriteShellStdinError({ error: `Shell ${args.shellId} is not running` }) } });
    const before = Number((await stat(running.terminalPath)).size);
    await new Promise<void>((resolve, reject) => running.child.stdin.write(args.chars, error => error == null ? resolve() : reject(error)));
    return new WriteShellStdinResult({ result: { case: "success", value: new WriteShellStdinSuccess({ shellId: args.shellId, terminalFileLengthBeforeInputWritten: before }) } });
  }

  async stop(): Promise<void> {
    this.stopMcpServers();
    for (const child of this.#foreground) this.kill(child);
    for (const process of this.#background.values()) this.kill(process.child);
    this.#foreground.clear();
    this.#background.clear();
  }

  private spawnShell(command: string, cwd: string): ChildProcessWithoutNullStreams {
    return spawn("/bin/sh", ["-lc", command], { cwd, env: this.#environment, detached: process.platform !== "win32", stdio: "pipe" });
  }

  private kill(child: ChildProcessWithoutNullStreams): void {
    if (child.exitCode != null || child.signalCode != null) return;
    try {
      if (process.platform !== "win32" && child.pid != null) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }

  private async run(command: string, cwd: string, timeoutMs: number | undefined, signal: AbortSignal): Promise<ProcessOutcome> {
    const child = this.spawnShell(command, cwd);
    this.#foreground.add(child);
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", data => { stdout += String(data); });
    child.stderr.on("data", data => { stderr += String(data); });
    const abort = () => this.kill(child);
    signal.addEventListener("abort", abort, { once: true });
    const timer = timeoutMs == null ? undefined : setTimeout(() => { timedOut = true; this.kill(child); }, timeoutMs);
    try {
      const outcome = await new Promise<{ code: number; signal: string }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, childSignal) => resolve({ code: code ?? 1, signal: childSignal ?? "" }));
      });
      return { ...outcome, stdout, stderr, elapsedMs: Date.now() - startedAt, timedOut, aborted: signal.aborted };
    } finally {
      if (timer != null) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      this.#foreground.delete(child);
    }
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(error => error == null ? resolve() : reject(error)));
}

export async function startBoxExecDaemon(options: BoxExecDaemonOptions): Promise<BoxExecDaemonHandle> {
  const host = options.host ?? BOX_EXEC_DAEMON_HOST;
  const port = options.port ?? BOX_EXEC_DAEMON_PORT;
  const authToken = options.authToken ?? BOX_EXEC_DAEMON_AUTH_TOKEN;
  const requestedWorkspaceRoot = path.resolve(options.workspaceRoot);
  const requestedTerminalsDirectory = path.resolve(options.terminalsDirectory ?? path.join(tmpdir(), "sand-box-terminals"));
  await mkdir(requestedWorkspaceRoot, { recursive: true });
  await mkdir(requestedTerminalsDirectory, { recursive: true });
  const [workspaceRoot, terminalsDirectory] = await Promise.all([
    realpath(requestedWorkspaceRoot),
    realpath(requestedTerminalsDirectory),
  ]);
  await stat(workspaceRoot).then(info => {
    if (!info.isDirectory()) throw new Error(`workspaceRoot is not a directory: ${workspaceRoot}`);
  });
  const runtime = new BoxExecRuntime(workspaceRoot, terminalsDirectory, options.environment ?? process.env);
  const adapter = connectNodeAdapter({
    routes(router) {
      router.service(BoxControlService, {
        ping: async () => new PingResponse(),
        getCapabilities: async () => new GetCapabilitiesResponse({ computerUseSupported: false, installPluginArtifactSupported: false }),
        updateEnvironmentVariables: async request => new UpdateEnvironmentVariablesResponse(runtime.applyEnvironment(request)),
        loadMcpServers: async request => runtime.loadMcpServers(request),
      });
      router.service(BoxExecService, { exec: (request, context) => runtime.execute(request, context.signal) });
    },
  });
  let readyState = false;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${authToken}`) {
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end("Unauthorized");
      return;
    }
    adapter(request, response);
  });
  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); readyState = true; resolve(); });
  });
  await ready;
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Box exec daemon did not expose a TCP address");
  let stopped = false;
  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    workspaceRoot,
    terminalsDirectory,
    ready,
    isReady: () => readyState && !stopped,
    async stop() {
      if (stopped) return;
      stopped = true;
      readyState = false;
      await runtime.stop();
      await closeServer(server);
    },
  };
}
