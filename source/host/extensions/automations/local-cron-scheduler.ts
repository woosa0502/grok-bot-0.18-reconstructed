import type { PollingPolicy } from "../../../internal/scheduling.js";
import { automationAnchor, computeNextRunAt } from "../../../shared/automation-schedule.js";
import { triggerList, type AutomationTrigger } from "../../../shared/automations.js";

// Local clock for cron routines (AUDIT-7 / parity A9).
//
// Upstream computes the next run on the Cursor backend and posts a "fire" that the
// box only executes. Without a Cursor account nothing ever fires, although the
// parser (`computeNextRunAt`), the run ledger and the wake prompt all run locally.
// This scheduler adds the missing clock: every tick it derives each enabled cron
// routine's next run from its persisted anchor (`lastRunAt ?? createdAt`) and fires
// through the same server-scheduled entry point a cloud fire would use, so the run
// history, in-flight dedupe and transcript card are identical. Cloud-owned routines
// (backend evidence says the backend runs them) are left alone.
//
// Restart / sleep recovery: a due time in the past fires once (catch-up) unless it
// is older than `staleAfterMs` (default 6h); then the routine is re-anchored to now
// so a machine that was off for a week does not replay a week-old digest.

export interface LocalSchedulableAutomation {
  readonly id?: string;
  readonly isEnabled: boolean;
  readonly trigger: AutomationTrigger;
  readonly createdAt: number;
  readonly lastRunAt?: number | null;
}

export interface LocalCronSchedulerDeps<Automation extends LocalSchedulableAutomation = LocalSchedulableAutomation> {
  readonly polling: PollingPolicy;
  listAutomations(): Promise<readonly { agentId: string; automation: Automation }[]>;
  fire(agentId: string, automation: Automation, dueAt: number): Promise<unknown>;
  isReady(): boolean | Promise<boolean>;
  shouldScheduleLocally(args: { agentId: string; automation: Automation }): boolean;
  getTimeZone(): string | undefined;
  readonly now?: () => number;
  readonly staleAfterMs?: number;
  readonly log?: (message: string) => void;
}

export const LOCAL_CRON_TICK_INTERVAL_MS = 30_000;
export const LOCAL_CRON_STALE_AFTER_MS = 6 * 60 * 60 * 1_000;

export function cronSchedulesOf(trigger: AutomationTrigger): string[] {
  return triggerList(trigger).flatMap((member) => member.type === "cron" ? [member.schedule] : []);
}

export type LocalCronDecision =
  | { readonly kind: "fire"; readonly dueAt: number }
  | { readonly kind: "wait"; readonly dueAt: number }
  | { readonly kind: "stale"; readonly dueAt: number }
  | { readonly kind: "none" };

/** Pure: what to do for one routine at `now`, given the persisted anchor and the local override. */
export function decideLocalCronRun(args: {
  readonly schedules: readonly string[];
  readonly anchorMs: number;
  readonly now: number;
  readonly timeZone: string | undefined;
  readonly staleAfterMs: number;
}): LocalCronDecision {
  let earliest: number | undefined;
  for (const schedule of args.schedules) {
    const due = computeNextRunAt(schedule, args.anchorMs, args.timeZone);
    if (due != null && (earliest === undefined || due < earliest)) earliest = due;
  }
  if (earliest === undefined) return { kind: "none" };
  if (earliest > args.now) return { kind: "wait", dueAt: earliest };
  if (args.now - earliest > args.staleAfterMs) return { kind: "stale", dueAt: earliest };
  return { kind: "fire", dueAt: earliest };
}

export class LocalCronScheduler<Automation extends LocalSchedulableAutomation = LocalSchedulableAutomation> {
  readonly #deps: LocalCronSchedulerDeps<Automation>;
  readonly #localAnchors = new Map<string, number>();
  readonly #inFlight = new Set<string>();
  // Dispatch-failure retry state (strict-review P1-05): a failed fire used to
  // leave the anchor advanced, silently skipping the slot until its next
  // scheduled time. Now the slot is restored and retried with a growing hold;
  // the stale guard (6h) still bounds how long a slot is retried.
  readonly #fireFailures = new Map<string, number>();
  readonly #retryHoldUntil = new Map<string, number>();
  #timer: { dispose(): void } | undefined;
  #stopped = false;
  #ticking: Promise<void> = Promise.resolve();

  constructor(deps: LocalCronSchedulerDeps<Automation>) {
    this.#deps = deps;
  }

  start(): void {
    if (this.#timer != null) return;
    this.#stopped = false;
    this.#timer = this.#deps.polling.start(async () => { await this.tick(); });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#timer?.dispose();
    this.#timer = undefined;
    await this.#ticking;
  }

  /** One scheduling pass; safe to call directly (tests, "run now" hooks). */
  tick(): Promise<void> {
    const pass = this.#ticking.then(() => this.#pass()).catch((error: unknown) => {
      this.#deps.log?.(`[local-cron] tick failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.#ticking = pass;
    return pass;
  }

  async #pass(): Promise<void> {
    if (this.#stopped || !(await this.#deps.isReady())) return;
    const now = this.#deps.now?.() ?? Date.now();
    const staleAfterMs = this.#deps.staleAfterMs ?? LOCAL_CRON_STALE_AFTER_MS;
    const timeZone = this.#deps.getTimeZone();
    const seen = new Set<string>();
    for (const { agentId, automation } of await this.#deps.listAutomations()) {
      if (this.#stopped) return;
      if (!automation.isEnabled || automation.id === undefined) continue;
      const schedules = cronSchedulesOf(automation.trigger);
      if (schedules.length === 0) continue;
      if (!this.#deps.shouldScheduleLocally({ agentId, automation })) continue;
      const key = `${agentId}:${automation.id}`;
      seen.add(key);
      if (this.#inFlight.has(key)) continue;
      const anchorMs = Math.max(automationAnchor(automation), this.#localAnchors.get(key) ?? 0);
      const decision = decideLocalCronRun({ schedules, anchorMs, now, timeZone, staleAfterMs });
      if (decision.kind === "stale") {
        this.#deps.log?.(`[local-cron] ${key}: missed run at ${new Date(decision.dueAt).toISOString()} is older than ${Math.round(staleAfterMs / 60_000)} min; re-anchoring to now`);
        this.#localAnchors.set(key, now);
        this.#fireFailures.delete(key);
        this.#retryHoldUntil.delete(key);
        continue;
      }
      if (decision.kind !== "fire") continue;
      const holdUntil = this.#retryHoldUntil.get(key);
      if (holdUntil !== undefined && now < holdUntil) continue;
      this.#localAnchors.set(key, decision.dueAt);
      this.#inFlight.add(key);
      void Promise.resolve()
        .then(() => this.#deps.fire(agentId, automation, decision.dueAt))
        .then(() => { this.#fireFailures.delete(key); this.#retryHoldUntil.delete(key); })
        .catch((error: unknown) => {
          const failures = (this.#fireFailures.get(key) ?? 0) + 1;
          this.#fireFailures.set(key, failures);
          // Put the slot back so it retries, held off by a growing backoff. Once
          // the slot ages past staleAfterMs the stale branch re-anchors it.
          this.#localAnchors.set(key, decision.dueAt - 1);
          this.#retryHoldUntil.set(key, (this.#deps.now?.() ?? Date.now()) + Math.min(failures, 10) * 60_000);
          this.#deps.log?.(`[local-cron] ${key}: fire failed (attempt ${failures}, will retry): ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => { this.#inFlight.delete(key); });
    }
    for (const key of [...this.#localAnchors.keys()]) {
      if (seen.has(key) || this.#inFlight.has(key)) continue;
      this.#localAnchors.delete(key);
      this.#fireFailures.delete(key);
      this.#retryHoldUntil.delete(key);
    }
  }
}
