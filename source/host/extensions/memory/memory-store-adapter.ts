import { randomUUID } from "node:crypto";
import type { FileMemoryStore, MemoryKind, MemoryRecord } from "./memory-service.js";
import type { BelmontMemoryLearningRuntime } from "./memory-learning-runtime.js";
import type { MemoryItem } from "./kernel/index.js";
import { normalizeMemoryContent, memoryDedupeKey, MEMORY_PROFILE_PROMPT_LIMIT } from "../../runner/sand-memory.js";
import type { MemoryRuntimeStore } from "../../runner/memory-runtime-hooks.js";

export function legacyMemoryView(item: MemoryItem): MemoryRecord {
  return { id: item.id, content: item.content, createdAt: item.validFrom, kind: ["semantic", "preference"].includes(item.type) ? "profile" : "log" };
}

export function writeCanonicalMemory(runtime: BelmontMemoryLearningRuntime, memoryDir: string, input: {
  content: string; createdAt: number; kind: MemoryKind; confirmedByUser: boolean; requestId?: string;
}): MemoryRecord | null {
  runtime.assertWritable();
  const content = normalizeMemoryContent(input.content);
  if (!content) return null;
  if (runtime.list(memoryDir).some((item) => memoryDedupeKey(item.content) === memoryDedupeKey(content))) return null;
  const { scope, session } = runtime.session(memoryDir, input.confirmedByUser ? "user" : "agent");
  const eventId = input.requestId ?? randomUUID();
  const evidence = session.capture({ scope, source: input.confirmedByUser ? "user-message" : "assistant", sourceRef: `facade:${eventId}`, content,
    occurredAt: input.createdAt, expectedEpoch: session.snapshot(scope).epoch });
  const result = session.propose({ scope, type: input.kind === "profile" ? "semantic" : "episodic", content, validFrom: input.createdAt,
    evidenceIds: [evidence.id], idempotencyKey: `facade:${eventId}`, basedOn: session.snapshot(scope) });
  if (result.status !== "committed") throw new Error(`Memory proposal ${result.status}: ${result.reason}`);
  runtime.changed(scope);
  return { id: result.id, content, createdAt: input.createdAt, kind: input.kind };
}

/** Dynamic façade keeps already materialized sessions on the same writer after the rollout state changes.
 * The legacy object's private implementation is always bound to its original instance.
 */
export function routeMemoryStore(legacy: FileMemoryStore, runtime: BelmontMemoryLearningRuntime, agentId: string): FileMemoryStore & MemoryRuntimeStore {
  let unsubscribe: (() => void) | undefined;
  const records = () => runtime.list(legacy.memoryDir).map(legacyMemoryView).sort((a, b) => Number(b.kind === "profile") - Number(a.kind === "profile") || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const canonical: Record<string, unknown> = {
    getLocation: () => null,
    recall: (recentLimit = 20) => { const all = records(); return { profile: all.filter((m) => m.kind === "profile").slice(0, MEMORY_PROFILE_PROMPT_LIMIT), recent: all.filter((m) => m.kind === "log").slice(0, Math.max(0, Math.floor(recentLimit))) }; },
    listMemories: (limit = 100) => records().slice(0, Math.max(0, Math.floor(limit))),
    countMemories: () => records().length,
    hasMemories: () => records().length > 0,
    // update_state's legacy origin="explicit" was an agent marker, not authenticated user consent.
    addMemory: (content: string, createdAt: number, kind: MemoryKind) => writeCanonicalMemory(runtime, legacy.memoryDir, { content, createdAt, kind, confirmedByUser: false }),
    removeMemory: () => { throw new Error("MEMORY_FORGET_REQUIRES_AUTHENTICATED_USER_UI"); },
    removeMemoryByContent: () => { throw new Error("MEMORY_FORGET_REQUIRES_AUTHENTICATED_USER_UI"); },
    clearMemories: () => { throw new Error("MEMORY_FORGET_REQUIRES_AUTHENTICATED_USER_UI"); },
    prepareSynthesis: () => ({ fingerprint: runtime.memoryContextKey(agentId), memories: records().map((m) => ({ ...m, origin: "legacy" })) }),
    applySynthesis: () => { throw new Error("LEGACY_SYNTHESIS_DISABLED_FOR_CANONICAL_MEMORY"); },
    isTemporalReviewDue: () => false,
    markTemporalReview: () => {},
    // Capture happens at the authenticated send boundary; settle must not capture an LLM-expanded prompt again.
    recordMemoryEvidence: (_evidence: unknown) => {},
  };
  const hooks: MemoryRuntimeStore = {
    isCanonicalMemory: () => runtime.isCanonical(),
    prepareMemoryTurn: (input) => runtime.prepareMemoryTurn({ ...input, agentId }),
    getMemoryContext: (input) => runtime.getMemoryContext({ agentId, conversationId: input?.conversationId ?? agentId, ...(input?.requestId ? { requestId: input.requestId } : {}) }),
    memoryContextKey: () => runtime.memoryContextKey(agentId),
  };
  return new Proxy(legacy, {
    get(target, key) {
      if (key === "setOnChange") return (listener?: (() => void) | null) => {
        unsubscribe?.(); unsubscribe = undefined;
        target.setOnChange(listener ? () => { if (!runtime.isCanonical()) listener(); } : null);
        // A materialized legacy session must receive canonical events after cutover too.
        if (listener) unsubscribe = runtime.subscribe(() => { if (runtime.isCanonical()) listener(); });
      };
      // Keep the old persisted-prompt contract in legacy mode; no revision hook is exposed until canonical.
      if (key in hooks) return runtime.isCanonical() || runtime.stage === "shadow-read" ? hooks[key as keyof MemoryRuntimeStore] : undefined;
      if (runtime.isCanonical() && typeof key === "string" && key in canonical) return canonical[key];
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as FileMemoryStore & MemoryRuntimeStore;
}
