export const FTS_QUERY_MAX_TERMS = 8;
export const FTS_TOKENIZER = "unicode61 remove_diacritics 2";
export const SNIPPET_CONTEXT_TOKENS = 16;
export const INDEXED_BODY_MAX_CHARS = 20_000;

/** Preserve the indexed search syntax for both stored and in-memory messages. */
export function buildFtsMatchQuery(query: string): string | null {
  const terms = query.normalize("NFKC").trim().split(/\s+/).filter(Boolean)
    .slice(0, FTS_QUERY_MAX_TERMS);
  return terms.length === 0
    ? null
    : terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ");
}
