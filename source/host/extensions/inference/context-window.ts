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

/**
 * Conservative default effective window for the Codex OAuth backend. The
 * catalog's nominal window (272k for gpt-5.x) is not what the backend honors —
 * live rejections land at ~55–83k — and trusting the catalog put the 0.9
 * compaction trigger at ~245k, unreachable, so long conversations died with
 * "input exceeds the context window" instead of compacting (A2, reproduced
 * live 2026-09-01). 50k keeps the proactive trigger (45k) under the LOWEST
 * observed rejection; an account with a larger real limit just compacts a bit
 * early, which costs a summary, never the conversation. Operators pin the
 * real value with the env above when they know it.
 */
export const CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS = 50_000;

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
  const catalog = modelContextWindow !== undefined && modelContextWindow > 0
    ? modelContextWindow
    : CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS;
  // Unpinned, the catalog value is only trusted DOWNWARD: a smaller advertised
  // window is real, a larger one is the unreachable-threshold trap above.
  const base = pinned ?? Math.min(catalog, CODEX_DEFAULT_EFFECTIVE_WINDOW_TOKENS);
  return cap !== undefined && base > cap ? cap : base;
}
