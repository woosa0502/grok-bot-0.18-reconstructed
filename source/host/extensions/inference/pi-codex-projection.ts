import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Tool,
  Usage,
} from "@earendil-works/pi-ai";

type Loose = Record<string, unknown>;

export interface PiProviderMessage {
  readonly role: string;
  readonly content: string | readonly unknown[];
}

export type PiToolDefinition = Loose;
export type BelmontAssistantContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly reasoning: string; readonly redacted?: boolean }
  | { readonly type: "tool-call"; readonly toolCallId: string; readonly toolName: string; readonly args: unknown };

export interface RoutedProviderSessionState<TMessage = PiProviderMessage> {
  readonly schemaVersion: 1;
  readonly messages: readonly TMessage[];
  readonly modelId?: string;
}

export type PiCodexProjectedEvent =
  | { readonly type: "text-delta"; readonly textDelta: string }
  | { readonly type: "reasoning-delta"; readonly reasoningDelta: string }
  | { readonly type: "tool-call"; readonly toolCallId: string; readonly toolName: string; readonly args: unknown };

function record(value: unknown): Loose | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Loose : null;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item) ?? "null";
  } catch {
    return "null";
  }
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function bufferLikeBytes(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer);
  }
  const candidate = record(value);
  if (candidate?.type === "Buffer" && Array.isArray(candidate.data)) {
    const bytes = candidate.data.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 255);
    return bytes.length === candidate.data.length ? Uint8Array.from(bytes) : null;
  }
  return null;
}

export function imageData(value: unknown): string | null {
  if (typeof value === "string") {
    const dataUrl = /^data:[^;]+;base64,(.*)$/s.exec(value);
    return dataUrl?.[1] ?? value;
  }
  const bytes = bufferLikeBytes(value);
  return bytes == null ? null : Buffer.from(bytes).toString("base64");
}

function imageMimeType(part: Loose): string {
  if (typeof part.mimeType === "string" && part.mimeType.length > 0) return part.mimeType;
  if (typeof part.mediaType === "string" && part.mediaType.length > 0) return part.mediaType;
  if (typeof part.data === "string") return /^data:([^;]+);base64,/s.exec(part.data)?.[1] ?? "image/png";
  return "image/png";
}

function userContent(parts: readonly unknown[]): Extract<Message, { role: "user" }>["content"] {
  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
  for (const raw of parts) {
    const part = record(raw);
    if (part == null) continue;
    if (part.type === "text" && typeof part.text === "string") {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image") {
      const data = imageData(part.data);
      if (data != null) content.push({ type: "image", data, mimeType: imageMimeType(part) });
    }
  }
  return content;
}

function toolResultContent(value: unknown): Extract<Message, { role: "toolResult" }>["content"] {
  if (Array.isArray(value)) {
    const projected: Extract<Message, { role: "toolResult" }>["content"] = [];
    for (const raw of value) {
      const part = record(raw);
      if (part?.type === "text" && typeof part.text === "string") projected.push({ type: "text", text: part.text });
      else if (part?.type === "image") {
        const data = imageData(part.data);
        if (data != null) projected.push({ type: "image", data, mimeType: imageMimeType(part) });
      }
    }
    if (projected.length > 0) return projected;
  }
  return [{ type: "text", text: typeof value === "string" ? value : safeJson(value ?? "") }];
}

function historyAssistant(content: Extract<Message, { role: "assistant" }>["content"], timestamp: number): Extract<Message, { role: "assistant" }> {
  return {
    role: "assistant",
    content,
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "history",
    usage: emptyUsage(),
    stopReason: content.some(part => part.type === "toolCall") ? "toolUse" : "stop",
    timestamp,
  };
}

export function messagesToPi(messages: readonly PiProviderMessage[], now: () => number = Date.now): Message[] {
  const converted: Message[] = [];
  for (const message of messages) {
    const timestamp = now();
    if (message.role === "user") {
      converted.push({
        role: "user",
        content: typeof message.content === "string" ? message.content : userContent(message.content),
        timestamp,
      });
      continue;
    }

    const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    let assistantContent: Extract<Message, { role: "assistant" }>["content"] = [];
    const flushAssistant = (): void => {
      if (assistantContent.length === 0) return;
      converted.push(historyAssistant(assistantContent, timestamp));
      assistantContent = [];
    };

    for (const raw of parts) {
      const part = record(raw);
      if (part == null) continue;
      if (part.type === "text" && typeof part.text === "string") {
        assistantContent.push({ type: "text", text: part.text });
      } else if ((part.type === "reasoning" || part.type === "thinking") && typeof (part.reasoning ?? part.thinking) === "string") {
        assistantContent.push({
          type: "thinking",
          thinking: String(part.reasoning ?? part.thinking),
          ...(typeof part.thinkingSignature === "string" ? { thinkingSignature: part.thinkingSignature } : {}),
          ...(part.redacted === true ? { redacted: true } : {}),
        });
      } else if ((part.type === "tool-call" || part.type === "toolCall") && typeof (part.toolCallId ?? part.id) === "string" && typeof (part.toolName ?? part.name) === "string") {
        assistantContent.push({
          type: "toolCall",
          id: String(part.toolCallId ?? part.id),
          name: String(part.toolName ?? part.name),
          arguments: record(part.args ?? part.arguments) ?? {},
        });
      } else if ((part.type === "tool-result" || part.type === "toolResult") && typeof (part.toolCallId ?? part.id) === "string") {
        flushAssistant();
        converted.push({
          role: "toolResult",
          toolCallId: String(part.toolCallId ?? part.id),
          toolName: typeof (part.toolName ?? part.name) === "string" ? String(part.toolName ?? part.name) : "tool",
          content: toolResultContent(part.result ?? part.content),
          isError: part.isError === true,
          timestamp,
        });
      }
    }
    flushAssistant();
  }
  return converted;
}

export function toolsToPi(definitions: readonly PiToolDefinition[] | undefined): Tool[] | undefined {
  if (definitions == null) return undefined;
  const tools = definitions.flatMap((definition): Tool[] => {
    const name = typeof definition.name === "string" ? definition.name : "";
    if (name.length === 0) return [];
    const wrapped = definition.inputSchema ?? definition.parameters;
    const parameters = record(wrapped)?.jsonSchema ?? wrapped;
    if (parameters == null || typeof parameters !== "object") return [];
    return [{
      name,
      description: typeof definition.description === "string" ? definition.description : "",
      parameters: parameters as Tool["parameters"],
    }];
  });
  return tools.length > 0 ? tools : undefined;
}

export function createPiContext(messages: readonly PiProviderMessage[], definitions: readonly PiToolDefinition[] | undefined, systemPrompt: string): Context {
  const tools = toolsToPi(definitions);
  return {
    systemPrompt,
    messages: messagesToPi(messages),
    ...(tools == null ? {} : { tools }),
  };
}

export function belmontContentFromPi(content: AssistantMessage["content"]): BelmontAssistantContent[] {
  return content.map(part => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    if (part.type === "thinking") {
      return {
        type: "reasoning" as const,
        reasoning: part.thinking,
        ...(part.redacted === true ? { redacted: true } : {}),
      };
    }
    return {
      type: "tool-call" as const,
      toolCallId: part.id,
      toolName: part.name,
      args: cloneValue(part.arguments),
    };
  });
}

export function belmontTextFromResponse(value: unknown): string | null {
  const root = record(value);
  if (root == null || !Array.isArray(root.messages)) return null;
  const assistant = [...root.messages]
    .reverse()
    .map(record)
    .find(message => message?.role === "assistant");
  if (assistant == null) return null;
  if (typeof assistant.content === "string") return assistant.content;
  if (!Array.isArray(assistant.content)) return null;
  return assistant.content.flatMap(raw => {
    const part = record(raw);
    return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
  }).join("");
}

function sameContent(left: AssistantMessage["content"], right: AssistantMessage["content"]): boolean {
  return safeJson(left) === safeJson(right);
}

export class PiStreamMaterializer {
  #content: AssistantMessage["content"] = [];
  #terminal: AssistantMessage | undefined;
  #closed = false;

  get isClosed(): boolean {
    return this.#closed;
  }

  content(): AssistantMessage["content"] {
    return cloneValue(this.#content);
  }

  terminalMessage(): AssistantMessage | undefined {
    return this.#terminal == null ? undefined : cloneValue(this.#terminal);
  }

  abort(): void {
    this.#closed = true;
  }

  finalize(message: AssistantMessage): void {
    if (this.#closed) return;
    this.#terminal = cloneValue(message);
    this.#content = cloneValue(message.content);
    this.#closed = true;
  }

  apply(event: AssistantMessageEvent): PiCodexProjectedEvent | undefined {
    if (this.#closed) return undefined;
    if (event.type === "done") {
      this.finalize(event.message);
      return undefined;
    }
    if (event.type === "error") {
      this.finalize(event.error);
      return undefined;
    }

    try {
      this.#applyIncremental(event);
      if (!sameContent(this.#content, event.partial.content)) this.#content = cloneValue(event.partial.content);
    } catch {
      this.#content = cloneValue(event.partial.content);
    }

    if (event.type === "text_delta") return { type: "text-delta", textDelta: event.delta };
    if (event.type === "thinking_delta") return { type: "reasoning-delta", reasoningDelta: event.delta };
    if (event.type === "toolcall_end") {
      return {
        type: "tool-call",
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        args: cloneValue(event.toolCall.arguments),
      };
    }
    return undefined;
  }

  #applyIncremental(event: Exclude<AssistantMessageEvent, { type: "done" | "error" }>): void {
    if (event.type === "start") {
      this.#content = cloneValue(event.partial.content);
      return;
    }
    const index = event.contentIndex;
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`Invalid Pi content index: ${index}`);
    if (event.type === "text_start") {
      this.#content[index] = { type: "text", text: "" };
    } else if (event.type === "text_delta") {
      const current = this.#content[index];
      if (current?.type !== "text") throw new TypeError(`Pi text delta has no text slot at ${index}`);
      current.text += event.delta;
    } else if (event.type === "text_end") {
      this.#content[index] = { type: "text", text: event.content };
    } else if (event.type === "thinking_start") {
      this.#content[index] = { type: "thinking", thinking: "" };
    } else if (event.type === "thinking_delta") {
      const current = this.#content[index];
      if (current?.type !== "thinking") throw new TypeError(`Pi reasoning delta has no thinking slot at ${index}`);
      current.thinking += event.delta;
    } else if (event.type === "thinking_end") {
      this.#content[index] = { type: "thinking", thinking: event.content };
    } else if (event.type === "toolcall_start" || event.type === "toolcall_delta") {
      this.#content = cloneValue(event.partial.content);
    } else if (event.type === "toolcall_end") {
      this.#content[index] = cloneValue(event.toolCall);
    }
  }
}

export function parseRoutedProviderSessionState<TMessage extends PiProviderMessage>(state: unknown): { messages?: readonly TMessage[]; modelId?: string } {
  if (Array.isArray(state)) return { messages: state as TMessage[] };
  const candidate = record(state);
  if (candidate == null) return {};
  return {
    ...(Array.isArray(candidate.messages) ? { messages: candidate.messages as TMessage[] } : {}),
    ...(typeof candidate.modelId === "string" && candidate.modelId.trim().length > 0 ? { modelId: candidate.modelId.trim() } : {}),
  };
}

export function createRoutedProviderSessionState<TMessage extends PiProviderMessage>(messages: readonly TMessage[], modelId: string | undefined): RoutedProviderSessionState<TMessage> {
  return {
    schemaVersion: 1,
    messages: cloneValue(messages),
    ...(modelId == null || modelId.length === 0 ? {} : { modelId }),
  };
}
