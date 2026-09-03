import { z } from "zod";
import { defineCommunicateTool } from "./communicate-tool.js";
import type { KnowledgeIndexLike } from "../knowledge-store.js";

export const SAND_KNOWLEDGE_SEARCH_TOOL_NAME = "knowledge_search";

const knowledgeSearchParameters = z.object({
  queries: z.array(z.string().trim().min(1)).min(1).max(5).describe("One or more search phrases; a site's domain (naver.com, console.cloud.google.com) plus the task's key words works best. Results are OR-ed and ranked."),
  max_results: z.number().int().min(1).max(20).optional().describe("How many pages to return (default 5)."),
});
type KnowledgeSearchArgs = z.infer<typeof knowledgeSearchParameters>;

export interface KnowledgeSearchToolDependencies { readonly index: KnowledgeIndexLike }

/** Read-only search over the user's knowledge store (sites/ playbooks, rules/, lessons/). */
export function createKnowledgeSearchTool(deps: KnowledgeSearchToolDependencies) {
  return defineCommunicateTool(deps, {
    id: "KNOWLEDGE_SEARCH", name: SAND_KNOWLEDGE_SEARCH_TOOL_NAME,
    description: [
      "Search the shared knowledge store (site playbooks with direct URLs and step procedures, browser-worker rules, lessons learned) before doing anything on a website.",
      "Returns ranked pages with an absolute path, the first matching line and an excerpt; open a promising hit with Read. Korean and English both work.",
    ].join(" "),
    parameters: knowledgeSearchParameters,
    describeActivity: (args: KnowledgeSearchArgs) => ({ detail: args.queries.join(" | ").slice(0, 120) }),
    execute: async (_ctx, args: KnowledgeSearchArgs, runtime) => {
      const hits = runtime.index.search({ queries: args.queries, ...(args.max_results === undefined ? {} : { maxResults: args.max_results }) });
      if (hits.length === 0) return "No matching pages in the knowledge store.";
      return hits.map((h, i) => `${i + 1}. ${h.path}#L${h.line} — ${h.title}${h.date ? ` (${h.date})` : ""}\n${h.excerpt}`).join("\n\n");
    },
  });
}
