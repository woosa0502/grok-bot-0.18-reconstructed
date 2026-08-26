import { z } from "zod";

import type { Context } from "../../../../context/core.js";
import { createSpan } from "../../../../context/otel.js";
import { deleteExecutorResource } from "../../../../agent-exec/delete.js";
import type { RemoteExecManager } from "../../../../agent-exec/remote.js";
import type { ResourceAccessor } from "../../../../agent-exec/resource-provider.js";
import { createStringResult } from "../../../../chat-inference/prompt-executor.js";
import { ToolCall } from "../../../../proto/generated/agent/v1/agent_pb.js";
import { DeleteArgs, DeleteError, DeleteResult } from "../../../../proto/generated/agent/v1/delete_exec_pb.js";
import { DeleteToolCall } from "../../../../proto/generated/agent/v1/delete_tool_pb.js";
import { ToolCallArgParseError, ToolCallRejectedError, ToolCallUnexpectedEnvironmentError, createZodAgentTool } from "../../common.js";

const DELETE_DESCRIPTION = "Delete a file at the given path. Use this when a file is no longer needed. Fails gracefully if the file does not exist, the path is a directory, or the deletion is not permitted.";

export type DeleteResourceAccessor = ResourceAccessor<RemoteExecManager>;

interface DeleteInteractionHandler {
  executeToolCall(
    ctx: Context,
    toolCall: ToolCall,
    toolCallId: string,
    run: (ctx: Context) => Promise<DeleteResult>,
    merge: (result: DeleteResult) => ToolCall,
  ): Promise<DeleteResult>;
}

function createDeleteToolCall(value: DeleteToolCall): ToolCall {
  return new ToolCall({ tool: { case: "deleteToolCall", value } });
}

export function createDeleteTool(
  resourceAccessor: DeleteResourceAccessor,
  toolName = "delete_file",
): ReturnType<typeof createZodAgentTool> {
  const deleteExecutor = resourceAccessor.get(deleteExecutorResource);
  const parameters = z.object({
    path: z.string().describe("The path to the file to delete. Absolute, or relative to the workspace root."),
  });

  const execute = async (
    parentCtx: Context,
    interactionHandler: DeleteInteractionHandler,
    argsStream: AsyncIterable<string>,
    meta: { readonly toolCallId: string },
  ): Promise<DeleteResult> => {
    using span = createSpan(parentCtx.withName("deleteExecute"));
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
    const deleteArgs = new DeleteArgs({ path: parsed.data.path, toolCallId: meta.toolCallId });
    return interactionHandler.executeToolCall(
      span.ctx,
      createDeleteToolCall(new DeleteToolCall({ args: deleteArgs })),
      meta.toolCallId,
      async ctx => {
        const result = await deleteExecutor.execute(ctx, deleteArgs, { execId: meta.toolCallId });
        if (result.result.case === "rejected") throw new ToolCallRejectedError(result.result.value.reason || "Delete rejected");
        if (result.result.case === "error") throw new ToolCallUnexpectedEnvironmentError(result.result.value.error);
        return result;
      },
      result => createDeleteToolCall(new DeleteToolCall({ args: deleteArgs, result })),
    );
  };

  const render = async (_ctx: Context, execResult: DeleteResult): Promise<ReturnType<typeof createStringResult>> => {
    switch (execResult.result?.case) {
      case "success": return createStringResult(`Deleted ${execResult.result.value.path}`);
      case "fileNotFound": return createStringResult(`File not found: ${execResult.result.value.path}`);
      case "notFile": return createStringResult(`Not a file (is a directory): ${execResult.result.value.path}`);
      case "permissionDenied": return createStringResult(`Permission denied: ${execResult.result.value.path}`);
      case "fileBusy": return createStringResult(`File is busy: ${execResult.result.value.path}`);
      case "rejected": return createStringResult(`Rejected: ${execResult.result.value.reason}`);
      case "error": return createStringResult(`Error: ${execResult.result.value.error}`);
      case undefined: return createStringResult("Unknown error");
    }
  };

  return createZodAgentTool("DELETE_FILE", {
    name: toolName,
    contextType: { type: "dynamic", conciseStaticContext: "Use this tool to delete a file." },
    descriptionGenerator: () => DELETE_DESCRIPTION,
    parameters,
    execute,
    render,
    serializeError: (error: unknown) => createDeleteToolCall(new DeleteToolCall({
      result: new DeleteResult({ result: { case: "error", value: new DeleteError({ path: "", error: error instanceof Error ? error.message : String(error) }) } }),
    })),
  });
}
