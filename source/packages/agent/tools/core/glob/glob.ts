import { z } from "zod";

import type { Context } from "../../../../context/core.js";
import { createSpan } from "../../../../context/otel.js";
import { shellExecutorResource } from "../../../../agent-exec/shell.js";
import type { RemoteExecManager } from "../../../../agent-exec/remote.js";
import type { ResourceAccessor } from "../../../../agent-exec/resource-provider.js";
import { createStringResult } from "../../../../chat-inference/prompt-executor.js";
import { ToolCall } from "../../../../proto/generated/agent/v1/agent_pb.js";
import { GlobToolArgs, GlobToolError, GlobToolResult, GlobToolSuccess } from "../../../../proto/generated/agent/v1/glob_tool_pb.js";
import { GlobToolCall } from "../../../../proto/generated/agent/v1/glob_tool_pb.js";
import { ShellArgs } from "../../../../proto/generated/agent/v1/shell_exec_pb.js";
import { ToolCallArgParseError, createZodAgentTool } from "../../common.js";

const GLOB_DESCRIPTION = "Find files by name using a glob pattern. Provide a `glob_pattern` such as '**/*.ts' or 'src/**/test_*.py', and optionally a `target_directory` to search under (defaults to the workspace root). Returns matching file paths. Prefer this over shelling out to find/ls when locating files by name.";

const GLOB_MAX_FILES = 300;

export type GlobResourceAccessor = ResourceAccessor<RemoteExecManager>;

interface GlobInteractionHandler {
  executeToolCall(
    ctx: Context,
    toolCall: ToolCall,
    toolCallId: string,
    run: (ctx: Context) => Promise<GlobToolResult>,
    merge: (result: GlobToolResult) => ToolCall,
  ): Promise<GlobToolResult>;
}

function createGlobToolCall(value: GlobToolCall): ToolCall {
  return new ToolCall({ tool: { case: "globToolCall", value } });
}

function singleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createGlobTool(
  resourceAccessor: GlobResourceAccessor,
  toolName = "glob_file_search",
): ReturnType<typeof createZodAgentTool> {
  const shellExecutor = resourceAccessor.get(shellExecutorResource);
  const parameters = z.object({
    glob_pattern: z.string().describe("The glob pattern to match file paths against, e.g. '**/*.ts'."),
    target_directory: z.string().optional().describe("Directory to search under. Defaults to the workspace root."),
  });

  const execute = async (
    parentCtx: Context,
    interactionHandler: GlobInteractionHandler,
    argsStream: AsyncIterable<string>,
    meta: { readonly toolCallId: string },
  ): Promise<GlobToolResult> => {
    using span = createSpan(parentCtx.withName("globExecute"));
    let rawArgs = "";
    try {
      for await (const chunk of argsStream) rawArgs += chunk;
    } catch (error) {
      throw new ToolCallArgParseError(error instanceof Error ? error.message : String(error));
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawArgs);
    } catch (error) {
      throw new ToolCallArgParseError(error instanceof Error ? error.message : "Invalid JSON");
    }
    const parsed = parameters.safeParse(parsedJson);
    if (!parsed.success) throw new ToolCallArgParseError(`Invalid arguments: ${parsed.error.message}`);
    const pattern = parsed.data.glob_pattern;
    const dir = parsed.data.target_directory !== undefined && parsed.data.target_directory.length > 0 ? parsed.data.target_directory : "/workspace";
    const globArgs = new GlobToolArgs({ globPattern: pattern, targetDirectory: dir });
    return interactionHandler.executeToolCall(
      span.ctx,
      createGlobToolCall(new GlobToolCall({ args: globArgs })),
      meta.toolCallId,
      async ctx => {
        // Search relative to workingDirectory (the box resolves it); do not pass the
        // virtual /workspace path as an rg argument — it does not exist on the host.
        // Mirror the original ripwalk: include hidden files and don't require a git repo for ignore handling.
        // Do not mask failures: `rg --files -g <glob>` exits 0 when files match,
        // 1 when nothing matches (a legitimate empty result), and >=2 on error
        // (missing rg, invalid glob). Only exit 1 is an empty success — every
        // other non-success is surfaced as an error so "no match" is never
        // confused with "search failed".
        const command = `rg --files --hidden --no-require-git -g ${singleQuote(pattern)}`;
        const shellResult = await shellExecutor.execute(ctx, new ShellArgs({ command, workingDirectory: dir, timeout: 30_000, toolCallId: meta.toolCallId }), { execId: meta.toolCallId });
        const rc = shellResult.result;
        let stdout: string;
        if (rc.case === "success") {
          stdout = rc.value.stdout;
        } else if (rc.case === "failure" && rc.value.exitCode === 1 && rc.value.stderr.trim().length === 0 && !rc.value.aborted) {
          stdout = ""; // ripgrep found no matching files
        } else {
          const detail = rc.case === "failure"
            ? `exit ${rc.value.exitCode}${rc.value.stderr.trim().length > 0 ? `: ${rc.value.stderr.trim()}` : ""}${rc.value.aborted ? " (aborted)" : ""}`
            : (rc.case ?? "unknown");
          return new GlobToolResult({ result: { case: "error", value: new GlobToolError({ error: `glob failed (${detail})` }) } });
        }
        const allFiles = stdout.split("\n").map(line => line.trim()).filter(line => line.length > 0);
        allFiles.sort((a, b) => a.localeCompare(b));
        const files = allFiles.slice(0, GLOB_MAX_FILES);
        return new GlobToolResult({ result: { case: "success", value: new GlobToolSuccess({
          pattern,
          path: dir,
          files,
          totalFiles: allFiles.length,
          clientTruncated: allFiles.length > GLOB_MAX_FILES,
          ripgrepTruncated: false,
        }) } });
      },
      result => createGlobToolCall(new GlobToolCall({ args: globArgs, result })),
    );
  };

  const render = async (_ctx: Context, execResult: GlobToolResult): Promise<ReturnType<typeof createStringResult>> => {
    switch (execResult.result?.case) {
      case "success": {
        const value = execResult.result.value;
        if (value.files.length === 0) return createStringResult(`No files match ${value.pattern}`);
        const suffix = value.clientTruncated ? `\n… (${value.totalFiles - value.files.length} more)` : "";
        return createStringResult(value.files.join("\n") + suffix);
      }
      case "error": return createStringResult(`Error: ${execResult.result.value.error}`);
      case undefined: return createStringResult("Unknown error");
    }
  };

  return createZodAgentTool("GLOB_FILE_SEARCH", {
    name: toolName,
    contextType: { type: "dynamic", conciseStaticContext: "Use this tool to find files by glob pattern." },
    descriptionGenerator: () => GLOB_DESCRIPTION,
    parameters,
    execute,
    render,
    serializeError: (error: unknown) => createGlobToolCall(new GlobToolCall({
      result: new GlobToolResult({ result: { case: "error", value: new GlobToolError({ error: error instanceof Error ? error.message : String(error) }) } }),
    })),
  });
}
