import { readFileSync } from "node:fs";
import { join } from "node:path";

import { query as queryClaude, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
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
  imageData,
  parseRoutedProviderSessionState,
} from "./pi-codex-projection.js";
import type { LabelMessage, PromptExecutor } from "./sand-labeling.js";
import type { PiCodexExecutorOptions } from "./pi-codex-runtime.js";

type Loose = Record<string, any>;
interface ProviderMessage extends LabelMessage { role: string; content: string | readonly unknown[] }
type RoutedProvider = Exclude<SandInferenceProvider, "cursor">;
type UsageRecord = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
type RoutedToolExecutor = (tool: Loose, args: unknown, toolCallId: string) => Promise<unknown>;

/** What each routed provider can do on the authoritative host path. Claude Code runs its own agent loop
 * inside the CLI, so the host's per-turn tool definitions (executed by the host runner) cannot be handed
 * to it yet; it answers as a text-only provider and says so instead of silently dropping the tools. */
export function routedProviderCapabilities(provider: RoutedProvider): { readonly hostTools: boolean; readonly incrementalStreaming: boolean } {
  return { hostTools: provider !== "claude-code", incrementalStreaming: true };
}
export const CLAUDE_HOST_TOOLS_UNSUPPORTED = "Claude Code is a text-only provider in Grok Bot for now: the host's tool definitions cannot be handed to its own agent loop, so they were not offered on this turn. Select Codex or OpenRouter for tool-capable turns.";
let claudeHostToolGapReporter: (droppedTools: number) => void = droppedTools => console.warn(`[inference] ${CLAUDE_HOST_TOOLS_UNSUPPORTED} (${droppedTools} tool definition(s) not offered)`);
/** Test seam: observe or silence the once-per-executor capability notice. */
export function setClaudeHostToolGapReporterForTesting(reporter: ((droppedTools: number) => void) | null): void {
  claudeHostToolGapReporter = reporter ?? (droppedTools => console.warn(`[inference] ${CLAUDE_HOST_TOOLS_UNSUPPORTED} (${droppedTools} tool definition(s) not offered)`));
}

/** True when the selected routed provider has the credential/binary it needs to run a turn (Codex readiness is
 * the Pi credential, checked by the inference extension). */
export function isRoutedProviderConfigured(provider: RoutedProvider, modelId?: string): boolean {
  if (provider === "claude-code") return resolveClaudeCodeCliPath() != null;
  if (provider === "openrouter") { try { resolveOpenAiCompatibleTarget(modelId).apiKey(); return true; } catch { return false; } }
  return false;
}
// "max" exists on the gpt-5.6 tier (Codex model catalog: low…xhigh, max); Pi clamps it per model.
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
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

/**
 * OpenAI-compatible hosts reachable through the "openrouter" executor, selected by a model-id
 * prefix so a single bot can run on a different host than the global provider:
 * "nvidia/deepseek-ai/deepseek-v4-flash-0731" → NVIDIA NIM (free tier), model "deepseek-ai/…".
 * A bare model id ("openai/gpt-5.2") keeps going to OpenRouter.
 */
interface OpenAiCompatibleTarget { readonly name: string; readonly baseURL: string; readonly modelId: string; readonly apiKey: () => string; readonly headers?: Record<string, string> }
const OPENAI_COMPATIBLE_HOSTS: Record<string, { baseURL: string; keyName: string; hint: string }> = {
  nvidia: { baseURL: "https://integrate.api.nvidia.com/v1", keyName: "NVIDIA_API_KEY", hint: "build.nvidia.com → Get API Key; put it in the env or the secrets store as NVIDIA_API_KEY." },
};
export function openAiCompatibleHostForModel(modelId: string | undefined): string | undefined {
  const prefix = modelId?.split("/", 1)[0];
  return prefix !== undefined && prefix in OPENAI_COMPATIBLE_HOSTS ? prefix : undefined;
}
function resolveOpenAiCompatibleTarget(requestedModelId: string | undefined): OpenAiCompatibleTarget {
  const host = openAiCompatibleHostForModel(requestedModelId);
  if (host !== undefined && requestedModelId !== undefined) {
    const spec = OPENAI_COMPATIBLE_HOSTS[host]!;
    return {
      name: host, baseURL: spec.baseURL, modelId: requestedModelId.slice(host.length + 1),
      apiKey: () => {
        const value = process.env[spec.keyName]?.trim() || persistedSecrets()[spec.keyName]?.trim();
        if (value == null || value.length === 0) throw new Error(`${host} needs ${spec.keyName}. ${spec.hint}`);
        return value;
      },
    };
  }
  return {
    // SAND_OPENROUTER_BASE_URL points the OpenAI-compatible client at a self-hosted or test endpoint.
    name: "openrouter", baseURL: process.env.SAND_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    modelId: requestedModelId?.trim() || process.env.SAND_OPENROUTER_MODEL?.trim() || "openai/gpt-5.2",
    apiKey: openRouterCredential,
    headers: { "HTTP-Referer": "https://github.com/grok-bot-reconstructed", "X-Title": "Grok Bot Reconstructed" },
  };
}

function providerPrompt(messages: readonly ProviderMessage[], systemPrompt?: string): string {
  const rendered = messages.map(message => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    return `${message.role.toUpperCase()}: ${content}`;
  }).join("\n\n");
  if (systemPrompt != null) return `${systemPrompt}\n\n${rendered}`;
  return `${GROK_ROUTER_SYSTEM_PROMPT}\n\nContinue this Grok Bot conversation.\n\n${rendered}`;
}

type ClaudeContent = Exclude<SDKUserMessage["message"]["content"], string>;

function claudeContentParts(value: unknown): ClaudeContent {
  if (typeof value !== "object" || value == null) return [{ type: "text", text: String(value) }];
  const part = value as Loose;
  if (part.type === "text" && typeof part.text === "string") return part.text.length > 0 ? [{ type: "text", text: part.text }] : [];
  if (part.type === "tool-result") {
    const { result, content, experimental_content, ...identity } = part;
    const body = experimental_content ?? result ?? content;
    return [{ type: "text", text: JSON.stringify(identity) }, ...(Array.isArray(body) ? body.flatMap(claudeContentParts) : claudeContentParts(body))];
  }
  if (part.type === "image" || part.type === "file") {
    const raw = part.type === "image" ? part.image ?? part.data : part.data;
    const value = raw instanceof URL ? raw.href : raw;
    const dataUrl = typeof value === "string" ? /^data:([^;,]+);base64,(.*)$/s.exec(value) : null;
    const mime = String(part.mimeType ?? part.mediaType ?? dataUrl?.[1] ?? (part.type === "image" ? "image/png" : "application/octet-stream")).toLowerCase();
    const url = typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
    const data = url == null ? imageData(value) : undefined;
    if (part.type === "image" || mime.startsWith("image/")) {
      if (url != null) return [{ type: "image", source: { type: "url", url } }];
      if (data != null && data.length > 0 && (mime === "image/jpeg" || mime === "image/png" || mime === "image/gif" || mime === "image/webp")) {
        return [{ type: "image", source: { type: "base64", media_type: mime, data } }];
      }
    } else if (mime === "application/pdf") {
      if (url != null) return [{ type: "document", source: { type: "url", url } }];
      if (data != null && data.length > 0) return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }];
    } else if (mime.startsWith("text/") && data != null && data.length > 0) {
      return [{ type: "document", source: { type: "text", media_type: "text/plain", data: Buffer.from(data, "base64").toString("utf8") } }];
    }
    return [{ type: "text", text: `[Attached ${mime} content could not be supplied to Claude. Do not claim to have read it.]` }];
  }
  if (part.type === "audio" || part.type === "video") {
    return [{ type: "text", text: `[Attached ${part.type} requires media preprocessing and was not understood. Do not claim to have heard or watched it.]` }];
  }
  return [{ type: "text", text: JSON.stringify(part) }];
}

function claudePrompt(messages: readonly ProviderMessage[], systemPrompt?: string): string | AsyncIterable<SDKUserMessage> {
  const containsMedia = (value: unknown): boolean => {
    if (typeof value !== "object" || value == null) return false;
    const part = value as Loose;
    if (["image", "file", "audio", "video"].includes(part.type)) return true;
    if (part.type !== "tool-result") return false;
    const body = part.experimental_content ?? part.result ?? part.content;
    return Array.isArray(body) && body.some(containsMedia);
  };
  if (!messages.some(message => Array.isArray(message.content) && message.content.some(containsMedia))) return providerPrompt(messages, systemPrompt);
  // The SDK streaming-input protocol accepts user envelopes. Preserve the
  // existing transcript role labels in one envelope, with native media blocks
  // in their original position instead of JSON-encoding binary data as text.
  return (async function* () {
    const content: ClaudeContent = [{ type: "text", text: systemPrompt ?? `${GROK_ROUTER_SYSTEM_PROMPT}\n\nContinue this Grok Bot conversation.` }];
    for (const message of messages) {
      content.push({ type: "text", text: `${message.role.toUpperCase()}:` });
      if (typeof message.content === "string") {
        if (message.content.length > 0) content.push({ type: "text", text: message.content });
      } else content.push(...message.content.flatMap(claudeContentParts));
    }
    yield { type: "user", session_id: "", parent_tool_use_id: null, message: { role: "user", content } };
  })();
}

function deferred<T>() {
  const pending = Promise.withResolvers<T>();
  // Stream-only consumers stop at an abort/error without awaiting response and
  // usage. Keep those rejections observable to awaiters without reporting them
  // again as host-level unhandled rejections.
  pending.promise.catch(() => undefined);
  return pending;
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
function configuredCodexReasoningEffort(): CodexReasoningEffort {
  const selected = process.env.SAND_CODEX_REASONING_EFFORT?.trim();
  return isCodexReasoningEffort(selected) ? selected : "high";
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

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
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
  // A consumer that stops at fullStream — an aborted auto-review classifier request, a caller
  // that only needs the text — never awaits the derived promises, so a rejection there (the abort
  // reason, a runtime failure) surfaced as four host unhandledRejections per event (264 on
  // 2026-09-05, one quartet per classifier timeout). Mark them handled; awaiting them still throws.
  const derived = <Value>(select: (value: Awaited<typeof executor>) => Value): Promise<Value> => {
    const promise = executor.then(select);
    promise.catch(() => undefined);
    return promise;
  };
  return {
    fullStream,
    response: derived(value => value.response),
    usage: derived(value => value.usage),
    extendedUsage: derived(value => value.extendedUsage),
    providerMetadata: derived(value => value.providerMetadata),
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

function claudeExecutor(messages: readonly ProviderMessage[], invocationId: string, onUsage?: (usage: UsageRecord) => void, mcpServerUrl?: string, systemPrompt?: string, context?: ProviderExecutorContext) {
  const executable = resolveClaudeCodeCliPath();
  if (executable == null) throw new Error("Claude Code is not installed. Install and sign in to Claude Code, then reopen Grok Bot.");
  const usage = deferred<{ promptTokens: number; completionTokens: number; totalTokens: number }>();
  const extendedUsage = deferred<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; maxTokens: number }>();
  const resultResponse = deferred<ReturnType<typeof response>>();
  const metadata = deferred<Record<string, unknown>>();
  const fullStream = (async function* () {
    const abortController = new AbortController();
    const abortQuery = () => abortController.abort(context?.signal?.reason);
    if (context?.signal?.aborted) abortQuery();
    else context?.signal?.addEventListener("abort", abortQuery, { once: true });
    try {
      abortController.signal.throwIfAborted();
      let final: SDKResultMessage | undefined;
      let streamed = "";
      const requestedModel = context?.modelId?.trim();
      const selectedModel = requestedModel != null && requestedModel.length > 0 && requestedModel !== "claude-code"
        ? requestedModel
        : process.env.SAND_CLAUDE_MODEL?.trim();
      for await (const message of queryClaude({
        prompt: claudePrompt(messages, systemPrompt),
        options: {
          abortController,
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
          // Text and thinking arrive as they are produced instead of once with the final result.
          includePartialMessages: true,
          ...(selectedModel == null || selectedModel.length === 0 ? {} : { model: selectedModel }),
        },
      })) {
        if (message.type === "stream_event") {
          const event = message.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
          if (event.type !== "content_block_delta" || event.delta == null) continue;
          if (event.delta.type === "text_delta" && typeof event.delta.text === "string" && event.delta.text.length > 0) {
            streamed += event.delta.text;
            yield { type: "text-delta" as const, textDelta: event.delta.text };
          } else if (event.delta.type === "thinking_delta" && typeof event.delta.thinking === "string" && event.delta.thinking.length > 0) {
            yield { type: "reasoning" as const, textDelta: event.delta.thinking };
          }
          continue;
        }
        if (message.type === "result") final = message;
      }
      abortController.signal.throwIfAborted();
      if (final == null) throw new Error("Claude Code ended without a result.");
      if (final.subtype !== "success") throw new Error(final.errors.join("\n") || `Claude Code failed (${final.subtype}).`);
      const text = final.result;
      // Whatever already streamed is not repeated; only text the final result adds (or the whole result when
      // the CLI sent no partial events) is emitted.
      const remainder = streamed.length === 0 ? text : text.startsWith(streamed) ? text.slice(streamed.length) : streamed.endsWith(text) ? "" : text;
      if (remainder.length > 0) yield { type: "text-delta" as const, textDelta: remainder };
      const input = final.usage.input_tokens;
      const output = final.usage.output_tokens;
      const cacheRead = final.usage.cache_read_input_tokens ?? 0;
      const cacheWrite = final.usage.cache_creation_input_tokens ?? 0;
      onUsage?.({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite });
      usage.resolve({ promptTokens: input, completionTokens: output, totalTokens: input + output });
      extendedUsage.resolve({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, maxTokens: 0 });
      metadata.resolve({ anthropic: { sessionId: final.session_id, totalCostUsd: final.total_cost_usd } });
      resultResponse.resolve(response(text, invocationId, selectedModel || "claude-code"));
    } catch (error) {
      usage.reject(error);
      extendedUsage.reject(error);
      metadata.reject(error);
      resultResponse.reject(error);
      throw error;
    } finally {
      context?.signal?.removeEventListener("abort", abortQuery);
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
  requestedModelId?: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const target = resolveOpenAiCompatibleTarget(requestedModelId);
  const model: LanguageModelV1 = createOpenAI({
    apiKey: target.apiKey(),
    baseURL: target.baseURL,
    compatibility: "compatible",
    name: target.name,
    ...(target.headers === undefined ? {} : { headers: target.headers }),
  }).chat(target.modelId as any);
  const tools = toToolSet(definitions, executeTool);
  const result = streamText({
    model,
    system: systemPrompt ?? GROK_ROUTER_SYSTEM_PROMPT,
    messages: messages as CoreMessage[],
    ...(signal == null ? {} : { abortSignal: signal }),
    ...(tools === undefined ? {} : { tools }),
    toolCallStreaming: true,
    maxSteps: tools === undefined ? 1 : 8,
  });
  // Hosts that omit usage from the stream (NVIDIA NIM without stream_options) hand the SDK NaN
  // token counts; downstream proto fields are uint32 and reject NaN ("invalid uint 32: NaN").
  const finite = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  const safeUsage = result.usage.then(value => ({
    promptTokens: finite(value.promptTokens),
    completionTokens: finite(value.completionTokens),
    totalTokens: finite(value.totalTokens) || finite(value.promptTokens) + finite(value.completionTokens),
  }));
  const extendedUsage = safeUsage.then(value => ({
    inputTokens: value.promptTokens,
    outputTokens: value.completionTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    maxTokens: 0,
  }));
  extendedUsage.catch(() => undefined);
  if (onUsage != null) void extendedUsage.then(onUsage).catch(() => undefined);
  // AI SDK 4.3 leaves response/usage/providerMetadata pending forever when the stream fails (provider error part
  // or abort). Anything awaiting them after a failed turn would hang, so they settle with the stream's failure.
  const failure = deferred<never>();
  failure.promise.catch(() => undefined);
  const settled = <T>(promise: Promise<T>): Promise<T> => {
    const raced = Promise.race([promise, failure.promise]);
    // Consumers that never look at a derived value must not turn the stream's failure into an unhandled rejection.
    raced.catch(() => undefined);
    return raced;
  };
  type StreamPart = typeof result.fullStream extends AsyncIterable<infer Part> ? Part : never;
  const fullStream = (async function* (): AsyncGenerator<StreamPart> {
    try {
      for await (const part of result.fullStream) {
        const probe = part as { type: string; error?: unknown };
        if (probe.type === "error") failure.reject(probe.error instanceof Error ? probe.error : new Error(String(probe.error)));
        yield part;
      }
    } catch (error) {
      failure.reject(error);
      throw error;
    }
  })();
  return {
    fullStream,
    response: settled(result.response),
    usage: settled(safeUsage),
    extendedUsage: settled(extendedUsage),
    providerMetadata: settled(result.providerMetadata),
    invocationId: Promise.resolve(invocationId),
  };
}

class ProviderPromptExecutor implements PromptExecutor {
  #claudeToolGapReported = false;
  readonly #messages: ProviderMessage[];
  // Stable prompt-cache affinity key (strict-review P1-02, rev 2): the Pi runtime
  // maps sessionId to provider prompt-cache affinity. Executors are rebuilt every
  // turn, so a per-executor random key only covered tool round-trips WITHIN a
  // turn — the caller now passes the conversation id, making affinity stable
  // across turns of the same conversation (random stays the fallback).
  readonly #cacheSessionId: string;

  constructor(
    readonly provider: RoutedProvider,
    initialMessages: readonly ProviderMessage[] | undefined,
    readonly onUsage: ((usage: UsageRecord) => void) | undefined,
    readonly modelId: string | undefined,
    readonly reasoning?: CodexReasoningEffort,
    cacheSessionId?: string,
  ) {
    this.#messages = initialMessages == null ? [] : [...initialMessages];
    this.#cacheSessionId = cacheSessionId != null && cacheSessionId.length > 0 ? cacheSessionId : crypto.randomUUID();
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
    if (this.provider === "claude-code") {
      const dropped = definitions?.length ?? 0;
      if (dropped > 0) {
        if (process.env.SAND_CLAUDE_STRICT_TOOLS === "1") throw new Error(CLAUDE_HOST_TOOLS_UNSUPPORTED);
        if (!this.#claudeToolGapReported) { this.#claudeToolGapReported = true; claudeHostToolGapReporter(dropped); }
      }
      return claudeExecutor(this.getMessages(), invocationId, this.onUsage, undefined, undefined, providerContext(signalFromContext(ctx), modelFromContext(ctx) ?? this.modelId));
    }
    return openRouterExecutor(this.getMessages(), invocationId, definitions, undefined, this.onUsage, undefined, modelFromContext(ctx) ?? this.modelId, signalFromContext(ctx));
  }
}

export function createProviderPromptSession(
  provider: RoutedProvider,
  requestedModelId?: string,
  requestedReasoning?: CodexReasoningEffort,
  cacheSessionId?: string,
): { getModelId(): string; getExecutor(state?: unknown): PromptExecutor } {
  const requested = requestedModelId?.trim();
  const modelId = provider === "codex"
    ? requested || configuredCodexModel()
    : provider === "claude-code"
      ? requested || process.env.SAND_CLAUDE_MODEL?.trim() || "claude-code"
      : requested || process.env.SAND_OPENROUTER_MODEL?.trim() || "openai/gpt-5.2";
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
        cacheSessionId,
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
      ? claudeExecutor(messages, invocationId, onUsage, options?.mcpServerUrl, options?.systemPrompt, providerContext(options?.signal, options?.modelId))
      : openRouterExecutor(messages, invocationId, options?.tools, options?.executeTool, onUsage, options?.systemPrompt, options?.modelId, options?.signal);
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
