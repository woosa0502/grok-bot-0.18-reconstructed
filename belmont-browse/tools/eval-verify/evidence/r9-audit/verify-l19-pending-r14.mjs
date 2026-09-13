// L19.PENDING (R14, corrected) — fixes the false-PASS GPT-6 Pro's whole-project review found:
// the r5 harness counted marker FILES (0/1), but B appends with >> so a DOUBLE execution left 2 lines in ONE
// file -> "never duplicated" was true even on a double run. Here the external artifact is the EXECUTION COUNT
// (non-empty lines in the BSTART file), read-failure is UNKNOWN(-1), and the verdict FAILS on >=2 executions.
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
function sessionDir(id) { const base = path.join(STATE, "aside-home-909/u/0/sessions"); const hit = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.endsWith(`_${id}`)) : null; return hit ? path.join(base, hit) : null; }
// EXECUTION count = non-empty lines in the marker file (each run appends one). -1 = read failure (UNKNOWN).
function execCount(id, name) { const d = sessionDir(id); if (!d) return -1; try { return fs.readFileSync(path.join(d, name), "utf8").split("\n").filter(Boolean).length; } catch (e) { return e.code === "ENOENT" ? 0 : -1; } }
const post = (task) => api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: false });
const view = (id) => api("GET", `/sessions/${id}`);
async function waitFor(id, pred, t, e = 1000) { const t0 = Date.now(); let v; do { try { v = await view(id); } catch {} if (pred(v)) return v; await sleep(e); } while (Date.now() - t0 < t); return v; }
const marker = (id, name) => { const d = sessionDir(id); if (!d) return false; try { return fs.readdirSync(d).includes(name); } catch { return false; } };

const nonce = crypto.randomUUID().slice(0, 8);
const A = await post(`Run this one bash command and nothing else: echo A-${nonce} > ASTART-${nonce}; sleep 45`);
await waitFor(A.id, (v) => v?.status === "running" && marker(A.id, `ASTART-${nonce}`), 30000);
const B = await post(`Run this one bash command and nothing else: echo B-${nonce} >> BSTART-${nonce}; sleep 3`);
const bBefore = await waitFor(B.id, (v) => !!v?.status, 8000, 500);
const bQueued = bBefore?.status === "queued";
const bExecBefore = execCount(B.id, `BSTART-${nonce}`);
await api("POST", `/sessions/${B.id}/stop`, {});
const bAfterStop = await waitFor(B.id, (v) => TERMINAL.has(v?.status), 8000, 500);
await api("POST", `/sessions/${A.id}/stop`, {});
await sleep(6000);
let bView; try { bView = await view(B.id); } catch (e) { bView = { error: e.message }; }
const bExecAfter = execCount(B.id, `BSTART-${nonce}`);
const C = await post(`Run this one bash command and nothing else: echo C-${nonce} > CSTART-${nonce}`);
const cFinal = await waitFor(C.id, (v) => TERMINAL.has(v?.status), 90000, 1500);
const R = { case: "l19-pending-r14", at: new Date().toISOString(), nonce,
  evidence: { aId: A.id, bId: B.id, cId: C.id, bQueued, bStatusAfterCancel: bAfterStop?.status,
    bExecCountBefore: bExecBefore, bExecCountAfter: bExecAfter, bQueryableAfter: !!(bView && (bView.status || bView.id)),
    cStarted: marker(C.id, `CSTART-${nonce}`), cFinal: cFinal?.status },
  verdict: {
    b_not_lost: !!(bView && (bView.status || bView.id)),
    b_exec_read_ok: bExecAfter >= 0,                 // not a read failure
    b_never_executed: bExecAfter === 0,              // corrected: EXECUTION count, catches >=2
    b_cancelled_terminal: TERMINAL.has(bAfterStop?.status),
    c_ran: marker(C.id, `CSTART-${nonce}`) && cFinal?.status === "done",
  } };
R.verdict_pass = Object.values(R.verdict).every(Boolean);
fs.writeFileSync(path.join(SP, "ev-l19-pending-r14.json"), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R.verdict), "PASS:", R.verdict_pass);
process.exit(R.verdict_pass ? 0 : 1);
