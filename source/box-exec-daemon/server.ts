import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { appendFile, lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { connectNodeAdapter } from "@connectrpc/connect-node";
import { MethodKind, type ServiceType } from "@bufbuild/protobuf";

import { ControlService } from "../packages/proto/generated/agent/v1/control_service_connect.js";
import { ExecService } from "../packages/proto/generated/agent/v1/exec_service_connect.js";
import {
  GetCapabilitiesResponse,
  LoadMcpServersResponse,
  PingResponse,
  UpdateEnvironmentVariablesResponse,
  type UpdateEnvironmentVariablesRequest,
} from "../packages/proto/generated/agent/v1/control_service_pb.js";
import {
  ExecClientControlMessage,
  ExecClientMessage,
  ExecClientStreamClose,
  ExecClientThrow,
  type ExecServerMessage,
} from "../packages/proto/generated/agent/v1/exec_pb.js";
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
  #nextShellId = 1;

  constructor(readonly workspaceRoot: string, readonly terminalsDirectory: string, environment: NodeJS.ProcessEnv) {
    this.#environment = { ...environment };
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

  async *execute(request: ExecServerMessage, signal: AbortSignal): AsyncGenerator<ExecStreamElement> {
    try {
      switch (request.message.case) {
        case "readArgs":
        case "redactedReadArgs": {
          const result = await this.read(request.message.value);
          const resultCase = request.message.case === "readArgs" ? "readResult" : "redactedReadResult";
          yield client(request.id, request.execId, { case: resultCase, value: result } as ExecClientMessage["message"]);
          break;
        }
        case "lsArgs": {
          yield client(request.id, request.execId, { case: "lsResult", value: await this.ls(request.message.value) });
          break;
        }
        case "deleteArgs": {
          yield client(request.id, request.execId, { case: "deleteResult", value: await this.delete(request.message.value) });
          break;
        }
        case "grepArgs": {
          yield client(request.id, request.execId, { case: "grepResult", value: await this.grep(request.message.value, signal) });
          break;
        }
        case "writeArgs": {
          yield client(request.id, request.execId, { case: "writeResult", value: await this.write(request.message.value) });
          break;
        }
        case "shellArgs":
        case "miniSweAgentBashArgs": {
          const result = await this.shell(request.message.value, signal);
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
    const stdout = await new Promise<string>((resolve) => {
      const child = spawn("rg", rgArgs, { cwd: spawnCwd, env: this.#environment });
      let out = "";
      child.stdout.on("data", data => { out += String(data); });
      child.stderr.on("data", () => {});
      const abort = () => this.kill(child);
      signal.addEventListener("abort", abort, { once: true });
      child.once("close", () => { signal.removeEventListener("abort", abort); resolve(out); });
      child.once("error", () => resolve(out));
    });
    const byFile = new Map<string, GrepContentMatch[]>();
    let totalMatchedLines = 0;
    const offset = Math.max(0, args.offset ?? 0);
    let matchIndex = 0;
    for (const line of stdout.split("\n")) {
      if (line.length === 0) continue;
      let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== "match") continue;
      if (matchIndex++ < offset) continue;
      const file = event.data?.path?.text ?? "";
      const lineNumber = event.data?.line_number ?? 0;
      const content = (event.data?.lines?.text ?? "").replace(/\n$/, "");
      const list = byFile.get(file) ?? [];
      if (list.length === 0) byFile.set(file, list);
      if (totalMatchedLines < headLimit) {
        list.push(new GrepContentMatch({ lineNumber, content: content.slice(0, 2000), contentTruncated: content.length > 2000 }));
        totalMatchedLines += 1;
      }
    }
    const outputMode = args.outputMode ?? "content";
    const clientTruncated = totalMatchedLines >= headLimit;
    let union: GrepUnionResult;
    if (outputMode === "files_with_matches" || outputMode === "files") {
      const files = [...byFile.keys()];
      union = new GrepUnionResult({ result: { case: "files", value: new GrepFilesResult({ files, totalFiles: files.length, clientTruncated, ripgrepTruncated: false }) } });
    } else if (outputMode === "count") {
      const counts = [...byFile.entries()].map(([file, fileMatches]) => new GrepFileCount({ file, count: fileMatches.length }));
      union = new GrepUnionResult({ result: { case: "count", value: new GrepCountResult({ counts, totalFiles: counts.length, totalMatches: totalMatchedLines, clientTruncated }) } });
    } else {
      const matches = [...byFile.entries()].map(([file, fileMatches]) => new GrepFileMatch({ file, matches: fileMatches }));
      union = new GrepUnionResult({ result: { case: "content", value: new GrepContentResult({ matches, totalLines: totalMatchedLines, totalMatchedLines, clientTruncated, ripgrepTruncated: false }) } });
    }
    return new GrepResult({ result: { case: "success", value: new GrepSuccess({ pattern: args.pattern, path: cwd, outputMode, workspaceResults: { workspace: union } }) } });
  }

  async write(args: WriteArgs): Promise<WriteResult> {
    let target: string;
    try {
      target = this.resolvePath(args.path);
    } catch (error) {
      return new WriteResult({ result: { case: "error", value: new WriteError({ path: args.path, error: errorText(error) }) } });
    }
    try {
      await mkdir(path.dirname(target), { recursive: true });
      const data = args.fileBytes !== undefined && args.fileBytes.length > 0 ? Buffer.from(args.fileBytes) : Buffer.from(args.fileText ?? "", args.encodingHint === "latin1" ? "latin1" : "utf8");
      await writeFile(target, data);
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
        loadMcpServers: async () => new LoadMcpServersResponse(),
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
