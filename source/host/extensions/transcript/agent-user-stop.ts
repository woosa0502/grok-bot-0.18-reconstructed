import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const USER_STOP_REASON = "user stopped";
export const USER_STOP_FILE_NAME = "user-stopped-agents.json";

interface RunScope {
  readonly agentId: string;
  readonly generation: number;
  readonly stopGuard: string | null;
}

export interface AgentStopState {
  readonly stopGuard: string | null;
  readonly userIntentRevision: number;
}
export interface AgentStopExpectation {
  readonly expectedStopGuard?: string;
  readonly expectedClientNonce?: string;
}
export interface AgentStopResult extends AgentStopState {
  readonly id: string;
  readonly interrupted: boolean;
  readonly stale?: true;
}
interface AgentIntent extends AgentStopState {
  readonly clientNonce?: string;
}

/** A stop cancels existing work; only a new explicit prompt opens a new scope. */
export class AgentUserStopController {
  private readonly stopped = new Set<string>();
  private readonly generations = new Map<string, number>();
  private readonly intents = new Map<string, AgentIntent>();
  private readonly scope = new AsyncLocalStorage<RunScope>();

  constructor(readonly filePath: string | null = null) {
    if (filePath == null) return;
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const saved = JSON.parse(raw) as { version?: unknown; stopped?: unknown; intents?: unknown };
    if (saved.version !== 1 || !Array.isArray(saved.stopped) ||
        saved.stopped.some((id) => typeof id !== "string" || id.length === 0))
      throw new Error("Invalid user-stop state; refusing to resume cancelled work");
    for (const id of saved.stopped) this.stopped.add(id);
    if (saved.intents != null) {
      if (!Array.isArray(saved.intents)) throw new Error("Invalid user-stop intent state");
      for (const rawIntent of saved.intents) {
        const intent = rawIntent as Record<string, unknown> | null;
        if (typeof intent?.agentId !== "string" || intent.agentId.length === 0 ||
            typeof intent.stopGuard !== "string" || intent.stopGuard.length === 0 ||
            typeof intent.userIntentRevision !== "number" ||
            !Number.isSafeInteger(intent.userIntentRevision) || intent.userIntentRevision < 1 ||
            (intent.clientNonce != null && typeof intent.clientNonce !== "string"))
          throw new Error("Invalid user-stop intent state");
        this.intents.set(intent.agentId, {
          stopGuard: intent.stopGuard, userIntentRevision: intent.userIntentRevision,
          ...(typeof intent.clientNonce === "string" ? { clientNonce: intent.clientNonce } : {}),
        });
      }
    }
  }

  isStopped(agentId: string): boolean {
    const scope = this.scope.getStore();
    return this.stopped.has(agentId) ||
      (scope?.agentId === agentId && scope.generation !== this.generation(agentId));
  }

  isUserStopped(agentId: string): boolean {
    return this.stopped.has(agentId);
  }

  getState(agentId: string): AgentStopState {
    const intent = this.intents.get(agentId);
    return { stopGuard: intent?.stopGuard ?? null, userIntentRevision: intent?.userIntentRevision ?? 0 };
  }

  matchesExpectation(agentId: string, expected: AgentStopExpectation): boolean {
    const intent = this.intents.get(agentId);
    return (expected.expectedStopGuard == null || expected.expectedStopGuard === intent?.stopGuard) &&
      (expected.expectedClientNonce == null || expected.expectedClientNonce === intent?.clientNonce);
  }

  /** For asynchronous preparation that has not entered the run queue yet. */
  captureStopGuard(agentId: string): () => boolean {
    const generation = this.generation(agentId);
    const alreadyStopped = this.isStopped(agentId);
    return () => alreadyStopped || this.isStopped(agentId) ||
      generation !== this.generation(agentId);
  }

  stop(agentId: string): boolean {
    if (this.stopped.has(agentId)) {
      this.persist();
      return false;
    }
    this.stopped.add(agentId);
    this.generations.set(agentId, this.generation(agentId) + 1);
    const previous = this.intents.get(agentId);
    this.intents.set(agentId, {
      ...previous,
      stopGuard: previous?.stopGuard ?? randomUUID(),
      userIntentRevision: (previous?.userIntentRevision ?? 0) + 1,
    });
    this.persist();
    return true;
  }

  runUserPrompt<T>(agentId: string | undefined, task: () => T, clientNonce?: string): T {
    if (agentId == null) return task();
    const wasStopped = this.stopped.delete(agentId);
    let intent: AgentIntent;
    try {
      intent = this.beginIntent(agentId, clientNonce);
    } catch (error) {
      if (wasStopped) this.stopped.add(agentId);
      throw error;
    }
    return this.scope.run({ agentId, generation: this.generation(agentId), stopGuard: intent.stopGuard }, task);
  }

  /** Capture at enqueue time, preserving the scope of a pre-stop callback. */
  bindQueuedWork<T>(agentId: string, task: () => Promise<T>): () => Promise<T> {
    const active = this.scope.getStore();
    const generation = this.stopped.has(agentId) ? -1 :
      active?.agentId === agentId ? active.generation : this.generation(agentId);
    let stopGuard: string | null;
    try {
      stopGuard = active?.agentId === agentId ? active.stopGuard :
        generation < 0 ? this.getState(agentId).stopGuard : this.beginIntent(agentId).stopGuard;
    } catch (error) {
      // Admission follows beginSessionRun in existing callers. Let their normal
      // finally paths release it, with model execution blocked, before rejecting.
      return () => this.scope.run({ agentId, generation: -1, stopGuard: null }, async () => {
        await task();
        throw error;
      });
    }
    return () => this.scope.run({ agentId, generation, stopGuard }, task);
  }

  guardRunner<T extends { run: (...args: any[]) => any }>(agentId: string, runner: T): T {
    const run = (...args: any[]) => {
      if (this.isStopped(agentId)) return Promise.resolve({
        text: "", sentMessageCount: 0, reacted: false, aborted: true,
        streamOutputProduced: false,
      });
      return runner.run(...args);
    };
    return new Proxy(runner, {
      get(target, key) {
        if (key === "run") return run;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  private generation(agentId: string): number {
    return this.generations.get(agentId) ?? 0;
  }

  private beginIntent(agentId: string, clientNonce?: string): AgentIntent {
    const previous = this.intents.get(agentId);
    const intent = {
      stopGuard: randomUUID(), userIntentRevision: (previous?.userIntentRevision ?? 0) + 1,
      ...(clientNonce == null ? {} : { clientNonce }),
    };
    this.intents.set(agentId, intent);
    try {
      this.persist();
    } catch (error) {
      if (previous == null) this.intents.delete(agentId);
      else this.intents.set(agentId, previous);
      throw error;
    }
    return intent;
  }

  private persist(): void {
    if (this.filePath == null) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const part = `${this.filePath}.part`;
    writeFileSync(part, JSON.stringify({ version: 1, stopped: [...this.stopped].sort(),
      intents: [...this.intents].map(([agentId, intent]) => ({ agentId, ...intent })),
    }));
    renameSync(part, this.filePath);
  }
}

/** Interrupt both the wrapper (e.g. Aside) and this bot's child execution tree. */
export function interruptUserRunner(runner: any): boolean {
  if (runner == null) return false;
  const interrupted = runner.interrupt?.(USER_STOP_REASON) === true;
  const interruptedChildren = runner.interruptAll?.(USER_STOP_REASON) === true;
  runner.cancelBackgroundShellRewatches?.();
  return interrupted || interruptedChildren;
}

function clearCancelledRecovery(tm: Record<string, any>, agentId: string): void {
  tm.ackObligations.clearAckRedriveTimer(agentId);
  tm.ackObligations.ackRunTokens.delete(agentId);
  tm.ackObligationStore?.clear?.(agentId);
  tm.pendingWakeStore?.clearAgent?.(agentId);
  tm.upgradeResumeStore?.clear?.(agentId);
  tm.sendPipeline.latestRecoverySends.delete(agentId);
  for (const queue of [
    tm.backgroundWakes.pendingSubagentCompletions,
    tm.backgroundWakes.pendingShellCompletions,
    tm.backgroundWakes.pendingInbound,
    tm.backgroundWakes.pendingAgentInbound,
    tm.backgroundWakes.pendingChannelFailures,
    tm.backgroundWakes.pendingEventWakes,
  ]) queue.delete(agentId);
  tm.groupChat.dmPreemptedGroupMemberIds.delete(agentId);
  tm.backgroundWakes.dmPreemptedWakeAgentIds.delete(agentId);
}

export function runExplicitTranscriptPrompt<T>(
  tm: Record<string, any>, agentId: string | undefined, task: () => T, clientNonce?: string,
): T {
  if (agentId != null && tm.userStops.isUserStopped(agentId)) {
    clearCancelledRecovery(tm, agentId);
    // Recovery stores intentionally catch I/O errors. Check their raw persisted
    // projection before removing the stop tombstone and permitting new work.
    const hasPending = (store: any) =>
      store?.listPending?.().some((marker: { agentId: string }) => marker.agentId === agentId) === true;
    if (tm.ackObligationStore?.get?.(agentId) != null ||
        hasPending(tm.pendingWakeStore) || hasPending(tm.upgradeResumeStore))
      throw new Error("Cannot resume agent: cancelled recovery state could not be cleared");
  }
  return tm.userStops.runUserPrompt(agentId, task, clientNonce);
}

/** Public user cancellation is intentionally separate from deletion/watchdog cleanup. */
export async function interruptTranscriptAgent(
  tm: Record<string, any>,
  agentId: string,
  expected: AgentStopExpectation = {},
): Promise<AgentStopResult> {
  if (typeof agentId !== "string" || agentId.trim().length === 0)
    throw new Error("interruptAgent requires an agent id");
  if (tm.sessions.isAgentGone(agentId))
    throw new Error(`Agent ${agentId} no longer exists`);
  // Compare and mutate synchronously: no new prompt can enter between them.
  if (!tm.userStops.matchesExpectation(agentId, expected))
    return { id: agentId, interrupted: false, stale: true, ...tm.userStops.getState(agentId) };
  const wasInFlight = tm.runLifecycle.runningAgentIds().has(agentId);
  // Persist before interrupting, so a restart cannot redrive cancelled work.
  const firstStop = !tm.userStops.isUserStopped(agentId);
  let persistenceError: unknown;
  try {
    tm.userStops.stop(agentId);
  } catch (error) {
    // Still interrupt now, but do not report durable success if saving failed.
    persistenceError = error;
  }
  clearCancelledRecovery(tm, agentId);
  tm.sendPipeline.recoveryBreakEpochs.set(agentId,
    tm.sendPipeline.nextTurnEpoch({ id: agentId }));
  let interrupted = false;
  if (firstStop) {
    for (const runner of new Set([
      tm.runnerRegistry.runners.get(agentId),
      tm.runnerRegistry.activeGroupMemberRunners.get(agentId),
    ])) interrupted = interruptUserRunner(runner) || interrupted;
  }
  tm.telemetry.reportTurnInterrupt({
    conversationId: agentId, reason: "user_stop", hadActiveRun: interrupted, wasInFlight,
  });
  const stopState = tm.userStops.getState(agentId);
  await tm.roster.emitAgentUpdate(agentId);
  if (persistenceError != null) throw persistenceError;
  return { id: agentId, interrupted: firstStop && (interrupted || wasInFlight), ...stopState };
}
