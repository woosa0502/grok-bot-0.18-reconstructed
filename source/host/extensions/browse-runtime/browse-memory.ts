import type { ExperienceEnvelope } from "../memory/kernel/index.js";
import type { BrowseClientMemoryHooks, BrowseSessionView } from "./browse-client.js";

/** The host supplies identity. Aside only returns observations and candidate material. */
export interface BrowseMemoryFacade {
  isCanonical(): boolean;
  prepareAsideTask(input: { agentId: string; conversationId: string; task: string; domain?: string; environment?: string; context?: Record<string, string>; conditions?: string[] }): Promise<{ task: string; memoryContext?: object }>;
  validateAsideTask(context: object): unknown;
  ingestAsideOutcome(input: { agentId: string; conversationId: string; ownerKey: string; experience: ExperienceEnvelope; procedureId?: string; expectedEpoch?: number }): unknown;
  captureAsideObservation(input: { agentId: string; conversationId: string; ownerKey: string; eventId: string; at: number; content: string; expectedEpoch?: number }): void;
}

export function createBrowseMemoryHooks(
  memory: BrowseMemoryFacade,
  identity: { agentId: string; conversationId: () => string },
  log: (message: string) => void,
): BrowseClientMemoryHooks {
  const pending = new Map<string, Promise<void>>();
  const seen = new Set<string>();
  return {
    isCanonical: () => memory.isCanonical(),
    async validate(context) { await memory.validateAsideTask(context); },
    async prepare(task, metadata) {
      const conversationId = identity.conversationId();
      const prepared = await memory.prepareAsideTask({ ...metadata, agentId: identity.agentId, conversationId, task });
      // task is the current user instruction; memory has its own transport field.
      const context = { ...prepared.memoryContext, authority: "belmont" as const, version: 1 as const, agentId: identity.agentId, conversationId };
      await memory.validateAsideTask(context);
      return context;
    },
    async observe(view: BrowseSessionView) {
      const observation = view.memoryObservation;
      const binding = view.memoryContext;
      if (!memory.isCanonical() || !observation || binding?.authority !== "belmont") return;
      if (binding.agentId !== identity.agentId || binding.conversationId !== identity.conversationId() || typeof binding.ownerKey !== "string") return;
      const key = `${observation.eventId}:${String(observation.outcomeSource ?? "ungraded")}:${observation.experience ? "graded" : "observed"}`;
      if (seen.has(key)) return;
      const prior = pending.get(key);
      if (prior) return prior;
      const task = Promise.resolve().then(async () => {
        const scope = { agentId: identity.agentId, conversationId: binding.conversationId, ownerKey: binding.ownerKey as string, ...(typeof binding.expectedEpoch === "number" ? { expectedEpoch: binding.expectedEpoch } : {}) };
        const serialized = JSON.stringify(observation);
        // The kernel evidence limit is 64k; retain the complete bounded service
        // observation normally and make any oversized producer payload explicit.
        const content = serialized.length <= 63000 ? serialized : JSON.stringify({ eventId: observation.eventId, at: observation.at, status: observation.status, truncated: true, excerpt: serialized.slice(0, 55000) });
        memory.captureAsideObservation({ ...scope, eventId: key, at: observation.at, content });
        if (observation.experience) await memory.ingestAsideOutcome({ ...scope, experience: observation.experience, ...(binding.procedure?.id ? { procedureId: binding.procedure.id } : {}) });
        seen.add(key);
        // Canonical idempotency remains authoritative after this bounded delivery cache evicts.
        if (seen.size > 2048) seen.delete(seen.values().next().value!);
      }).catch(() => {
        log("[browse-runtime] Memory 2.1 outcome delivery deferred; canonical ingestion did not complete");
      }).finally(() => pending.delete(key));
      pending.set(key, task);
      await task;
    },
  };
}
