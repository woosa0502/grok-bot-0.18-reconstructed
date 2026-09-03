import { z } from "zod";
import { defineCommunicateTool } from "./communicate-tool.js";
import type { KnowledgeIndexLike } from "../knowledge-store.js";

export const SAND_KNOWLEDGE_SEARCH_TOOL_NAME = "knowledge_search";

const knowledgeSearchParameters = z.object({
  queries: z.array(z.string().trim().min(1)).max(5).optional().describe("Search phrases; a site's domain (naver.com, console.cloud.google.com) plus the task's key words works best. Results are OR-ed and ranked. Omit when using read_path."),
  max_results: z.number().int().min(1).max(20).optional().describe("How many pages to return (default 5)."),
  read_path: z.string().trim().min(1).optional().describe("Absolute path of a page returned by a previous search: returns its full content. Use this instead of Read — the store is host-only and Read refuses it."),
});
type KnowledgeSearchArgs = z.infer<typeof knowledgeSearchParameters>;

export interface KnowledgeSearchToolDependencies { readonly index: KnowledgeIndexLike; readonly readPage: (path: string) => string | null }

/** Read-only search over the user's knowledge store (sites/ playbooks, rules/, lessons/). */
export function createKnowledgeSearchTool(deps: KnowledgeSearchToolDependencies) {
  return defineCommunicateTool(deps, {
    id: "KNOWLEDGE_SEARCH", name: SAND_KNOWLEDGE_SEARCH_TOOL_NAME,
    description: [
      "Search the shared knowledge store (site playbooks with direct URLs and step procedures, browser-worker rules, lessons learned) before doing anything on a website.",
      "Returns ranked pages with an absolute path, the first matching line and an excerpt; pass read_path to get a page's full content (Read is refused for this store). Korean and English both work.",
    ].join(" "),
    parameters: knowledgeSearchParameters,
    describeActivity: (args: KnowledgeSearchArgs) => ({ detail: (args.read_path ?? (args.queries ?? []).join(" | ")).slice(0, 120) }),
    execute: async (_ctx, args: KnowledgeSearchArgs, runtime) => {
      if (args.read_path !== undefined) {
        const body = runtime.readPage(args.read_path);
        return body === null ? `Not a knowledge store page: ${args.read_path}` : body;
      }
      const queries = args.queries ?? [];
      if (queries.length === 0) return "Give at least one query, or read_path.";
      const hits = runtime.index.search({ queries, ...(args.max_results === undefined ? {} : { maxResults: args.max_results }) });
      if (hits.length === 0) return "No matching pages in the knowledge store.";
      return hits.map((h, i) => `${i + 1}. ${h.path}#L${h.line} — ${h.title}${h.date ? ` (${h.date})` : ""}\n${h.excerpt}`).join("\n\n");
    },
  });
}
