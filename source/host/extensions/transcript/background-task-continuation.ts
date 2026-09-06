import {
  buildTaskContinuationPrompt,
  decideTaskContinuation,
  hasUnansweredParkedTaskCard,
  turnHasUnapprovedCard,
  type TaskStopReason,
} from "../../runner/turn-open-work.js";
import { getTranscript } from "./transcript-store.js";
import type { TranscriptManagerLike, TranscriptEntry } from "./transcript-hub.js";
import type { AgentRunner, TurnResult } from "./turn-runtime.js";
import { withPendingWakeWorkflow } from "./pending-wake-workflow.js";
import type { PendingWakeReference } from "./sand-pending-wake-store.js";

export interface BackgroundTaskSettlement {
  readonly result: TurnResult;
  readonly reason: TaskStopReason;
  /** Only an actual settled task may clear a durable wake or mark an automation successful. */
  readonly completed: boolean;
  readonly continuations: number;
}

/**
 * Delegation, child completion and automation wakes use the same finite task policy as user turns.
 * No delivery nudge is added: the original wake decides who should hear the outcome, if anyone.
 * A pending approval/handoff, interruption, idle run or exhausted budget keeps its durable marker.
 */
export async function runBackgroundTask(
  tm: TranscriptManagerLike,
  session: { readonly id: string; readonly db: { getTranscriptEntries(): unknown[] } },
  runner: AgentRunner,
  prompt: string,
  options: Record<string, unknown>,
  isOriginCurrent: () => boolean = () => true,
  sources: readonly PendingWakeReference[] = [],
): Promise<BackgroundTaskSettlement> {
  return withPendingWakeWorkflow(tm, session.id, sources,
    () => runBackgroundTaskWithinWorkflow(tm, session, runner, prompt, options, isOriginCurrent));
}

async function runBackgroundTaskWithinWorkflow(
  tm: TranscriptManagerLike,
  session: { readonly id: string; readonly db: { getTranscriptEntries(): unknown[] } },
  runner: AgentRunner,
  prompt: string,
  options: Record<string, unknown>,
  isOriginCurrent: () => boolean,
): Promise<BackgroundTaskSettlement> {
  const startedAtMs = Date.now();
  const epoch = tm.sendPipeline?.currentTurnEpoch(session);
  const wasStopped = tm.captureAgentStopGuard?.(session.id) as (() => boolean) | undefined;
  const isCurrent = (): boolean => tm.execution.canExecute
    && tm.isAgentUserStopped?.(session.id) !== true
    && wasStopped?.() !== true
    && isOriginCurrent()
    && (epoch == null || epoch === tm.sendPipeline?.currentTurnEpoch(session));
  if (!isCurrent()) return {
    result: { sentMessageCount: 0, reacted: false, aborted: true },
    reason: "aborted", completed: false, continuations: 0,
  };
  let latest = await runner.run(prompt, options);
  let continuations = 0;
  let idleContinuations = (latest.workToolCalls ?? 0) > 0 || (latest.todoWrites ?? 0) > 0 ? 0 : 1;
  let sentMessageCount = latest.sentMessageCount;
  let reacted = latest.reacted;
  let streamOutputProduced = latest.streamOutputProduced === true;
  for (;;) {
    const current = isCurrent();
    const entries = (session.id === tm.sessions.activeSession?.id
      ? getTranscript()
      : session.db.getTranscriptEntries()) as TranscriptEntry[];
    const awaiting = latest.awaitingUserSelection === true
      || turnHasUnapprovedCard(entries, startedAtMs)
      || ((latest.todoWrites ?? 0) === 0 && hasUnansweredParkedTaskCard(entries, latest.openTodos ?? []));
    const decision = decideTaskContinuation({
      openTodos: latest.openTodos,
      taskCompletionUnknown: latest.taskCompletionUnknown === true,
      aborted: latest.aborted || latest.quiescedForUpgrade === true || !current,
      awaitingUserSelection: awaiting,
      handedOff: latest.handedOff === true,
      continuations,
      idleContinuations,
      elapsedMs: Date.now() - startedAtMs,
    });
    if (!decision.continue) return {
      result: {
        ...latest, sentMessageCount, reacted, streamOutputProduced,
        ...(!current ? { aborted: true } : {}),
      },
      reason: decision.reason,
      completed: decision.reason === "done",
      continuations,
    };
    continuations += 1;
    const continued = await runner.run(buildTaskContinuationPrompt(latest.openTodos ?? [], "origin"), {
      ...options,
      hidden: true,
      taskContinuation: true,
      autoReviewEpoch: "continue",
    });
    // Missing continuation metadata cannot erase a previously observed unfinished list.
    latest = { ...continued, ...(continued.openTodos === undefined && latest.openTodos !== undefined ? { openTodos: latest.openTodos } : {}) };
    sentMessageCount += continued.sentMessageCount;
    reacted ||= continued.reacted;
    streamOutputProduced ||= continued.streamOutputProduced === true;
    idleContinuations = (continued.workToolCalls ?? 0) > 0 ? 0 : idleContinuations + 1;
  }
}
