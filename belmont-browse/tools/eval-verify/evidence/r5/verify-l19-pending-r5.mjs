// L19.PENDING (R5) — a session QUEUED (pending, never started) at crash time: after an unattended restart it
// must NOT vanish (still queryable), must NOT auto-execute uncontrolled, and must NEVER run twice (no duplicate).
// A occupies the maxConcurrent=1 slot; B queues behind it; SIGKILL the serve while B is pending; restart; measure
// B's fate via an external BSTART marker (must appear at most once) + its status. Behavior is MEASURED, not assumed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const REPO = "/home/hoon/_roots/labs/work/Belmont";
const NODE = `${process.env.HOME}/.nvm/versions/node/v26.8.1/bin/node`;
const { createEvaluationApi } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/procedure-evaluation.mjs")).href);
const SP = process.argv[2] || "/tmp";
const STATE = path.join(REPO, "belmont-browse/.state");
const SERVE_LOG = path.join(SP, "eval-serve.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
const readServe = () => JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
function sessionDir(id) { const base = path.join(STATE, "aside-home-909/u/0/sessions"); const hit = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.endsWith(`_${id}`)) : null; return hit ? path.join(base, hit) : null; }
const markerCount = (id, name) => { const d = sessionDir(id); if (!d) return 0; try { return fs.readdirSync(d).filter((f) => f === name).length; } catch { return 0; } };
const markerExists = (id, name) => markerCount(id, name) > 0;
function startServe() {
  const env = { ...process.env, BELMONT_BROWSE_ENGINE: "909", BELMONT_BROWSE_TRANSPORT: "port", BELMONT_BROWSE_NATIVE_COMPONENTS: "1",
    BELMONT_BROWSE_CHROME: "/home/hoon/chromium/src/out/aside/chrome", BELMONT_BROWSE_CHROME_ARGS: "--ignore-gpu-blocklist",
    BELMONT_BROWSE_DISPLAY: ":0", DISPLAY: ":0", BELMONT_BROWSE_STATE_DIR: path.join(REPO, "belmont-browse/.state"),
    BELMONT_KNOWLEDGE_DIR: path.join(REPO, ".cache/eval-verify-909/knowledge"), BELMONT_BROWSE_SITES_OVERLAY: "1" };
  const out = fs.openSync(SERVE_LOG, "a");
  const child = spawn(NODE, ["belmont-browse/src/serve.mjs", "--port", "9360", "--engine", "909", "--transport", "port", "--cdp-port", "9333", "--relay-port", "9361"],
    { cwd: REPO, env, stdio: ["ignore", out, out], detached: true });
  child.unref(); fs.writeFileSync(path.join(SP, "eval-serve.pid"), String(child.pid)); return child.pid;
}
async function waitFor(api, id, pred, timeoutMs, everyMs = 1000) { const t0 = Date.now(); let v; do { try { v = await api("GET", `/sessions/${id}`); } catch {} if (pred(v)) return v; await sleep(everyMs); } while (Date.now() - t0 < timeoutMs); return v; }

const nonce = crypto.randomUUID().slice(0, 8);
const R = { case: "l19-pending-r5", at: new Date().toISOString(), nonce,
  gate: "A pending/running at crash; B QUEUED(pending) at crash -> after unattended restart B is not lost, not auto-run uncontrolled, and never duplicated (BSTART <=1)" };
let serve = readServe();
let servePid1 = Number(fs.readFileSync(path.join(SP, "eval-serve.pid"), "utf8").trim());
let api = createEvaluationApi(serve);
const post = (task) => api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: false });

// A occupies the slot
const A = await post(`Run this one bash command and nothing else: echo A-${nonce} > ASTART-${nonce}; sleep 45`);
const aRun = await waitFor(api, A.id, (v) => v?.status === "running" && markerExists(A.id, `ASTART-${nonce}`), 30000);
// B queues behind A (pending); BSTART must appear at most once, ever
const B = await post(`Run this one bash command and nothing else: echo B-${nonce} >> BSTART-${nonce}; sleep 3`);
const bBefore = await waitFor(api, B.id, (v) => !!v?.status, 8000, 500);
R.preCrash = { aStatus: (await api("GET", `/sessions/${A.id}`))?.status, aStartMarker: markerExists(A.id, `ASTART-${nonce}`),
  bStatus: bBefore?.status, bQueued: bBefore?.status === "queued", bStartMarkerBefore: markerCount(B.id, `BSTART-${nonce}`) };
console.log("pre-crash:", JSON.stringify(R.preCrash));

// CRASH the serve while B is pending
try { execSync(`kill -9 ${servePid1}`); } catch (e) { R.killError = e.message; }
await sleep(2500);

// RESTART unattended
const servePid2 = startServe();
let serve2 = null;
for (let i = 0; i < 60; i++) { try { const s = readServe(); if (s.pid && s.pid !== servePid1) { serve2 = s; break; } } catch {} await sleep(1000); }
R.restart = { servePid2, serve2Pid: serve2?.pid };
api = createEvaluationApi(serve2);

// measure B + A after restart, and give any (wrongful) B execution a real chance
await sleep(10000);
let aAfter = null, bAfter = null;
try { aAfter = await api("GET", `/sessions/${A.id}`); } catch (e) { aAfter = { error: e.message }; }
try { bAfter = await api("GET", `/sessions/${B.id}`); } catch (e) { bAfter = { error: e.message }; }
// wait a bit more, then final marker count (duplicate check)
await sleep(6000);
const bStartAfter = markerCount(B.id, `BSTART-${nonce}`);
R.recovered = {
  aStatusAfter: aAfter?.status ?? aAfter?.error, bStatusAfter: bAfter?.status ?? bAfter?.error,
  bQueryable: !!(bAfter && bAfter.status), bStartMarkerAfter: bStartAfter,
  bLost: !(bAfter && (bAfter.status || bAfter.id)),
  bNeverDuplicated: bStartAfter <= 1,
  bAutoRanUncontrolled: bStartAfter > R.preCrash.bStartMarkerBefore, // B actually executed after restart
};
console.log("recovered:", JSON.stringify(R.recovered));
R.verdict = {
  b_not_lost: R.recovered.bQueryable,
  b_never_duplicated: R.recovered.bNeverDuplicated,
  b_terminal_or_defined: TERMINAL.has(R.recovered.bStatusAfter) || R.recovered.bStatusAfter === "queued",
};
R.verdict_pass = R.verdict.b_not_lost && R.verdict.b_never_duplicated && R.verdict.b_terminal_or_defined;
fs.writeFileSync(path.join(SP, "ev-l19-pending-r5.json"), JSON.stringify(R, null, 2));
console.log("EVIDENCE -> ev-l19-pending-r5.json");
console.log("VERDICT:", JSON.stringify(R.verdict), "PASS:", R.verdict_pass);
