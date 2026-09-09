/**
 * Runs shutdown/startup-rollback cleanup steps so that one failing or hanging step never skips the
 * steps after it. Every step is attempted; failures are reported per step and aggregated so the
 * caller can choose a truthful exit status instead of exiting 0 after a partial cleanup.
 */
export interface CleanupStep {
  readonly name: string;
  readonly run: () => Promise<unknown> | unknown;
}

export interface CleanupOutcome {
  readonly name: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly error?: unknown;
  readonly timedOut?: boolean;
}

export interface CleanupReport {
  readonly outcomes: readonly CleanupOutcome[];
  readonly failed: readonly CleanupOutcome[];
}

export class CleanupStepTimeoutError extends Error {
  constructor(readonly step: string, readonly timeoutMs: number) {
    super(`cleanup step "${step}" did not finish within ${timeoutMs}ms`);
    this.name = "CleanupStepTimeoutError";
  }
}

export interface RunCleanupOptions {
  /** Per-step budget; a step that overruns is recorded as failed (timedOut) and the next step starts. */
  readonly stepTimeoutMs?: number;
  readonly onFailure?: (outcome: CleanupOutcome) => void;
  readonly now?: () => number;
}

export async function runCleanupSteps(steps: readonly CleanupStep[], options: RunCleanupOptions = {}): Promise<CleanupReport> {
  const now = options.now ?? (() => Date.now());
  const outcomes: CleanupOutcome[] = [];
  for (const step of steps) {
    const startedAt = now();
    let outcome: CleanupOutcome;
    try {
      await withTimeout(step, options.stepTimeoutMs);
      outcome = { name: step.name, ok: true, durationMs: now() - startedAt };
    } catch (error) {
      outcome = {
        name: step.name,
        ok: false,
        durationMs: now() - startedAt,
        error,
        ...(error instanceof CleanupStepTimeoutError ? { timedOut: true } : {}),
      };
      options.onFailure?.(outcome);
    }
    outcomes.push(outcome);
  }
  return { outcomes, failed: outcomes.filter(outcome => !outcome.ok) };
}

async function withTimeout(step: CleanupStep, timeoutMs: number | undefined): Promise<void> {
  const work = Promise.resolve().then(() => step.run());
  if (timeoutMs === undefined || !(timeoutMs > 0)) { await work; return; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CleanupStepTimeoutError(step.name, timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A step that overran keeps running in the background; its late rejection must not surface as unhandled.
    work.catch(() => undefined);
  }
}

/** Splits an overall watchdog budget across steps, keeping a floor so a single slow step still gets a fair share. */
export function perStepTimeout(totalMs: number, stepCount: number, floorMs = 500): number {
  if (stepCount <= 0) return totalMs;
  return Math.max(floorMs, Math.floor(totalMs / stepCount));
}
