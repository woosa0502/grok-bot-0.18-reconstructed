// Proves the corrected L19.PENDING verdict catches what the r5 one missed: execCount is the EXECUTION count.
import assert from "node:assert/strict";
const verdict = (bExecAfter, bView = { status: "done" }, bAfterStop = { status: "stopped" }, cOk = true) => {
  const v = { b_not_lost: !!(bView && (bView.status || bView.id)), b_exec_read_ok: bExecAfter >= 0,
    b_never_executed: bExecAfter === 0, b_cancelled_terminal: ["done","error","stopped","interrupted"].includes(bAfterStop.status), c_ran: cOk };
  return Object.values(v).every(Boolean);
};
assert.equal(verdict(0), true, "0 executions (B never ran) -> PASS");
assert.equal(verdict(2), false, "2 executions (GPT double-run reproduction) -> MUST FAIL");
assert.equal(verdict(1), false, "1 execution (B ran once, uncontrolled) -> MUST FAIL");
assert.equal(verdict(-1), false, "read failure -> MUST FAIL (UNKNOWN, not PASS)");
console.log("PASS: corrected L19.PENDING verdict FAILS on 2-run/1-run/read-failure, PASSes only on 0 executions");
