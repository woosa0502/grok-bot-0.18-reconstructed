// Effective context window reported to the summarization orchestrator.
//
// Pi's model catalog advertises the model's nominal context window (e.g. 272k
// for gpt-5.x). The Codex OAuth backend has been observed to reject inputs well
// below that ("input exceeds the context window" at ~55-83k tokens — AUDIT-6B),
// which makes the pre-emptive compaction threshold unreachable. The operator can
// pin the effective window with `SAND_CODEX_CONTEXT_WINDOW_TOKENS`; the value is
// also capped by `SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS` when set. Invalid values
// are ignored so a typo never disables compaction.

export const CODEX_CONTEXT_WINDOW_ENV = "SAND_CODEX_CONTEXT_WINDOW_TOKENS";
export const CODEX_CONTEXT_WINDOW_MAX_ENV = "SAND_CODEX_CONTEXT_WINDOW_MAX_TOKENS";

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function effectiveContextWindowTokens(
  modelContextWindow: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const pinned = parsePositiveInt(env[CODEX_CONTEXT_WINDOW_ENV]);
  const cap = parsePositiveInt(env[CODEX_CONTEXT_WINDOW_MAX_ENV]);
  const base = pinned ?? (modelContextWindow !== undefined && modelContextWindow > 0 ? modelContextWindow : 0);
  return cap !== undefined && base > cap ? cap : base;
}
