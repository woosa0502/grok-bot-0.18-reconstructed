import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { getSandRootDir } from "../../host-paths.js";

/**
 * Per-model-call token metering (Belmont v4). This is a SEPARATE, best-effort observability
 * ledger — it never affects inference. It is written once per completed model request from the
 * pi-codex path, tagged with the acting bot / conversation / purpose fixed by the upper layer
 * (turn-run-shell) so a report tool can aggregate tokens by bot, model, and purpose.
 *
 * Design contract:
 * - Single-writer append of newline-delimited JSON to <sandRoot>/usage-ledger.jsonl.
 * - A write failure MUST NOT propagate into the model path (all writes are guarded here).
 * - Only IDs, model names, token counts and timings are recorded — never prompt/reasoning
 *   text, tool arguments, or credentials.
 * - Raw token fields are recorded as the provider reports them; derivations (total input =
 *   uncached + cacheRead + cacheWrite; reasoning is a SUBSET of output, not additive) are left
 *   to the report tool to avoid double counting.
 */

/** Immutable attribution fixed by the upper execution layer (turn-run-shell). */
export interface UsageMeteringContext {
  /** The bot/session that ran this turn (conversation id for top-level turns). */
  readonly actorId: string;
  /** The owning top-level bot; null for subagent runners. */
  readonly ownerAgentId: string | null;
  readonly conversationId: string;
  /** The host request id that opened this turn. */
  readonly hostRequestId: string;
  /** One id per turn run; a turn can make several model calls (tool round-trips + summary). */
  readonly turnRunId: string;
  /** "agent" = normal bot turn, "summary" = context compaction, "auxiliary" = helper call. */
  readonly purpose: "agent" | "summary" | "auxiliary";
  /** For a Task subagent turn: the parent bot's agent id (null when not a subagent / unknown). */
  readonly parentActorId?: string | null;
  /** For a subagent turn: the parent's host request id, from the dispatch lineage. */
  readonly parentRequestId?: string | null;
  /** For a subagent turn: this child subagent's own agent id. */
  readonly childAgentId?: string | null;
  /** Job tags fixed at request receipt ([job:<id>]). Empty/absent when none or unattributable. */
  readonly jobIds?: readonly string[];
}

export interface UsageLedgerEntry extends UsageMeteringContext {
  readonly schemaVersion: 1;
  readonly ts: number;
  readonly eventId: string;
  readonly callId: string;
  readonly invocationId: string;
  readonly responseId: string | null;
  readonly provider: string;
  readonly requestedModel: string | null;
  readonly resolvedModel: string | null;
  readonly responseModel: string | null;
  readonly requestedEffort: string | null;
  /**
   * Uncached input as the Pi adapter reports it (cache read/write are EXCLUDED from this).
   * null on error/abort rows where usage never arrived (NOT 0 — usage is unknown).
   */
  readonly inputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly outputTokens: number | null;
  /** Reasoning tokens — a SUBSET of outputTokens. null when the provider did not report them. */
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  readonly usageSource: string;
  readonly startedAt: number | null;
  readonly endedAt: number;
  /** "ok" | "error" | "aborted". */
  readonly status: string;
}

function ledgerPath(): string {
  return join(getSandRootDir(), "usage-ledger.jsonl");
}

/** Append one metering entry. Never throws — a metering failure must not touch inference. */
export function recordUsageLedgerEntry(entry: UsageLedgerEntry): void {
  try {
    appendFileSync(ledgerPath(), JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort only. Swallow disk/permission errors; do not log at error level per call.
  }
}

/* ------------------------------------------------------------------------- *
 * job-id (task) attribution — approach "B" (GPT Pro consult 2026-09-14).
 *
 * The usage ledger above already groups every model call of a turn by turnRunId.
 * We keep it UNCHANGED and, in a SEPARATE side file (job-bindings.jsonl), record
 * one row per turn: turnRunId -> the [job:<id>] tags parsed from the ORIGINAL
 * message (before any [agent]/system wrapper is prepended). A report tool joins
 * the two files on turnRunId. hostRequestId is NOT a safe join key (subagents
 * reuse "subagent:<toolCallId>"), so the join key is turnRunId.
 * ------------------------------------------------------------------------- */

/** Result of parsing the leading [job:...] header of a raw message. */
export interface JobAttribution {
  /** "tagged" = valid job tag(s); "untagged" = no tag; "invalid" = a malformed [job:] tag. */
  readonly kind: "tagged" | "untagged" | "invalid";
  /** Distinct job ids in header order. Empty for untagged/invalid. */
  readonly jobIds: readonly string[];
  /** Why invalid, or "shared" note when >1 job on one turn. null otherwise. */
  readonly reason: string | null;
}

/** The subset of the metering context needed to bind a turn to its job(s). */
export interface MeterIdentity {
  readonly actorId: string;
  readonly turnRunId: string;
  readonly hostRequestId: string;
}

export interface JobBindingEntry extends MeterIdentity, JobAttribution {
  readonly schemaVersion: 1;
  readonly type: "run-job-binding";
  readonly ts: number;
}

const JOB_ID_RE = /^[A-Za-z0-9._-]{1,96}$/;

/**
 * Parse only a LEADING run of `[key:value]` header tags on the first non-empty
 * line, and return the `[job:<id>]` attribution. Tags anywhere else (body,
 * quotes, past conversation) are ignored on purpose. A malformed job id makes
 * the whole header "invalid" (we never partially accept). Never throws.
 */
export function parseLeadingJobHeader(text: string | null | undefined): JobAttribution {
  try {
    if (typeof text !== "string" || text.length === 0) return { kind: "untagged", jobIds: [], reason: null };
    const firstLine = (text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").trim();
    const tags: string[] = [];
    let i = 0;
    while (i < firstLine.length && firstLine[i] === "[") {
      const end = firstLine.indexOf("]", i);
      if (end < 0) break;
      tags.push(firstLine.slice(i + 1, end));
      i = end + 1;
    }
    const jobTags = tags.filter((t) => t.slice(0, 4).toLowerCase() === "job:");
    if (jobTags.length === 0) return { kind: "untagged", jobIds: [], reason: null };
    const ids: string[] = [];
    for (const t of jobTags) {
      const id = t.slice(4);
      if (!JOB_ID_RE.test(id)) return { kind: "invalid", jobIds: [], reason: `bad-job-id:${id.slice(0, 24)}` };
      if (!ids.includes(id)) ids.push(id);
    }
    return { kind: "tagged", jobIds: ids, reason: ids.length > 1 ? "shared" : null };
  } catch {
    return { kind: "untagged", jobIds: [], reason: null };
  }
}

function jobBindingsPath(): string {
  return join(getSandRootDir(), "job-bindings.jsonl");
}

/**
 * Record the turn->job binding once per turn. Best-effort, never throws (a lost
 * binding must not re-run the user's work; the report tool surfaces the loss as
 * "unmapped"). De-dup and conflict handling are left to the report-time join.
 */
export function appendJobBindingObserved(entry: Omit<JobBindingEntry, "schemaVersion" | "type" | "ts">): void {
  try {
    const row: JobBindingEntry = { schemaVersion: 1, type: "run-job-binding", ts: Date.now(), ...entry };
    appendFileSync(jobBindingsPath(), JSON.stringify(row) + "\n");
  } catch {
    // Best-effort only.
  }
}
