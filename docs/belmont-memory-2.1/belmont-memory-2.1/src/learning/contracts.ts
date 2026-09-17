import type { MemoryType } from "../types.js";
import type { ProcedureTrial } from "../procedures.js";
export interface SourceSpan { evidenceId: string; start: number; end: number; quote: string }
export interface AtomicDetails {
  kind: "atomic";
  subject: string;
  predicate: string;
  value: string;
  context: Record<string, string>;
  observedAt: number;
  confidence: number;
  assertion: "explicit" | "stated" | "inferred";
  spans: SourceSpan[];
  episodeId: string;
  extractorVersion: string;
  supersedesId?: string;
  contradictsIds?: string[];
}
export interface ProcedureSpec {
  domain: string;
  task: string;
  environment: string;
  preconditions: Record<string, string>;
  steps: { operation: "navigate" | "fill" | "click" | "wait" | "read"; target: string; value?: string }[];
  shortcuts: string[];
  failureConditions: string[];
  supersedesId?: string;
}
export interface ProcedureDetails extends ProcedureSpec {
  kind: "procedure";
  state: "accepted" | "deprecated";
  evaluationEvidenceId: string;
  successCount: number;
  failureCount: number;
  successRate: number;
  medianLatencyMs: number;
  medianTokens: number;
  lastVerified: number;
  feedbackEvidenceIds: string[];
}
export interface ProcedureEvaluation {
  kind: "procedure-evaluation-v1";
  spec: ProcedureSpec;
  control: ProcedureTrial[];
  candidate: ProcedureTrial[];
  candidateEvidenceId: string;
}
export type MemoryDetails = AtomicDetails | ProcedureDetails;
export interface ExtractedAtom {
  type: MemoryType; content: string; subject: string; predicate: string; value: string;
  context: Record<string, string>; confidence: number; span: { start: number; end: number; quote: string };
}
export interface CapturedTurn {
  id: string; text: string; at: number; sessionId: string;
  /** Host-authenticated user confirmation. Never accept this bit from an LLM/tool body. */
  explicitMemory?: boolean;
  /** Captured by the host when enqueuing, so clear/forget invalidates queued old work. */
  expectedEpoch?: number;
}
