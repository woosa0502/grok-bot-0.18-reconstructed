/**
 * Passive SKILL.md metadata. Phase 1 deliberately does not enforce these fields.
 * They are not authorization checks and must not replace AgentWorkflowEnablement.
 */
export interface WorkflowScopeFields {
  globs?: readonly string[];
  environments?: readonly string[];
  scoped_to?: readonly string[];
}

const SCOPE_KEYS = ["globs", "environments", "scoped_to"] as const;

/**
 * Accept arrays only; ignore malformed entries without rejecting the skill.
 * Keep a missing field distinct from an explicit empty list. Strings are trimmed
 * and deduplicated in insertion order; inputs (including parsed.data) are untouched.
 * No glob compilation, environment lookup, or agent lookup happens here.
 */
export function readWorkflowScopeFields(value: unknown): WorkflowScopeFields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const data = value as Record<string, unknown>;
  const result: WorkflowScopeFields = {};
  for (const key of SCOPE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const input = data[key];
    if (!Array.isArray(input)) continue;
    const seen = new Set<string>();
    for (const item of input) {
      if (typeof item !== "string") continue;
      const text = item.trim();
      if (text.length > 0) seen.add(text);
    }
    result[key] = [...seen];
  }
  return result;
}
