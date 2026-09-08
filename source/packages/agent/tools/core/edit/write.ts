import { z } from "zod";

import type { Context } from "../../../../context/core.js";
import { createSpan } from "../../../../context/otel.js";
import { writeExecutorResource } from "../../../../agent-exec/write.js";
import type { RemoteExecManager } from "../../../../agent-exec/remote.js";
import type { ResourceAccessor } from "../../../../agent-exec/resource-provider.js";
import { createStringResult } from "../../../../chat-inference/prompt-executor.js";
import { ToolCall } from "../../../../proto/generated/agent/v1/agent_pb.js";
import { PiWriteToolArgs, PiWriteToolError, PiWriteToolRejected, PiWriteToolResult, PiWriteToolSuccess } from "../../../../proto/generated/agent/v1/pi_write_tool_pb.js";
import { PiWriteToolCall } from "../../../../proto/generated/agent/v1/pi_write_tool_pb.js";
import { WriteArgs } from "../../../../proto/generated/agent/v1/write_exec_pb.js";
import { WORKTREE_GUARD_ERROR } from "../../../../utils/path-utils.js";
import { waitForFileMutationLock } from "../file-mutation-lock.js";
import { ToolCallArgParseError, ToolCallUnexpectedEnvironmentError, createZodAgentTool } from "../../common.js";

const WRITE_DESCRIPTION = "Create a new file, or completely overwrite an existing one. Provide `path` (absolute, or relative to the workspace root) and the full `contents` to write. Use this to create files; use edit_file to change part of an existing file.";

export type WriteResourceAccessor = ResourceAccessor<RemoteExecManager>;

interface WriteInteractionHandler {
  executeToolCall(
    ctx: Context,
    toolCall: ToolCall,
    toolCallId: string,
    run: (ctx: Context) => Promise<PiWriteToolResult>,
    merge: (result: PiWriteToolResult) => ToolCall,
  ): Promise<PiWriteToolResult>;
}

function createWriteToolCall(value: PiWriteToolCall): ToolCall {
  return new ToolCall({ tool: { case: "piWriteToolCall", value } });
}

export function createWriteTool(
  resourceAccessor: WriteResourceAccessor,
  toolName = "write",
): ReturnType<typeof createZodAgentTool> {
  const writeExecutor = resourceAccessor.get(writeExecutorResource);
  const parameters = z.object({
    path: z.string().describe("The path to the file to write. Absolute, or relative to the workspace root."),
    contents: z.string().describe("The full contents to write to the file."),
  });

  const execute = async (
    parentCtx: Context,
    interactionHandler: WriteInteractionHandler,
    argsStream: AsyncIterable<string>,
    meta: { readonly toolCallId: string },
  ): Promise<PiWriteToolResult> => {
    using span = createSpan(parentCtx.withName("writeExecute"));
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
    const { path: filePath, contents } = parsed.data;
    const toolArgs = new PiWriteToolArgs({ path: filePath, content: contents });
    return interactionHandler.executeToolCall(
      span.ctx,
      createWriteToolCall(new PiWriteToolCall({ args: toolArgs })),
      meta.toolCallId,
      async ctx => {
        using mutationLock = await waitForFileMutationLock(ctx, resourceAccessor);
        const writeResult = await writeExecutor.execute(ctx, new WriteArgs({ path: filePath, fileText: contents, toolCallId: meta.toolCallId }), { execId: meta.toolCallId });
        switch (writeResult.result.case) {
          case "success": {
            const lines = contents.length === 0 ? 0 : contents.split("\n").length;
            return new PiWriteToolResult({ result: { case: "success", value: new PiWriteToolSuccess({ output: `Wrote ${lines} line${lines === 1 ? "" : "s"} to ${filePath}` }) } });
          }
          case "permissionDenied": return new PiWriteToolResult({ result: { case: "error", value: new PiWriteToolError({ error: `Write permission denied: ${filePath}` }) } });
          case "noSpace": return new PiWriteToolResult({ result: { case: "error", value: new PiWriteToolError({ error: "No space left on device" }) } });
          case "rejected": return new PiWriteToolResult({ result: { case: "rejected", value: new PiWriteToolRejected({ reason: writeResult.result.value.reason }) } });
          case "error": {
            const writeError = writeResult.result.value.error;
            if (writeError === WORKTREE_GUARD_ERROR) throw new ToolCallUnexpectedEnvironmentError(writeError);
            return new PiWriteToolResult({ result: { case: "error", value: new PiWriteToolError({ error: writeError }) } });
          }
          default: return new PiWriteToolResult({ result: { case: "error", value: new PiWriteToolError({ error: `Could not write file (${writeResult.result.case ?? "unknown"})` }) } });
        }
      },
      result => createWriteToolCall(new PiWriteToolCall({ args: toolArgs, result })),
    );
  };

  const render = async (_ctx: Context, execResult: PiWriteToolResult): Promise<ReturnType<typeof createStringResult>> => {
    switch (execResult.result?.case) {
      case "success": return createStringResult(execResult.result.value.output);
      case "rejected": return createStringResult(`Rejected: ${execResult.result.value.reason}`);
      case "error": return createStringResult(`Error: ${execResult.result.value.error}`);
      case undefined: return createStringResult("Unknown error");
    }
  };

  return createZodAgentTool("PI_WRITE", {
    name: toolName,
    contextType: { type: "dynamic", conciseStaticContext: "Use this tool to create or overwrite a file." },
    descriptionGenerator: () => WRITE_DESCRIPTION,
    parameters,
    execute,
    render,
    serializeError: (error: unknown) => createWriteToolCall(new PiWriteToolCall({
      result: new PiWriteToolResult({ result: { case: "error", value: new PiWriteToolError({ error: error instanceof Error ? error.message : String(error) }) } }),
    })),
  });
}
