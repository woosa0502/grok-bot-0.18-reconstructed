import { join } from "node:path";

import type {
  AssistantMessage,
  AuthInteraction,
  ThinkingLevel,
  Usage,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { getSandRootDir } from "../../host-paths.js";
import { classifyTokenLimitErrorFromMessage } from "../../../packages/chat-inference/token-limit-error-classification.js";

/** 429/503/overload shapes observed from the Codex OAuth backend. */
export function isRateLimitLikeMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b429\b|\b503\b/.test(lower)
    || lower.includes("rate limit")
    || lower.includes("rate-limited")
    || lower.includes("too many requests")
    || lower.includes("overloaded")
    || lower.includes("server is currently unavailable")
    || lower.includes("usage limit");
}
import { effectiveContextWindowTokens } from "./context-window.js";
import {
  BelmontPiCredentialStore,
  migrateBelmontCliCredential,
  migrateLegacyCodexCredential,
} from "./pi-codex-credential-store.js";
import {
  PiStreamMaterializer,
  belmontContentFromPi,
  createPiContext,
  type BelmontAssistantContent,
  type PiProviderMessage,
  type PiToolDefinition,
} from "./pi-codex-projection.js";

export interface PiUsageRecord {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export type PiCodexStreamEvent =
  | { readonly type: "text-delta"; readonly textDelta: string }
  | { readonly type: "reasoning-delta"; readonly reasoningDelta: string }
  | { readonly type: "tool-call"; readonly toolCallId: string; readonly toolName: string; readonly args: unknown };

export interface PiCodexExecutorOptions {
  readonly messages: readonly PiProviderMessage[];
  readonly invocationId: string;
  /**
   * Stable conversation-scoped cache key. Pi maps sessionId to prompt-cache
   * affinity, so this must NOT change per call; invocationId stays per-call for
   * result identity only (strict-review P1-02).
   */
  readonly cacheSessionId?: string;
  readonly definitions?: readonly PiToolDefinition[];
  readonly modelId?: string;
  readonly reasoning?: ThinkingLevel;
  readonly signal?: AbortSignal;
  readonly onUsage?: (usage: PiUsageRecord) => void;
  /**
   * Replaces the Grok Bot assistant persona for single-purpose requests (e.g. the local
   * auto-review classifier), which must not answer as the desktop assistant.
   */
  readonly systemPrompt?: string;
}

const CODEX_PROVIDER = "openai-codex";
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const GROK_ROUTER_SYSTEM_PROMPT = [
  "You are Grok Bot, a warm, concise desktop assistant.",
  "You are running inside Grok Bot. Belmont owns tools, approvals, transcript, MCP, and subagents.",
  "Use the tools supplied with this request when relevant. Do not claim connected Belmont capabilities are unavailable.",
].join("\n");

let runtimePromise: Promise<ModelRuntime> | undefined;

export function resolvePiCodexCredentialPath(): string {
  return process.env.SAND_PI_CODEX_AUTH_PATH?.trim() || join(getSandRootDir(), "pi-auth.json");
}

async function runtime(): Promise<ModelRuntime> {
  runtimePromise ??= (async () => {
    // @earendil-works/pi-coding-agent (and pi-ai) are ESM-only packages with no `require` export
    // condition. The clean host is a CJS bundle, so the value must be pulled in through a dynamic
    // import(), which esbuild preserves for an external package (require() would throw
    // ERR_PACKAGE_PATH_NOT_EXPORTED). The type import above is erased and stays static.
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const credentials = new BelmontPiCredentialStore(resolvePiCodexCredentialPath());
    await migrateBelmontCliCredential(credentials);
    await migrateLegacyCodexCredential(credentials);
    return await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
  })();
  return await runtimePromise;
}

function usageRecord(usage: Usage): PiUsageRecord {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
  };
}

async function resolveModel(modelId: string | undefined, signal?: AbortSignal) {
  const models = await runtime();
  signal?.throwIfAborted();
  const selectedId = modelId?.trim() || process.env.SAND_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
  const model = models.getModel(CODEX_PROVIDER, selectedId);
  if (model == null) {
    const available = models.getModels(CODEX_PROVIDER).map(candidate => candidate.id).sort();
    throw new Error(`Unknown Pi Codex model: ${selectedId}. Available: ${available.join(", ") || "none"}`);
  }
  return { runtime: models, model };
}

function resultResponse(
  message: AssistantMessage,
  invocationId: string,
  content: readonly BelmontAssistantContent[],
) {
  return {
    id: message.responseId ?? invocationId,
    modelId: message.model,
    timestamp: new Date(message.timestamp),
    headers: {},
    messages: [{ role: "assistant", content }],
  };
}

export async function getPiCodexAuthStatus(signal?: AbortSignal): Promise<{ configured: boolean; source?: string }> {
  const models = await runtime();
  signal?.throwIfAborted();
  const status = models.getProviderAuthStatus(CODEX_PROVIDER);
  if (!status.configured) return { configured: false };
  return status.source == null ? { configured: true } : { configured: true, source: status.source };
}

export async function loginPiCodex(interaction: AuthInteraction): Promise<void> {
  const models = await runtime();
  await models.login(CODEX_PROVIDER, "oauth", interaction);
}

export async function logoutPiCodex(signal?: AbortSignal): Promise<void> {
  const models = await runtime();
  await models.logout(CODEX_PROVIDER, signal == null ? {} : { signal });
}

export async function listPiCodexModels(signal?: AbortSignal): Promise<readonly string[]> {
  const models = await runtime();
  signal?.throwIfAborted();
  return models.getModels(CODEX_PROVIDER).map(model => model.id).sort();
}

export function createPiCodexExecutor(options: PiCodexExecutorOptions) {
  const response = Promise.withResolvers<ReturnType<typeof resultResponse>>();
  const usage = Promise.withResolvers<{ promptTokens: number; completionTokens: number; totalTokens: number }>();
  const extendedUsage = Promise.withResolvers<PiUsageRecord & { maxTokens: number }>();
  const metadata = Promise.withResolvers<Record<string, unknown>>();
  const materializer = new PiStreamMaterializer();

  const fullStream = (async function* (): AsyncGenerator<PiCodexStreamEvent> {
    try {
      options.signal?.throwIfAborted();
      const resolved = await resolveModel(options.modelId, options.signal);
      const context = createPiContext(options.messages, options.definitions, options.systemPrompt ?? GROK_ROUTER_SYSTEM_PROMPT);
      const stream = resolved.runtime.streamSimple(resolved.model, context, {
        ...(options.signal == null ? {} : { signal: options.signal }),
        ...(options.reasoning == null ? {} : { reasoning: options.reasoning }),
        sessionId: options.cacheSessionId ?? options.invocationId,
      });
      let final: AssistantMessage | undefined;
      for await (const event of stream) {
        options.signal?.throwIfAborted();
        const projected = materializer.apply(event);
        if (projected != null) yield projected;
        if (event.type === "done") final = event.message;
        if (event.type === "error") {
          throw new Error(event.error.errorMessage ?? `Pi Codex ${event.reason}`);
        }
      }
      options.signal?.throwIfAborted();
      final ??= await stream.result();
      options.signal?.throwIfAborted();
      if (!materializer.isClosed) materializer.finalize(final);
      const authoritative = materializer.terminalMessage() ?? final;
      const recorded = usageRecord(authoritative.usage);
      options.onUsage?.(recorded);
      usage.resolve({
        promptTokens: recorded.inputTokens,
        completionTokens: recorded.outputTokens,
        totalTokens: recorded.inputTokens + recorded.outputTokens,
      });
      // Report the model's real context window so Belmont's summarization orchestrator can
      // fire PRE-EMPTIVELY. Hardcoding 0 here made getBackgroundSummarizationTriggerThreshold
      // return undefined (background-summarization.ts: `if (maxTokens <= 0) return undefined`),
      // so proactive compaction never triggered and long conversations only compacted AFTER the
      // model threw "input exceeds the context window". Pi exposes contextWindow on the model.
      // The nominal window can be pinned/capped with SAND_CODEX_CONTEXT_WINDOW_TOKENS /
      // SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS when the backend's real limit is lower (AUDIT-6B).
      extendedUsage.resolve({ ...recorded, maxTokens: effectiveContextWindowTokens(resolved.model.contextWindow) });
      metadata.resolve({ openai: { responseId: authoritative.responseId, pi: true } });
      response.resolve(resultResponse(
        authoritative,
        options.invocationId,
        belmontContentFromPi(materializer.content()),
      ));
    } catch (error) {
      if (options.signal?.aborted) materializer.abort();
      // Classify token-limit failures into the typed errors the summarization
      // retry loop dispatches on (SummarizationHandler.isTokenLimitError is an
      // instanceof check). A plain Error here left "input exceeds the context
      // window" unrecognized, so the blocking-compaction recovery never ran on
      // the local provider and an over-long conversation simply died (A2,
      // reproduced live 2026-09-01).
      const classified = error instanceof Error
        ? classifyTokenLimitErrorFromMessage(error.message)
        : undefined;
      // Rate-limit / overload failures carry explicit retry guidance
      // (GBF-AGT-000240: a bare 429/503 gave the model and the user nothing
      // actionable). Token-limit classification wins — it has its own recovery.
      const finalError = classified
        ?? (error instanceof Error && isRateLimitLikeMessage(error.message)
          ? new Error(`${error.message} — The provider is rate limiting or overloaded right now; this is transient. Wait a moment and retry the same request.`)
          : error);
      response.reject(finalError);
      usage.reject(finalError);
      extendedUsage.reject(finalError);
      metadata.reject(finalError);
      throw finalError;
    }
  })();

  return {
    fullStream,
    response: response.promise,
    usage: usage.promise,
    extendedUsage: extendedUsage.promise,
    providerMetadata: metadata.promise,
    invocationId: Promise.resolve(options.invocationId),
  };
}
