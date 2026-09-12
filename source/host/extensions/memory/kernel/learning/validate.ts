import { normalize } from "../text.js";
import { assert, finiteTime } from "../types.js";
import type { Evidence, MemoryItem, Principal, Proposal } from "../types.js";
import { extractAtoms, EXTRACTOR_VERSION, sameExtraction } from "./extract.js";
import { evaluateProcedure } from "../procedures.js";
import type { ProcedureEvaluation, ProcedureDetails } from "./contracts.js";
export function validateDetails(p: Principal, proposal: Proposal, evidence: Evidence[], target?: MemoryItem): void {
  const d = proposal.details;
  if (!d) return;
  assert(JSON.stringify(d).length <= 24000, "DETAILS_TOO_LARGE");
  if (d.kind === "atomic") {
    assert(finiteTime(d.observedAt) && Number.isFinite(d.confidence) && d.confidence >= 0 && d.confidence <= 1, "INVALID_ATOM");
    assert(["explicit","stated","inferred"].includes(d.assertion) && [d.subject,d.predicate,d.value,d.episodeId].every(v => typeof v === "string" && v.length > 0 && v.length <= 2000), "INVALID_ATOM");
    assert(d.spans.length > 0 && d.spans.length <= 64, "ATOM_SPAN_REQUIRED");
    for (const s of d.spans) {
      const e = evidence.find(e => e.id === s.evidenceId);
      assert(e?.content != null && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start && e.content.slice(s.start, s.end) === s.quote, "UNSUPPORTED_SOURCE_SPAN");
    }
    assert(d.spans.some(s => evidence.find(e => e.id === s.evidenceId)?.occurredAt === d.observedAt), "UNSUPPORTED_OBSERVED_AT");
    if (p.actor !== "user" && (proposal.type === "preference" || proposal.type === "semantic")) {
      assert(p.actor === "consolidator" && p.capabilities.includes("consolidate"), "CONSOLIDATOR_REQUIRED");
      assert(d.assertion === "stated" && d.extractorVersion === EXTRACTOR_VERSION, "INFERENCE_REQUIRES_REVIEW");
      assert(d.spans.some(s => evidence.find(e => e.id === s.evidenceId)?.source === "user-message" && extractAtoms(s.quote).some(a => a.type === proposal.type && sameExtraction(a, d))), "UNSUPPORTED_ATOMIC_VALUE");
    }
    // Content remains an exact supported sentence, including numbers, entities and negative words.
    assert(d.spans.some(s => normalize(s.quote) === normalize(proposal.content)), "NONEXTRACTIVE_CONTENT_REQUIRES_REVIEW");
  } else if (d.kind === "procedure") {
    assert(p.actor === "consolidator" && p.capabilities.includes("evaluate"), "EVALUATOR_REQUIRED");
    const e = evidence.find(e => e.id === d.evaluationEvidenceId);
    assert(e?.source === "tool-outcome" && e.content != null, "MEASUREMENT_EVIDENCE_REQUIRED");
    const ev = JSON.parse(e.content) as ProcedureEvaluation;
    assert(ev.kind === "procedure-evaluation-v1" && evaluateProcedure(ev.control, ev.candidate, d.environment).accept, "PROCEDURE_GATE_FAILED");
    for (const key of ["domain","task","environment","preconditions","steps","shortcuts","supersedesId"] as const) assert(JSON.stringify(ev.spec[key]) === JSON.stringify(d[key]), "PROCEDURE_SPEC_CHANGED");
    assert(evidence.some(e => e.id === ev.candidateEvidenceId && e.content != null), "CANDIDATE_EVIDENCE_REQUIRED");
    // Every added failure condition is tied to an actual outcome. Text cannot invent a new shortcut.
    const feedback = d.feedbackEvidenceIds.map(id => { const f = evidence.find(e => e.id === id); assert(f?.source === "tool-outcome" && f.content != null, "FEEDBACK_EVIDENCE_REQUIRED"); return JSON.parse(f.content) as { success: boolean; condition?: string; at: number; environment: string }; });
    assert(new Set(d.feedbackEvidenceIds).size === feedback.length && feedback.every(f => f.environment === d.environment), "INVALID_FEEDBACK");
    const successes = ev.candidate.filter(t => t.success).length + feedback.filter(f => f.success).length;
    const failures = ev.candidate.filter(t => !t.success).length + feedback.filter(f => !f.success).length;
    assert(d.successCount === successes && d.failureCount === failures && Math.abs(d.successRate - successes / (successes + failures)) < 1e-10, "INVALID_PROCEDURE_STATS");
    assert(d.failureConditions.every(c => ev.spec.failureConditions.includes(c) || feedback.some(f => !f.success && f.condition === c)), "UNSUPPORTED_FAILURE_CONDITION");
    assert(d.lastVerified === Math.max(e.occurredAt, ...feedback.map(f => f.at)), "UNSUPPORTED_VERIFICATION_TIME");
    if (target?.details?.kind === "procedure") assert(target.details.evaluationEvidenceId === d.evaluationEvidenceId, "REEVALUATION_NEEDS_NEW_PROCEDURE");
  } else assert(false, "INVALID_DETAILS_KIND");
}
