import {
  buildToolCallExecutionTimedOutMessage,
  toolCallExecutionGuardMs,
} from "../../../packages/agent/tools/tool-execution-timeout.js";
import {
  toolExecutionTimeoutSuspensionKey,
  type ToolExecutionTimeoutSuspension,
} from "../../../packages/agent/tools/tool-timeout-suspension.js";

export function sandToolCallExecutionTimeoutMs(
  toolName: string,
  isComputerUseSubagent: boolean,
): number {
  return toolCallExecutionGuardMs(isComputerUseSubagent ? "subagent" : toolName, undefined);
}

export class SandToolCallExecutionTimeoutError extends Error {
  override readonly name = "ToolCallExecutionTimeoutError";
  constructor(
    readonly toolName: string,
    readonly executionTimeoutMs: number,
  ) {
    super(buildToolCallExecutionTimedOutMessage({ toolName, executionTimeoutMs }));
  }
}

export interface DynamicToolRegistry {
  resolveToolName(rawArguments: string): string | undefined;
}

export interface StreamingInvocationTool<Context, Handler, Meta, Result> {
  readonly name: string;
  execute(
    context: Context,
    interactionHandler: Handler,
    argumentsStream: AsyncIterable<string>,
    meta: Meta,
  ): Promise<Result>;
}

async function withTimeout<Result>(
  operation: Promise<Result>,
  milliseconds: number,
  createError: () => Error,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(createError()), milliseconds);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

interface SuspendableContextLike {
  readonly signal: AbortSignal;
  get<T>(key: unknown): T;
  with<T>(key: unknown, value: T): unknown;
  withCancel(): [unknown, (reason?: unknown) => void];
}

function isSuspendableContext(value: unknown): value is SuspendableContextLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.get === "function"
    && typeof candidate.with === "function"
    && typeof candidate.withCancel === "function"
    && typeof candidate.signal === "object";
}

/**
 * Per-call budget that behaves like the shipped tool timeout (packages/agent/tools/common.ts):
 * it pauses while the tool is parked on an Auto-review approval (withToolExecutionTimeoutSuspended)
 * and, when the budget really runs out, cancels the child context so the approval's abort listener
 * retires it. The plain race this replaced killed CallMcpTool after 840s while its approval card was
 * still waiting for the user, and left the approval pending — every later side effect was then
 * refused with "Another action is waiting for Auto-review approval" until the next user message
 * (Gmail cleanup, 2026-09-05 13:26 and 10:55). A context without cancel/suspension support keeps
 * the old race.
 */
export async function runWithSuspendableTimeout<Context, Result>(
  context: Context,
  milliseconds: number,
  createError: () => Error,
  operation: (ctx: Context) => Promise<Result>,
): Promise<Result> {
  if (!isSuspendableContext(context)) return withTimeout(operation(context), milliseconds, createError);
  const parentSuspension = context.get<ToolExecutionTimeoutSuspension | undefined>(toolExecutionTimeoutSuspensionKey);
  const [childCtx, cancel] = context.withCancel();
  const child = childCtx as SuspendableContextLike;
  let finished = false;
  let timedOut = false;
  let remainingMs = milliseconds;
  let armedAtMs: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suspendCount = 0;
  const disarm = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (armedAtMs !== undefined) { remainingMs = Math.max(0, remainingMs - (Date.now() - armedAtMs)); armedAtMs = undefined; }
  };
  const arm = () => {
    if (finished || suspendCount > 0 || timer !== undefined) return;
    armedAtMs = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      armedAtMs = undefined;
      timedOut = true;
      cancel(createError());
    }, remainingMs);
    timer.unref?.();
  };
  const suspension: ToolExecutionTimeoutSuspension = {
    suspend: () => {
      const resumeParent = parentSuspension?.suspend();
      suspendCount += 1;
      disarm();
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        suspendCount -= 1;
        arm();
        resumeParent?.();
      };
    },
  };
  const timeoutCtx = child.with(toolExecutionTimeoutSuspensionKey, suspension) as Context;
  arm();
  try {
    return await Promise.race([
      operation(timeoutCtx),
      new Promise<never>((_resolve, reject) => {
        child.signal.addEventListener("abort", () => {
          if (timedOut) reject(createError());
        }, { once: true });
      }),
    ]);
  } finally {
    finished = true;
    disarm();
  }
}

export function wrapDynamicInvocationToolWithTimeout<
  Context,
  Handler,
  Meta,
  Result,
  Tool extends StreamingInvocationTool<Context, Handler, Meta, Result>,
>(
  tool: Tool,
  dynamicToolRegistry: DynamicToolRegistry,
  isComputerUseSubagent: boolean,
  timeoutMsFor: (effectiveToolName: string) => number = (name) =>
    sandToolCallExecutionTimeoutMs(name, isComputerUseSubagent),
): Tool {
  return {
    ...tool,
    async execute(
      context: Context,
      interactionHandler: Handler,
      argumentsStream: AsyncIterable<string>,
      meta: Meta,
    ): Promise<Result> {
      let rawArguments = "";
      for await (const chunk of argumentsStream) rawArguments += chunk;
      const effectiveToolName = dynamicToolRegistry.resolveToolName(rawArguments) ?? tool.name;
      const executionTimeoutMs = timeoutMsFor(effectiveToolName);
      const replay = (async function* () {
        yield rawArguments;
      })();
      return runWithSuspendableTimeout(
        context,
        executionTimeoutMs,
        () => new SandToolCallExecutionTimeoutError(effectiveToolName, executionTimeoutMs),
        (ctx) => tool.execute(ctx, interactionHandler, replay, meta),
      );
    },
  };
}

export interface McpToolForMeta {
  readonly providerIdentifier: string;
  readonly toolName: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly plugin?: unknown;
  readonly marketplace?: unknown;
  readonly pluginId?: string;
  readonly marketplaceId?: string;
}

export interface McpToolDescriptor {
  readonly toolName: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpDescriptor {
  readonly serverIdentifier: string;
  readonly serverName: string;
  readonly plugin?: unknown;
  readonly marketplace?: unknown;
  readonly pluginDbId?: string;
  readonly marketplaceId?: string;
  readonly tools: McpToolDescriptor[];
}

export function createSandMcpMetaToolOptions(mcpTools: readonly McpToolForMeta[]) {
  const descriptors = new Map<string, Omit<McpDescriptor, "serverIdentifier">>();
  for (const tool of mcpTools) {
    const serverIdentifier = tool.providerIdentifier;
    let descriptor = descriptors.get(serverIdentifier);
    if (descriptor == null) {
      descriptor = {
        serverName: tool.providerIdentifier,
        ...(tool.plugin == null ? {} : { plugin: tool.plugin }),
        ...(tool.marketplace == null ? {} : { marketplace: tool.marketplace }),
        ...(tool.pluginId == null ? {} : { pluginDbId: tool.pluginId }),
        ...(tool.marketplaceId == null ? {} : { marketplaceId: tool.marketplaceId }),
        tools: [],
      };
      descriptors.set(serverIdentifier, descriptor);
    }
    descriptor.tools.push({
      toolName: tool.toolName,
      ...(tool.description == null ? {} : { description: tool.description }),
      ...(tool.inputSchema == null ? {} : { inputSchema: tool.inputSchema }),
    });
  }
  return {
    enabled: true,
    mcpDescriptors: [...descriptors.entries()].map(([serverIdentifier, descriptor]) => ({
      serverIdentifier,
      ...descriptor,
      tools: descriptor.tools.sort((left, right) => left.toolName.localeCompare(right.toolName)),
    })),
  };
}
