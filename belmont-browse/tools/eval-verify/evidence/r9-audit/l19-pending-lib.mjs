// Shared observation + verdict logic for L19.PENDING, imported by BOTH the live verifier
// (verify-l19-pending-r14.mjs) AND its self-test (test-pending-formula.mjs). The self-test previously
// RE-DECLARED the verdict inline, so it proved nothing about the real code (GPT whole-project finding);
// now both call these exact functions.
import fs from "node:fs";
import path from "node:path";

export const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);

// PURE formula: EXECUTION count from a marker file's raw contents. Each real execution appends exactly one
// non-empty line (B's command uses `>>`), so N non-empty lines == N executions. null == read failure -> -1.
export function countExecutions(rawOrNull) {
  if (rawOrNull == null) return -1;                 // read failure -> UNKNOWN
  return String(rawOrNull).split("\n").filter(Boolean).length;
}

// Filesystem wrapper the live verifier uses. 0 when the file is absent (never executed), N for N executions,
// -1 on any non-ENOENT read failure (UNKNOWN).
export function execCountFromDir(dir, name) {
  if (!dir) return -1;
  try { return countExecutions(fs.readFileSync(path.join(dir, name), "utf8")); }
  catch (e) { return e.code === "ENOENT" ? 0 : -1; }
}

// PURE verdict from observations.
export function computeVerdict({ bView, bExecAfter, bAfterStop, cRan }) {
  return {
    b_not_lost: !!(bView && (bView.status || bView.id)),
    b_exec_read_ok: bExecAfter >= 0,                 // not a read failure
    b_never_executed: bExecAfter === 0,              // EXECUTION count: catches a double run (>=2) too
    b_cancelled_terminal: TERMINAL.has(bAfterStop?.status),
    c_ran: !!cRan,
  };
}
export const verdictPass = (v) => Object.values(v).every(Boolean);

// PRECONDITIONS gate: the run only MEANS anything if B was actually queued behind a still-running A. If A never
// reached the running+marker state, or B was never queued (it started immediately), then "B never executed"
// is vacuous — the pending/cancel path was not exercised. Such a run is INVALID/UNKNOWN, never PASS.
export function checkPreconditions({ aReady, bQueued }) {
  return { ok: !!aReady && !!bQueued, aReady: !!aReady, bQueued: !!bQueued };
}

// Overall grade: INVALID when preconditions are unmet, else PASS/FAIL from the verdict.
export function grade({ preconditions, verdict }) {
  if (!preconditions.ok) return "INVALID";
  return verdictPass(verdict) ? "PASS" : "FAIL";
}
