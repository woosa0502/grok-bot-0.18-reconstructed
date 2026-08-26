import { z } from "zod";

import type { Context } from "../../../../context/core.js";
import { createSpan } from "../../../../context/otel.js";
import { lsExecutorResource } from "../../../../agent-exec/ls.js";
import type { RemoteExecManager } from "../../../../agent-exec/remote.js";
import type { ResourceAccessor } from "../../../../agent-exec/resource-provider.js";
import { createStringResult } from "../../../../chat-inference/prompt-executor.js";
import { ToolCall } from "../../../../proto/generated/agent/v1/agent_pb.js";
import { LsArgs, LsError, LsResult } from "../../../../proto/generated/agent/v1/ls_exec_pb.js";
import { LsToolCall } from "../../../../proto/generated/agent/v1/ls_tool_pb.js";
import { ToolCallArgParseError, ToolCallRejectedError, ToolCallUnexpectedEnvironmentError, createZodAgentTool } from "../../common.js";
import { renderDirectoryTreeWithinBudget } from "./formatters.js";

const LS_DESCRIPTION = "List the contents of a directory as a tree. This is a quick way to understand the structure of a directory before reading specific files or running more targeted searches. Returns the files and subdirectories under the given path (recursively, within a budget), grouped and sorted, with per-extension counts for large subtrees.";

export type LsResourceAccessor = ResourceAccessor<RemoteExecManager>;

interface LsInteractionHandler {
  executeToolCall(
    ctx: Context,
    toolCall: ToolCall,
    toolCallId: string,
    run: (ctx: Context) => Promise<LsResult>,
    merge: (result: LsResult) => ToolCall,
  ): Promise<LsResult>;
}

function createLsToolCall(value: LsToolCall): ToolCall {
  return new ToolCall({ tool: { case: "lsToolCall", value } });
}

export function createLsTool(
  resourceAccessor: LsResourceAccessor,
  toolName = "list_dir",
): ReturnType<typeof createZodAgentTool> {
  const lsExecutor = resourceAccessor.get(lsExecutorResource);
  const parameters = z.object({
    relative_workspace_path: z.string().describe("The path to the directory to list. Absolute, or relative to the workspace root."),
    ignore: z.array(z.string()).optional().describe("Names to exclude from the listing."),
  });

  const execute = async (
    parentCtx: Context,
    interactionHandler: LsInteractionHandler,
    argsStream: AsyncIterable<string>,
    meta: { readonly toolCallId: string },
  ): Promise<LsResult> => {
    using span = createSpan(parentCtx.withName("lsExecute"));
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
    const lsArgs = new LsArgs({
      path: parsed.data.relative_workspace_path,
      toolCallId: meta.toolCallId,
      ...(parsed.data.ignore === undefined ? {} : { ignore: parsed.data.ignore }),
    });
    return interactionHandler.executeToolCall(
      span.ctx,
      createLsToolCall(new LsToolCall({ args: lsArgs })),
      meta.toolCallId,
      async ctx => {
        const result = await lsExecutor.execute(ctx, lsArgs, { execId: meta.toolCallId });
        if (result.result.case === "error") throw new ToolCallUnexpectedEnvironmentError(result.result.value.error);
        if (result.result.case === "rejected") throw new ToolCallRejectedError(result.result.value.reason || "Directory listing rejected");
        return result;
      },
      result => createLsToolCall(new LsToolCall({ args: lsArgs, result })),
    );
  };

  const render = async (_ctx: Context, execResult: LsResult): Promise<ReturnType<typeof createStringResult>> => {
    switch (execResult.result?.case) {
      case "success": {
        const root = execResult.result.value.directoryTreeRoot;
        return createStringResult(root === undefined ? "(empty directory)" : renderDirectoryTreeWithinBudget(root).result);
      }
      case "timeout": {
        const root = execResult.result.value.directoryTreeRoot;
        const body = root === undefined ? "" : `${renderDirectoryTreeWithinBudget(root).result}\n`;
        return createStringResult(`${body}(listing timed out; results may be partial)`);
      }
      case "error": return createStringResult(`Error: ${execResult.result.value.error}`);
      case "rejected": return createStringResult(`Rejected: ${execResult.result.value.reason}`);
      case undefined: return createStringResult("Unknown error");
    }
  };

  return createZodAgentTool("LS", {
    name: toolName,
    contextType: { type: "dynamic", conciseStaticContext: "Use this tool to list the contents of a directory." },
    descriptionGenerator: () => LS_DESCRIPTION,
    parameters,
    execute,
    render,
    serializeError: (error: unknown) => createLsToolCall(new LsToolCall({
      result: new LsResult({ result: { case: "error", value: new LsError({ path: "", error: error instanceof Error ? error.message : String(error) }) } }),
    })),
  });
}
