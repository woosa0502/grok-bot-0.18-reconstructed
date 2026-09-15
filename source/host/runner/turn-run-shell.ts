import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Context } from "../../packages/context/core.js";
import type { PrivacyMode } from "../../packages/redaction/privacy-mode.js";
import { SAND_SUMMARIZATION_MODEL_ID, reasoningEffortFromSelection, type SandAgentModelSelection } from "../../shared/agents/sand-agent-model.js";
import type { DiskPressureReminderEpisodes } from "../extensions/forever-box/disk-pressure.js";
import {
  createDiskPressureReminderMiddleware,
  createSendMessageReminderMiddleware,
  type MessageLike,
  type PromptExecutor,
} from "./send-message-reminder-middleware.js";
import { createStartOfTurnAckReminderMiddleware } from "./start-of-turn-ack-reminder-middleware.js";
import { createPromptMessagesRecorder, createPromptMessagesSnapshotMiddleware } from "./prompt-messages-snapshot-middleware.js";
import { SimplePromptToolExecutor } from "../../packages/agent/tool-stream-executor.js";
import {
  createShellWatchGeneratedStateProjection,
  createShellWatchReadAccessor,
  type ConfirmedUserTurnWatermark,
  type ShellTerminalWatchHost,
  type ShellWatchGeneratedStateOwner,
  type ShellWatchResourceAccessor,
} from "./shell-terminal-watch.js";
import type {
  TurnAgentScope,
  TurnAgentSessions,
} from "./turn-agent-composition.js";
import type {
  PromptSnapshotStore,
} from "./system-prompt-assembly.js";
import type { SummarizationPromptSession } from "../../packages/agent-summarization/summarization-handler.js";
import { createProviderPromptSession, openAiCompatibleHostForModel, type CodexReasoningEffort, isCodexReasoningEffort } from "../extensions/inference/provider-session.js";
import { parseLeadingJobHeader, type JobAttribution, type MeterIdentity } from "../extensions/inference/usage-ledger.js";
import { getSandRootDir } from "../host-paths.js";
import { SandSettingsStore } from "../../shared/node/settings/sand-settings-store.js";
import type { AgentProfilePromptSnapshot } from "./sand-agent-profile-prompt.js";
import {
  ConversationAction,
  ResumeAction,
} from "../../packages/proto/generated/agent/v1/agent_pb.js";
import type { BlobStore } from "../../packages/agent-kv/blob-store.js";
import {
  createTurnSettle,
  type TurnCheckpoint,
  type TurnSession,
  type TurnSettleHost,
  type TurnSettleResult,
} from "./turn-settle.js";
import type {
  InactiveTurnAgentStreamPath,
  InactiveTurnAgentStreamLifecycleInput,
  InactiveTurnAgentStreamStartInput,
} from "./inactive-turn-agent-stream.js";

export interface TurnAgentPromptSession {
  getModelId(): string;
  getExecutor(state?: unknown): PromptExecutor;
}

export interface TurnAgentInferenceOwner {
  resolvePrivacyMode(): Promise<PrivacyMode> | PrivacyMode;
  createSession(
    onRequestId: (requestId: string) => void,
    options?: Readonly<Record<string, unknown>>,
  ): TurnAgentPromptSession;
  createSummarizationSession?(
    onRequestId: (requestId: string) => void,
    options?: Readonly<Record<string, unknown>>,
  ): SummarizationPromptSession;
}

export interface TurnAgentShellWatchInput<ContextValue> {
  readonly box: {
    ensureReady(
      context: ContextValue,
      conversationId: string,
    ): Promise<{
      readonly terminalsFolder: string;
      readonly remoteAccessor: ShellWatchResourceAccessor<ContextValue>;
    }>;
  };
  readonly generatedState: ShellWatchGeneratedStateOwner<ContextValue>;
  readonly getConfirmedUserTurnWatermarkCache: () =>
    | ConfirmedUserTurnWatermark
    | undefined;
  readonly setConfirmedUserTurnWatermarkCache: (
    cache: ConfirmedUserTurnWatermark,
  ) => void;
  readonly now?: () => number;
}

export interface TurnAgentRunContextInput<ContextValue> {
  readonly context: ContextValue;
  readonly conversationId: string;
  readonly requestId: string;
  readonly inference: TurnAgentInferenceOwner;
  readonly onRequestId: (requestId: string) => void;
  readonly modelId?: string;
  readonly requestSource?: string;
  readonly isSubagentRunner: boolean;
  readonly subagentType?: string;
  readonly isSilenceAllowed: boolean;
  readonly isComputerUseSubagent?: boolean;
  readonly isBrowserUseSubagent?: boolean;
  readonly hidden?: boolean;
  readonly lineage?: unknown;
  readonly canUseSelfSummary: () => boolean;
  readonly diskPressureReminder?: DiskPressureReminderEpisodes;
  readonly diskPressureClaimId?: string;
  readonly cancelThisRun: (reason: TurnCancellation) => void;
  readonly ackToken?: string;
  readonly pauseThisRun?: () => void;
  readonly isRunAwaitingUserSelection?: () => boolean;
  readonly endThisRunAwaitingUser?: (reason: string) => void;
  readonly quietOrigin?: unknown;
  readonly directionEpoch?: number;
  readonly profilePromptSnapshot?: AgentProfilePromptSnapshot;
  /** The released profile/system-prompt owner; prompt assembly stays there. */
  readonly systemPromptAssembly?: Pick<
    ReturnType<
      typeof import("./system-prompt-assembly.js").createSystemPromptAssembly
    >,
    "prepareAgentProfilePromptSnapshot" | "getAgentProfileUpdateForTurn"
  >;
  readonly profilePromptSnapshotStore?: PromptSnapshotStore;
  readonly onProfileUpdateAppended?: (identity: {
    readonly name: string;
    readonly description: string;
  }) => void;
  readonly emittedConnectorCards: Set<string>;
  readonly diskPressureReminderEpisodeId?: string | null;
  readonly shellWatch?: TurnAgentShellWatchInput<ContextValue>;
  readonly onLatestPromptMessages?: (
    getter: () => readonly MessageLike[],
  ) => void;
}

export interface TurnAgentRunContext<ContextValue> {
  readonly privacyMode: PrivacyMode;
  /**
   * The metering identity minted for this turn (Belmont v4 job-id): the same
   * turnRunId the usage ledger stamps on every model call of this turn. The
   * adapter uses it to write the turn->job binding after owner creation.
   */
  readonly meterIdentity: MeterIdentity;
  readonly sessions: TurnAgentSessions;
  readonly scope: TurnAgentScope;
  readonly toolSession: {
    getExecutor(...args: readonly unknown[]): SimplePromptToolExecutor;
  };
  readonly summarizationSession?: SummarizationPromptSession;
  readonly shellWatchHost?: ShellTerminalWatchHost<ContextValue>;
  readonly diskPressureReminderEpisodeId: string | null;
  readonly profilePromptSnapshot?: unknown;
  readonly profileUpdateForTurn?: {
    readonly text: string;
    readonly identity: { readonly name: string; readonly description: string };
  };
  commitDiskPressureReminder(): void;
  dispose(): void;
}

/**
 * Reconstructs the immutable pre-buildAgentForRun owner. Session creation,
 * privacy resolution, disk-pressure episode claiming, scope identity, and
 * shell-watch state/blob/box wiring all happen once per turn; disposal is
 * idempotent and releases an uncommitted reminder episode.
 */
// Context compaction on the Codex path used to fall through to the turn model
// (gpt-5.5/high): ~130 summaries a day over ~45k tokens each. Summaries need no tools, so the
// cheap model does them; override with SAND_CODEX_SUMMARY_MODEL / SAND_CODEX_SUMMARY_EFFORT.
const LOCAL_SUMMARY_MODEL = process.env.SAND_CODEX_SUMMARY_MODEL?.trim() || "gpt-5.6-luna";
const LOCAL_SUMMARY_REASONING: CodexReasoningEffort = ((): CodexReasoningEffort => {
  const effort = process.env.SAND_CODEX_SUMMARY_EFFORT?.trim();
  return isCodexReasoningEffort(effort) ? effort : "medium";
})();

export async function createTurnAgentRunContext<ContextValue>(
  input: TurnAgentRunContextInput<ContextValue>,
): Promise<TurnAgentRunContext<ContextValue>> {
  const privacyMode = await input.inference.resolvePrivacyMode();
  const diskPressureReminderEpisodeId = input.diskPressureReminder == null
    || input.diskPressureClaimId == null
    ? input.diskPressureReminderEpisodeId ?? null
    : input.diskPressureReminder.claim({
      agentId: input.conversationId,
      claimId: input.diskPressureClaimId,
    });
  const sessionOptions = {
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.isComputerUseSubagent === undefined
      ? {}
      : { isComputerUseSubagent: input.isComputerUseSubagent }),
    ...(input.isBrowserUseSubagent === undefined
      ? {}
      : { isBrowserUseSubagent: input.isBrowserUseSubagent }),
    ...(input.requestSource === undefined
      ? {}
      : { requestSource: input.requestSource }),
    skipLabeling: input.isSubagentRunner || input.hidden === true,
    ...(input.lineage === undefined ? {} : { lineage: input.lineage }),
  };
  const settingsStore = new SandSettingsStore(join(getSandRootDir(), "settings.json"));
  const inferenceProvider = settingsStore.getInferenceProvider();
  // Per-agent model + reasoning for the local (non-Cursor) path. The main "bot", each subagent
  // TYPE (executor, video-review, …), and a subagent-wide fallback each read their own model
  // selection from settings.json, so e.g. an executor can run a cheaper model/effort than the main
  // agent — agentModelsBySubagentType[type] { effort: "medium" } while the main stays "high". The
  // selection's model id and its "effort" parameter override the runner's global default; both
  // fall back to it. Resolution order for a subagent: its type's selection, then the subagent
  // default, then the runner default. (Per-type keys need input.subagentType, threaded from the
  // subagent dispatcher through the owner input.)
  const agentSelection: SandAgentModelSelection | undefined = input.isSubagentRunner
    ? (input.subagentType != null && input.subagentType.length > 0
        ? settingsStore.getAgentModelForSubagentType(input.subagentType)
        : undefined)
      ?? settingsStore.getSubagentDefaultModel()
    // Top-level agents: a per-agent selection (AUDIT-W1 — set at CreateAgent or via
    // settings) wins over the global default. The runner's conversation id IS the
    // persistent agent id for top-level turns.
    : settingsStore.getAgentModelForAgentId(input.conversationId) ?? settingsStore.getAgentDefaultModel();
  const resolvedModelId = agentSelection?.modelId ?? input.modelId;
  const resolvedReasoning = ((): CodexReasoningEffort | undefined => {
    const effort = reasoningEffortFromSelection(agentSelection);
    return isCodexReasoningEffort(effort) ? effort : undefined;
  })();
  // A per-bot model id that names an OpenAI-compatible host ("nvidia/…") routes that bot through
  // the openrouter executor regardless of the global provider, so one roster bot can run on a free
  // or cheaper host while the rest stay on Codex.
  const routedHost = openAiCompatibleHostForModel(resolvedModelId);
  const turnProvider: typeof inferenceProvider = routedHost === undefined ? inferenceProvider : "openrouter";
  // Best-effort per-call token metering attribution (Belmont v4). Fixed here in the upper layer so
  // the lower model-request layer can tag each usage row with the acting bot / conversation / purpose.
  // A turn can make several model calls (tool round-trips + a summary); turnRunId groups them.
  const meterLineage = input.lineage != null && typeof input.lineage === "object"
    ? input.lineage as Record<string, unknown>
    : undefined;
  const meterBase = {
    actorId: input.conversationId,
    ownerAgentId: input.isSubagentRunner ? null : input.conversationId,
    conversationId: input.conversationId,
    hostRequestId: input.requestId,
    turnRunId: randomUUID(),
    // Subagent parent linkage (Belmont v4): parentAgentId/parentRequestId come from the dispatch
    // lineage (deriveSandSubagentRequestLineage) so a child subagent's usage links to the parent bot.
    ...(input.isSubagentRunner
      ? {
          parentActorId: typeof meterLineage?.parentAgentId === "string" ? meterLineage.parentAgentId : null,
          parentRequestId: typeof meterLineage?.parentRequestId === "string" ? meterLineage.parentRequestId : null,
          childAgentId: input.conversationId,
        }
      : {}),
  };
  const agent = turnProvider === "cursor"
    ? input.inference.createSession(input.onRequestId, sessionOptions)
    : createProviderPromptSession(turnProvider, resolvedModelId, resolvedReasoning, input.conversationId, { ...meterBase, purpose: "agent" }) as unknown as TurnAgentPromptSession;
  const summarizationSession = turnProvider === "cursor" ? input.inference.createSummarizationSession?.(
    input.onRequestId,
    {
      modelId: SAND_SUMMARIZATION_MODEL_ID,
      isSummarizationSession: true,
      ...(input.lineage === undefined ? {} : { lineage: input.lineage }),
    },
  ) : createProviderPromptSession(
    turnProvider,
    turnProvider === "codex" ? LOCAL_SUMMARY_MODEL : resolvedModelId,
    LOCAL_SUMMARY_REASONING,
    `${input.conversationId}:summary`,
    { ...meterBase, purpose: "summary" },
  ) as unknown as SummarizationPromptSession;
  const summarization = summarizationSession ?? input.inference.createSession(
    input.onRequestId,
    {
      modelId: SAND_SUMMARIZATION_MODEL_ID,
      isSummarizationSession: true,
      ...(input.lineage === undefined ? {} : { lineage: input.lineage }),
    },
  );
  const profilePromptSnapshot = input.profilePromptSnapshot
    ?? input.systemPromptAssembly?.prepareAgentProfilePromptSnapshot(
      input.profilePromptSnapshotStore,
    );
  const profileUpdateForTurn = input.systemPromptAssembly?.getAgentProfileUpdateForTurn(
    profilePromptSnapshot,
  );
  // Silent-stop postmortem part 2: the Agent asks for a fresh executor per runStream / summary /
  // step, so "the latest executor's messages" can be a stale snapshot at settle time. Record the
  // messages of every model call instead (innermost wrapper, after all reminders) and hand the
  // settle step that recording; it is exactly what the model last saw, whichever executor it was.
  const promptMessagesRecorder = createPromptMessagesRecorder();
  const baseExecutor = (): PromptExecutor =>
    createPromptMessagesSnapshotMiddleware(promptMessagesRecorder)(agent.getExecutor());
  const toolSession = {
    getExecutor: () => {
      const withDiskPressure = diskPressureReminderEpisodeId == null
        ? baseExecutor()
        : createDiskPressureReminderMiddleware(
          diskPressureReminderEpisodeId,
        )(baseExecutor());
      const withSendMessage = input.isSubagentRunner || input.isSilenceAllowed
        ? withDiskPressure
        : createSendMessageReminderMiddleware()(withDiskPressure);
      const executor = input.isSubagentRunner || input.isSilenceAllowed
        ? withSendMessage
        : createStartOfTurnAckReminderMiddleware()(withSendMessage);
      const toolExecutor = new SimplePromptToolExecutor(executor);
      input.onLatestPromptMessages?.(() => promptMessagesRecorder.latest());
      return toolExecutor;
    },
  };
  const scope: TurnAgentScope = {
    isSilenceAllowed: input.isSilenceAllowed,
    privacyMode,
    ...(input.quietOrigin === undefined ? {} : { quietOrigin: input.quietOrigin }),
    ...(input.directionEpoch === undefined
      ? {}
      : { directionEpoch: input.directionEpoch }),
    cancelThisRun: input.cancelThisRun,
    ...(input.ackToken === undefined ? {} : { ackToken: input.ackToken }),
    ...(input.pauseThisRun === undefined
      ? {}
      : { pauseThisRun: input.pauseThisRun }),
    ...(input.isRunAwaitingUserSelection === undefined
      ? {}
      : { isRunAwaitingUserSelection: input.isRunAwaitingUserSelection }),
    ...(input.endThisRunAwaitingUser === undefined
      ? {}
      : { endThisRunAwaitingUser: input.endThisRunAwaitingUser }),
    ...(profilePromptSnapshot === undefined
      ? {}
      : { profilePromptSnapshot }),
    ...(input.onProfileUpdateAppended === undefined
      ? {}
      : { onProfileUpdateAppended: input.onProfileUpdateAppended }),
    diskPressureReminderEpisodeId,
    ...(profilePromptSnapshot === undefined ? {} : { profilePromptSnapshot }),
    ...(profileUpdateForTurn == null ? {} : { profileUpdateForTurn }),
    emittedConnectorCards: input.emittedConnectorCards,
  };
  const shellWatchHost = input.shellWatch === undefined
    ? undefined
    : {
        ctx: input.context,
        ...createShellWatchGeneratedStateProjection(input.shellWatch.generatedState),
        getConversationId: () => input.conversationId,
        ensureBoxReady: async (context: ContextValue, conversationId: string) => {
          const connection = await input.shellWatch!.box.ensureReady(
            context,
            conversationId,
          );
          return {
            terminalsFolder: connection.terminalsFolder,
            remoteAccessor: createShellWatchReadAccessor(connection.remoteAccessor),
          };
        },
        getConfirmedUserTurnWatermarkCache:
          input.shellWatch.getConfirmedUserTurnWatermarkCache,
        setConfirmedUserTurnWatermarkCache:
          input.shellWatch.setConfirmedUserTurnWatermarkCache,
        ...(input.shellWatch.now === undefined
          ? {}
          : { now: input.shellWatch.now }),
      } satisfies ShellTerminalWatchHost<ContextValue>;
  let committed = false;
  let disposed = false;
  return {
    privacyMode,
    meterIdentity: {
      actorId: meterBase.actorId,
      turnRunId: meterBase.turnRunId,
      hostRequestId: meterBase.hostRequestId,
    },
    sessions: {
      agent,
      summarization,
      canUseSelfSummary: input.canUseSelfSummary,
    },
    scope,
    toolSession,
    ...(summarizationSession === undefined ? {} : { summarizationSession }),
    ...(shellWatchHost === undefined ? {} : { shellWatchHost }),
    diskPressureReminderEpisodeId,
    ...(profilePromptSnapshot === undefined ? {} : { profilePromptSnapshot }),
    ...(profileUpdateForTurn == null ? {} : { profileUpdateForTurn }),
    commitDiskPressureReminder() {
      if (disposed || committed || diskPressureReminderEpisodeId == null) return;
      committed = input.diskPressureReminder?.commit({
        agentId: input.conversationId,
        claimId: input.diskPressureClaimId ?? input.requestId,
      }) ?? false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!committed && diskPressureReminderEpisodeId != null) {
        input.diskPressureReminder?.release({
          agentId: input.conversationId,
          claimId: input.diskPressureClaimId ?? input.requestId,
        });
      }
    },
  };
}

export class SandEmptyPromptError extends Error {
  constructor() {
    super("Prompt cannot be empty.");
  }
}

export class SandTurnInterruptedBeforeDispatchError extends Error {
  constructor() {
    super("Turn interrupted before dispatch");
    this.name = "SandTurnInterruptedBeforeDispatchError";
  }
}

/** A beforeSubmitPrompt hook returned continue:false — the turn never ran. */
export class SandPromptSubmissionHaltedError extends Error {
  constructor(userMessage?: string) {
    super(
      userMessage !== undefined && userMessage.length > 0
        ? userMessage
        : "Prompt submission was blocked by a beforeSubmitPrompt hook.",
    );
    this.name = "SandPromptSubmissionHaltedError";
  }
}

export const RESUME_TURN_ACTION = new ConversationAction({
  action: { case: "resumeAction", value: new ResumeAction() },
});

export interface TurnRunOptions {
  readonly requestSource?: string;
  readonly memoryLearningSource?: "user" | "system";
  /** Distinguishes recovery work from optional hidden delivery nudges. */
  readonly upgradeResume?: boolean;
  readonly automationWake?: { readonly id: string };
  readonly selectedImages?: readonly unknown[];
  readonly attachedFilePaths?: readonly string[];
  readonly selectedVideos?: readonly unknown[];
  readonly inferenceRequestId?: string;
  readonly ackToken?: string;
  readonly messageId?: string;
  readonly recentUserMessages?: readonly {
    readonly id: string;
    readonly text: string;
  }[];
  readonly replyContext?: unknown;
  readonly hidden?: boolean;
  /** Hidden closing-send nudge: keep silent-tail detection on so the nudge can repeat (bounded). */
  readonly closingNudge?: boolean;
  /** Hidden task-continuation run: the runtime handed the turn back over an unfinished todo list. */
  readonly taskContinuation?: boolean;
  readonly isSilenceAllowed?: boolean;
  readonly autoReviewEpoch?: "continue" | "new";
  readonly lineage?: {
    readonly parentRequestId: string;
    readonly rootParentRequestId: string;
    readonly parentAgentToolCallId?: string;
  };
  /**
   * Belmont v4 job-id: the [job:<id>] attribution parsed from the ORIGINAL message
   * (before any wrapper). Set upstream for worker inbound (agent-to-agent-messaging)
   * where args.text is intact; run() falls back to parsing a direct user prompt.
   */
  readonly jobAttribution?: JobAttribution;
}

export interface TurnCancellation {
  readonly intentional: boolean;
  readonly reason: string;
}

export interface TurnRunContext {
  readonly signal: AbortSignal;
  readonly requestId: string;
  readonly generation: number;
  readonly privacyMode?: unknown;
  readonly inferenceSession?: TurnSession;
  readonly boxConnection?: unknown;
  readonly mcpTools?: readonly unknown[];
  /** Invocation identity, independent of persistent conversation generations. */
  readonly ownsRun?: () => boolean;
  readonly cancelThisRun?: (cancellation: TurnCancellation) => void;
}

export interface PreparedTurn {
  readonly action: unknown;
  readonly baseState: TurnCheckpoint;
  readonly transcriptPersistenceEnabled: boolean;
  readonly session: TurnSession;
  /** Release this invocation, including a predecessor escaped by the scheduler. */
  readonly dispose?: () => void;
}

export interface TurnStreamCallbacks {
  collectText(delta: string): void;
  collectSendMessage(): void;
  collectReaction(): void;
  collectAgentMessage(message: string): void;
  persistCheckpoint(checkpoint: TurnCheckpoint): Promise<void>;
  pauseForUser(reason: string): void;
  /**
   * SendMessage final: true. The run ends once the checkpoint carrying that
   * delivery is persisted, and settles as a completed turn (no closing round trip).
   */
  completeAfterDelivery(): void;
  noteDispatched(): void;
}

export interface TurnRunShellHost {
  /** Prepared real Agent path; inactive until the single atomic flip. */
  readonly inactiveTurnAgentStreamPath?: InactiveTurnAgentStreamPath;
  readonly activateTurnAgentStream?: boolean;
  /**
   * A8: runs the box's beforeSubmitPrompt hook for USER prompt submissions
   * (requestSource "turn" on a non-subagent runner). `halted: true` stops the
   * turn before the model sees the prompt (SandPromptSubmissionHaltedError,
   * carrying the hook's userMessage); additionalContext is injected ahead of
   * the prompt as a system reminder. Undefined return = hook did not run.
   */
  readonly runBeforeSubmitPromptHook?: (args: {
    readonly prompt: string;
    readonly requestId: string;
  }) => Promise<
    { halted: boolean; userMessage?: string; additionalContext?: string } | undefined
  >;
  readonly isSubagentRunner: boolean;
  readonly subagentType?: string;
  readonly inheritedRequestSource?: string;
  readonly inheritedAutomationId?: string;
  readonly subagents: {
    readonly sessions: ReadonlyMap<
      string,
      { interrupt(reason: string): void }
    >;
  };
  getConversationId(): string;
  runGeneration(): number;
  setActiveTurnRequestSource(source: string | undefined): void;
  setActiveTurnAutomationId?(automationId: string | undefined): void;
  beginAutoReviewUserMessageEpoch(): void;
  setActiveRunInterrupted(value: boolean): void;
  setAwaitingUserSelection(value: boolean): void;
  isAwaitingUserSelection(): boolean;
  emitRunLifecycle(event: {
    type: "started" | "ended";
    requestId: string;
  }): void;
  emitUpdate?(event: { type: string; requestId?: string }): void;
  conversationSizeGuard?(): Promise<void>;
  beginLocalToolPermissionTurn?(conversationId: string): void;
  resolvePrivacyMode?(): Promise<unknown>;
  createInferenceSession?(context: TurnRunContext): Promise<TurnSession>;
  ensureBoxReady?(context: TurnRunContext): Promise<unknown>;
  discoverMcpTools?(context: TurnRunContext): Promise<readonly unknown[]>;
  refreshMcpAccountConfig?(): void;
  resolveMcpCustomInstructions?(): Promise<unknown>;
  setMcpDiscoveryUnavailableForTurn?(value: boolean): void;
  setMcpConnectedServerNamesForTurn?(names: readonly string[]): void;
  setMcpCustomInstructionsForTurn?(instructions: unknown): void;
  noteMcpToolDiscoveryFailed?(error: unknown): void;
  traceSendPhase?<T>(
    context: TurnRunContext,
    name: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  setTurnTraceAttributes?(attributes: Readonly<Record<string, string>>): void;
  resolveAutomationId?(wakeId: string): string;
  prepareTurn(
    prompt: string,
    options: TurnRunOptions,
    context: TurnRunContext,
  ): Promise<PreparedTurn>;
  runPreparedTurn(
    prepared: PreparedTurn,
    context: TurnRunContext,
    callbacks: TurnStreamCallbacks,
  ): Promise<TurnCheckpoint>;
  createSettleHost(): TurnSettleHost;
  profilePromptSnapshots(): unknown;
  memoryStore?(): Parameters<typeof createTurnSettle>[1]["memoryStore"];
  episodeProgress?(): Parameters<typeof createTurnSettle>[1]["episodeProgress"];
  isMemorableExchange?: (prompt: string) => boolean;
  getLatestPromptMessages?(): readonly unknown[];
  ownsFinalState?(generation: number): boolean;
  onRunUnwind?(): void;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly generation: number;
  readonly requestId: string;
  dispatched: boolean;
  recoveryShaped: boolean;
  awaitingUserSelection: boolean;
  quiescedForUpgrade: boolean;
  /** A SendMessage marked final: true was delivered; cut the run at the next persisted checkpoint. */
  finalDeliveryRequested: boolean;
  /** The run was cut after that checkpoint: a completed turn, not an abort. */
  completedOnFinalDelivery: boolean;
}

export function createTurnRunShell(host: TurnRunShellHost) {
  let quiescingForUpgrade = false;
  let activeRun: ActiveRun | null = null;
  // A checkpoint already inside an asynchronous store/mirror cannot be revoked.
  // Preserve write order across escaped runs; later callbacks check ownership
  // when their slot is reached, before they can enter persistence.
  let persistenceTail: Promise<void> = Promise.resolve();

  function cancelRun(run: ActiveRun, cancellation: TurnCancellation): void {
    if (!run.controller.signal.aborted) {
      run.controller.abort(cancellation);
    }
  }

  function interrupt(
    reason: string,
    supersede?: { readonly carriesRecovery: boolean },
  ): boolean {
    const run = activeRun;
    if (run == null) return false;
    if (
      !run.dispatched
      && supersede != null
      && (!supersede.carriesRecovery || !run.recoveryShaped)
    ) {
      return false;
    }
    host.setActiveRunInterrupted(true);
    cancelRun(run, { intentional: true, reason });
    return true;
  }

  function requestQuiesceForUpgrade(): void {
    quiescingForUpgrade = true;
  }

  function isQuiescingForUpgrade(): boolean {
    return quiescingForUpgrade;
  }

  function cancelQuiesceForUpgrade(): void {
    quiescingForUpgrade = false;
  }

  function endTurnAwaitingUser(
    reason: string,
    owner: ActiveRun | null = activeRun,
  ): void {
    if (owner == null) return;
    owner.awaitingUserSelection = true;
    if (owner === activeRun) {
      host.setAwaitingUserSelection(true);
      cancelRun(owner, { intentional: true, reason });
      return;
    }
    cancelRun(owner, {
      intentional: true,
      reason: "awaiting user selection (escaped run)",
    });
  }

  function endTurnAfterDelivery(owner: ActiveRun | null = activeRun): void {
    if (owner == null) return;
    owner.finalDeliveryRequested = true;
  }

  function interruptAll(reason: string): boolean {
    const interrupted = interrupt(reason);
    for (const subagent of host.subagents.sessions.values()) {
      subagent.interrupt(reason);
    }
    return interrupted;
  }

  async function run(
    prompt: string,
    options: TurnRunOptions = {},
  ): Promise<TurnSettleResult> {
    const requestSource =
      options.requestSource ?? host.inheritedRequestSource;
    host.setActiveTurnRequestSource(requestSource);
    const turnAutomationId = options.automationWake == null
      ? host.inheritedAutomationId
      : host.resolveAutomationId?.(options.automationWake.id)
        ?? options.automationWake.id;
    host.setActiveTurnAutomationId?.(turnAutomationId);

    if (
      !host.isSubagentRunner
      && options.autoReviewEpoch !== "continue"
    ) {
      host.beginAutoReviewUserMessageEpoch();
    }

    const trimmedPrompt = prompt.trim();
    const selectedImages = options.selectedImages ?? [];
    const attachedFilePaths = options.attachedFilePaths ?? [];
    const selectedVideos = options.selectedVideos ?? [];
    if (
      trimmedPrompt.length === 0
      && selectedImages.length === 0
      && attachedFilePaths.length === 0
      && selectedVideos.length === 0
    ) {
      throw new SandEmptyPromptError();
    }

    const requestId = options.inferenceRequestId ?? randomUUID();
    const generation = host.runGeneration();
    const controller = new AbortController();
    const rawTranscriptText = options.messageId == null
      ? undefined
      : options.recentUserMessages?.find(
        (message) => message.id === options.messageId,
      )?.text;
    const runState: ActiveRun = {
      controller,
      generation,
      requestId,
      dispatched: false,
      recoveryShaped:
        options.messageId != null
        && selectedImages.length === 0
        && attachedFilePaths.length === 0
        && selectedVideos.length === 0
        && options.replyContext == null
        && rawTranscriptText != null
        && rawTranscriptText === trimmedPrompt,
      awaitingUserSelection: false,
      quiescedForUpgrade: false,
      finalDeliveryRequested: false,
      completedOnFinalDelivery: false,
    };
    if (activeRun != null) {
      cancelRun(activeRun, { intentional: true, reason: "Superseded by a newer turn." });
    }
    activeRun = runState;
    const ownsRun = (): boolean => activeRun === runState && host.runGeneration() === generation;
    const persistWhileOwned = (operation: () => Promise<void>): Promise<void> => {
      const pending = persistenceTail.then(async () => {
        if (ownsRun()) await operation();
      });
      persistenceTail = pending.catch(() => {});
      return pending;
    };
    host.setActiveRunInterrupted(false);
    host.setAwaitingUserSelection(false);

    let lifecycleEnded = false;
    const endLifecycle = (): void => {
      if (lifecycleEnded) return;
      lifecycleEnded = true;
      host.emitRunLifecycle({ type: "ended", requestId });
    };
    host.emitRunLifecycle({ type: "started", requestId });
    const traceAttributes = {
      ...(options.automationWake == null
        ? {}
        : { "sand.automation_id": options.automationWake.id }),
      ...(!host.isSubagentRunner || host.subagentType == null
        ? {}
        : { "sand.subagent_type": host.subagentType }),
    };
    if (Object.keys(traceAttributes).length > 0) {
      host.setTurnTraceAttributes?.(traceAttributes);
    }

    const memoryStore = host.memoryStore?.();
    const episodeProgress = host.episodeProgress?.();
    const settle = createTurnSettle(
      host.createSettleHost(),
      {
        conversationId: host.getConversationId(),
        profilePromptSnapshots: host.profilePromptSnapshots(),
        isRunSuperseded: () => !ownsRun(),
        ...(memoryStore == null ? {} : { memoryStore }),
        ...(episodeProgress === undefined
          ? {}
          : { episodeProgress }),
        ...(host.isMemorableExchange == null
          ? {}
          : { isMemorableExchange: host.isMemorableExchange }),
      },
    );

    let prepared: PreparedTurn | undefined;
    let finalState: TurnCheckpoint | undefined;
    let aborted = false;
    let awaitingUserSelection = false;
    let lastPersistedCheckpoint: TurnCheckpoint | undefined;
    const turnStartedAtMs = Date.now();

    let context: TurnRunContext = {
      signal: controller.signal,
      requestId,
      generation,
      ownsRun,
      cancelThisRun: cancellation => cancelRun(runState, cancellation),
    };
    const settleCompleted = async (state: TurnCheckpoint): Promise<void> => {
      if (prepared == null) return;
      await settle.settleCompletedTurn({
        finalState: state,
        turnStartedAtMs,
        hidden: options.hidden === true,
        closingNudge: options.closingNudge === true,
        taskContinuation: options.taskContinuation === true,
        trimmedPrompt,
        ...(rawTranscriptText == null ? {} : { memoryUserTurn: rawTranscriptText }),
        ...(options.memoryLearningSource == null ? {} : { memoryLearningSource: options.memoryLearningSource }),
        session: prepared.session,
        baseContext: context,
        requestId,
      });
    };

    try {
      if (!host.isSubagentRunner) {
        await host.conversationSizeGuard?.();
        if (options.autoReviewEpoch !== "continue") {
          host.beginLocalToolPermissionTurn?.(host.getConversationId());
        }
      }
      if (host.resolvePrivacyMode != null) {
        context = {
          ...context,
          privacyMode: await host.resolvePrivacyMode(),
        };
      }
      if (controller.signal.aborted) {
        throw new SandTurnInterruptedBeforeDispatchError();
      }

      if (host.createInferenceSession != null) {
        const create = () => host.createInferenceSession!(context);
        const inferenceSession = host.traceSendPhase == null
          ? await create()
          : await host.traceSendPhase(
            context,
            "inference.createSession",
            create,
          );
        context = { ...context, inferenceSession };
      }

      host.setMcpDiscoveryUnavailableForTurn?.(false);
      if (host.discoverMcpTools != null) {
        try {
          const mcpTools = await host.discoverMcpTools(context);
          context = { ...context, mcpTools };
          host.setMcpConnectedServerNamesForTurn?.(
            mcpTools.flatMap((tool) => {
              if (
                typeof tool !== "object"
                || tool == null
                || !("providerIdentifier" in tool)
                || typeof tool.providerIdentifier !== "string"
              ) return [];
              return [tool.providerIdentifier];
            }),
          );
        } catch (error) {
          host.noteMcpToolDiscoveryFailed?.(error);
        }
        host.refreshMcpAccountConfig?.();
      }
      if (host.resolveMcpCustomInstructions != null) {
        host.setMcpCustomInstructionsForTurn?.(
          await host.resolveMcpCustomInstructions(),
        );
      }

      // A8 (GBF-AGT-000325): beforeSubmitPrompt fires for real user prompt
      // submissions before the model ever sees the text. A halt surfaces the
      // hook's userMessage as the turn outcome; hook-context rides in as a
      // system reminder AHEAD of the untouched user prompt. Infrastructure
      // failures fail open (never block the user's prompt on plumbing).
      let effectivePrompt = trimmedPrompt;
      if (
        requestSource === "turn"
        && !host.isSubagentRunner
        && host.runBeforeSubmitPromptHook != null
      ) {
        const verdict = await host.runBeforeSubmitPromptHook({
          prompt: trimmedPrompt,
          requestId,
        }).catch(() => undefined);
        if (verdict?.halted === true) {
          throw new SandPromptSubmissionHaltedError(verdict.userMessage);
        }
        if (
          typeof verdict?.additionalContext === "string"
          && verdict.additionalContext.length > 0
        ) {
          effectivePrompt =
            `<system_reminder>\nbeforeSubmitPrompt hook context:\n${verdict.additionalContext}\n</system_reminder>\n\n${trimmedPrompt}`;
        }
      }

      if (memoryStore?.prepareMemoryTurn != null) {
        try {
          await memoryStore.prepareMemoryTurn({
            conversationId: host.getConversationId(),
            requestId,
            query: trimmedPrompt,
            isSubagent: host.isSubagentRunner,
            isAutomation: requestSource === "automation" || turnAutomationId != null,
          });
        } catch {
          // Retrieval is optional context; the facade retains sparse fallback.
        }
      }
      if (controller.signal.aborted || !ownsRun()) {
        throw new SandTurnInterruptedBeforeDispatchError();
      }

      // Belmont v4 job-id: prefer the attribution fixed upstream from the original
      // message (worker inbound); otherwise parse a direct user prompt's leading
      // [job:] header. trimmedPrompt for a worker turn is the [agent] wrapper, which
      // has no leading job header, so this fallback never misattributes.
      const jobAttribution = options.jobAttribution ?? parseLeadingJobHeader(trimmedPrompt);
      prepared = await host.prepareTurn(
        effectivePrompt,
        { ...options, jobAttribution },
        context,
      );
      settle.noteBaseState(
        prepared.baseState,
        prepared.transcriptPersistenceEnabled,
      );

      if (controller.signal.aborted) {
        throw new SandTurnInterruptedBeforeDispatchError();
      }

      if (host.ensureBoxReady != null) {
        const ensure = () => host.ensureBoxReady!(context);
        const boxConnection = host.traceSendPhase == null
          ? await ensure()
          : await host.traceSendPhase(context, "box.ensureReady", ensure);
        context = { ...context, boxConnection };
      }

      const callbacks: TurnStreamCallbacks = {
        collectText: delta => { if (ownsRun()) settle.collectors.collectText(delta); },
        collectSendMessage: () => { if (ownsRun()) settle.collectors.collectSendMessage(); },
        collectReaction: () => { if (ownsRun()) settle.collectors.collectReaction(); },
        collectAgentMessage: message => { if (ownsRun()) settle.collectors.collectAgentMessage(message); },
        async persistCheckpoint(checkpoint): Promise<void> {
          if (!ownsRun()) return;
          await persistWhileOwned(async () => {
            settle.prepareCheckpointForPersistence(checkpoint);
            await settle.persistStepCheckpoint(context, checkpoint);
          });
          if (!ownsRun()) return;
          lastPersistedCheckpoint = checkpoint;
          if (runState.awaitingUserSelection) {
            cancelRun(runState, {
              intentional: true,
              reason: "awaiting user selection",
            });
          } else if (runState.finalDeliveryRequested) {
            // The checkpoint carrying the final SendMessage (its tool result
            // included) is durable: end the run here instead of paying another
            // model round trip for an empty closing message. Settles as completed.
            runState.completedOnFinalDelivery = true;
            cancelRun(runState, {
              intentional: true,
              reason: "final message delivered",
            });
          } else if (quiescingForUpgrade) {
            runState.quiescedForUpgrade = true;
            cancelRun(runState, {
              intentional: true,
              reason: "quiescing for forced host upgrade",
            });
          }
        },
        pauseForUser(reason): void {
          endTurnAwaitingUser(reason, runState);
        },
        completeAfterDelivery(): void {
          endTurnAfterDelivery(runState);
        },
        noteDispatched(): void {
          runState.dispatched = true;
        },
      };

      if (controller.signal.aborted || !ownsRun()) {
        throw new SandTurnInterruptedBeforeDispatchError();
      }
      finalState = await host.runPreparedTurn(
        prepared,
        context,
        callbacks,
      );
      runState.dispatched = true;
      aborted =
        (controller.signal.aborted || !ownsRun())
        && !runState.awaitingUserSelection
        && !runState.quiescedForUpgrade
        && !runState.completedOnFinalDelivery;
      endLifecycle();

      if (ownsRun() && !aborted && !runState.quiescedForUpgrade) {
        await settleCompleted(finalState);
      }
    } catch (error) {
      endLifecycle();
      if (!controller.signal.aborted) throw error;
      aborted =
        !runState.awaitingUserSelection
        && !runState.quiescedForUpgrade
        && !runState.completedOnFinalDelivery;
      if (
        runState.completedOnFinalDelivery
        && ownsRun()
        && lastPersistedCheckpoint != null
      ) {
        // We cut the stream ourselves right after the final delivery's checkpoint
        // was persisted; that checkpoint is the turn's final state.
        finalState = lastPersistedCheckpoint;
        await settleCompleted(finalState);
      }
    } finally {
      try {
        if (
          ownsRun()
          && finalState != null
          && (host.ownsFinalState?.(generation) ?? true)
        ) {
          const checkpoint = finalState;
          await persistWhileOwned(() => settle.persistFinalState(context, checkpoint));
        }
      } finally {
        awaitingUserSelection = runState.awaitingUserSelection
          || (ownsRun() && host.isAwaitingUserSelection());
        try {
          prepared?.dispose?.();
        } finally {
          if (activeRun === runState) {
            activeRun = null;
            host.setActiveRunInterrupted(false);
            host.setActiveTurnAutomationId?.(undefined);
            host.onRunUnwind?.();
          }
          endLifecycle();
        }
      }
    }

    return settle.buildResult({
      aborted,
      ...(runState.quiescedForUpgrade
        ? { quiescedForUpgrade: true }
        : {}),
      ...(awaitingUserSelection
        ? { awaitingUserSelection: true }
        : {}),
      ...(runState.completedOnFinalDelivery
        ? { completedOnFinalDelivery: true }
        : {}),
    });
  }

  return {
    run,
    inactiveTurnAgentStreamPath: host.inactiveTurnAgentStreamPath,
    isTurnAgentStreamActivationReady: () =>
      host.activateTurnAgentStream === true
      && host.inactiveTurnAgentStreamPath !== undefined,
    runInactiveTurnAgentStream: async (
      input: InactiveTurnAgentStreamStartInput,
    ) => {
      if (
        host.activateTurnAgentStream !== true
        || host.inactiveTurnAgentStreamPath === undefined
      ) throw new Error("turn Agent stream path is inactive");
      return host.inactiveTurnAgentStreamPath.startStream(input);
    },
    runInactiveTurnAgentLifecycle: (
      input: InactiveTurnAgentStreamLifecycleInput,
      context: Context,
    ) => {
      if (
        host.activateTurnAgentStream !== true
        || host.inactiveTurnAgentStreamPath === undefined
      ) throw new Error("turn Agent stream path is inactive");
      return host.inactiveTurnAgentStreamPath.createLifecycle(input).run(context);
    },
    interrupt,
    interruptAll,
    requestQuiesceForUpgrade,
    isQuiescingForUpgrade,
    cancelQuiesceForUpgrade,
    endTurnAwaitingUser,
    hasActiveRun: (): boolean => activeRun != null,
    activeRequestId: (): string | undefined => activeRun?.requestId,
  };
}
