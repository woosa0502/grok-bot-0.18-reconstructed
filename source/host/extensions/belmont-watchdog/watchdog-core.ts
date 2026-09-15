// Belmont v4 Host watchdog — pure decision core (HOOK-SPEC.md, 12 acceptance conditions).
//
// This module holds ZERO side effects and ZERO model calls. Given the current time,
// a snapshot of the active jobs, the limits config, and the set of event ids already
// emitted, it returns the NEW events to raise. The runtime shell (extension.ts) owns
// the timer, the jobs-dir read, turn-completion signals, persistence and the actual
// wake — this file owns only "given these facts, what is wrong and who to wake".
//
// Keeping the judgement pure is what makes the 12 conditions testable without a live host.

export type JobStatus =
  | "assigned"       // accepted, not yet started
  | "working"        // worker actively running / turns in progress
  | "has-result"     // result/files.json posted
  | "replied"        // worker reported back to the owner
  | "waiting-approval" // blocked on user/approval — never a stall
  | "cancelled";     // owner/user cancelled the job

export interface WatchdogJob {
  readonly jobId: string;
  /** Manager that owns the job ledger — wake target for unreported / stall / escalation. */
  readonly ownerId: string;
  /** For a Task, the creating parent (may differ from ownerId). Informational. */
  readonly parentId?: string;
  readonly workerId: string;
  readonly status: JobStatus;
  /** Absolute deadline = assignedAt + deadlines_minutes[category]. */
  readonly deadlineMs: number;
  readonly assignedAtMs: number;
  /** ms since worker turn last ended for this job (recordTurnCompleted); undefined = no turn ended yet. */
  readonly lastTurnEndedMs?: number;
  /** ms of the worker's last reply to the owner about this job. */
  readonly lastReplyMs?: number;
  /** out/.../files.json (or result.json) exists. */
  readonly hasResultFile: boolean;
  /** an active subagent / child run exists — not a stall. */
  readonly hasActiveChild: boolean;
  /** the worker has a next turn already scheduled (pending wake) — not a stall. */
  readonly nextTurnScheduled: boolean;
  /** an external side effect (order/send) whose outcome is unconfirmed. */
  readonly externalEffectUncertain: boolean;
}

export interface WatchdogLimits {
  readonly turnEndReplyGraceMs: number;   // host_watch.turn_end_reply_grace_seconds
  readonly overdueFollowupCount: number;   // on_overdue.followup (expected 1)
  readonly overdueEscalationAfterMs: number; // on_overdue.then_after_minutes
  readonly hardStopMultiple: number;       // hard_stop.multiple_of_deadline
  readonly hardStopMaxMs: number;          // hard_stop.max_minutes
}

export type WatchdogEventKind =
  | "result-pending-review" // cond 2: result posted, no reply
  | "unreported"            // cond 3: turn ended, no result, no reply
  | "overdue-followup"      // cond 8: past deadline (first nudge)
  | "overdue-escalation"    // cond 8: past deadline + grace (escalate to owner/Belmont)
  | "hard-stop"             // hard_stop: 2x deadline / max — needs cancel, not a nudge
  | "unknown-effect-hold";  // cond 10: external effect uncertain — stop, no auto-retry

export interface WatchdogEvent {
  readonly eventId: string;        // deterministic; idempotency key (cond 6)
  readonly kind: WatchdogEventKind;
  readonly jobId: string;
  readonly wakeTargetId: string;   // agent to wake
  readonly reason: string;
}

export interface WatchdogInput {
  readonly nowMs: number;
  readonly jobs: readonly WatchdogJob[];
  readonly limits: WatchdogLimits;
  /** event ids already emitted (persisted across restarts) — dedup / one-shot. */
  readonly emittedEventIds: ReadonlySet<string>;
}

const ev = (job: WatchdogJob, kind: WatchdogEventKind, target: string, reason: string): WatchdogEvent => ({
  eventId: `${job.jobId}:${kind}`, kind, jobId: job.jobId, wakeTargetId: target, reason,
});

/** True once the worker has genuinely reported back after its last turn ended. */
function hasRepliedSinceTurn(job: WatchdogJob): boolean {
  if (job.status === "replied") return true;
  if (job.lastReplyMs == null) return false;
  if (job.lastTurnEndedMs == null) return true; // replied, no later turn
  return job.lastReplyMs >= job.lastTurnEndedMs;
}

/** A job that is blocked or still progressing must never read as a stall (cond 4). */
function isProgressingOrBlocked(job: WatchdogJob): boolean {
  return job.status === "waiting-approval" || job.hasActiveChild || job.nextTurnScheduled;
}

/**
 * Evaluate one watchdog tick. Pure: returns the NEW events (those not already emitted).
 * The runtime only calls this when there is >=1 active job, so a normal-state tick with
 * nothing wrong returns [] and triggers zero model calls (cond 11).
 */
export function evaluateWatchdog(input: WatchdogInput): WatchdogEvent[] {
  const { nowMs, jobs, limits, emittedEventIds } = input;
  const out: WatchdogEvent[] = [];
  const push = (e: WatchdogEvent): void => { if (!emittedEventIds.has(e.eventId)) out.push(e); };

  for (const job of jobs) {
    // cond 5: a cancelled job never produces events (a late result is stored only).
    if (job.status === "cancelled") continue;

    // cond 10: an unconfirmed external effect halts — surface once, never auto-retry.
    if (job.externalEffectUncertain) {
      push(ev(job, "unknown-effect-hold", job.ownerId,
        "external effect (order/send) outcome unconfirmed — held, no auto-retry"));
      continue; // do not also nudge/stall a job in unknown-effect
    }

    const replied = hasRepliedSinceTurn(job);

    // Hard stop takes priority over softer overdue nudges.
    const hardStopAt = Math.min(
      job.assignedAtMs + (job.deadlineMs - job.assignedAtMs) * limits.hardStopMultiple,
      job.assignedAtMs + limits.hardStopMaxMs,
    );
    if (!replied && nowMs >= hardStopAt) {
      push(ev(job, "hard-stop", job.ownerId,
        `exceeded hard stop (${new Date(hardStopAt).toISOString()}) — cancel and report real state`));
      continue;
    }

    // cond 2: result file exists but no reply → "review/accept pending", once.
    if (job.hasResultFile && !replied) {
      push(ev(job, "result-pending-review", job.ownerId,
        "result files present but worker did not report back — review/accept pending"));
      // still allow overdue nudges below if also past deadline
    }

    // cond 3 + cond 4: turn ended, no result, no reply, and not blocked/progressing.
    if (!job.hasResultFile && !replied && job.lastTurnEndedMs != null
        && nowMs - job.lastTurnEndedMs >= limits.turnEndReplyGraceMs
        && !isProgressingOrBlocked(job)) {
      push(ev(job, "unreported", job.ownerId,
        "worker turn ended past grace with no result and no reply"));
    }

    // cond 7 + cond 8: overdue nudges, each one-shot; escalation after the extra grace.
    if (!replied && nowMs > job.deadlineMs) {
      push(ev(job, "overdue-followup", job.ownerId, "past deadline — first follow-up"));
      if (nowMs > job.deadlineMs + limits.overdueEscalationAfterMs) {
        push(ev(job, "overdue-escalation", job.ownerId, "still overdue after grace — escalate"));
      }
    }
  }
  return out;
}

/** Build the limits used by the core from the belmont-work control/limits.json shape. */
export function watchdogLimitsFromControl(limitsJson: any): WatchdogLimits {
  const hw = limitsJson?.host_watch ?? {};
  const od = limitsJson?.on_overdue ?? {};
  const hs = limitsJson?.hard_stop ?? {};
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    turnEndReplyGraceMs: num(hw.turn_end_reply_grace_seconds, 30) * 1000,
    overdueFollowupCount: num(od.followup, 1),
    overdueEscalationAfterMs: num(od.then_after_minutes, 5) * 60_000,
    hardStopMultiple: num(hs.multiple_of_deadline, 2),
    hardStopMaxMs: num(hs.max_minutes, 180) * 60_000,
  };
}
