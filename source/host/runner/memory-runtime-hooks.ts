/** Host adapters keep the canonical kernel out of the runner/tool contracts. */
export interface PreparedMemoryTurn {
  readonly conversationId: string;
  readonly requestId: string;
  readonly query: string;
  readonly isSubagent?: boolean;
  readonly isAutomation?: boolean;
}

export interface MemoryContextRequest {
  readonly conversationId?: string;
  readonly requestId?: string;
}

export interface MemoryRuntimeStore {
  isCanonicalMemory?(): boolean;
  prepareMemoryTurn?(input: PreparedMemoryTurn): Promise<void>;
  getMemoryContext?(input?: MemoryContextRequest): string;
  memoryContextKey?(): string;
}

export interface MemoryToolAction {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
}

export interface MemoryToolResult extends MemoryToolAction {
  readonly result?: unknown;
  readonly error?: unknown;
}

export interface MemoryToolHooks {
  beforeToolAction(input: MemoryToolAction): Promise<Record<string, unknown>>;
  afterToolAction(input: MemoryToolResult): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function* replayArguments(raw: string): AsyncIterable<string> {
  yield raw;
}

/**
 * Runs before the concrete tool's schema parser and approval preflight. The
 * memory adapter alone owns the whitelist/schema mapping; opaque/custom tool
 * formats and malformed JSON are left to their existing parser.
 */
export function withMemoryToolAction<T extends {
  readonly name: string;
  execute(...args: readonly unknown[]): Promise<unknown>;
}>(tool: T, hooks: MemoryToolHooks | undefined): T {
  if (hooks == null) return tool;
  return {
    ...tool,
    async execute(...args: readonly unknown[]): Promise<unknown> {
      const [context, interactionHandler, stream, metadata] = args;
      if (
        stream == null
        || typeof stream !== "object"
        || !(Symbol.asyncIterator in stream)
        || !record(metadata)
        || typeof metadata.toolCallId !== "string"
      ) return tool.execute(...args);

      let raw = "";
      for await (const chunk of stream as AsyncIterable<string>) raw += chunk;
      let proposed: unknown;
      try { proposed = JSON.parse(raw); } catch {}
      if (!record(proposed)) {
        return tool.execute(context, interactionHandler, replayArguments(raw), metadata);
      }
      let finalArguments = proposed;
      let finalRaw = raw;
      try {
        const grounded = await hooks.beforeToolAction({
          toolCallId: metadata.toolCallId,
          toolName: tool.name,
          arguments: JSON.parse(raw) as Record<string, unknown>,
        });
        if (record(grounded)) {
          finalRaw = JSON.stringify(grounded);
          finalArguments = grounded;
        }
      } catch {
        // An unavailable memory adapter cannot change or block proposed args.
      }
      const observation = {
        toolName: tool.name,
        toolCallId: metadata.toolCallId,
        arguments: finalArguments,
      };
      try {
        const result = await tool.execute(
          context,
          interactionHandler,
          replayArguments(finalRaw),
          metadata,
        );
        try { hooks.afterToolAction({ ...observation, result }); } catch {}
        return result;
      } catch (error) {
        try { hooks.afterToolAction({ ...observation, error }); } catch {}
        throw error;
      }
    },
  };
}
