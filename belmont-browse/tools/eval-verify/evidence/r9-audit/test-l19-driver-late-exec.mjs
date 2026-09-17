// DRIVER regression for L19.PENDING (whole-project review round-2). The pure-formula self-test could not catch
// a driver that dropped the post-C re-measure, because it never runs the driver. This test runs the REAL driver
// flow (runPendingVerification from l19-pending-driver.mjs — the same code the CLI verifier uses) against an
// INJECTED fake session API that makes the cancelled B execute LATE, while the harness is waiting on C. Because
// the late execution is only visible in the FINAL post-C read, the run must grade FAIL. If the driver's post-C
// re-measure were removed (verdict taken from the pre-C count), this test would see PASS and FAIL its assertion
// — which is exactly the regression GPT asked for.
import assert from "node:assert/strict";
import { runPendingVerification } from "./l19-pending-driver.mjs";

const noSleep = () => Promise.resolve();

// A minimal in-memory session API + observation store. `opts` shapes the scenario:
//   lateExecOnC: when C is posted, the cancelled B "executes" (its exec count jumps to 2).
//   preReadFail / finalReadFail: force a required B read to fail (-1) to exercise the INVALID gate.
function makeHarness(opts = {}) {
  const s = { A: null, B: null, C: null, statusA: null, statusB: null, statusC: null, aMarker: false, cMarker: false, bExec: 0 };
  let bReads = 0, idc = 0;
  const api = async (method, p, body) => {
    if (method === "POST" && p === "/sessions") {
      const task = body.task; const id = "s" + (++idc);
      if (task.includes("ASTART-")) { s.A = id; s.statusA = "running"; s.aMarker = true; return { id }; }
      if (task.includes("BSTART-")) { s.B = id; s.statusB = "queued"; return { id }; }        // B queued behind A
      if (task.includes("CSTART-")) { s.C = id; s.statusC = "done"; s.cMarker = true; if (opts.lateExecOnC) s.bExec = 2; return { id }; }
      return { id };
    }
    if (method === "POST" && p.endsWith("/stop")) {
      if (s.B && p.includes(s.B)) s.statusB = "stopped";
      if (s.A && p.includes(s.A)) s.statusA = "stopped";
      return {};
    }
    if (method === "GET") {
      if (s.A && p.includes(s.A)) return { id: s.A, status: s.statusA };
      if (s.B && p.includes(s.B)) return { id: s.B, status: s.statusB };
      if (s.C && p.includes(s.C)) return { id: s.C, status: s.statusC };
    }
    return null;
  };
  const execCount = (id, name) => {
    if (id === s.B && name.startsWith("BSTART-")) {
      bReads += 1;
      if (opts.preReadFail && bReads === 1) return -1;        // fail the pre-cancel read
      if (opts.finalReadFail && bReads >= 3) return -1;       // fail the final post-C read
      return s.bExec;
    }
    return 0;
  };
  const marker = (id, name) => (id === s.A && name.startsWith("ASTART-") && s.aMarker) || (id === s.C && name.startsWith("CSTART-") && s.cMarker);
  return { api, execCount, marker };
}

const run = (opts) => runPendingVerification({ ...makeHarness(opts), sleep: noSleep, nonce: "test", stabilizeMs: 0, cancelSettleMs: 0 });

// control: B never executes -> PASS
{
  const out = await run({});
  assert.equal(out.result, "PASS", `control (B never runs) should PASS, got ${out.result}`);
  assert.equal(out.bExecFinal, 0, "final count should be 0 in the control");
}
// THE regression: B executes LATE during C -> only the FINAL read sees it -> FAIL
{
  const out = await run({ lateExecOnC: true });
  assert.equal(out.bExecAfterCancel, 0, "pre-C count must be 0 (the late run has not happened yet)");
  assert.equal(out.bExecFinal, 2, "final post-C count must be 2 (the late run is only visible after C)");
  assert.equal(out.result, "FAIL", `late execution during C must FAIL via the post-C re-measure, got ${out.result}. If this is PASS, the driver dropped the re-measure.`);
}
// required-observation gates run through the real driver too:
{
  const out = await run({ preReadFail: true });
  assert.equal(out.result, "INVALID", `a failed pre-cancel read must gate to INVALID, got ${out.result}`);
}
{
  const out = await run({ finalReadFail: true });
  assert.equal(out.result, "INVALID", `a failed final read must gate to INVALID, got ${out.result}`);
}

console.log("PASS: L19 driver regression — the real flow FAILs a late B execution during C (post-C re-measure is load-bearing) and gates read failures to INVALID");
