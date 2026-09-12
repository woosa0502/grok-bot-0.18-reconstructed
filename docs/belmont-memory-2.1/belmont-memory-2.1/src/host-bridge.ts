import type { MemorySession } from "./repository.js";
import type { Proposal } from "./types.js";
/** Integration example, not a replacement for FileMemoryStore's entire legacy interface. */
export class BelmontMemoryBridge {
  constructor(private readonly userUI: MemorySession, private readonly agent: MemorySession) {}
  /** Call ONLY from the host's authenticated, explicitly confirmed memory form/message route. */
  confirmedRemember(input: { scope: string; content: string; kind: "profile" | "log"; messageId: string; occurredAt: number }) {
    const evidence = this.userUI.capture({ scope: input.scope, content: input.content, source: "user-message", sourceRef: input.messageId, occurredAt: input.occurredAt, expectedEpoch: this.userUI.snapshot(input.scope).epoch });
    return this.userUI.propose({ scope: input.scope, type: input.kind === "profile" ? "semantic" : "episodic", content: input.content, evidenceIds: [evidence.id], idempotencyKey: `remember:${input.messageId}`, basedOn: this.userUI.snapshot(input.scope) });
  }
  /** update_state must use this channel, NOT confirmedRemember. */
  agentProposal(proposal: Proposal) { return this.agent.propose(proposal); }
  listLegacyView(scope: string) {
    return this.userUI.list(scope).map((item) => ({ id: item.id, content: item.content, createdAt: item.recordedAt, kind: ["semantic", "preference"].includes(item.type) ? "profile" as const : "log" as const }));
  }
}
