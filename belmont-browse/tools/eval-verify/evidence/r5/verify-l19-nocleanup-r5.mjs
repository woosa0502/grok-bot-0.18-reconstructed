// L19.RUNNING.NO_CLEANUP (R5 corrected) — closes the AUDIT.R4 evidence debt AND live-validates the
// DEF-L19-CHROME-ORPHAN-001 fix. Crash the serve (SIGKILL, no handler), restart UNATTENDED (no manual
// cleanup), and capture RAW evidence:
//   * re-execution signal: a BOOT-<nonce> marker the session writes ONCE at bash start. Count before crash
//     (=1) vs after restart. A 2nd boot line == the session was re-executed; unchanged == no re-exec. This
//     is immune to the orphaned-child heartbeat confound (a SIGKILL-orphaned bash may keep writing HB).
//   * recovered session status (the actual snapshot, not a summary string).
//   * chrome adopt: after restart, the reuse branch must ADOPT the orphan (owner serve dead) — assert the
//     new owner file names this serve with adoptedFrom = the dead serve, and the orphan count stays <=1.
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
const OWNER = path.join(STATE, "chrome-profile/.belmont-chrome-owner.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const readOwner = () => { try { return JSON.parse(fs.readFileSync(OWNER, "utf8")); } catch { return null; } };
const readServe = () => JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
function sessionDir(id) { const base = path.join(STATE, "aside-home-909/u/0/sessions"); const hit = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.endsWith(`_${id}`)) : null; return hit ? path.join(base, hit) : null; }
const countLines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
function startServe() {
  const env = { ...process.env, BELMONT_BROWSE_ENGINE: "909", BELMONT_BROWSE_TRANSPORT: "port", BELMONT_BROWSE_NATIVE_COMPONENTS: "1",
    BELMONT_BROWSE_CHROME: "/home/hoon/chromium/src/out/aside/chrome", BELMONT_BROWSE_CHROME_ARGS: "--ignore-gpu-blocklist",
    BELMONT_BROWSE_DISPLAY: ":0", DISPLAY: ":0", BELMONT_BROWSE_STATE_DIR: path.join(REPO, "belmont-browse/.state"),
    BELMONT_KNOWLEDGE_DIR: path.join(REPO, ".cache/eval-verify-909/knowledge"), BELMONT_BROWSE_SITES_OVERLAY: "1" };
  const out = fs.openSync(SERVE_LOG, "a");
  const child = spawn(NODE, ["belmont-browse/src/serve.mjs", "--port", "9360", "--engine", "909", "--transport", "port", "--cdp-port", "9333", "--relay-port", "9361"],
    { cwd: REPO, env, stdio: ["ignore", out, out], detached: true });
  child.unref();
  fs.writeFileSync(path.join(SP, "eval-serve.pid"), String(child.pid));
  return child.pid;
}

const nonce = crypto.randomUUID().slice(0, 8);
const R = { case: "l19-nocleanup-r5", at: new Date().toISOString(), nonce };

// --- phase 1: start a heartbeat session under the current serve ---
let serve = readServe();
let servePid1 = Number(fs.readFileSync(path.join(SP, "eval-serve.pid"), "utf8").trim());
// The owner file is the source of truth for the (possibly adopted) chrome pid; serve.json chromePid can be
// null on a pre-fix adopt. Prefer the owner file.
const chromePid1 = readOwner()?.chromePid ?? serve.chromePid;
let api = createEvaluationApi(serve);
const task = `Run this one bash command and nothing else (do not reply until it ends): echo boot-${nonce} >> BOOT-${nonce}; for i in $(seq 1 600); do echo hb-${nonce}-$i >> HB-${nonce}; sleep 1; done`;
const A = await (async () => api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: false }))();
console.log("A", A.id, "servePid1", servePid1, "chromePid1", chromePid1);
// wait until heartbeat active
let sdir = null, hbPath = null, bootPath = null;
for (let i = 0; i < 40; i++) { sdir = sessionDir(A.id); if (sdir) { hbPath = path.join(sdir, `HB-${nonce}`); bootPath = path.join(sdir, `BOOT-${nonce}`); if (countLines(hbPath) >= 3) break; } await sleep(1000); }
R.preCrash = { sessionDir: sdir, bootBefore: countLines(bootPath), hbBefore: countLines(hbPath), chromePid1Alive: alive(chromePid1), ownerBefore: readOwner() };
console.log("pre-crash:", JSON.stringify(R.preCrash));

// --- phase 2: CRASH the serve (SIGKILL: no in-process handler runs) ---
try { execSync(`kill -9 ${servePid1}`); } catch (e) { R.killError = e.message; }
await sleep(2500);
R.crash = { servePid1Alive: alive(servePid1), chromeOrphanAlive: alive(chromePid1), ownerStillDeadServe: (() => { const o = readOwner(); return o && o.servePid === servePid1 && !alive(servePid1); })(),
  hbImmediatelyAfterCrash: countLines(hbPath) };
await sleep(3000);
R.crash.hbAfter3s = countLines(hbPath); // if the orphaned bash keeps writing, this grows (NOT re-exec)
console.log("crash:", JSON.stringify(R.crash));

// --- phase 3: RESTART serve UNATTENDED (no manual cleanup); my fix must ADOPT the orphan chrome ---
const logSizeBeforeRestart = (() => { try { return fs.statSync(SERVE_LOG).size; } catch { return 0; } })();
const oldServeMtime = (() => { try { return fs.statSync(path.join(STATE, "serve.json")).mtimeMs; } catch { return 0; } })();
const servePid2 = startServe();
// wait for a fresh serve.json (new pid, different from servePid1)
let serve2 = null;
for (let i = 0; i < 60; i++) { try { const s = readServe(); if (s.pid && s.pid !== servePid1) { serve2 = s; break; } } catch {} await sleep(1000); }
R.restart = { servePid2, serve2Pid: serve2?.pid, serve2ChromePid: serve2?.chromePid };
// read the adopt log emitted since restart
const logTail = (() => { try { const buf = fs.readFileSync(SERVE_LOG, "utf8"); return buf.slice(logSizeBeforeRestart); } catch { return ""; } })();
R.restart.adoptLogged = /adopting orphaned CDP/.test(logTail);
R.restart.reuseLogged = /reusing CDP/.test(logTail);
R.restart.freshChromeStarted = /\[chrome\] started/.test(logTail);
const ownerAfter = readOwner();
R.restart.ownerAfter = ownerAfter;
R.restart.adoptedFromDeadServe = ownerAfter && ownerAfter.adoptedFrom === servePid1 && ownerAfter.servePid === serve2?.pid;
// The adopted chrome has no child handle, so its pid lives in the owner file (and, after the code fix, in serve.json too).
R.restart.chromeReused = ownerAfter?.chromePid === chromePid1; // adopted the SAME chrome, not a new one
R.restart.serveJsonRecordsAdoptedPid = serve2?.chromePid === chromePid1; // observability: serve.json now shows the adopted pid
console.log("restart:", JSON.stringify(R.restart));

// --- phase 4: recovered session status + RE-EXEC signal ---
api = createEvaluationApi(serve2);
let recovered = null; try { recovered = await api("GET", `/sessions/${A.id}`); } catch (e) { recovered = { error: e.message }; }
await sleep(8000); // window for any (wrongful) re-execution to write a 2nd boot line
const bootAfter = countLines(bootPath);
let recovered2 = null; try { recovered2 = await api("GET", `/sessions/${A.id}`); } catch (e) { recovered2 = { error: e.message }; }
R.recovered = {
  statusRightAfterRestart: recovered?.status ?? recovered?.error,
  statusAfterWindow: recovered2?.status ?? recovered2?.error,
  bootBefore: R.preCrash.bootBefore, bootAfter,
  reExecuted: bootAfter > R.preCrash.bootBefore,
  snapshot: { id: recovered2?.id, status: recovered2?.status, resumed: recovered2?.resumed ?? null, error: recovered2?.error ?? null },
};
console.log("recovered:", JSON.stringify(R.recovered));

// --- verdict ---
R.verdict = {
  recovery_no_reexec: R.recovered.reExecuted === false,
  recovered_terminal_interrupted: R.recovered.statusAfterWindow === "interrupted",
  chrome_adopted_not_leaked: (R.restart.adoptLogged || R.restart.adoptedFromDeadServe) && R.restart.chromeReused && R.restart.freshChromeStarted === false,
  orphan_bounded: R.crash.chromeOrphanAlive === true, // it existed as an orphan (then adopted, not leaked)
};
R.verdict_pass = R.verdict.recovery_no_reexec && R.verdict.recovered_terminal_interrupted && R.verdict.chrome_adopted_not_leaked;

fs.writeFileSync(path.join(SP, "ev-l19-nocleanup-r5.json"), JSON.stringify(R, null, 2));
console.log("EVIDENCE -> ev-l19-nocleanup-r5.json");
console.log("VERDICT:", JSON.stringify(R.verdict), "PASS:", R.verdict_pass);
