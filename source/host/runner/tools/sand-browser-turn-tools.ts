// Framework adapter for the browser tools. createSandBrowserTools produces the
// raw driver-facing definitions — execute(context, parsedArgs, metadata), a
// private {required, enum} schema, no model parameters. The turn framework
// needs the createComputerTurnTool / createMcpTool contract instead: a zod
// parameters schema (toAgentTools copies it into the model tool definitions,
// and toolsToPi silently DROPS any definition without one), a streaming-args
// execute(ctx, interactionHandler, argsStream, meta), a proto ToolCall for the
// transcript, render(ctx, output), and serializeError. Without this adapter
// the browser tools were pushed into the toolset but never reached the model's
// tool list. The agent proto has no browser ToolCall case, so the transcript
// rides the MCP envelope (serverIdentifier "browser"), which carries free-form
// args and text+image results.
import { z, type ZodTypeAny } from "zod";
import { Value, type JsonValue } from "@bufbuild/protobuf";

import type { Context } from "../../../packages/context/core.js";
import {
  McpArgs,
  McpImageContent,
  McpSuccess,
  McpTextContent,
  McpToolResultContentItem,
} from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import {
  McpToolCall,
  McpToolError,
  McpToolResult,
} from "../../../packages/proto/generated/agent/v1/mcp_tool_pb.js";
import {
  createMcpToolCall,
  renderMcpToolResult,
} from "../../../packages/agent/tools/mcp/mcp-result-boundary.js";
import { createZodAgentTool } from "../../../packages/agent/tools/common.js";
import {
  createSandBrowserTools,
  type BrowserDriverDependencies,
  type BrowserDriverOutput,
} from "./sand-browser-tools.js";

export const SAND_BROWSER_MCP_SERVER_IDENTIFIER = "browser";

/**
 * Model-facing argument schemas, one per tool. Required fields mirror each
 * spec's `required` list (the driver re-validates them); the typed optionals
 * are the request fields the driver actually reads for that op. Every schema
 * is passthrough so a field the driver grows later still reaches it.
 */
const BROWSER_TOOL_PARAMETERS: Readonly<Record<string, ZodTypeAny>> = {
  browser_navigate: z.object({
    url: z.string().describe("The URL to open."),
    newTab: z.boolean().optional().describe("Open in a new tab instead of reusing the current one."),
  }).passthrough(),
  browser_snapshot: z.object({
    selector: z.string().optional().describe("Restrict the snapshot to a CSS selector."),
    maxDepth: z.number().optional(),
    interactive: z.boolean().optional().describe("Only include interactive elements."),
  }).passthrough(),
  browser_click: z.object({
    ref: z.string().describe("Element ref from browser_snapshot, e.g. e12."),
    element: z.string().optional().describe("Concise description of the intended target and purpose (used by the safety review; required when review is enforced)."),
    doubleClick: z.boolean().optional(),
    button: z.string().optional().describe("left (default), right, or middle."),
    modifiers: z.array(z.string()).optional(),
    confirmed: z.boolean().optional().describe("Only valid on a RETRY after this exact action was blocked as sensitive (payment/money or login/signup submission). Send the first attempt WITHOUT it; after a block, report it and get the user's explicit approval in chat, then retry with confirmed: true. Setting it on a first attempt is ignored and still blocks."),
  }).passthrough(),
  browser_mouse_click_xy: z.object({
    x: z.number().describe("Viewport x coordinate."),
    element: z.string().optional().describe("Concise description of the intended target and purpose (used by the safety review; required when review is enforced)."),
    y: z.number().describe("Viewport y coordinate."),
    doubleClick: z.boolean().optional(),
    button: z.string().optional(),
    confirmed: z.boolean().optional().describe("Only valid on a RETRY after this exact action was blocked as sensitive (payment/money or login/signup submission). Send the first attempt WITHOUT it; after a block, report it and get the user's explicit approval in chat, then retry with confirmed: true. Setting it on a first attempt is ignored and still blocks."),
  }).passthrough(),
  browser_type: z.object({
    ref: z.string(),
    text: z.string(),
    slowly: z.boolean().optional().describe("Type character by character."),
    submit: z.boolean().optional().describe("Press Enter after typing."),
    confirmed: z.boolean().optional().describe("Only valid on a RETRY after a blocked sensitive submit (login/signup form): get the user's explicit approval in chat first. Ignored on a first attempt."),
  }).passthrough(),
  browser_fill: z.object({
    ref: z.string(),
    value: z.string(),
  }).passthrough(),
  browser_select_option: z.object({
    ref: z.string(),
    values: z.array(z.string()).describe("Option values or labels to select."),
  }).passthrough(),
  browser_press_key: z.object({
    key: z.string().describe("Key name, e.g. Enter, Escape, Tab, ArrowDown, or a character."),
    holdDurationMs: z.number().optional(),
    modifiers: z.array(z.string()).optional(),
    confirmed: z.boolean().optional().describe("Only valid on a RETRY after a blocked sensitive Enter-submit (login/signup form): get the user's explicit approval in chat first. Ignored on a first attempt."),
  }).passthrough(),
  browser_scroll: z.object({
    ref: z.string().optional().describe("Scroll this element into view instead of the page."),
    direction: z.string().optional().describe("up, down, left, or right."),
    amount: z.number().optional().describe("Scroll distance in pixels."),
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
  }).passthrough(),
  browser_drag: z.object({
    sourceRef: z.string(),
    element: z.string().optional().describe("Concise description of the intended target and purpose (used by the safety review; required when review is enforced)."),
    targetRef: z.string().optional(),
    targetX: z.number().optional(),
    targetY: z.number().optional(),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
  }).passthrough(),
  browser_get_bounding_box: z.object({
    ref: z.string(),
  }).passthrough(),
  browser_highlight: z.object({
    ref: z.string(),
  }).passthrough(),
  browser_cdp: z.object({
    method: z.string().describe("One of the allowlisted read-only CDP methods."),
    params: z.record(z.unknown()).optional(),
  }).passthrough(),
  browser_tabs: z.object({
    action: z.enum(["list", "new", "close", "select"]),
    index: z.number().optional().describe("Tab index for close/select."),
    url: z.string().optional().describe("URL for a new tab."),
  }).passthrough(),
  browser_take_screenshot: z.object({
    fullPage: z.boolean().optional(),
  }).passthrough(),
};

interface BrowserInteractionHandlerLike {
  executeToolCall(
    ctx: Context,
    toolCall: ReturnType<typeof createMcpToolCall>,
    callId: string,
    promiseFn: (ctx: Context) => Promise<McpToolResult>,
    resultMergeFn: (result: McpToolResult) => ReturnType<typeof createMcpToolCall>,
  ): Promise<McpToolResult>;
}

function isBrowserInteractionHandler(value: unknown): value is BrowserInteractionHandlerLike {
  return typeof value === "object" && value !== null
    && typeof (value as { executeToolCall?: unknown }).executeToolCall === "function";
}

interface BrowserToolMeta {
  readonly toolCallId: string;
  readonly stateHandler?: unknown;
  readonly workspacePaths?: readonly string[];
}

function buildBrowserMcpArgs(
  toolName: string,
  args: Record<string, unknown>,
  toolCallId: string,
): McpArgs {
  const values: Record<string, Value> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    try {
      values[key] = Value.fromJson(value as JsonValue);
    } catch {
      values[key] = Value.fromJson(String(value));
    }
  }
  return new McpArgs({
    name: `${SAND_BROWSER_MCP_SERVER_IDENTIFIER}-${toolName}`,
    args: values,
    toolCallId,
    providerIdentifier: SAND_BROWSER_MCP_SERVER_IDENTIFIER,
    toolName,
    serverIdentifier: SAND_BROWSER_MCP_SERVER_IDENTIFIER,
  });
}

function browserOutputToMcpResult(output: BrowserDriverOutput): McpToolResult {
  const content: McpToolResultContentItem[] = [];
  if (output.text.length > 0) {
    content.push(new McpToolResultContentItem({
      content: { case: "text", value: new McpTextContent({ text: output.text }) },
    }));
  }
  if (output.imageB64 != null && output.imageB64.length > 0) {
    content.push(new McpToolResultContentItem({
      content: {
        case: "image",
        value: new McpImageContent({
          data: Buffer.from(output.imageB64, "base64"),
          mimeType: "image/png",
        }),
      },
    }));
  }
  return new McpToolResult({
    result: {
      case: "success",
      value: new McpSuccess({ content, isError: output.isError === true }),
    },
  });
}

function serializeBrowserToolError(error: unknown): ReturnType<typeof createMcpToolCall> {
  return createMcpToolCall(new McpToolCall({
    result: new McpToolResult({
      result: {
        case: "error",
        value: new McpToolError({
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    }),
  }));
}

async function readJsonObjectArgs(argsStream: AsyncIterable<string>): Promise<Record<string, unknown>> {
  let serialized = "";
  for await (const chunk of argsStream) serialized += chunk;
  if (serialized.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Tool call arguments were not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Tool call arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Builds the framework-conformant browser turn tools: each raw definition is
 * wrapped with its model parameters schema, streaming argument collection, the
 * MCP transcript envelope, and MCP-style rendering (text plus the screenshot
 * the driver returns). The raw definition keeps ownership of argument
 * validation, auto-review preflight, and driver execution.
 *
 * The wrapping goes through createZodAgentTool so `parameters` reaches the
 * model as a plain JSON schema in the ai-SDK jsonSchema wrapper — the same
 * projection live MCP tools use. A raw zod object must never be handed to the
 * provider: pi-ai sends `tool.parameters` verbatim, and a serialized ZodObject
 * is zod internals, not a JSON schema.
 */
export function createSandBrowserTurnTools<Context_ extends Context = Context>(
  dependencies: BrowserDriverDependencies<Context_>,
): Record<string, unknown>[] {
  return createSandBrowserTools(dependencies).map((definition) => {
    const parameters = BROWSER_TOOL_PARAMETERS[definition.name]
      ?? z.object({}).passthrough();
    return createZodAgentTool(definition.id, {
      name: definition.name,
      descriptionGenerator: () => definition.description,
      parameters,
      render: (_ctx: unknown, output: unknown) => renderMcpToolResult(output as McpToolResult),
      execute: async (
        ctx: Context_,
        interactionHandler: unknown,
        argsStream: AsyncIterable<string>,
        meta: BrowserToolMeta,
      ): Promise<McpToolResult> => {
        if (!isBrowserInteractionHandler(interactionHandler)) {
          throw new Error("browser tool execution requires an interaction handler");
        }
        const rawArgs = await readJsonObjectArgs(argsStream);
        const args = buildBrowserMcpArgs(definition.name, rawArgs, meta.toolCallId);
        const baseToolCall = createMcpToolCall(new McpToolCall({ args }));
        return interactionHandler.executeToolCall(
          ctx,
          baseToolCall,
          meta.toolCallId,
          async (runCtx) => {
            const output = await definition.execute(runCtx as Context_, rawArgs, {
              toolCallId: meta.toolCallId,
              ...(meta.stateHandler === undefined ? {} : { stateHandler: meta.stateHandler }),
              ...(meta.workspacePaths === undefined ? {} : { workspacePaths: meta.workspacePaths }),
            });
            return browserOutputToMcpResult(output);
          },
          (result) => createMcpToolCall(new McpToolCall({ args, result })),
        );
      },
      serializeError: serializeBrowserToolError,
    });
  });
}
