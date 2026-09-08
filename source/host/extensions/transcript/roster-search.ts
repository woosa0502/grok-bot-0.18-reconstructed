import { getTranscript } from "./transcript-store.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

export interface TranscriptSearchResult {
  agentId: string;
  entryId: string;
  role: string;
  timestampMs: number;
  snippet: string;
}

export class RosterSearch {
  constructor(readonly tm: TranscriptManagerLike) {}

  async searchAgents(
    query: string,
    limit = this.tm.contentSearch.maxResults,
  ): Promise<TranscriptSearchResult[]> {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0 || limit <= 0) return [];
    if (this.tm.contentSearch.isSearchReady) {
      const liveAgentId = this.tm.sessions.inMemoryTranscriptAgentId;
      const liveEntries = liveAgentId == null ? [] : getTranscript();
      const excludedAgentIds = new Set<string>(liveAgentId == null ? [] : [liveAgentId]);
      let indexed: TranscriptSearchResult[] | null;
      // Deletion and index cleanup are asynchronous. Refill only when stale
      // agent hits consumed the SQL limit, excluding them before the next LIMIT.
      // This avoids opening every agent DB to build a roster on each search.
      for (;;) {
        indexed = await this.tm.contentSearch.searchMessages({
          query: normalized,
          limit,
          excludedAgentIds: [...excludedAgentIds],
        });
        if (indexed == null) break;
        const previousExcludedCount = excludedAgentIds.size;
        for (const match of indexed) {
          if (!this.tm.sessionStore.agentExists(match.agentId)) {
            excludedAgentIds.add(match.agentId);
          }
        }
        if (excludedAgentIds.size === previousExcludedCount) break;
      }
      if (indexed != null) {
        const results: TranscriptSearchResult[] = indexed.filter(
          (match: TranscriptSearchResult) =>
            match.agentId !== liveAgentId &&
            this.tm.sessionStore.agentExists(match.agentId),
        );
        if (liveAgentId != null) {
          const newestLiveMs =
            liveEntries.reduce(
              (newest, entry) => Math.max(newest, entry.timestampMs ?? 0),
              0,
            ) || Date.now();
          for (const match of this.tm.contentSearch.findTranscriptMatches(
            liveEntries,
            normalized,
          )) {
            results.push({
              agentId: liveAgentId,
              entryId: match.entryId,
              role: match.role,
              timestampMs:
                match.timestampMs > 0 ? match.timestampMs : newestLiveMs,
              snippet: match.snippet,
            });
          }
        }
        return results
          .sort((left, right) => right.timestampMs - left.timestampMs)
          .slice(0, limit);
      }
    }
    return this.searchAgentsByLinearScan(normalized, limit);
  }

  async searchAgentsByLinearScan(
    normalized: string,
    limit: number,
  ): Promise<TranscriptSearchResult[]> {
    const activeId = this.tm.getActiveAgentId();
    const agents = await this.tm.sessionStore.listAgents(activeId ?? undefined);
    const results: TranscriptSearchResult[] = [];
    for (const agent of agents) {
      const entries =
        activeId != null && agent.id === activeId
          ? getTranscript()
          : this.tm.sessionStore.readAgentTranscriptEntries(agent.id);
      for (const match of this.tm.contentSearch.findTranscriptMatches(
        entries,
        normalized,
      )) {
        results.push({
          agentId: agent.id,
          entryId: match.entryId,
          role: match.role,
          timestampMs:
            match.timestampMs > 0 ? match.timestampMs : agent.updatedAt,
          snippet: match.snippet,
        });
      }
    }
    return results
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .slice(0, limit);
  }

  async searchMedia(
    query: string,
    limit = this.tm.contentSearch.maxResults,
  ): Promise<any[]> {
    if (!this.tm.contentSearch.isSearchReady) return [];
    const matches = await this.tm.contentSearch.searchMedia({
      query: query.trim(),
      limit,
    });
    if (matches == null) return [];
    return matches.filter((match: any) =>
      this.tm.sessionStore.agentExists(match.agentId),
    );
  }
}
