import { readFileSync } from "node:fs";
import { join } from "node:path";

import { query as queryClaude, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema, streamText, tool, type CoreMessage, type LanguageModelV1, type ToolSet } from "ai";

import type { SandInferenceProvider } from "../../../shared/inference-router.js";
import { resolveClaudeCodeCliPath } from "../../../shared/node/inference-router-local.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { getSandRootDir } from "../../host-paths.js";
import { getBoxSecretsStorePath } from "../secrets/secrets-service.js";
import {
  belmontTextFromResponse,
  createRoutedProviderSessionState,
  parseRoutedProviderSessionState,
} from "./pi-codex-projection.js";
import type { LabelMessage, PromptExecutor } from "./sand-labeling.js";
import type { PiCodexExecutorOptions } from "./pi-codex-runtime.js";

type Loose = Record<string, any>;
interface ProviderMessage extends LabelMessage { role: string; content: string | readonly unknown[] }
type RoutedProvider = Exclude<SandInferenceProvider, "cursor">;
type UsageRecord = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
type RoutedToolExecutor = (tool: Loose, args: unknown, toolCallId: string) => Promise<unknown>;
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
type ProviderExecutorContext = { readonly signal?: AbortSignal; readonly modelId?: string; readonly reasoning?: CodexReasoningEffort; readonly systemPrompt?: string };
type PiRuntimeModule = typeof import("./pi-codex-runtime.js");

const GROK_ROUTER_SYSTEM_PROMPT = [
  "You are Grok Bot, a warm, concise desktop assistant.",
  "You are running inside Grok Bot, not inside Codex CLI or Claude Code.",
  "The tools supplied with this request are Grok Bot's already-connected plugins and accounts. Use them whenever they are relevant instead of claiming that a plugin is unavailable or asking the user to reconnect it.",
  "Never ask for an API key for an already-connected plugin. Respond directly to the user in natural language after completing any necessary tool calls.",
].join("\n");

function loadPiCodexRuntime(): Promise<PiRuntimeModule> {
  // Literal specifier (not a variable) so esbuild statically bundles pi-codex-runtime into the
  // packaged host bundle. A variable dynamic import is left external and fails at runtime with
  // module-not-found on the first packaged Codex call. (PI-P0-01)
  return import("./pi-codex-runtime.js") as Promise<PiRuntimeModule>;
}

function recordRoutedUsage(provider: RoutedProvider, usage: UsageRecord): void {
  new SandSettingsStore(join(getSandRootDir(), "settings.json")).recordInferenceUsage(provider, usage);
}

function persistedSecrets(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return {};
    const secrets = (parsed as { secrets?: unknown }).secrets;
    if (typeof secrets !== "object" || secrets == null || Array.isArray(secrets)) return {};
    return Object.fromEntries(Object.entries(secrets).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function openRouterCredential(): string {
  const value = process.env.OPENROUTER_API_KEY?.trim() || persistedSecrets().OPENROUTER_API_KEY?.trim();
  if (value == null || value.length === 0) throw new Error("OpenRouter needs OPENROUTER_API_KEY. Add it in Settings → Router.");
  return value;
}

function providerPrompt(messages: readonly ProviderMessage[], systemPrompt?: string): string {
  const rendered = messages.map(message => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    return `${message.role.toUpperCase()}: ${content}`;
  }).join("\n\n");
  if (systemPrompt != null) return `${systemPrompt}\n\n${rendered}`;
  return `${GROK_ROUTER_SYSTEM_PROMPT}\n\nContinue this Grok Bot conversation.\n\n${rendered}`;
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

type DelegatedToolCall = { readonly toolCallId: string; readonly toolName: string; readonly args: unknown };

function response(text: string, id: string, modelId: string, toolCalls: readonly DelegatedToolCall[] = []) {
  const content: Loose[] = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const call of toolCalls) content.push({ type: "tool-call", ...call });
  return { id, modelId, timestamp: new Date(), headers: {}, messages: [{ role: "assistant", content }] };
}

function configuredCodexModel(): string {
  return process.env.SAND_CODEX_MODEL?.trim() || "gpt-5.5";
}

// The original default model id "gpt-5.5-high-fast" folded reasoning into the model name. Routing
// through Pi splits reasoning into its own axis, so the "high" half is restored here as the default
// effort (env-overridable) rather than silently falling back to the model's own default. (PI-P1-02)
function configuredCodexReasoningEffort(): "minimal" | "low" | "medium" | "high" | "xhigh" {
  const selected = process.env.SAND_CODEX_REASONING_EFFORT?.trim();
  return selected === "minimal" || selected === "low" || selected === "medium" || selected === "high" || selected === "xhigh" ? selected : "high";
}

function signalFromContext(context: unknown): AbortSignal | undefined {
  if (typeof context !== "object" || context == null) return undefined;
  const signal = (context as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

function modelFromContext(context: unknown): string | undefined {
  if (typeof context !== "object" || context == null) return undefined;
  const modelId = (context as { modelId?: unknown }).modelId;
  return typeof modelId === "string" && modelId.trim().length > 0 ? modelId.trim() : undefined;
}

function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function reasoningFromContext(context: unknown): CodexReasoningEffort | undefined {
  if (typeof context !== "object" || context == null) return undefined;
  const reasoning = (context as { reasoning?: unknown }).reasoning;
  return isCodexReasoningEffort(reasoning) ? reasoning : undefined;
}

function providerContext(signal: AbortSignal | undefined, modelId: string | undefined, reasoning?: CodexReasoningEffort, systemPrompt?: string): ProviderExecutorContext {
  return {
    ...(signal == null ? {} : { signal }),
    ...(modelId == null ? {} : { modelId }),
    ...(reasoning == null ? {} : { reasoning }),
    ...(systemPrompt == null ? {} : { systemPrompt }),
  };
}

function lazyPiCodexExecutor(options: PiCodexExecutorOptions) {
  const executor = loadPiCodexRuntime().then(module => module.createPiCodexExecutor(options));
  const fullStream = (async function* () {
    const loaded = await executor;
    for await (const event of loaded.fullStream) {
      // Belmont's StreamChunk carries reasoning as { type: "reasoning", textDelta }; the Pi runtime
      // emits { type: "reasoning-delta", reasoningDelta }. Translate so reasoning reaches the agent
      // stream (and afterAgentThought) instead of being dropped as an unknown event. (PI-P0-04)
      if (event.type === "reasoning-delta") {
        yield { type: "reasoning" as const, textDelta: event.reasoningDelta };
      } else {
        yield event;
      }
    }
  })();
  return {
    fullStream,
    response: executor.then(value => value.response),
    usage: executor.then(value => value.usage),
    extendedUsage: executor.then(value => value.extendedUsage),
    providerMetadata: executor.then(value => value.providerMetadata),
    invocationId: Promise.resolve(options.invocationId),
  };
}

function codexExecutor(
  messages: readonly ProviderMessage[],
  invocationId: string,
  definitions?: readonly Loose[],
  onUsage?: (usage: UsageRecord) => void,
  context?: ProviderExecutorContext,
  cacheSessionId?: string,
) {
  // Per-turn reasoning (resolved from the agent's model selection — e.g. a computer-use subagent's
  // effort=low) overrides the global default; the env fallback keeps the "high" the original name carried.
  const reasoning = context?.reasoning ?? configuredCodexReasoningEffort();
  return lazyPiCodexExecutor({
    messages,
    invocationId,
    ...(cacheSessionId == null ? {} : { cacheSessionId }),
    ...(definitions == null ? {} : { definitions }),
    modelId: context?.modelId ?? configuredCodexModel(),
    ...(reasoning == null ? {} : { reasoning }),
    ...(context?.signal == null ? {} : { signal: context.signal }),
    ...(onUsage == null ? {} : { onUsage }),
    ...(context?.systemPrompt == null ? {} : { systemPrompt: context.systemPrompt }),
  });
}

function claudeExecutor(messages: readonly ProviderMessage[], invocationId: string, onUsage?: (usage: UsageRecord) => void, mcpServerUrl?: string, systemPrompt?: string) {
  const executable = resolveClaudeCodeCliPath();
  if (executable == null) throw new Error("Claude Code is not installed. Install and sign in to Claude Code, then reopen Grok Bot.");
  const usage = deferred<{ promptTokens: number; completionTokens: number; totalTokens: number }>();
  const extendedUsage = deferred<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; maxTokens: number }>();
  const resultResponse = deferred<ReturnType<typeof response>>();
  const metadata = deferred<Record<string, unknown>>();
  const fullStream = (async function* () {
    try {
      let final: SDKResultMessage | undefined;
      const selectedModel = process.env.SAND_CLAUDE_MODEL?.trim();
      for await (const message of queryClaude({
        prompt: providerPrompt(messages, systemPrompt),
        options: {
          pathToClaudeCodeExecutable: executable,
          cwd: getSandRootDir(),
          tools: mcpServerUrl == null ? [] : ["mcp__grok_bot_plugins__*"],
          ...(mcpServerUrl == null ? {} : {
            mcpServers: { grok_bot_plugins: { type: "http" as const, url: mcpServerUrl } },
            strictMcpConfig: true,
          }),
          permissionMode: "default",
          maxTurns: mcpServerUrl == null ? 1 : 8,
          persistSession: false,
          ...(selectedModel == null || selectedModel.length === 0 ? {} : { model: selectedModel }),
        },
      })) {
        if (message.type === "result") final = message;
      }
      if (final == null) throw new Error("Claude Code ended without a result.");
      if (final.subtype !== "success") throw new Error(final.errors.join("\n") || `Claude Code failed (${final.subtype}).`);
      const text = final.result;
      if (text.length > 0) yield { type: "text-delta" as const, textDelta: text };
      const input = final.usage.input_tokens;
      const output = final.usage.output_tokens;
      const cacheRead = final.usage.cache_read_input_tokens ?? 0;
      const cacheWrite = final.usage.cache_creation_input_tokens ?? 0;
      onUsage?.({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite });
      usage.resolve({ promptTokens: input, completionTokens: output, totalTokens: input + output });
      extendedUsage.resolve({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, maxTokens: 0 });
      metadata.resolve({ anthropic: { sessionId: final.session_id, totalCostUsd: final.total_cost_usd } });
      resultResponse.resolve(response(text, invocationId, "claude-code"));
    } catch (error) {
      usage.reject(error);
      extendedUsage.reject(error);
      metadata.reject(error);
      resultResponse.reject(error);
      throw error;
    }
  })();
  return {
    fullStream,
    response: resultResponse.promise,
    usage: usage.promise,
    extendedUsage: extendedUsage.promise,
    providerMetadata: metadata.promise,
    invocationId: Promise.resolve(invocationId),
  };
}

function toToolSet(definitions: readonly Loose[] | undefined, executeTool?: RoutedToolExecutor): ToolSet | undefined {
  if (definitions == null || definitions.length === 0) return undefined;
  const tools: ToolSet = {};
  for (const definition of definitions) {
    if (typeof definition.name !== "string" || definition.name.length === 0) continue;
    const parameters = definition.inputSchema ?? definition.parameters;
    if (parameters == null) continue;
    const routedTool: any = {
      ...(typeof definition.description === "string" ? { description: definition.description } : {}),
      parameters: jsonSchema(parameters),
    };
    if (executeTool != null) {
      routedTool.execute = async (args: unknown, options: { toolCallId: string }) => await executeTool(definition, args, options.toolCallId);
    }
    tools[definition.name] = tool(routedTool);
  }
  return Object.keys(tools).length === 0 ? undefined : tools;
}

function openRouterExecutor(
  messages: readonly ProviderMessage[],
  invocationId: string,
  definitions?: readonly Loose[],
  executeTool?: RoutedToolExecutor,
  onUsage?: (usage: UsageRecord) => void,
  systemPrompt?: string,
) {
  const id = process.env.SAND_OPENROUTER_MODEL?.trim() || "openai/gpt-5.2";
  const model: LanguageModelV1 = createOpenAI({
    apiKey: openRouterCredential(),
    baseURL: "https://openrouter.ai/api/v1",
    compatibility: "compatible",
    name: "openrouter",
    headers: { "HTTP-Referer": "https://github.com/grok-bot-reconstructed", "X-Title": "Grok Bot Reconstructed" },
  }).chat(id as any);
  const tools = toToolSet(definitions, executeTool);
  const result = streamText({
    model,
    system: systemPrompt ?? GROK_ROUTER_SYSTEM_PROMPT,
    messages: messages as CoreMessage[],
    ...(tools === undefined ? {} : { tools }),
    toolCallStreaming: true,
    maxSteps: tools === undefined ? 1 : 8,
  });
  const extendedUsage = result.usage.then(value => ({
    inputTokens: value.promptTokens,
    outputTokens: value.completionTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    maxTokens: 0,
  }));
  if (onUsage != null) void extendedUsage.then(onUsage);
  return {
    fullStream: result.fullStream,
    response: result.response,
    usage: result.usage,
    extendedUsage,
    providerMetadata: result.providerMetadata,
    invocationId: Promise.resolve(invocationId),
  };
}

class ProviderPromptExecutor implements PromptExecutor {
  readonly #messages: ProviderMessage[];
  // Stable prompt-cache affinity key (strict-review P1-02): the Pi runtime maps
  // sessionId to provider prompt-cache affinity, and passing the per-call
  // invocation UUID gave every model call a fresh identity — repeated turns and
  // tool round-trips could never deliberately share a cached prefix. One key per
  // executor (whose #messages ARE the conversation) restores that affinity.
  readonly #cacheSessionId: string = crypto.randomUUID();

  constructor(
    readonly provider: RoutedProvider,
    initialMessages: readonly ProviderMessage[] | undefined,
    readonly onUsage: ((usage: UsageRecord) => void) | undefined,
    readonly modelId: string | undefined,
    readonly reasoning?: CodexReasoningEffort,
  ) {
    this.#messages = initialMessages == null ? [] : [...initialMessages];
  }

  appendMessages(messages: LabelMessage | readonly LabelMessage[]): this {
    const incoming = Array.isArray(messages) ? messages : [messages];
    this.#messages.push(...incoming as ProviderMessage[]);
    return this;
  }

  getState(): unknown {
    // The ProviderPromptExecutor state contract is the messages ARRAY: checkpoint/compact and the
    // send-message/ack reminder middlewares consume getState() with .map()/.length, and the restore
    // path feeds it back as `initialMessages` (also an array). The model id is threaded per run via
    // the turn context (modelFromContext), never the state blob, so it must not change this shape. (PI-P0-03)
    return [...this.#messages];
  }

  getMessages(): ProviderMessage[] {
    return [...this.#messages];
  }

  clearMessages(): void {
    this.#messages.length = 0;
  }

  stream(ctx: unknown, invocationId = crypto.randomUUID(), definitions?: readonly Loose[]) {
    if (this.provider === "codex") {
      return codexExecutor(
        this.getMessages(),
        invocationId,
        definitions,
        this.onUsage,
        providerContext(signalFromContext(ctx), modelFromContext(ctx) ?? this.modelId, reasoningFromContext(ctx) ?? this.reasoning),
        this.#cacheSessionId,
      );
    }
    if (this.provider === "claude-code") return claudeExecutor(this.getMessages(), invocationId, this.onUsage);
    return openRouterExecutor(this.getMessages(), invocationId, definitions, undefined, this.onUsage);
  }
}

export function createProviderPromptSession(
  provider: RoutedProvider,
  requestedModelId?: string,
  requestedReasoning?: CodexReasoningEffort,
): { getModelId(): string; getExecutor(state?: unknown): PromptExecutor } {
  const requested = requestedModelId?.trim();
  const modelId = provider === "codex"
    ? requested || configuredCodexModel()
    : provider === "claude-code"
      ? "claude-code"
      : process.env.SAND_OPENROUTER_MODEL?.trim() || "openai/gpt-5.2";
  return {
    getModelId: () => modelId,
    getExecutor: state => {
      const parsed = parseRoutedProviderSessionState<ProviderMessage>(state);
      return new ProviderPromptExecutor(
        provider,
        parsed.messages,
        usage => recordRoutedUsage(provider, usage),
        parsed.modelId ?? modelId,
        requestedReasoning,
      );
    },
  };
}

export async function runRoutedProviderText(provider: RoutedProvider, messages: readonly ProviderMessage[], options?: {
  readonly mcpServerUrl?: string;
  readonly tools?: readonly Loose[];
  readonly executeTool?: RoutedToolExecutor;
  readonly onTextDelta?: (delta: string, accumulated: string) => void;
  readonly signal?: AbortSignal;
  readonly modelId?: string;
  /** Codex/Pi only: per-request reasoning effort (e.g. "low" for a latency-bound classifier). */
  readonly reasoning?: CodexReasoningEffort;
  /** Replaces the Grok Bot assistant persona for single-purpose requests. */
  readonly systemPrompt?: string;
}): Promise<string> {
  const invocationId = crypto.randomUUID();
  const onUsage = (usage: UsageRecord) => recordRoutedUsage(provider, usage);
  const result = provider === "codex"
    ? codexExecutor(messages, invocationId, options?.tools, onUsage, providerContext(options?.signal, options?.modelId, options?.reasoning, options?.systemPrompt))
    : provider === "claude-code"
      ? claudeExecutor(messages, invocationId, onUsage, options?.mcpServerUrl, options?.systemPrompt)
      : openRouterExecutor(messages, invocationId, options?.tools, options?.executeTool, onUsage, options?.systemPrompt);
  let text = "";
  for await (const event of result.fullStream) {
    if (event.type === "text-delta" && typeof event.textDelta === "string") {
      text += event.textDelta;
      options?.onTextDelta?.(event.textDelta, text);
    }
  }
  const settled = await result.response;
  if (provider === "codex") {
    const authoritative = belmontTextFromResponse(settled);
    if (authoritative != null && authoritative !== text) {
      text = authoritative;
      options?.onTextDelta?.("", text);
    }
  }
  return text;
}
