// The L19.PENDING live-verification FLOW, with injectable dependencies. Extracted from the CLI verifier so a
// driver-level regression can exercise the REAL observation ordering — post A, queue B, cancel B, run C, and
// RE-MEASURE B after C completes — without the live 909 stack (whole-project review round-2: the pure-formula
// self-test could not catch a driver that dropped the post-C re-measure). Both the CLI verifier and the driver
// regression call runPendingVerification(); the ONLY thing the regression swaps is the api/execCount/marker deps.
import { TERMINAL, computeVerdict, checkPreconditions, grade } from "./l19-pending-lib.mjs";

export async function runPendingVerification({ api, execCount, marker, sleep, nonce, stabilizeMs = 6000, cancelSettleMs = 6000, model = "gpt-5.5", thinking = "high" }) {
  const post = (task) => api("POST", "/sessions", { task, model, thinking, mode: "guard", autoApprove: false });
  const view = (id) => api("GET", `/sessions/${id}`);
  async function waitFor(id, pred, t, e = 1000) { const t0 = Date.now(); let v; do { try { v = await view(id); } catch {} if (pred(v)) return v; await sleep(e); } while (Date.now() - t0 < t); return v; }

  const A = await post(`Run this one bash command and nothing else: echo A-${nonce} > ASTART-${nonce}; sleep 45`);
  const aView = await waitFor(A.id, (v) => v?.status === "running" && marker(A.id, `ASTART-${nonce}`), 30000);
  const aReady = aView?.status === "running" && marker(A.id, `ASTART-${nonce}`);   // PRECONDITION: A occupies the runner
  const B = await post(`Run this one bash command and nothing else: echo B-${nonce} >> BSTART-${nonce}; sleep 3`);
  const bBefore = await waitFor(B.id, (v) => !!v?.status, 8000, 500);
  const bQueued = bBefore?.status === "queued";                                    // PRECONDITION: B actually queued
  const bExecBefore = execCount(B.id, `BSTART-${nonce}`);
  await api("POST", `/sessions/${B.id}/stop`, {});
  const bAfterStop = await waitFor(B.id, (v) => TERMINAL.has(v?.status), 8000, 500);
  await api("POST", `/sessions/${A.id}/stop`, {});
  await sleep(cancelSettleMs);
  let bView; try { bView = await view(B.id); } catch (e) { bView = { error: e.message }; }
  const bExecAfterCancel = execCount(B.id, `BSTART-${nonce}`);   // post-cancel, PRE-C (diagnostic only)
  const C = await post(`Run this one bash command and nothing else: echo C-${nonce} > CSTART-${nonce}`);
  const cFinal = await waitFor(C.id, (v) => TERMINAL.has(v?.status), 90000, 1500);
  const cRan = marker(C.id, `CSTART-${nonce}`) && cFinal?.status === "done";
  // R3: re-measure B AFTER C completes plus a queue-stabilization window. A cancelled B that (wrongly) executes
  // LATE — while the harness was still waiting on C — is only visible in this FINAL read, so the verdict MUST
  // use THIS value, not the pre-C `bExecAfterCancel`. (test-l19-driver-late-exec.mjs fails if this is removed.)
  await sleep(stabilizeMs);
  const bExecFinal = execCount(B.id, `BSTART-${nonce}`);

  const preconditions = checkPreconditions({
    aReady, bQueued,
    bPreReadOk: bExecBefore >= 0,        // required: the pre-cancel observation actually succeeded
    bFinalReadOk: bExecFinal >= 0,       // required: the final post-C observation actually succeeded
  });
  const verdict = computeVerdict({ bView, bExecAfter: bExecFinal, bAfterStop, cRan });
  const result = grade({ preconditions, verdict });
  return {
    ids: { aId: A.id, bId: B.id, cId: C.id },
    aReady, bQueued, bAfterStop, bView, cFinal, cRan,
    bExecBefore, bExecAfterCancel, bExecFinal,
    preconditions, verdict, result,
  };
}
