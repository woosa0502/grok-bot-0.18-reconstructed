import { AsyncLocalStorage } from "node:async_hooks";
import type { PendingWakeReference, DurablePendingWakeMarker } from "./sand-pending-wake-store.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

interface WakeWorkflow {
  readonly agentId: string;
  readonly references: readonly PendingWakeReference[];
  readonly replyTo: readonly PendingWakeReference[];
}
const workflow = new AsyncLocalStorage<WakeWorkflow>();
const key = (ref: PendingWakeReference): string => JSON.stringify([ref.agentId, ref.kind, ref.workId]);
function unique(refs: readonly PendingWakeReference[]): PendingWakeReference[] {
  return [...new Map(refs.map((ref) => [key(ref), ref])).values()];
}

/** Bind source wake identities through async tool calls, without sharing one mutable per-agent slot. */
export function withPendingWakeWorkflow<T>(
  tm: TranscriptManagerLike,
  agentId: string,
  sources: readonly PendingWakeReference[],
  run: () => Promise<T>,
): Promise<T> {
  // A routine/group run may originate from an async resource created during earlier work.
  // An empty source list starts an independent scope instead of inheriting stale wake ancestry.
  if (sources.length === 0) return workflow.run({ agentId, references: [], replyTo: [] }, run);
  const pending = (tm.pendingWakeStore?.listPending() ?? []) as DurablePendingWakeMarker[];
  let references = unique(sources.filter((ref) => ref.agentId === agentId));
  const replyTo: PendingWakeReference[] = [];
  const visited = new Set<string>();
  for (let index = 0; index < references.length; index += 1) {
    const ref = references[index]!;
    if (visited.has(key(ref))) continue;
    visited.add(key(ref));
    const marker = pending.find((item) => key(item) === key(ref));
    if (marker == null) continue;
    references = unique([...references, ...(marker.workflowParents ?? []).filter((parent) => parent.agentId === agentId)]);
    replyTo.push(...marker.replyToWorkflow ?? []);
  }
  return workflow.run({ agentId, references, replyTo: unique(replyTo) }, run);
}

/** Called at child/shell dispatch, before the child can finish or the process can restart. */
export function pendingWakeWorkflowFields(agentId: string): { workflowParents?: readonly PendingWakeReference[] } {
  const current = workflow.getStore();
  return current?.agentId === agentId && current.references.length > 0
    ? { workflowParents: current.references }
    : {};
}

/** Replies carry the requesting workflow back; completing the recipient alone cannot settle it. */
export function agentMessageWorkflowFields(fromAgentId: string, toAgentId: string): {
  workflowParents?: readonly PendingWakeReference[];
  replyToWorkflow?: readonly PendingWakeReference[];
} {
  const current = workflow.getStore();
  if (current?.agentId !== fromAgentId) return {};
  const parents = current.replyTo.filter((ref) => ref.agentId === toAgentId);
  return {
    ...(parents.length > 0 ? { workflowParents: parents } : {}),
    ...(current.references.length > 0 ? { replyToWorkflow: current.references } : {}),
  };
}

/** Clear this wake and only its linked, dependency-free ancestors in one durable store write. */
export function settlePendingWakeWorkflow(tm: TranscriptManagerLike, source: PendingWakeReference): void {
  if (typeof tm.pendingWakeStore?.clearSettledWorkflow !== "function") {
    tm.pendingWakes.clearSettledPendingWake(source);
    return;
  }
  const settled = tm.pendingWakeStore.clearSettledWorkflow(source) as PendingWakeReference[];
  for (const ref of settled) tm.telemetry.reportPendingWake({
    conversationId: ref.agentId, outcome: "settled", kind: ref.kind, workId: ref.workId,
  });
  if (settled.length > 0) tm.roster.emitAsyncTasksForAgent?.(source.agentId);
}
