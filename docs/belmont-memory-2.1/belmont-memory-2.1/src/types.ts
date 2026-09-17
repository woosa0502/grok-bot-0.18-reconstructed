import type { MemoryDetails } from "./learning/contracts.js";
export type MemoryType = "episodic" | "semantic" | "preference" | "procedural" | "knowledge";
export type Source = "user-message" | "browser" | "tool-outcome" | "assistant" | "legacy";
export type Authority = "user_explicit" | "agent_inference" | "external" | "legacy";
export type Actor = "user" | "agent" | "aside" | "consolidator" | "migrator";
export type Capability = "read" | "capture" | "propose" | "explicit" | "forget" | "migrate" | "index" | "consolidate" | "evaluate";
/** Construct ONLY in trusted host code. Never deserialize this from tool arguments. */
export interface Principal {
  readonly id: string;
  readonly actor: Actor;
  readonly scopes: readonly string[];
  readonly capabilities: readonly Capability[];
}
export interface Snapshot { readonly scope: string; readonly epoch: number; readonly generation: number }
export interface EvidenceInput {
  scope: string; source: Source; sourceRef: string; content: string; occurredAt: number;
  /** Required for queued capture; prevents an old task from writing after clear/forget. */
  expectedEpoch: number;
}
export interface Evidence {
  id: string; scope: string; source: Source; content: string | null;
  occurredAt: number; recordedAt: number; revokedAt: number | null;
}
export interface Proposal {
  scope: string; type: MemoryType; content: string; title?: string; aliases?: string[];
  evidenceIds: string[]; parentIds?: string[];
  idempotencyKey: string; basedOn: Snapshot;
  target?: { id: string; expectedVersion: number };
  validFrom?: number; validTo?: number | null; details?: MemoryDetails;
}
export interface MemoryItem {
  id: string; scope: string; type: MemoryType; content: string; title: string; aliases: string[];
  authority: Authority; version: number; validFrom: number; validTo: number | null;
  recordedAt: number; updatedAt: number; evidenceIds: string[]; details?: MemoryDetails;
}
export type ProposalResult =
  | { status: "committed"; id: string; version: number }
  | { status: "review_required" | "rejected"; reason: string };
export interface SearchHit { item: MemoryItem; score: number; channels: string[] }
export interface IndexJob { seq: number; scope: string; itemId: string; version: number; operation: "upsert" | "delete" }
export class MemoryError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "MemoryError"; }
}
export function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new MemoryError(code);
}
export function finiteTime(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
