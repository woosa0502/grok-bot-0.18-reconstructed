// Belmont v4 Host watchdog — runtime orchestrator around the pure core.
//
// Dependencies are INJECTED (clock, job snapshot, persistence, wake, enable gate) so the
// tick loop is testable without a live host and so the host extension only has to supply
// the real bindings. The pure judgement lives in watchdog-core; this file owns the
// side-effecting orchestration: gate -> snapshot -> evaluate -> wake -> persist.

import {
  evaluateWatchdog,
  type WatchdogEvent,
  type WatchdogJob,
  type WatchdogLimits,
} from "./watchdog-core.js";

export interface WatchdogDeps {
  /** feature flag — default OFF; the watchdog is inert until the operator enables it. */
  readonly isEnabled: () => boolean;
  readonly now: () => number;
  /** active jobs only (status !== cancelled/replied is the caller's filter); [] => idle tick. */
  readonly listActiveJobs: () => readonly WatchdogJob[];
  readonly limits: () => WatchdogLimits;
  /** persisted emitted event ids (survives host restart — cond 9). */
  readonly loadEmittedIds: () => Set<string>;
  readonly saveEmittedIds: (ids: Set<string>) => void;
  /** deliver one event to its wake target (agent inbound / background wake). */
  readonly wake: (event: WatchdogEvent) => void;
  readonly log?: (message: string) => void;
}

export interface WatchdogTickResult {
  readonly ran: boolean;      // false when disabled or idle (=> zero model calls, cond 11)
  readonly woke: number;      // events dispatched this tick
}

export class BelmontWatchdog {
  constructor(private readonly deps: WatchdogDeps) {}

  /** One watchdog tick. Pure-core decides; this dispatches wakes and persists dedup ids. */
  tick(): WatchdogTickResult {
    if (!this.deps.isEnabled()) return { ran: false, woke: 0 };
    const jobs = this.deps.listActiveJobs();
    if (jobs.length === 0) return { ran: false, woke: 0 }; // idle: nothing scanned, no wakes

    const emitted = this.deps.loadEmittedIds();
    const events = evaluateWatchdog({
      nowMs: this.deps.now(), jobs, limits: this.deps.limits(), emittedEventIds: emitted,
    });
    if (events.length === 0) return { ran: true, woke: 0 };

    for (const event of events) {
      try {
        this.deps.wake(event);
        emitted.add(event.eventId);
      } catch (error) {
        this.deps.log?.(`watchdog wake failed for ${event.eventId}: ${String(error)}`);
        // do NOT add to emitted on failure, so a transient wake error is retried next tick
      }
    }
    this.deps.saveEmittedIds(emitted);
    return { ran: true, woke: events.length };
  }

  /** Prune persisted ids for jobs that are no longer active (keeps the ledger bounded). */
  static pruneEmitted(emitted: Set<string>, activeJobIds: ReadonlySet<string>): Set<string> {
    const kept = new Set<string>();
    for (const id of emitted) {
      const jobId = id.slice(0, id.lastIndexOf(":"));
      if (activeJobIds.has(jobId)) kept.add(id);
    }
    return kept;
  }
}
