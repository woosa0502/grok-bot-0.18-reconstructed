import { z } from "zod";

import type { Context } from "../../../../context/core.js";
import { createSpan } from "../../../../context/otel.js";
import { grepExecutorResource } from "../../../../agent-exec/grep.js";
import type { RemoteExecManager } from "../../../../agent-exec/remote.js";
import type { ResourceAccessor } from "../../../../agent-exec/resource-provider.js";
import { createStringResult } from "../../../../chat-inference/prompt-executor.js";
import { ToolCall } from "../../../../proto/generated/agent/v1/agent_pb.js";
import { GrepArgs, GrepError, GrepResult, type GrepSuccess } from "../../../../proto/generated/agent/v1/grep_exec_pb.js";
import { GrepToolCall } from "../../../../proto/generated/agent/v1/grep_tool_pb.js";
import { ToolCallArgParseError, ToolCallUnexpectedEnvironmentError, createZodAgentTool } from "../../common.js";

const GREP_DESCRIPTION = "Search file contents with ripgrep. Provide a regular-expression `pattern`; optionally restrict to a `path`, a `glob`, or a file `type`. Returns matching lines grouped by file with their line numbers. Prefer this over shelling out to grep for code search.";

const GREP_CHARACTER_BUDGET = 12_000;

export type GrepResourceAccessor = ResourceAccessor<RemoteExecManager>;

interface GrepInteractionHandler {
  executeToolCall(
    ctx: Context,
    toolCall: ToolCall,
    toolCallId: string,
    run: (ctx: Context) => Promise<GrepResult>,
    merge: (result: GrepResult) => ToolCall,
  ): Promise<GrepResult>;
}

function createGrepToolCall(value: GrepToolCall): ToolCall {
  return new ToolCall({ tool: { case: "grepToolCall", value } });
}

function renderGrepSuccess(success: GrepSuccess): string {
  const lines: string[] = [];
  let used = 0;
  let capped = false;
  let totalMatched = 0;
  const overBudget = (extra: number): boolean => used + extra > GREP_CHARACTER_BUDGET;
  for (const union of Object.values(success.workspaceResults)) {
    const r = union.result;
    if (r.case === "files") {
      if (r.value.clientTruncated || r.value.ripgrepTruncated) capped = true;
      for (const file of r.value.files) {
        if (overBudget(file.length)) { lines.push("… (output truncated to fit the character budget)"); return lines.join("\n"); }
        lines.push(file);
        used += file.length + 1;
      }
      continue;
    }
    if (r.case === "count") {
      if (r.value.clientTruncated) capped = true;
      totalMatched += r.value.totalMatches;
      for (const entry of r.value.counts) {
        const row = `${entry.file}: ${entry.count}`;
        if (overBudget(row.length)) { lines.push("… (output truncated to fit the character budget)"); return lines.join("\n"); }
        lines.push(row);
        used += row.length + 1;
      }
      continue;
    }
    if (r.case !== "content") continue;
    const content = r.value;
    if (content.clientTruncated || content.ripgrepTruncated) capped = true;
    totalMatched += content.totalMatchedLines;
    for (const fileMatch of content.matches) {
      const header = `${fileMatch.file}:`;
      if (overBudget(header.length)) { lines.push("… (output truncated to fit the character budget)"); return lines.join("\n"); }
      lines.push(header);
      used += header.length + 1;
      for (const match of fileMatch.matches) {
        const row = `  ${match.lineNumber}: ${match.content}`;
        if (overBudget(row.length)) { lines.push("… (output truncated to fit the character budget)"); return lines.join("\n"); }
        lines.push(row);
        used += row.length + 1;
      }
    }
  }
  if (lines.length === 0) return `No matches for /${success.pattern}/`;
  if (capped) lines.push(totalMatched > 0 ? `… (results capped at ${totalMatched} match${totalMatched === 1 ? "" : "es"}; narrow the pattern or path to see more)` : "… (results truncated; narrow the pattern or path to see more)");
  return lines.join("\n");
}

export function createGrepTool(
  resourceAccessor: GrepResourceAccessor,
  toolName = "grep",
): ReturnType<typeof createZodAgentTool> {
  const grepExecutor = resourceAccessor.get(grepExecutorResource);
  const parameters = z.object({
    pattern: z.string().describe("The regular expression to search for."),
    path: z.string().optional().describe("File or directory to search in. Defaults to the workspace root."),
    glob: z.string().optional().describe("Glob to filter which files are searched, e.g. '*.ts'."),
    type: z.string().optional().describe("Restrict to a ripgrep file type, e.g. 'py'."),
    case_insensitive: z.boolean().optional().describe("Case-insensitive match."),
    context: z.number().int().optional().describe("Lines of context to show before and after each match."),
    head_limit: z.number().int().optional().describe("Maximum number of matched lines to return."),
    multiline: z.boolean().optional().describe("Allow the pattern to span multiple lines."),
    output_mode: z.enum(["content", "files_with_matches", "count"]).optional().describe("What to return: 'content' (matching lines with line numbers, the default), 'files_with_matches' (only the paths of files that match), or 'count' (number of matches per file)."),
  });

  const execute = async (
    parentCtx: Context,
    interactionHandler: GrepInteractionHandler,
    argsStream: AsyncIterable<string>,
    meta: { readonly toolCallId: string },
  ): Promise<GrepResult> => {
    using span = createSpan(parentCtx.withName("grepExecute"));
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
    const grepArgs = new GrepArgs({
      pattern: parsed.data.pattern,
      toolCallId: meta.toolCallId,
      ...(parsed.data.path === undefined ? {} : { path: parsed.data.path }),
      ...(parsed.data.glob === undefined ? {} : { glob: parsed.data.glob }),
      ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
      ...(parsed.data.case_insensitive === undefined ? {} : { caseInsensitive: parsed.data.case_insensitive }),
      ...(parsed.data.context === undefined ? {} : { context: parsed.data.context }),
      ...(parsed.data.head_limit === undefined ? {} : { headLimit: parsed.data.head_limit }),
      ...(parsed.data.multiline === undefined ? {} : { multiline: parsed.data.multiline }),
      ...(parsed.data.output_mode === undefined ? {} : { outputMode: parsed.data.output_mode }),
    });
    return interactionHandler.executeToolCall(
      span.ctx,
      createGrepToolCall(new GrepToolCall({ args: grepArgs })),
      meta.toolCallId,
      async ctx => {
        const result = await grepExecutor.execute(ctx, grepArgs, { execId: meta.toolCallId });
        if (result.result.case === "error") throw new ToolCallUnexpectedEnvironmentError(result.result.value.error);
        return result;
      },
      result => createGrepToolCall(new GrepToolCall({ args: grepArgs, result })),
    );
  };

  const render = async (_ctx: Context, execResult: GrepResult): Promise<ReturnType<typeof createStringResult>> => {
    switch (execResult.result?.case) {
      case "success": return createStringResult(renderGrepSuccess(execResult.result.value));
      case "error": return createStringResult(`Error: ${execResult.result.value.error}`);
      case undefined: return createStringResult("Unknown error");
    }
  };

  return createZodAgentTool("RIPGREP_SEARCH", {
    name: toolName,
    contextType: { type: "dynamic", conciseStaticContext: "Use this tool to search file contents by regular expression." },
    descriptionGenerator: () => GREP_DESCRIPTION,
    parameters,
    execute,
    render,
    serializeError: (error: unknown) => createGrepToolCall(new GrepToolCall({
      result: new GrepResult({ result: { case: "error", value: new GrepError({ error: error instanceof Error ? error.message : String(error) }) } }),
    })),
  });
}
