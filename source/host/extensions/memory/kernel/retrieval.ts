import type { MemorySession } from "./repository.js";
import type { MemoryType, SearchHit } from "./types.js";
import { assert } from "./types.js";
import { reciprocalRankFusion } from "./text.js";
import type { RankedCandidate, RankedChannel } from "./text.js";
export interface DenseProvider {
  /** Must pre-filter by scope in its own store. Returns IDs/version only, never trusted text. */
  search(input: { scope: string; query: string; limit: number; signal: AbortSignal }): Promise<RankedCandidate[]>;
}
export async function hybridSearch(session: MemorySession, input: {
  scope: string; query: string; dense?: DenseProvider; timeoutMs?: number; limit?: number;
  at: number; types?: MemoryType[];
}): Promise<{ hits: SearchHit[]; denseState: "unused" | "used" | "failed" }> {
  const limit = input.limit ?? 10;
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 100, "INVALID_LIMIT");
  const count = Math.min(200, Math.max(20, limit * 4));
  const sparse = session.search(input.scope, input.query, { limit: count, at: input.at, ...(input.types ? { types: input.types } : {}) });
  const channels: RankedChannel[] = [{ name: "sparse", weight: 1, candidates: sparse.map((h) => ({ id: h.item.id, version: h.item.version })) }];
  let denseState: "unused" | "used" | "failed" = "unused";
  if (input.dense != null) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("DENSE_TIMEOUT")); }, input.timeoutMs ?? 200);
      });
      const candidates = await Promise.race([input.dense.search({ scope: input.scope, query: input.query, limit: count, signal: controller.signal }), timeout]);
      assert(Array.isArray(candidates), "INVALID_DENSE_RESPONSE");
      channels.push({ name: "dense", weight: 1, candidates: candidates.slice(0, count).filter((c) => typeof c.id === "string" && Number.isSafeInteger(c.version)) });
      denseState = "used";
    } catch { denseState = "failed"; }
    finally { if (timer != null) clearTimeout(timer); controller.abort(); }
  }
  // Revalidate scope, version, revocation and validity AFTER asynchronous search.
  const hits = reciprocalRankFusion(channels).flatMap((candidate) => {
    const item = session.read(input.scope, candidate.id);
    if (item == null || item.version !== candidate.version || item.validFrom > input.at || item.validTo != null && item.validTo <= input.at || input.types != null && !input.types.includes(item.type)) return [];
    return [{ item, score: candidate.score, channels: candidate.channels }];
  }).slice(0, limit);
  return { hits, denseState };
}
export interface EvidencePacket {
  role: "untrusted_memory_data";
  memories: { id: string; version: number; content: string; authority: string; evidence: { id: string; source: string; quote: string }[] }[];
}
/** Tokenizer is supplied by the host model. Do not pretend character counts are real model tokens. */
export function buildEvidencePacket(session: MemorySession, scope: string, hits: SearchHit[], budget: number, countTokens: (text: string) => number): EvidencePacket {
  const packet: EvidencePacket = { role: "untrusted_memory_data", memories: [] };
  assert(Number.isInteger(budget) && budget > 0, "INVALID_BUDGET");
  assert(countTokens(JSON.stringify(packet)) <= budget, "BUDGET_TOO_SMALL");
  for (const hit of hits) {
    const current = session.read(scope, hit.item.id);
    if (current == null || current.version !== hit.item.version) continue;
    const evidence = current.evidenceIds.flatMap((id) => {
      const e = session.evidence(scope, id); return e?.content == null ? [] : [{ id, source: e.source, quote: e.content }];
    });
    if (evidence.length !== current.evidenceIds.length) continue;
    const entry = { id: current.id, version: current.version, content: current.content, authority: current.authority, evidence };
    packet.memories.push(entry);
    // Skip a whole oversize memory, rather than truncate away negations or numbers.
    if (countTokens(JSON.stringify(packet)) > budget) packet.memories.pop();
  }
  return packet;
}
/** Query expansion for known tool schemas only. These strings are search cues, NOT inferred facts. */
export function actionQueries(query: string, tool: string): string[] {
  const expansions: Record<string, string[]> = {
    flight_search: ["항공 좌석 선호 장거리 통로석 창가", "비행 예산 일정 제약"],
    hotel_search: ["호텔 숙소 위치 조용함 가격 선호", "여행 숙박 제약"],
    code_change: ["프로젝트 코딩 규칙 테스트 결정"],
  };
  return [query, ...(expansions[tool] ?? [])];
}
