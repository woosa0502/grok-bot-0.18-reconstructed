// Self-test for the CORRECTED L19.PENDING logic. It imports the REAL observation formula, verdict, and
// precondition gate from l19-pending-lib.mjs — the same module the live verifier uses — so a future change to
// the real logic that broke these properties would fail HERE (the old self-test re-declared the verdict inline
// and thus proved nothing about the shipped code; GPT whole-project finding).
import assert from "node:assert/strict";
import { countExecutions, computeVerdict, verdictPass, checkPreconditions, grade } from "./l19-pending-lib.mjs";

// (1) the EXECUTION-count formula (the crux of the r5 false-PASS: files vs executions).
assert.equal(countExecutions(""), 0, "empty file -> 0 executions");
assert.equal(countExecutions("B-x\n"), 1, "one appended line -> 1 execution");
assert.equal(countExecutions("B-x\nB-x\n"), 2, "TWO appended lines in ONE file -> 2 executions (r5 missed this)");
assert.equal(countExecutions(null), -1, "read failure -> -1 (UNKNOWN)");

// (2) the verdict, driven purely by the FINAL (post-C) execution count (other observations held healthy).
const good = { bView: { status: "done" }, bAfterStop: { status: "stopped" }, cRan: true };
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: 0 })), true, "0 executions -> verdict holds");
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: 2 })), false, "2 executions (double/late run) -> verdict fails");
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: 1 })), false, "1 execution -> verdict fails");

// (3) the PRECONDITION + REQUIRED-OBSERVATION gate. Fully-satisfied gate:
const full = { aReady: true, bQueued: true, bPreReadOk: true, bFinalReadOk: true };
const perfect = computeVerdict({ ...good, bExecAfter: 0 });
assert.equal(grade({ preconditions: checkPreconditions(full), verdict: perfect }), "PASS", "exercised + all reads ok + clean -> PASS");
// test-validity preconditions:
assert.equal(grade({ preconditions: checkPreconditions({ ...full, bQueued: false }), verdict: perfect }), "INVALID", "B never queued -> INVALID, not PASS");
assert.equal(grade({ preconditions: checkPreconditions({ ...full, aReady: false }), verdict: perfect }), "INVALID", "A never ready -> INVALID, not PASS");
// required-observation gates (R3): a read failure is INVALID (could-not-observe), never PASS and never FAIL:
assert.equal(grade({ preconditions: checkPreconditions({ ...full, bPreReadOk: false }), verdict: perfect }), "INVALID", "pre-cancel read failed -> INVALID, not PASS");
assert.equal(grade({ preconditions: checkPreconditions({ ...full, bFinalReadOk: false }), verdict: perfect }), "INVALID", "final post-C read failed -> INVALID, not PASS");
// R3 late-execution: a cancelled B that runs LATE (during C) shows up ONLY in the final count -> FAIL:
assert.equal(grade({ preconditions: checkPreconditions(full), verdict: computeVerdict({ ...good, bExecAfter: 2 }) }), "FAIL", "exercised but B ran late/double (final count 2) -> FAIL");
assert.equal(grade({ preconditions: checkPreconditions(full), verdict: computeVerdict({ ...good, bExecAfter: 1 }) }), "FAIL", "exercised but B ran once (final count 1) -> FAIL");

// (4) the re-measure is LOAD-BEARING: in a late-execution scenario the pre-C count is 0 but the final post-C
// count is 2. Grading the STALE pre-C count would (wrongly) PASS; grading the FINAL count FAILs. So a driver
// that dropped the post-C re-measure (verify-l19-pending-r14.mjs) would regress to a false-PASS here.
const stalePreC = 0, finalPostC = 2;
assert.equal(grade({ preconditions: checkPreconditions(full), verdict: computeVerdict({ ...good, bExecAfter: stalePreC }) }), "PASS", "stale pre-C count would wrongly PASS (why the re-measure exists)");
assert.equal(grade({ preconditions: checkPreconditions(full), verdict: computeVerdict({ ...good, bExecAfter: finalPostC }) }), "FAIL", "final post-C count correctly FAILs -> the re-measure is load-bearing");

console.log("PASS: L19.PENDING shared logic — execution-count formula, verdict on the FINAL count (FAILS on >=1), and the precondition+required-observation gate (INVALID when unexercised or a required read failed) all hold, imported from the real module");
