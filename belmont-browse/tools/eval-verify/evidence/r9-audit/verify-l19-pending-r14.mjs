// L19.PENDING (R14, corrected) — CLI wrapper around the shared, injectable driver (l19-pending-driver.mjs).
// History: the r5 harness counted marker FILES (0/1), but B appends with >> so a DOUBLE execution left 2 lines
// in ONE file -> "never duplicated" passed even on a double run. The external artifact is now the EXECUTION
// COUNT (non-empty lines in BSTART), read-failure is UNKNOWN(-1), the verdict FAILS on >=1 executions, the
// observation formula + verdict + gate live in l19-pending-lib.mjs (shared with the self-test), the flow lives
// in l19-pending-driver.mjs (shared with the driver regression), B is RE-MEASURED after C completes, and
// preconditions (A running+marker, B queued) + required reads gate the grade to INVALID when unmet.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { execCountFromDir } from "./l19-pending-lib.mjs";
import { runPendingVerification } from "./l19-pending-driver.mjs";
const REPO = "/home/hoon/_roots/labs/work/Belmont";
const { createEvaluationApi } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/procedure-evaluation.mjs")).href);
const SP = process.argv[2] || "/tmp";
const STATE = path.join(REPO, "belmont-browse/.state");
const serve = JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
const api = createEvaluationApi(serve);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sessionDir(id) { const base = path.join(STATE, "aside-home-909/u/0/sessions"); const hit = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.endsWith(`_${id}`)) : null; return hit ? path.join(base, hit) : null; }
const execCount = (id, name) => execCountFromDir(sessionDir(id), name);
const marker = (id, name) => { const d = sessionDir(id); if (!d) return false; try { return fs.readdirSync(d).includes(name); } catch { return false; } };

const nonce = crypto.randomUUID().slice(0, 8);
const out = await runPendingVerification({ api, execCount, marker, sleep, nonce, stabilizeMs: Number(process.env.L19_STABILIZE_MS || 6000) });
const R = { case: "l19-pending-r14", at: new Date().toISOString(), nonce,
  evidence: { aId: out.ids.aId, bId: out.ids.bId, cId: out.ids.cId, aReady: out.aReady, bQueued: out.bQueued,
    bStatusAfterCancel: out.bAfterStop?.status, bExecCountBefore: out.bExecBefore, bExecCountAfterCancel: out.bExecAfterCancel,
    bExecCountFinal: out.bExecFinal, bQueryableAfter: !!(out.bView && (out.bView.status || out.bView.id)),
    cStarted: out.cRan, cFinal: out.cFinal?.status },
  preconditions: out.preconditions, verdict: out.verdict, result: out.result };
R.verdict_pass = out.result === "PASS";                 // back-compat field; PASS only when preconditions met AND verdict holds
fs.writeFileSync(path.join(SP, "ev-l19-pending-r14.json"), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R.verdict), "RESULT:", out.result, "(preconditions:", JSON.stringify(out.preconditions) + ")");
process.exit(out.result === "PASS" ? 0 : 1);
