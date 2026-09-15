// Belmont v4 Host watchdog — in-host controller (wires the tested core into the runtime).
//
// Deliberately low-risk: it is started from the transcript extension (no new generated
// extension slot, no edit to core turn plumbing). Everything is guarded — a failure here
// never throws into host startup. It is INERT unless the operator turns the flag on, and
// it scans files + a timer only (zero model calls in the normal state).

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BelmontWatchdog } from "./watchdog-runtime.js";
import { watchdogLimitsFromControl, type WatchdogEvent, type WatchdogJob, type JobStatus } from "./watchdog-core.js";

export interface WatchdogWakeManager {
  sendToAgent(fromAgentId: string, toAgentId: string, text: string): unknown;
}

export interface WatchdogControllerOptions {
  /** work root (belmont-work). Defaults to the ~/belmont-work symlink. */
  readonly workRoot?: string;
  /** sand-data root (for the feature-flag file). */
  readonly sandRoot: string;
  readonly manager: WatchdogWakeManager;
  readonly log?: (message: string) => void;
  readonly tickMs?: number;
}

const FLAG_KEY = "belmont_host_watchdog";
const WATCHDOG_SENDER_ID = "belmont-host-watchdog";
const STATE_FILE = ".watchdog-emitted.json";

function readJson(path: string): any | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

/** Feature flag (default OFF): sand-data/sand-feature-flag-overrides.json -> overrides[FLAG_KEY]. */
function flagEnabled(sandRoot: string): boolean {
  const f = readJson(join(sandRoot, "sand-feature-flag-overrides.json"));
  return f?.overrides?.[FLAG_KEY] === true;
}

/** Map a role id to its live agent id from control/roster.json (evolved shape: { agents: [...] }). */
function roleAgentIds(workRoot: string): Map<string, string> {
  const roster = readJson(join(workRoot, "control", "roster.json"));
  const map = new Map<string, string>();
  for (const a of roster?.agents ?? [])
    if (typeof a?.role === "string" && typeof a?.agent_id === "string") map.set(a.role, a.agent_id);
  return map;
}

function mapState(state: unknown, archived: unknown): JobStatus | "done" {
  if (archived === true) return "done";
  switch (String(state)) {
    case "cancelled": return "cancelled";
    case "queued": case "assigned": return "assigned";
    case "working": case "in_progress": return "working";
    case "blocked": case "waiting": case "waiting_approval": return "waiting-approval";
    case "done": case "complete": case "completed": case "accepted": return "done";
    default: return "working";
  }
}

/** Conservative file reader: only returns jobs it can parse with a computable deadline. */
function readActiveJobs(workRoot: string, limits: any): WatchdogJob[] {
  const jobsRoot = join(workRoot, "jobs");
  if (!existsSync(jobsRoot)) return [];
  const roles = roleAgentIds(workRoot);
  const ownerId = roles.get("belmont") ?? "";
  const deadlines = limits?.deadlines_minutes ?? {};
  const out: WatchdogJob[] = [];
  let years: string[] = [];
  try { years = readdirSync(jobsRoot); } catch { return []; }
  for (const year of years) {
    let dirs: string[] = [];
    try { dirs = readdirSync(join(jobsRoot, year)); } catch { continue; }
    for (const dir of dirs) {
      const jobDir = join(jobsRoot, year, dir);
      const job = readJson(join(jobDir, "job.json"));
      if (job == null) continue;
      const status = mapState(job.state, job.archived);
      if (status === "done") continue; // accepted/archived jobs never alarm
      const createdAt = typeof job.created_at === "number" ? job.created_at : Date.parse(job.created_at ?? "");
      if (!Number.isFinite(createdAt)) continue; // no clock -> cannot judge a deadline; skip (conservative)
      const category = String(job.deadline_category ?? job.classification ?? "daily_or_lookup");
      const minutes = typeof deadlines[category] === "number" ? deadlines[category] : (deadlines.daily_or_lookup ?? 15);
      const hasResultFile = existsSync(join(jobDir, "out")) && dirHasFile(join(jobDir, "out"), ["result.json", "files.json"]);
      out.push({
        jobId: String(job.job_id ?? dir), ownerId, workerId: String(job.assigned_worker_id ?? ""),
        status: status as JobStatus, assignedAtMs: createdAt, deadlineMs: createdAt + minutes * 60_000,
        hasResultFile, hasActiveChild: false, nextTurnScheduled: false,
        externalEffectUncertain: job.unknown_effect === true,
        // turn-end / reply are only known in-process; left undefined so "unreported" never false-fires from files.
      });
    }
  }
  return out;
}

function dirHasFile(root: string, names: readonly string[]): boolean {
  let stack = [root];
  let guard = 0;
  while (stack.length > 0 && guard++ < 5000) {
    const cur = stack.pop() as string;
    let entries: string[] = [];
    try { entries = readdirSync(cur); } catch { continue; }
    for (const e of entries) {
      const p = join(cur, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) stack.push(p);
      else if (names.includes(e)) return true;
    }
  }
  return false;
}

/** Start the watchdog. Returns a dispose fn. Never throws. */
export function startBelmontWatchdog(options: WatchdogControllerOptions): () => void {
  const workRoot = options.workRoot ?? join(process.env.HOME ?? "/home/hoon", "belmont-work");
  const stateFile = join(workRoot, "control", STATE_FILE);
  const log = options.log ?? (() => {});

  const loadEmittedIds = (): Set<string> => new Set<string>(readJson(stateFile)?.ids ?? []);
  const saveEmittedIds = (ids: Set<string>): void => {
    try { writeFileSync(stateFile, JSON.stringify({ ids: [...ids] })); } catch (e) { log(`watchdog persist failed: ${String(e)}`); }
  };

  const wd = new BelmontWatchdog({
    isEnabled: () => flagEnabled(options.sandRoot),
    now: () => Date.now(),
    listActiveJobs: () => {
      try { return readActiveJobs(workRoot, readJson(join(workRoot, "control", "limits.json"))); }
      catch (e) { log(`watchdog scan failed: ${String(e)}`); return []; }
    },
    limits: () => watchdogLimitsFromControl(readJson(join(workRoot, "control", "limits.json"))),
    loadEmittedIds, saveEmittedIds,
    wake: (event: WatchdogEvent) => {
      const text = `[host-watchdog] job ${event.jobId}: ${event.kind} — ${event.reason}`;
      options.manager.sendToAgent(WATCHDOG_SENDER_ID, event.wakeTargetId, text);
    },
    log,
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    timer = setInterval(() => { try { wd.tick(); } catch (e) { log(`watchdog tick failed: ${String(e)}`); } }, options.tickMs ?? 60_000);
    timer.unref?.();
    log("belmont host-watchdog started (flag-gated, default off)");
  } catch (e) { log(`watchdog start failed: ${String(e)}`); }

  return () => { if (timer != null) clearInterval(timer); };
}
