import { createHash } from "node:crypto";
import { assert } from "./types.js";
import type { Snapshot } from "./types.js";
export interface MemoryViewStamp {
  principalId: string;
  /** Increment on ACL/membership changes; supplied by the trusted host. */
  policyEpoch: number;
  snapshots: readonly Snapshot[];
}
export interface FrozenMemoryPrompt { render: string; compactionEpoch: number; memoryViewKey: string }
export function memoryViewKey(stamp: MemoryViewStamp): string {
  assert(stamp.principalId.length > 0 && Number.isSafeInteger(stamp.policyEpoch) && stamp.policyEpoch >= 0, "INVALID_VIEW_STAMP");
  assert(new Set(stamp.snapshots.map((s) => s.scope)).size === stamp.snapshots.length, "DUPLICATE_SCOPE");
  const scopes = [...stamp.snapshots].sort((a, b) => a.scope.localeCompare(b.scope));
  assert(scopes.every((s) => s.scope.length > 0 && Number.isSafeInteger(s.epoch) && s.epoch >= 0 && Number.isSafeInteger(s.generation) && s.generation >= 0), "INVALID_VIEW_STAMP");
  return createHash("sha256").update(JSON.stringify([stamp.principalId, stamp.policyEpoch, scopes.map((s) => [s.scope, s.epoch, s.generation])])).digest("hex");
}
/** Replaces compaction-only cache validity. Host must still revalidate immediately before dispatch. */
export function resolveFrozenPrompt(input: {
  previous?: FrozenMemoryPrompt; compactionEpoch: number; stamp: MemoryViewStamp;
  renderLive: () => { render: string; hasFacts: boolean };
}): { render: string; snapshotToPersist?: FrozenMemoryPrompt } {
  const key = memoryViewKey(input.stamp);
  if (input.previous?.compactionEpoch === input.compactionEpoch && input.previous.memoryViewKey === key) return { render: input.previous.render };
  const live = input.renderLive();
  // Cache even an empty view, replacing any old persisted sensitive render.
  return { render: live.render, snapshotToPersist: { render: live.render, compactionEpoch: input.compactionEpoch, memoryViewKey: key } };
}
