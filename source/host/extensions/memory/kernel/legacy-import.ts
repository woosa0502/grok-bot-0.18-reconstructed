import { normalize } from "./text.js";
export interface LegacyFact { line: number; content: string; createdAt: number; kind: "profile" | "log" }
export interface LegacyInspection { facts: LegacyFact[]; issues: { line: number; reason: string }[] }
/** Matches the inspected Belmont dated-line format. Dry-run ONLY, never edits source Markdown. */
export function inspectLegacyMarkdown(raw: string, kind: "profile" | "log"): LegacyInspection {
  const facts: LegacyFact[] = [], issues: LegacyInspection["issues"] = [];
  let inComment = false;
  for (const [offset, text] of raw.split(/\r?\n/u).entries()) {
    const line = offset + 1, stripped = text.trim();
    if (stripped.startsWith("<!--")) { inComment = !stripped.includes("-->"); continue; }
    if (inComment) { if (stripped.includes("-->")) inComment = false; continue; }
    if (!stripped || /^#{1,6}\s/u.test(stripped)) continue;
    const match = /^-\s+\((\d{4}-\d{2}-\d{2})\)\s+(.+)$/u.exec(stripped);
    if (match == null) { issues.push({ line, reason: "UNRECOGNIZED_LINE" }); continue; }
    const date = match[1]!, content = normalize(match[2]!), createdAt = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString().slice(0, 10) !== date) { issues.push({ line, reason: "INVALID_DATE" }); continue; }
    if (content.length === 0 || content.length > 4000) { issues.push({ line, reason: "INVALID_CONTENT" }); continue; }
    facts.push({ line, content, createdAt, kind });
  }
  if (inComment) issues.push({ line: raw.split(/\r?\n/u).length, reason: "UNCLOSED_COMMENT" });
  return { facts, issues };
}
