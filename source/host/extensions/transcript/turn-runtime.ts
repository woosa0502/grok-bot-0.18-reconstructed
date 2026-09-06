import { isMessageAddress } from "../../../shared/message-reference.js";
import { sandDualSurfaceToolTelemetry } from "../../../shared/agents/agent-tool-names.js";
import { SAND_REACTION_AGENT } from "../../../shared/transcript.js";
import { UNKNOWN_CONNECTOR_TAG } from "../../../shared/observability/connector-auth-telemetry.js";
import { sandErrorDetail } from "../../ports/telemetry.js";
import {
  isContextOverflowDeadEnd,
  isConversationTooLargeRefusal,
  isFirstTokenStallError,
  isProviderCapacityError,
  isRetryableProviderError,
  isTransientStreamError,
  serverRetryAfterMsFromError,
} from "../../runner/transient-stream-error.js";
import {
  beginTurnTrace,
  markTurnTraceError,
  resolveTurnTraceOutcome,
  setTurnTraceAttributes,
  type HostTrace,
} from "../../send-trace-host.js";
import { brandedEnumOf, brandedErrno } from "../../../shared/errors/bounded.js";
import { SandError } from "../../../shared/errors/registry.js";
import { findSystemErrno } from "../../../shared/system-errno.js";
import {
  describeAgentRunError,
  findBackendConnectError,
  PROVIDER_OVERLOAD_ERROR_TITLE,
} from "./agent-run-error.js";
import {
  createSendMessageEntry,
  describeRepliedMessageQuote,
  isUserMessageEntry,
  stampBoxRequestEntry,
  type SendMessage,
} from "./send-message-shaping.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { getSandRootDir } from "../../host-paths.js";
import { join } from "node:path";
import { openAiCompatibleHostForModel } from "../inference/provider-session.js";
import {
  buildParkedTaskWidget,
  hasUnansweredParkedTaskCard,
  buildTaskContinuationPrompt,
  decideTaskContinuation,
  shouldParkTask,
  turnHasUnapprovedCard,
  type OpenTodo,
  type TaskStopReason,
} from "../../runner/turn-open-work.js";
import { nextEntryId } from "./transcript-entry-ids.js";
import type {
  TranscriptEntry,
  TranscriptManagerLike,
} from "./transcript-hub.js";
import { getTranscript, updateEntry } from "./transcript-store.js";
import type { LiveTranscriptSession } from "./session-runtime.js";

export const MAX_REPLY_NUDGES = 3;
/** Closing-send nudges per turn: each one re-runs the model, so keep the loop bounded. */
export const MAX_CLOSING_SEND_NUDGES = 3;
export const REPLY_NUDGE_PROMPT =
  "Your previous turn left the user without the result they're waiting on — you never called SendMessage that turn, or every SendMessage you tried failed to deliver. Either way they received nothing and are still waiting. Do not assume a send from an earlier turn covered it: an opening acknowledgement back then did not deliver this result (ack ≠ delivery). Deliver the result now by actually invoking the SendMessage tool — make a real tool/function call, not text you write. Plain assistant text is NEVER shown to the user; only a real SendMessage tool invocation reaches them, so if you don't call the tool they just keep seeing silence.";
export const CLOSING_SEND_NUDGE_PROMPT =
  "Your previous turn acknowledged the user and then ran tool calls, but ended without a follow-up SendMessage — the last thing the user saw is that opening acknowledgement, so whatever the tool calls produced after it never reached them. If that work produced the result or answer they are waiting on, deliver it now by actually invoking the SendMessage tool — make a real tool/function call, not text you write. Plain assistant text is NEVER shown to the user; only a real SendMessage tool invocation reaches them. If the work is genuinely unfinished, continue it and send the result once you have it. A progress update is not a result: while the task the user asked for is still unfinished and not waiting on them, keep working in this turn until it is done or genuinely blocked, then report. If the acknowledgement already contained the complete answer and the later work produced nothing new for the user, end the turn without sending anything.";
export const TASK_ERROR_RESULT_CLASS = "task_error_result";
export const CONNECT_CODE_NAMES = [
  "Canceled",
  "Unknown",
  "InvalidArgument",
  "DeadlineExceeded",
  "NotFound",
  "AlreadyExists",
  "PermissionDenied",
  "ResourceExhausted",
  "FailedPrecondition",
  "Aborted",
  "OutOfRange",
  "Unimplemented",
  "Internal",
  "Unavailable",
  "DataLoss",
  "Unauthenticated",
] as const;
export const connectCodeTag = brandedEnumOf(CONNECT_CODE_NAMES, "Other");

export interface TurnTraceContext {
  withName(name: string): unknown;
}

export type TurnCompletedSpanRecorder = (
  context: unknown,
  options: {
    readonly startTime: Date;
    readonly attributes: Readonly<Record<string, unknown>>;
  },
  endTime: Date,
) => void;

let turnCompletedSpanRecorder: TurnCompletedSpanRecorder | undefined;

/** Supplies the bundle-scope tracing helper without guessing an OTel runtime. */
export function setTurnCompletedSpanRecorder(
  recorder: TurnCompletedSpanRecorder | undefined,
): void {
  turnCompletedSpanRecorder = recorder;
}

export function recordTurnQueueWaitSpan(args: {
  traceCtx: unknown;
  queueStartEpochMs?: number;
  queueStartPerfMs?: number;
  conversationId: string;
  clientNonce?: string;
}): void {
  if (
    turnCompletedSpanRecorder == null ||
    args.queueStartEpochMs == null ||
    args.queueStartPerfMs == null ||
    args.traceCtx == null ||
    typeof args.traceCtx !== "object" ||
    !("withName" in args.traceCtx) ||
    typeof args.traceCtx.withName !== "function"
  ) {
    return;
  }
  try {
    const queueWaitMs = Math.max(
      0,
      Math.round(performance.now() - args.queueStartPerfMs),
    );
    turnCompletedSpanRecorder(
      (args.traceCtx as TurnTraceContext).withName("turn-queue-wait"),
      {
        startTime: new Date(args.queueStartEpochMs),
        attributes: {
          "sand.queue_wait_ms": queueWaitMs,
          "sand.conversation_id": args.conversationId,
          ...(args.clientNonce != null && args.clientNonce.length > 0
            ? { "sand.client_nonce": args.clientNonce }
            : {}),
        },
      },
      new Date(args.queueStartEpochMs + queueWaitMs),
    );
  } catch {}
}

export function connectCodeOf(error: unknown): string | undefined {
  const connectError = findBackendConnectError(error, false);
  if (connectError == null || typeof connectError.code !== "number") {
    return undefined;
  }
  return connectCodeTag(CONNECT_CODE_NAMES[connectError.code - 1]);
}

export interface TurnResult {
  /** Final plain assistant text of the run (never shown to the user by itself). */
  text?: string;
  sentMessageCount: number;
  reacted: boolean;
  aborted: boolean;
  /** Unfinished TodoWrite items after the run (see turn-open-work). */
  openTodos?: readonly OpenTodo[];
  taskCompletionUnknown?: boolean;
  /** Non-delivery, non-bookkeeping tool calls in the run. */
  workToolCalls?: number;
  /** TodoWrite calls in the run (turn-open-work). */
  todoWrites?: number;
  /** The run ended by handing the task to another agent/subagent. */
  handedOff?: boolean;
  quiescedForUpgrade?: boolean;
  streamOutputProduced?: boolean;
  endedOnSilentToolCalls?: boolean;
  awaitingUserSelection?: boolean;
  /** A stopped model run can still leave its task pending. */
  taskStopReason?: TaskStopReason;
}

export interface AgentRunner {
  run(prompt: string, options: Record<string, unknown>): Promise<TurnResult>;
  wouldRecoverViaPrepend?(
    recent: readonly unknown[],
    latestMessageId: string,
    skippedMessageId: string,
  ): Promise<boolean>;
  getObservedToolCallCount?(): number;
}

export interface TurnOptions extends Record<string, unknown> {
  readonly selectedImages: readonly unknown[];
  readonly messageId?: string;
  readonly recentUserMessages?: readonly { id: string; text: string }[];
  readonly selectedVideos?: readonly unknown[];
  readonly attachedFilePaths?: readonly string[];
  readonly replyContext?: { targetId: string };
  readonly isFork?: boolean;
  readonly traceCtx?: unknown;
  readonly queueStartEpochMs?: number;
  readonly queueStartPerfMs?: number;
  readonly clientNonce?: string;
  readonly ackToken?: string;
}

export function isDeliveryOwed(
  result: Pick<TurnResult, "sentMessageCount" | "reacted">,
): boolean {
  return result.sentMessageCount === 0 && !result.reacted;
}

export function classifyAgentError(error: unknown): Record<string, unknown> {
  if (isProviderCapacityError(error)) {
    const retryAfterMs = serverRetryAfterMsFromError(error);
    if (retryAfterMs !== undefined) {
      return SandError.backendCapacityDeferred({
        connectCode: connectCodeOf(error),
        retryAfterMs,
      });
    }
    return SandError.providerOverloaded({ connectCode: connectCodeOf(error) });
  }
  if (isFirstTokenStallError(error)) return SandError.firstTokenStall();
  if (isContextOverflowDeadEnd(error)) return SandError.contextWindowOverflow();
  if (isConversationTooLargeRefusal(error)) {
    return SandError.conversationTooLarge();
  }
  const connectCode = connectCodeOf(error);
  if (isRetryableProviderError(error)) {
    if (isTransientStreamError(error)) {
      return SandError.streamReset({
        connectCode,
        errno: brandedErrno(findSystemErrno(error)),
      });
    }
    return SandError.turnRetryable({ connectCode });
  }
  if (connectCode !== undefined) {
    return SandError.backendRejected({ connectCode });
  }
  return SandError.agentUnclassified();
}

type CardPredicate = (entry: TranscriptEntry) => boolean;
type CardUpdate = (entry: TranscriptEntry) => TranscriptEntry;

function messageOf(entry: TranscriptEntry): Record<string, any> | undefined {
  return typeof entry.message === "object" && entry.message != null
    ? (entry.message as Record<string, any>)
    : undefined;
}

export class TurnRuntime {
  readonly replyThreadTargets = new Map<LiveTranscriptSession, string>();
  readonly forkTurnSessions = new Set<LiveTranscriptSession>();
  readonly activeRequestPrompts = new Map<string, string>();
  readonly activeRequestSources = new Map<string, string>();
  readonly activeTurnEpochs = new Map<string, number>();
  readonly activeTurns = new Map<string, Record<string, any>>();
  readonly reportedDualSurfaceToolCalls = new Map<string, Set<string>>();
  readonly reportedToolCallErrors = new Map<string, Set<string>>();
  readonly reportedToolCallStalls = new Map<string, Set<string>>();
  readonly pendingToolCallStarts = new Map<string, Map<string, number>>();

  constructor(readonly tm: TranscriptManagerLike) {}

  settleCardStatus(args: {
    runSession?: LiveTranscriptSession | null;
    isForActiveAgent: boolean;
    matchesCard: CardPredicate;
    applyStatus: CardUpdate;
  }): void {
    const targetSession =
      args.runSession ?? this.tm.sessions.activeSession ?? null;
    const dbTarget = targetSession?.db
      .getTranscriptEntries()
      .find(args.matchesCard) as TranscriptEntry | undefined;
    const persisted =
      targetSession != null && dbTarget != null
        ? (targetSession.db.updateTranscriptEntry(
            dbTarget.id,
            args.applyStatus,
          ) as TranscriptEntry | null)
        : null;
    const liveTarget = args.isForActiveAgent
      ? getTranscript().find(args.matchesCard)
      : undefined;
    const live =
      liveTarget == null ? null : updateEntry(liveTarget.id, args.applyStatus);
    const shipped = live ?? persisted;
    if (shipped != null)
      this.tm.roster.emit(
        { type: "updated", entry: shipped },
        targetSession?.id,
      );
  }

  markReportedOnce(args: {
    reported: Map<string, Set<string>>;
    sessionId: string;
    toolCallId: string;
  }): boolean {
    let seen = args.reported.get(args.sessionId);
    if (seen == null) {
      seen = new Set();
      args.reported.set(args.sessionId, seen);
    }
    if (seen.has(args.toolCallId)) return false;
    seen.add(args.toolCallId);
    return true;
  }

  reportToolCallDiagnostic(
    session: LiveTranscriptSession,
    observation: Record<string, any>,
  ): void {
    const requestId =
      observation.requestId ??
      this.tm.runLifecycle.lastRequestIdBySession.get(session.id);
    const base = {
      conversationId: session.id,
      requestId,
      toolName: observation.toolName,
      toolCallId: observation.toolCallId,
      connector: observation.connector,
    };
    if (observation.kind === "error") {
      if (
        !this.markReportedOnce({
          reported: this.reportedToolCallErrors,
          sessionId: session.id,
          toolCallId: observation.toolCallId,
        })
      )
        return;
      this.tm.telemetry.reportToolCallError({
        ...base,
        errorClass: observation.errorClass,
        durationMs: observation.durationMs,
      });
    } else {
      if (
        !this.markReportedOnce({
          reported: this.reportedToolCallStalls,
          sessionId: session.id,
          toolCallId: observation.toolCallId,
        })
      )
        return;
      this.tm.telemetry.reportToolCallStalled({
        ...base,
        elapsedMs: observation.elapsedMs,
      });
    }
  }

  async runTurn(
    session: LiveTranscriptSession,
    runner: AgentRunner,
    prompt: string,
    options: TurnOptions,
    epoch: number,
  ): Promise<void> {
    const turnTrace = beginTurnTrace({
      parentCtx: options.traceCtx,
      conversationId: session.id,
      turnType: "user",
      ...(options.queueStartEpochMs == null
        ? {}
        : { startTime: options.queueStartEpochMs }),
      attributes: {
        "sand.turn_epoch": epoch,
        ...(options.clientNonce
          ? { "sand.client_nonce": options.clientNonce }
          : {}),
        ...(options.messageId == null
          ? {}
          : { "sand.message_id": options.messageId }),
        ...(options.isFork === true ? { "sand.is_fork": true } : {}),
      },
    });
    const turnCtx = turnTrace?.context ?? options.traceCtx;
    try {
      recordTurnQueueWaitSpan({
        traceCtx: turnCtx,
        ...(options.queueStartEpochMs == null
          ? {}
          : { queueStartEpochMs: options.queueStartEpochMs }),
        ...(options.queueStartPerfMs == null
          ? {}
          : { queueStartPerfMs: options.queueStartPerfMs }),
        conversationId: session.id,
        ...(options.clientNonce == null
          ? {}
          : { clientNonce: options.clientNonce }),
      });
      if (
        epoch !== this.tm.sendPipeline.currentTurnEpoch(session) &&
        options.messageId != null
      ) {
        const latest = this.tm.sendPipeline.latestRecoverySends.get(session.id);
        const rawText = options.recentUserMessages?.find(
          (message) => message.id === options.messageId,
        )?.text;
        const recoverable =
          options.selectedImages.length === 0 &&
          (options.selectedVideos?.length ?? 0) === 0 &&
          (options.attachedFilePaths?.length ?? 0) === 0 &&
          options.isFork !== true &&
          options.replyContext == null &&
          rawText != null &&
          rawText === prompt.trim() &&
          epoch >
            (this.tm.sendPipeline.recoveryBreakEpochs.get(session.id) ?? 0) &&
          latest != null &&
          latest.epoch === this.tm.sendPipeline.currentTurnEpoch(session) &&
          runner.wouldRecoverViaPrepend != null &&
          (await runner.wouldRecoverViaPrepend(
            latest.recentUserMessages,
            latest.messageId,
            options.messageId,
          ));
        if (recoverable) {
          this.tm.telemetry
            .startTurn({ conversationId: session.id, turnType: "new" })
            .finalize("cancelled");
          this.tm.ackObligations.retireAckRunToken(
            session.id,
            options.ackToken,
          );
          setTurnTraceAttributes(turnTrace, { "sand.outcome": "superseded" });
          this.tm.runLifecycle.endSessionRun(session);
          return;
        }
      }

      const trimmed = prompt.trim();
      if (trimmed) this.activeRequestPrompts.set(session.id, trimmed);
      else this.activeRequestPrompts.delete(session.id);
      if (options.replyContext != null)
        this.replyThreadTargets.set(session, options.replyContext.targetId);
      else this.replyThreadTargets.delete(session);
      if (options.isFork === true) this.forkTurnSessions.add(session);
      else this.forkTurnSessions.delete(session);
      this.activeTurnEpochs.set(session.id, epoch);
      const startedAtMs = Date.now();
      const turn = this.tm.telemetry.startTurn({
        conversationId: session.id,
        turnType: "new",
      });
      this.activeTurns.set(session.id, turn);
      this.activeRequestSources.set(session.id, "turn");
      try {
        const unansweredPrompts =
          this.tm.widgetResponses.collectUnansweredQuestionPrompts(session);
        const result = await runner.run(prompt, {
          ...options,
          ...unansweredPrompts,
          traceCtx: turnCtx,
          appendReplyReminder: true,
          requestSource: "turn",
          onModelResolved: (modelId: string) => turn.setModel(modelId),
        });
        let settledResult = result;
        if (result.quiescedForUpgrade)
          this.tm.upgradeResume.markAgentResumePending(session, "turn");
        else if (
          !result.aborted &&
          epoch === this.tm.sendPipeline.currentTurnEpoch(session)
        ) {
          const settled = await this.ensureUserReply(
            runner,
            result,
            session,
            epoch,
            options.ackToken,
            turnCtx,
            turnTrace,
            turn,
            startedAtMs,
          );
          settledResult = settled.result;
          if (
            settled.deliveryOwed &&
            !settledResult.aborted &&
            settledResult.quiescedForUpgrade !== true &&
            epoch === this.tm.sendPipeline.currentTurnEpoch(session)
          ) {
            this.tm.telemetry.reportTurnEmptyDelivery({
              conversationId: session.id,
              requestId: this.tm.runLifecycle.lastRequestIdBySession.get(
                session.id,
              ),
              source: "turn",
              requestSource: "turn",
              replyNudgeAttempts: settled.replyNudgeAttempts,
              toolCallCount: runner.getObservedToolCallCount?.() ?? 0,
              streamOutputProduced: settled.streamOutputProduced,
              durationMs: Date.now() - startedAtMs,
              ackOutstanding:
                this.tm.ackObligationStore?.get(session.id) != null,
            });
          }
        }
        turn.finalize(
          settledResult.aborted || settledResult.quiescedForUpgrade
            || (settledResult.taskStopReason != null && settledResult.taskStopReason !== "done")
            ? "cancelled" : "success",
        );
        setTurnTraceAttributes(turnTrace, {
          "sand.outcome": settledResult.taskStopReason != null && settledResult.taskStopReason !== "done"
            ? settledResult.taskStopReason : resolveTurnTraceOutcome(settledResult),
        });
        await this.tm.roster.emitAgentUpdate(session.id);
        this.tm.automationRuntime.emitAutomations(session);
      } catch (error) {
        console.error(
          `[sand][turn] agent run failed for ${session.id}`,
          error,
        );
        turn.finalize(
          "error",
          classifyAgentError(error),
          sandErrorDetail(error),
        );
        markTurnTraceError(turnTrace, error);
        if (epoch === this.tm.sendPipeline.currentTurnEpoch(session)) {
          const description = describeAgentRunError(error);
          const requestId = session.db.getRequestIds().at(-1)?.id;
          this.tm.trayErrors.pushError({
            agentId: session.id,
            title:
              description.errorKind === "provider_overloaded"
                ? PROVIDER_OVERLOAD_ERROR_TITLE
                : "Agent failed to respond",
            requestId,
            ...description,
          });
        }
        await this.tm.roster.emitAgentUpdate(session.id);
      } finally {
        for (const map of [
          this.activeTurns,
          this.reportedDualSurfaceToolCalls,
          this.reportedToolCallErrors,
          this.reportedToolCallStalls,
          this.pendingToolCallStarts,
          this.activeRequestPrompts,
          this.activeRequestSources,
        ])
          map.delete(session.id);
        this.tm.runLifecycle.lastRequestIdBySession.delete(session.id);
        this.replyThreadTargets.delete(session);
        this.forkTurnSessions.delete(session);
        if (this.activeTurnEpochs.get(session.id) === epoch)
          this.activeTurnEpochs.delete(session.id);
        this.tm.ackObligations.retireAckRunToken(session.id, options.ackToken);
        this.tm.runLifecycle.endSessionRun(session);
      }
    } finally {
      try {
        turnTrace?.span.end();
      } catch {}
      this.tm.traceFlusher();
    }
  }

  /** True for a bot whose model id names an OpenAI-compatible host (see provider-session). */
  isPlainTextDeliveryBot(agentId: string): boolean {
    try {
      const selection = new SandSettingsStore(join(getSandRootDir(), "settings.json")).getAgentModelForAgentId(agentId);
      return openAiCompatibleHostForModel(selection?.modelId) !== undefined;
    } catch {
      return false;
    }
  }

  async ensureUserReply(
    runner: AgentRunner,
    result: TurnResult,
    session: LiveTranscriptSession,
    epoch: number,
    ackToken: string | undefined,
    traceCtx: unknown,
    turnTrace: HostTrace | undefined,
    turn?: Record<string, any>,
    startedAtMs: number = Date.now(),
  ): Promise<{
    result: TurnResult;
    replyNudgeAttempts: number;
    deliveryOwed: boolean;
    streamOutputProduced: boolean;
  }> {
    let latest = result;
    let attempts = 0;
    let delivered = !isDeliveryOwed(result);
    let streamOutputProduced = result.streamOutputProduced === true;
    const transcriptEntries = (): readonly TranscriptEntry[] =>
      session.id !== this.tm.sessions.activeSession?.id
        ? (session.db.getTranscriptEntries() as TranscriptEntry[])
        : getTranscript();
    const unapprovedCardThisTurn = (): boolean => turnHasUnapprovedCard(transcriptEntries(), startedAtMs);
    const parkedCardPending = (): boolean => hasUnansweredParkedTaskCard(transcriptEntries(), latest.openTodos ?? []);
    const heldByParkedCard = (): boolean => (latest.todoWrites ?? 0) === 0 && parkedCardPending();
    // Bots routed to an OpenAI-compatible host (nvidia/…) answer in plain text more often than they
    // call SendMessage, and each nudge there costs minutes of queueing. Their final plain text IS the
    // answer, so deliver it as the message instead of nudging. Codex bots keep the nudge path: their
    // trailing plain text is usually an internal note, not an answer.
    const plainText = typeof latest.text === "string" ? latest.text.trim() : "";
    if (
      !delivered &&
      plainText.length > 0 &&
      !latest.aborted &&
      latest.taskCompletionUnknown !== true &&
      latest.quiescedForUpgrade !== true &&
      this.tm.isAgentUserStopped?.(session.id) !== true &&
      epoch === this.tm.sendPipeline.currentTurnEpoch(session) &&
      this.isPlainTextDeliveryBot(session.id) &&
      typeof (runner as { emitUpdate?: unknown }).emitUpdate === "function"
    ) {
      (runner as unknown as { emitUpdate: (update: unknown) => void }).emitUpdate({
        type: "send-message",
        message: { type: "text", content: plainText },
        timestampMs: Date.now(),
      });
      latest = { ...latest, sentMessageCount: latest.sentMessageCount + 1 };
      delivered = true;
      setTurnTraceAttributes(turnTrace, { "sand.plain_text_delivery": true });
    }
    while (
      isDeliveryOwed(latest) &&
      !latest.aborted &&
      latest.taskCompletionUnknown !== true &&
      latest.quiescedForUpgrade !== true &&
      latest.handedOff !== true &&
      latest.awaitingUserSelection !== true &&
      !unapprovedCardThisTurn() &&
      !heldByParkedCard() &&
      this.tm.isAgentUserStopped?.(session.id) !== true &&
      attempts < MAX_REPLY_NUDGES &&
      epoch === this.tm.sendPipeline.currentTurnEpoch(session)
    ) {
      attempts += 1;
      const nudged = await runner.run(REPLY_NUDGE_PROMPT, {
        hidden: true,
        ackToken,
        traceCtx,
        onModelResolved: (id: string) => turn?.setModel(id),
      });
      latest = {
        ...nudged,
        ...(nudged.openTodos === undefined && latest.openTodos !== undefined ? { openTodos: latest.openTodos } : {}),
        workToolCalls: (latest.workToolCalls ?? 0) + (nudged.workToolCalls ?? 0),
      };
      delivered ||= !isDeliveryOwed(latest);
      streamOutputProduced ||= latest.streamOutputProduced === true;
      if (latest.aborted) break;
    }
    // Task continuation: while the model's own todo list still has unfinished items and the run did
    // not end waiting on someone (approval/question widget, a handoff to another bot), hand the turn
    // back with a hidden wake — the Aside engine's "poll until done", using the todo list as the
    // done signal. Bounded by a run cap, one idle run, and a wall-clock budget (turn-open-work).
    // A turn that did no work (a greeting, a status question, "잠깐 멈춰") does not restart a parked
    // task by itself: it counts as the one idle run, so the loop only follows real work.
    let continuations = 0;
    let continuationStopReason: TaskStopReason = "done";
    let closingNudges = 0;
    let idleContinuations = (latest.workToolCalls ?? 0) > 0 ? 0 : 1;
    // An approval / permission card raised this turn that the user has not answered yes to (pending,
    // denied, expired) means the user is in the loop: do not hand the turn back and re-raise it.
    // A parked-task card for this same list that the user has not answered: they were already asked.
    // A run that did not touch the list (a quick chore while the task sits parked) neither restarts
    // it nor drops a second card; touching the list (TodoWrite) or answering the card lifts the hold.
    settlement: for (;;) {
      for (;;) {
        const decision = decideTaskContinuation({
          openTodos: latest.openTodos,
          taskCompletionUnknown: latest.taskCompletionUnknown === true,
          aborted: latest.aborted || latest.quiescedForUpgrade === true || this.tm.isAgentUserStopped?.(session.id) === true,
          awaitingUserSelection: latest.awaitingUserSelection === true || unapprovedCardThisTurn() || heldByParkedCard(),
          handedOff: latest.handedOff === true,
          continuations,
          idleContinuations,
          elapsedMs: Date.now() - startedAtMs,
        });
        if (!decision.continue || epoch !== this.tm.sendPipeline.currentTurnEpoch(session)) {
          continuationStopReason = epoch !== this.tm.sendPipeline.currentTurnEpoch(session)
            ? "aborted" : decision.continue ? "aborted" : decision.reason;
          if (continuations > 0) {
            setTurnTraceAttributes(turnTrace, {
              "sand.task_continuations": continuations,
              "sand.task_continuation_stop": decision.continue ? "superseded" : decision.reason,
            });
            console.info(
              `[sand][turn] task continuation for ${session.id}: ${continuations} run(s), stopped (${decision.continue ? "superseded" : decision.reason}), ${latest.openTodos?.length ?? 0} item(s) still open`,
            );
          }
          // Parked: the bot was working and stopped short with items open. Leave a resume card in the
          // chat so the user can tap 이어가기 (or 그만두기) whenever they come back; the answer arrives as
          // the next user turn and the loop above takes over again.
          const park = {
            reason: continuationStopReason,
            openTodos: latest.openTodos,
            workToolCalls: latest.workToolCalls ?? 0,
            continuations,
          };
          if (
            !decision.continue &&
            shouldParkTask(park) &&
            !parkedCardPending() &&
            typeof (runner as { emitUpdate?: unknown }).emitUpdate === "function"
          ) {
            (runner as unknown as { emitUpdate: (update: unknown) => void }).emitUpdate({
              type: "send-message",
              message: buildParkedTaskWidget(park.reason, latest.openTodos ?? []),
              timestampMs: Date.now(),
            });
            setTurnTraceAttributes(turnTrace, { "sand.task_parked": park.reason });
            console.info(
              `[sand][turn] task parked for ${session.id}: ${park.reason}, ${latest.openTodos?.length ?? 0} open item(s); resume card sent`,
            );
          }
          break;
        }
        continuations += 1;
        const openTodos = latest.openTodos ?? [];
        console.info(
          `[sand][turn] task continuation ${continuations} for ${session.id}: ${openTodos.length} open item(s)`,
        );
        const continued = await runner.run(buildTaskContinuationPrompt(openTodos), {
          hidden: true,
          taskContinuation: true,
          ackToken,
          traceCtx,
          onModelResolved: (id: string) => turn?.setModel(id),
        });
        latest = { ...continued, ...(continued.openTodos === undefined && latest.openTodos !== undefined ? { openTodos: latest.openTodos } : {}) };
        delivered ||= !isDeliveryOwed(continued);
        streamOutputProduced ||= continued.streamOutputProduced === true;
        idleContinuations = (continued.workToolCalls ?? 0) > 0 ? 0 : idleContinuations + 1;
      }
      // The nudged run is settled with silent-tail detection kept on (closingNudge), so a model that
      // sends a progress note and keeps working without reporting is nudged again, up to a bound.
      while (
        latest.endedOnSilentToolCalls === true &&
        continuationStopReason === "done" &&
        !latest.aborted &&
        latest.quiescedForUpgrade !== true &&
        latest.handedOff !== true &&
        this.tm.isAgentUserStopped?.(session.id) !== true &&
        latest.awaitingUserSelection !== true &&
        closingNudges < MAX_CLOSING_SEND_NUDGES &&
        epoch === this.tm.sendPipeline.currentTurnEpoch(session)
      ) {
        closingNudges += 1;
        setTurnTraceAttributes(turnTrace, {
          "sand.closing_send_nudge": true,
          "sand.closing_send_nudges": closingNudges,
        });
        let nudged: TurnResult | undefined;
        try {
          nudged = await runner.run(CLOSING_SEND_NUDGE_PROMPT, {
            hidden: true,
            closingNudge: true,
            ackToken,
            traceCtx,
            onModelResolved: (id: string) => turn?.setModel(id),
          });
          latest = nudged;
          delivered ||= !isDeliveryOwed(nudged);
          streamOutputProduced ||= nudged.streamOutputProduced === true;
        } finally {
          this.tm.telemetry.reportClosingSendNudge({
            conversationId: session.id,
            delivered:
              nudged != null && (nudged.sentMessageCount > 0 || nudged.reacted),
            sentMessageCount: nudged?.sentMessageCount ?? 0,
            aborted: nudged?.aborted ?? false,
          });
        }
        // A closing nudge is a real model run too. If it started more work, inspect that work with
        // the same remaining continuation budget instead of reporting a stale earlier "done".
        idleContinuations = (latest.workToolCalls ?? 0) > 0 || (latest.todoWrites ?? 0) > 0 ? 0 : 1;
        continue settlement;
      }
      break;
    }
    return {
      result: { ...latest, taskStopReason: continuationStopReason },
      replyNudgeAttempts: attempts,
      deliveryOwed: !delivered,
      streamOutputProduced,
    };
  }

  resolveReplyTarget(
    entries: readonly TranscriptEntry[],
    candidateId: string,
  ): string | undefined {
    return entries.some((entry) => entry.id === candidateId)
      ? candidateId
      : undefined;
  }

  buildReplyContext(
    entries: readonly TranscriptEntry[],
    targetId?: string,
  ): { targetId: string; quote: string } | undefined {
    if (targetId == null) return undefined;
    const target = entries.find((entry) => entry.id === targetId);
    return target == null
      ? undefined
      : { targetId, quote: describeRepliedMessageQuote(target) };
  }

  handleAgentUpdate(
    update: Record<string, any>,
    session?: LiveTranscriptSession,
  ): string | undefined {
    const runSession =
      session ??
      this.tm.runLifecycle.activeRunSession ??
      this.tm.sessions.activeSession ??
      null;
    const isForActiveAgent =
      runSession == null ||
      runSession.id === this.tm.sessions.activeSession?.id;
    if (isForActiveAgent) this.tm.roster.applyAgentUpdateToOutline(update);
    if (runSession != null) {
      this.tm.runLifecycle.trackComposingFromUpdate(update, runSession.id);
      this.tm.runLifecycle.trackRetryingFromUpdate(update, runSession);
      this.tm.runLifecycle.trackActivityFromUpdate(update, runSession.id);
    }
    switch (update.type) {
      case "client-side-tool-v2": {
        if (runSession == null) return undefined;
        const event = this.tm.clientSideToolV2.publish(runSession.id, update.update);
        if (event != null) this.tm.roster.emitClientSideToolV2(event);
        return undefined;
      }
      case "tool-call": {
        if (update.status === "pending" && runSession != null) {
          let starts = this.pendingToolCallStarts.get(runSession.id);
          if (starts == null) {
            starts = new Map();
            this.pendingToolCallStarts.set(runSession.id, starts);
          }
          if (!starts.has(update.id)) starts.set(update.id, performance.now());
          const dual = sandDualSurfaceToolTelemetry(update.name);
          if (
            dual != null &&
            this.markReportedOnce({
              reported: this.reportedDualSurfaceToolCalls,
              sessionId: runSession.id,
              toolCallId: update.id,
            })
          ) {
            this.tm.telemetry.reportToolCallStarted({
              conversationId: runSession.id,
              requestId: this.tm.runLifecycle.lastRequestIdBySession.get(
                runSession.id,
              ),
              toolName: dual.toolName,
              toolCallId: update.id,
              surface: dual.surface,
            });
          }
        } else if (runSession != null) {
          const starts = this.pendingToolCallStarts.get(runSession.id);
          const started = starts?.get(update.id);
          starts?.delete(update.id);
          if (update.status === "failed")
            this.reportToolCallDiagnostic(runSession, {
              kind: "error",
              toolCallId: update.id,
              toolName: update.name,
              connector: UNKNOWN_CONNECTOR_TAG,
              errorClass: TASK_ERROR_RESULT_CLASS,
              ...(started == null
                ? {}
                : { durationMs: Math.round(performance.now() - started) }),
            });
        }
        return undefined;
      }
      case "request-id":
        if (runSession != null) {
          this.activeTurns.get(runSession.id)?.setRequestId(update.requestId);
          this.tm.runLifecycle.lastRequestIdBySession.set(
            runSession.id,
            update.requestId,
          );
          this.tm.runLifecycle.trackTurnRequestId(
            runSession.id,
            update.requestId,
          );
        }
        void this.tm.runLifecycle.recordRequestId(
          update.requestId,
          runSession,
          update.source,
        );
        return undefined;
      case "turn-ended":
        if (runSession != null)
          this.tm.runLifecycle.reportTurnUsage(runSession, update.usage);
        return undefined;
      case "send-message": {
        const incoming = update.message as SendMessage;
        if (
          (incoming.type === "text" || incoming.type === "attachment") &&
          typeof incoming.channel === "string" &&
          incoming.channel.length > 0
        )
          this.tm.backgroundWakes.deliverToChannel(
            runSession,
            incoming,
            incoming.channel,
          );
        if (incoming.type === "listener-connect")
          this.notifyListenerConnect(runSession, incoming);
        if (incoming.type === "connector" && incoming.variant === "connect")
          this.notifyConnectorConnect(runSession, incoming);
        const entries =
          isForActiveAgent || runSession == null
            ? getTranscript()
            : (runSession.db.getTranscriptEntries() as TranscriptEntry[]);
        const sendId = nextEntryId(entries, "send-message");
        const validated = this.tm.sendPipeline.validateAiReplyTarget(
          incoming,
          sendId,
          entries,
        );
        const threaded = this.tm.sendPipeline.applyAutoReplyThread(
          validated,
          runSession,
          entries,
        ) as SendMessage;
        const batchId =
          threaded.type === "attachment" && runSession != null
            ? this.tm.sendPipeline.claimSendAttachmentBatchId(runSession.id)
            : undefined;
        const base = {
          ...createSendMessageEntry(sendId, threaded, update.timestampMs),
          ...(batchId == null ? {} : { batchId }),
        };
        const stamped =
          update.boxHandoff == null
            ? base
            : stampBoxRequestEntry(base, update.boxHandoff);
        const entry =
          runSession != null && this.forkTurnSessions.has(runSession)
            ? { ...stamped, branched: true }
            : stamped;
        if (isForActiveAgent || runSession == null) {
          this.tm.sendPipeline.appendSendMessageEntry(entry);
          const activeId = runSession?.id ?? this.tm.sessions.activeSession?.id;
          this.tm.ackObligations.fulfillAckObligation(
            activeId,
            update.ackToken,
          );
          if (activeId != null) void this.tm.roster.emitAgentUpdate(activeId);
        } else {
          runSession.db.appendTranscriptEntry(entry);
          this.tm.ackObligations.fulfillAckObligation(
            runSession.id,
            update.ackToken,
          );
          this.tm.sessionStore.markSessionActivity(runSession);
          void this.tm.roster.emitAgentUpdate(runSession.id);
        }
        return sendId;
      }
      case "auto-review-status":
        this.settleNestedStatus(
          runSession,
          isForActiveAgent,
          "auto-review-approval",
          "approval",
          update.requestId,
          update.status,
        );
        return undefined;
      case "local-tool-permission-status":
        this.settleNestedStatus(
          runSession,
          isForActiveAgent,
          "local-tool-permission",
          "ask",
          update.requestId,
          update.status,
        );
        return undefined;
      case "react-to-message": {
        const emoji = String(update.emoji ?? "").trim();
        if (!emoji || !isMessageAddress(update.messageAddress))
          return undefined;
        const reactSession =
          runSession ?? this.tm.sessions.activeSession ?? null;
        const entries =
          reactSession != null &&
          reactSession.id !== this.tm.sessions.activeSession?.id
            ? (reactSession.db.getTranscriptEntries() as TranscriptEntry[])
            : getTranscript();
        const target = entries.find(
          (entry) => entry.id === update.messageAddress,
        );
        if (target == null || !isUserMessageEntry(target)) return undefined;
        const applied = this.tm.widgetResponses.applyReaction({
          session: reactSession,
          entryId: update.messageAddress,
          emoji,
          by: reactSession?.id ?? SAND_REACTION_AGENT,
        });
        return applied == null ? undefined : update.messageAddress;
      }
      default:
        return undefined;
    }
  }

  private notifyListenerConnect(
    session: LiveTranscriptSession | null,
    message: SendMessage,
  ): void {
    const ownerId = session?.id ?? this.tm.sessions.activeSession?.id;
    if (ownerId == null) return;
    try {
      this.tm.onListenerConnectCard?.({
        agentId: ownerId,
        platform: message.platform,
      });
    } catch {}
  }

  private notifyConnectorConnect(
    session: LiveTranscriptSession | null,
    message: SendMessage,
  ): void {
    const ownerId = session?.id ?? this.tm.sessions.activeSession?.id;
    if (ownerId == null) return;
    try {
      this.tm.onConnectorConnectCard?.({
        agentId: ownerId,
        connector: message.connector,
        ...(message.serverId == null ? {} : { serverId: message.serverId }),
      });
    } catch {}
  }

  private settleNestedStatus(
    runSession: LiveTranscriptSession | null,
    isForActiveAgent: boolean,
    type: string,
    key: string,
    requestId: string,
    status: unknown,
  ): void {
    const matchesCard = (entry: TranscriptEntry) =>
      messageOf(entry)?.type === type &&
      messageOf(entry)?.[key]?.requestId === requestId;
    const applyStatus = (entry: TranscriptEntry): TranscriptEntry => {
      const message = messageOf(entry);
      if (
        message == null ||
        message.type !== type ||
        message[key]?.requestId !== requestId
      )
        return entry;
      return {
        ...entry,
        message: { ...message, [key]: { ...message[key], status } },
      };
    };
    this.settleCardStatus({
      runSession,
      isForActiveAgent,
      matchesCard,
      applyStatus,
    });
  }
}
