import { z } from "zod";

import type { Context } from "../../../../context/core.js";
import { createSpan } from "../../../../context/otel.js";
import { readExecutorResource } from "../../../../agent-exec/read.js";
import { writeExecutorResource } from "../../../../agent-exec/write.js";
import type { RemoteExecManager } from "../../../../agent-exec/remote.js";
import type { ResourceAccessor } from "../../../../agent-exec/resource-provider.js";
import { createStringResult } from "../../../../chat-inference/prompt-executor.js";
import { ToolCall } from "../../../../proto/generated/agent/v1/agent_pb.js";
import { EditArgs, EditError, EditFileNotFound, EditReadPermissionDenied, EditRejected, EditResult, EditSuccess, EditWritePermissionDenied } from "../../../../proto/generated/agent/v1/edit_tool_pb.js";
import { EditToolCall } from "../../../../proto/generated/agent/v1/edit_tool_pb.js";
import { ReadArgs } from "../../../../proto/generated/agent/v1/read_exec_pb.js";
import { WriteArgs } from "../../../../proto/generated/agent/v1/write_exec_pb.js";
import { WORKTREE_GUARD_ERROR } from "../../../../utils/path-utils.js";
import { decoratePostWriteResultForModel } from "./post-write-result-decoration.js";
import { ToolCallArgParseError, ToolCallRejectedError, ToolCallUnexpectedEnvironmentError, createZodAgentTool } from "../../common.js";

const EDIT_DESCRIPTION = "Edit a file by replacing an exact string with a new string. Provide `path`, the exact `old_string` to find (including surrounding context so it is unique), and the `new_string` to replace it with. By default the match must be unique; set `replace_all` to replace every occurrence. To create a new file, use the write path instead.";

export type EditResourceAccessor = ResourceAccessor<RemoteExecManager>;

interface EditInteractionHandler {
  executeToolCall(
    ctx: Context,
    toolCall: ToolCall,
    toolCallId: string,
    run: (ctx: Context) => Promise<EditResult>,
    merge: (result: EditResult) => ToolCall,
  ): Promise<EditResult>;
}

function createEditToolCall(value: EditToolCall): ToolCall {
  return new ToolCall({ tool: { case: "editToolCall", value } });
}

function unifiedish(oldString: string, newString: string): string {
  const removed = oldString.split("\n").map(line => `- ${line}`);
  const added = newString.split("\n").map(line => `+ ${line}`);
  return [...removed, ...added].join("\n").slice(0, 4000);
}

export function createEditTool(
  resourceAccessor: EditResourceAccessor,
  toolName = "edit_file",
): ReturnType<typeof createZodAgentTool> {
  const readExecutor = resourceAccessor.get(readExecutorResource);
  const writeExecutor = resourceAccessor.get(writeExecutorResource);
  const parameters = z.object({
    path: z.string().describe("The path to the file to edit. Absolute, or relative to the workspace root."),
    old_string: z.string().describe("The exact text to replace. Must match the file exactly, including indentation, and be unique unless replace_all is set."),
    new_string: z.string().describe("The text to replace it with."),
    replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match."),
  });

  const execute = async (
    parentCtx: Context,
    interactionHandler: EditInteractionHandler,
    argsStream: AsyncIterable<string>,
    meta: { readonly toolCallId: string },
  ): Promise<EditResult> => {
    using span = createSpan(parentCtx.withName("editExecute"));
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
    const { path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll } = parsed.data;
    const editArgs = new EditArgs({ path: filePath, streamContent: newString });
    return interactionHandler.executeToolCall(
      span.ctx,
      createEditToolCall(new EditToolCall({ args: editArgs })),
      meta.toolCallId,
      async ctx => {
        const readResult = await readExecutor.execute(ctx, new ReadArgs({ path: filePath, toolCallId: meta.toolCallId }), { execId: meta.toolCallId });
        if (readResult.result.case !== "success") {
          if (readResult.result.case === "fileNotFound") return new EditResult({ result: { case: "fileNotFound", value: new EditFileNotFound({ path: filePath }) } });
          if (readResult.result.case === "permissionDenied") return new EditResult({ result: { case: "readPermissionDenied", value: new EditReadPermissionDenied({ path: filePath }) } });
          if (readResult.result.case === "rejected") throw new ToolCallRejectedError(readResult.result.value.reason || "Read rejected");
          const message = readResult.result.case === "error" ? readResult.result.value.error : "Could not read file for editing";
          return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: message }) } });
        }
        const output = readResult.result.value.output;
        if (output.case !== "content") return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: "File is not text and cannot be edited" }) } });
        const before = output.value;
        let occurrences = before.split(oldString).length - 1;
        let after: string;
        if (occurrences === 0) {
          // Whitespace-insensitive fallback: match old_string treating any run of whitespace as flexible,
          // mirroring the original edit tool's use_whitespace_insensitive_fallback.
          const pattern = new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "g");
          const wsCount = (before.match(pattern) ?? []).length;
          if (wsCount === 0) return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: "old_string was not found in the file" }) } });
          if (wsCount > 1 && replaceAll !== true) return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: `old_string is not unique (${wsCount} whitespace-insensitive matches); pass replace_all or add more context` }) } });
          occurrences = wsCount;
          after = before.replace(pattern, () => newString);
        } else {
          if (occurrences > 1 && replaceAll !== true) return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: `old_string is not unique (${occurrences} matches); pass replace_all or add more context` }) } });
          after = replaceAll === true ? before.split(oldString).join(newString) : before.replace(oldString, () => newString);
        }
        const writeResult = await writeExecutor.execute(ctx, new WriteArgs({ path: filePath, fileText: after, toolCallId: meta.toolCallId }), { execId: meta.toolCallId });
        if (writeResult.result.case !== "success") {
          switch (writeResult.result.case) {
            case "permissionDenied": return new EditResult({ result: { case: "writePermissionDenied", value: new EditWritePermissionDenied({ path: filePath, error: `Write permission denied: ${filePath}`, isReadonly: writeResult.result.value.isReadonly ?? false }) } });
            case "noSpace": return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: "No space left on device" }) } });
            case "rejected": return new EditResult({ result: { case: "rejected", value: new EditRejected({ path: filePath, reason: writeResult.result.value.reason }) } });
            case "error": {
              const writeError = writeResult.result.value.error;
              if (writeError === WORKTREE_GUARD_ERROR) throw new ToolCallUnexpectedEnvironmentError(writeError);
              return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: writeError }) } });
            }
            default: return new EditResult({ result: { case: "error", value: new EditError({ path: filePath, error: `Could not write edited file (${writeResult.result.case ?? "unknown"})` }) } });
          }
        }
        const replaced = replaceAll === true ? occurrences : 1;
        const linesRemoved = oldString.split("\n").length * replaced;
        const linesAdded = newString.split("\n").length * replaced;
        const baseMessage = `Replaced ${replaced} occurrence${replaced === 1 ? "" : "s"} in ${filePath}`;
        // Append post-write diagnostics (canvas/TypeScript lints) exactly like the original edit tool.
        const message = await decoratePostWriteResultForModel(ctx, resourceAccessor, filePath, baseMessage, meta.toolCallId);
        return new EditResult({ result: { case: "success", value: new EditSuccess({
          path: filePath,
          linesAdded,
          linesRemoved,
          diffString: unifiedish(oldString, newString),
          beforeFullFileContent: before.slice(0, 200_000),
          afterFullFileContent: after.slice(0, 200_000),
          message,
        }) } });
      },
      result => createEditToolCall(new EditToolCall({ args: editArgs, result })),
    );
  };

  const render = async (_ctx: Context, execResult: EditResult): Promise<ReturnType<typeof createStringResult>> => {
    switch (execResult.result?.case) {
      case "success": {
        const value = execResult.result.value;
        return createStringResult(`${value.message ?? `Edited ${value.path}`}\n(+${value.linesAdded ?? 0}/-${value.linesRemoved ?? 0})\n${value.diffString ?? ""}`.trim());
      }
      case "fileNotFound": return createStringResult(`File not found: ${execResult.result.value.path}`);
      case "readPermissionDenied": return createStringResult(`Read permission denied: ${execResult.result.value.path}`);
      case "writePermissionDenied": return createStringResult(`Write permission denied: ${execResult.result.value.path}`);
      case "rejected": return createStringResult(`Rejected: ${execResult.result.value.reason}`);
      case "error": return createStringResult(`Error: ${execResult.result.value.error}`);
      case undefined: return createStringResult("Unknown error");
    }
  };

  return createZodAgentTool("EDIT_FILE", {
    name: toolName,
    contextType: { type: "dynamic", conciseStaticContext: "Use this tool to edit a file by exact string replacement." },
    descriptionGenerator: () => EDIT_DESCRIPTION,
    parameters,
    execute,
    render,
    serializeError: (error: unknown) => createEditToolCall(new EditToolCall({
      result: new EditResult({ result: { case: "error", value: new EditError({ path: "", error: error instanceof Error ? error.message : String(error) }) } }),
    })),
  });
}
