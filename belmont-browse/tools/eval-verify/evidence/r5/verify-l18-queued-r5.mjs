// L18.QUEUED (R5 corrected) — closes the full gate GPT-6 Pro round-4 required:
// A must START (ASTART marker observed) AND COMPLETE NORMALLY (status 'done', NOT force-stopped) so the
// maxConcurrent=1 slot frees on its own; then a B that was cancelled while QUEUED must STILL never start,
// and a fresh C must run. External artifacts (per-session marker files) are the evidence, not status text.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
const REPO = "/home/hoon/_roots/labs/work/Belmont";
const { createEvaluationApi } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/procedure-evaluation.mjs")).href);
const SP = process.argv[2] || "/tmp";
const STATE = path.join(REPO, "belmont-browse/.state");
const serve = JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
const api = createEvaluationApi(serve);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
function sessionDir(id) {
  const base = path.join(STATE, "aside-home-909/u/0/sessions");
  const hit = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.endsWith(`_${id}`)) : null;
  return hit ? path.join(base, hit) : null;
}
const post = (task) => api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: false });
const view = (id) => api("GET", `/sessions/${encodeURIComponent(id)}`);
const marker = (id, name) => { const d = sessionDir(id); if (!d) return false; try { return fs.readdirSync(d).includes(name); } catch { return false; } };
async function waitFor(pred, timeoutMs, everyMs = 1000) { const t0 = Date.now(); let last; do { last = await pred(); if (last) return last; await sleep(everyMs); } while (Date.now() - t0 < timeoutMs); return last; }

const nonce = crypto.randomUUID().slice(0, 8);
const log = (...a) => console.log(...a);

// A: writes ASTART, occupies the slot ~25s, then completes NORMALLY.
const A = await post(`Run this one bash command and nothing else: echo A-${nonce} > ASTART-${nonce}; sleep 25; echo A-DONE-${nonce} > ADONE-${nonce}`);
log("A", A.id);
// Wait until A is actually running AND its ASTART marker exists (A truly occupies the slot).
const aRunning = await waitFor(async () => { const v = await view(A.id); return (v?.status === "running" && marker(A.id, `ASTART-${nonce}`)) ? v : null; }, 30000);
const aStartedMarker = marker(A.id, `ASTART-${nonce}`);
log("A running?", !!aRunning, "ASTART marker?", aStartedMarker);

// B: submitted while A occupies the slot -> should QUEUE (maxConcurrent=1). BSTART must NEVER appear.
const B = await post(`Run this one bash command and nothing else: echo B-${nonce} > BSTART-${nonce}; sleep 5`);
log("B", B.id);
const bView = await waitFor(async () => { const v = await view(B.id); return v?.status ? v : null; }, 8000, 500);
const bStatusBeforeCancel = (await view(B.id))?.status;
const bQueued = bStatusBeforeCancel === "queued";
log("B status before cancel:", bStatusBeforeCancel, "queued?", bQueued);

// Cancel B WHILE it is queued.
await api("POST", `/sessions/${B.id}/stop`, {});
const bAfterStop = await waitFor(async () => { const v = await view(B.id); return TERMINAL.has(v?.status) ? v : null; }, 8000, 500);
log("B status after cancel:", bAfterStop?.status);

// Let A COMPLETE NORMALLY (do NOT stop it) -> the slot frees on its own.
const aFinal = await waitFor(async () => { const v = await view(A.id); return TERMINAL.has(v?.status) ? v : null; }, 60000, 1000);
const aCompletedNormally = aFinal?.status === "done";
const aDoneMarker = marker(A.id, `ADONE-${nonce}`);
log("A final status:", aFinal?.status, "normal?", aCompletedNormally, "ADONE marker?", aDoneMarker);

// After the slot freed, give any (wrongful) B start a real chance.
await sleep(6000);
const bStartedMarker = marker(B.id, `BSTART-${nonce}`);
log("B BSTART marker after slot freed (MUST be false):", bStartedMarker);

// C: a fresh session after the slot freed -> should RUN to completion (scheduler still works).
const C = await post(`Run this one bash command and nothing else: echo C-${nonce} > CSTART-${nonce}`);
log("C", C.id);
const cFinal = await waitFor(async () => { const v = await view(C.id); return TERMINAL.has(v?.status) ? v : null; }, 90000, 1500);
const cStartedMarker = marker(C.id, `CSTART-${nonce}`);
log("C final:", cFinal?.status, "CSTART marker?", cStartedMarker);

const pass = aStartedMarker && aCompletedNormally && aDoneMarker && bQueued && TERMINAL.has(bAfterStop?.status)
  && !bStartedMarker && cStartedMarker && cFinal?.status === "done";
const out = {
  case: "l18-queued-r5", at: new Date().toISOString(), nonce,
  gate: "A starts+completes normally (slot frees naturally) => cancelled QUEUED B still never starts; C runs",
  evidence: {
    aId: A.id, aStartedMarker, aRunningObserved: !!aRunning, aFinalStatus: aFinal?.status, aCompletedNormally, aDoneMarker,
    bId: B.id, bStatusBeforeCancel, bQueued, bStatusAfterCancel: bAfterStop?.status, bStartedMarker_MUST_BE_FALSE: bStartedMarker,
    cId: C.id, cStartedMarker, cFinalStatus: cFinal?.status,
  },
  verdict_pass: pass,
};
fs.writeFileSync(path.join(SP, "ev-l18-queued-r5.json"), JSON.stringify(out, null, 2));
console.log("EVIDENCE -> ev-l18-queued-r5.json");
console.log(JSON.stringify(out.evidence, null, 2));
console.log("PASS:", pass);
