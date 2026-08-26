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
        const command = `rg --files -g ${singleQuote(pattern)} ${singleQuote(dir)} 2>/dev/null || true`;
        const shellResult = await shellExecutor.execute(ctx, new ShellArgs({ command, workingDirectory: dir, timeout: 30_000, toolCallId: meta.toolCallId }), { execId: meta.toolCallId });
        if (shellResult.result.case !== "success" && shellResult.result.case !== "failure") {
          return new GlobToolResult({ result: { case: "error", value: new GlobToolError({ error: `glob failed (${shellResult.result.case ?? "unknown"})` }) } });
        }
        const stdout = shellResult.result.value.stdout;
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
