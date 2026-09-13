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

// (2) the verdict, driven purely by the execution count (with the other observations held healthy).
const good = { bView: { status: "done" }, bAfterStop: { status: "stopped" }, cRan: true };
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: 0 })), true, "0 executions -> verdict holds");
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: 2 })), false, "2 executions (double-run) -> verdict fails");
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: 1 })), false, "1 execution -> verdict fails");
assert.equal(verdictPass(computeVerdict({ ...good, bExecAfter: -1 })), false, "read failure -> verdict fails (UNKNOWN)");

// (3) the PRECONDITION gate: even a PERFECT verdict must NOT grade PASS if the pending/cancel path was not
// actually exercised (A not ready, or B never queued). Such a run is INVALID/UNKNOWN.
const perfect = computeVerdict({ ...good, bExecAfter: 0 });
assert.equal(grade({ preconditions: checkPreconditions({ aReady: true, bQueued: true }), verdict: perfect }), "PASS", "exercised + clean -> PASS");
assert.equal(grade({ preconditions: checkPreconditions({ aReady: true, bQueued: false }), verdict: perfect }), "INVALID", "B never queued -> INVALID, not PASS");
assert.equal(grade({ preconditions: checkPreconditions({ aReady: false, bQueued: true }), verdict: perfect }), "INVALID", "A never ready -> INVALID, not PASS");
assert.equal(grade({ preconditions: checkPreconditions({ aReady: true, bQueued: true }), verdict: computeVerdict({ ...good, bExecAfter: 2 }) }), "FAIL", "exercised but B double-ran -> FAIL");

console.log("PASS: L19.PENDING shared logic — execution-count formula, verdict (FAILS on >=1/read-fail), and precondition gate (INVALID when unexercised) all hold, imported from the real module");
