import type { Authority, Evidence, MemoryItem, Principal, Proposal } from "./types.js";
export type Decision = { allow: true; authority: Authority } | { allow: false; status: "rejected" | "review_required"; reason: string };
export function decide(principal: Principal, proposal: Proposal, evidence: Evidence[], target?: MemoryItem): Decision {
  const deny = (reason: string): Decision => ({ allow: false, status: "rejected", reason });
  const review = (reason: string): Decision => ({ allow: false, status: "review_required", reason });
  if (target?.authority === "user_explicit" && principal.actor !== "user") return deny("EXPLICIT_PROTECTED");
  if (principal.actor === "user") {
    if (!principal.capabilities.includes("explicit")) return deny("EXPLICIT_CAPABILITY_REQUIRED");
    if (!evidence.some((e) => e.source === "user-message")) return deny("USER_EVIDENCE_REQUIRED");
    return { allow: true, authority: "user_explicit" };
  }
  if (principal.actor === "migrator") {
    if (!principal.capabilities.includes("migrate") || evidence.some((e) => e.source !== "legacy")) return deny("MIGRATION_ONLY");
    return { allow: true, authority: "legacy" };
  }
  const external = evidence.some((e) => e.source === "browser");
  if (principal.actor === "aside" && !["knowledge", "procedural", "episodic"].includes(proposal.type)) return deny("ASIDE_CANNOT_WRITE_SELF");
  if (principal.actor === "consolidator" && principal.capabilities.includes("consolidate") && proposal.details?.kind === "atomic" && proposal.details.assertion === "stated" && evidence.every(e => e.source === "user-message")) return { allow: true, authority: "agent_inference" };
  if (principal.actor === "consolidator" && principal.capabilities.includes("evaluate") && proposal.type === "procedural" && proposal.details?.kind === "procedure") return { allow: true, authority: "agent_inference" };
  if (["semantic", "preference"].includes(proposal.type)) {
    return external ? deny("EXTERNAL_CANNOT_WRITE_SELF") : review("PERSONAL_INFERENCE_REQUIRES_CONFIRMATION");
  }
  if (proposal.type === "procedural") return review("MEASURED_PROCEDURE_GATE_REQUIRED");
  if (target != null && target.authority === "legacy") return review("LEGACY_BASELINE_PROTECTED");
  return { allow: true, authority: external ? "external" : "agent_inference" };
}
