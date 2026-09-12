import { assert } from "./types.js";
export interface ProcedureTrial {
  scenarioId: string; environment: string; success: boolean;
  criticalFailure: boolean; latencyMs: number; tokens: number;
}
export function wilson(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  assert(Number.isInteger(trials) && trials > 0 && Number.isInteger(successes) && successes >= 0 && successes <= trials, "INVALID_COUNTS");
  const p = successes / trials, denom = 1 + z * z / trials;
  const mid = (p + z * z / (2 * trials)) / denom;
  const half = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denom;
  return { low: Math.max(0, mid - half), high: Math.min(1, mid + half) };
}
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2; };
/** Conservative offline gate; trial outcomes must come from a trusted evaluator, not an LLM claim. */
export function evaluateProcedure(control: ProcedureTrial[], candidate: ProcedureTrial[], expectedEnvironment: string) {
  const no = (reason: string) => ({ accept: false as const, reason });
  if (control.length !== candidate.length || control.length === 0) return no("UNPAIRED_TRIALS");
  const c = new Map(control.map((r) => [r.scenarioId, r]));
  if (c.size !== control.length || new Set(candidate.map((r) => r.scenarioId)).size !== candidate.length || candidate.some((r) => !c.has(r.scenarioId))) return no("UNPAIRED_TRIALS");
  if ([...control, ...candidate].some((r) => r.environment !== expectedEnvironment)) return no("ENVIRONMENT_CHANGED");
  if ([...control, ...candidate].some((r) => !Number.isFinite(r.latencyMs) || r.latencyMs <= 0 || !Number.isFinite(r.tokens) || r.tokens <= 0)) return no("INVALID_MEASUREMENT");
  if (candidate.some((r) => r.criticalFailure)) return no("CRITICAL_FAILURE");
  if (candidate.length < 200) return no("NEEDS_MORE_TRIALS");
  const candidateRate = wilson(candidate.filter((r) => r.success).length, candidate.length);
  const controlRate = wilson(control.filter((r) => r.success).length, control.length);
  // Conservative interval-difference bound (does not exploit pairing correlation).
  const lowerDifference = candidateRate.low - controlRate.high;
  if (lowerDifference < -0.02) return no("SUCCESS_NONINFERIORITY_NOT_ESTABLISHED");
  const pairs = candidate.filter((r) => r.success && c.get(r.scenarioId)!.success);
  if (pairs.length < 100) return no("INSUFFICIENT_SUCCESSFUL_PAIRS");
  const latencyRatio = median(pairs.map((r) => r.latencyMs / c.get(r.scenarioId)!.latencyMs));
  const tokenRatio = median(pairs.map((r) => r.tokens / c.get(r.scenarioId)!.tokens));
  if (latencyRatio > 0.9 && tokenRatio > 0.9) return no("NO_MATERIAL_EFFICIENCY_GAIN");
  return { accept: true as const, reason: "OFFLINE_GATE_PASSED", lowerDifference, latencyRatio, tokenRatio, pairs: pairs.length };
}
