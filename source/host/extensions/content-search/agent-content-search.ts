import { DatabaseSync } from "node:sqlite";
import { buildFtsMatchQuery, FTS_TOKENIZER, INDEXED_BODY_MAX_CHARS, SNIPPET_CONTEXT_TOKENS } from "./content-search-query.js";

export const AGENT_CONTENT_SEARCH_MAX_MATCHES_PER_AGENT = 5;
export const AGENT_CONTENT_SEARCH_MAX_RESULTS = 50;
export type SearchableTranscriptEntry = { readonly id: string; readonly kind: "message"; readonly content: string; readonly role: "user" | "assistant"; readonly timestampMs?: number; readonly hiddenOutboundAgentPeerMessage?: boolean } | { readonly id: string; readonly kind: "send-message"; readonly message: { readonly type: string; readonly content?: string }; readonly timestampMs?: number; readonly hiddenOutboundAgentPeerMessage?: boolean } | { readonly id: string; readonly kind: "notice"; readonly text: string; readonly timestampMs?: number; readonly hiddenOutboundAgentPeerMessage?: boolean } | { readonly id: string; readonly kind: string; readonly timestampMs?: number; readonly hiddenOutboundAgentPeerMessage?: boolean };
export interface AgentContentMatch { readonly entryId: string; readonly role: "user" | "assistant"; readonly timestampMs: number; readonly snippet: string }
export function entrySearchText(entry: SearchableTranscriptEntry): string { switch (entry.kind) { case "message": return "content" in entry ? entry.content : ""; case "send-message": return "message" in entry && entry.message.type === "text" ? entry.message.content ?? "" : ""; case "notice": return "text" in entry ? entry.text : ""; default: return ""; } }
export function buildContentSnippet(text: string, normalizedQuery: string): string | null {
  return findAgentContentMatches([
    { id: "snippet", kind: "message", role: "user", content: text },
  ], normalizedQuery, 1)[0]?.snippet ?? null;
}

export function findAgentContentMatches(
  entries: readonly SearchableTranscriptEntry[],
  normalizedQuery: string,
  limit = AGENT_CONTENT_SEARCH_MAX_MATCHES_PER_AGENT,
): AgentContentMatch[] {
  const match = buildFtsMatchQuery(normalizedQuery);
  if (match == null || limit <= 0 || entries.length === 0) return [];
  // Use SQLite's tokenizer, including its Unicode/diacritic rules, rather than
  // approximating the persistent FTS index with a different JS text matcher.
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE VIRTUAL TABLE transcript_fts USING fts5(body, tokenize='${FTS_TOKENIZER}')`);
    const insert = db.prepare("INSERT INTO transcript_fts(rowid, body) VALUES (?, ?)");
    db.exec("BEGIN");
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry == null || entry.hiddenOutboundAgentPeerMessage === true) continue;
      const body = entrySearchText(entry).trim().slice(0, INDEXED_BODY_MAX_CHARS);
      if (body.length > 0) insert.run(index + 1, body);
    }
    db.exec("COMMIT");
    const rows = db.prepare(`SELECT rowid,
      snippet(transcript_fts, 0, '', '', '…', ${SNIPPET_CONTEXT_TOKENS}) AS snippet
      FROM transcript_fts WHERE transcript_fts MATCH ? ORDER BY rowid DESC LIMIT ?`)
      .all(match, limit) as { rowid: number; snippet: string }[];
    return rows.flatMap((row): AgentContentMatch[] => {
      const entry = entries[row.rowid - 1];
      return entry == null ? [] : [{
        entryId: entry.id,
        role: entry.kind === "message" && "role" in entry ? entry.role : "assistant",
        timestampMs: entry.timestampMs ?? 0,
        snippet: row.snippet.replace(/\s+/g, " ").trim(),
      }];
    });
  } finally {
    db.close();
  }
}
