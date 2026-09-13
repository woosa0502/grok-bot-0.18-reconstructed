// P1-1 recovery re-verify — SUPERVISED-CRASH path (the supervisor's core guarantee), with a per-stage
// (pid,startTicks) + health + termination trace (GPT flagged the r8 HEALTH.DEAD/DOUBLE_CRASH JSONs as
// summary-only). Runs the REAL eval serve UNDER chrome-supervisor.py, then SIGKILLs the serve (a crash with no
// in-process cleanup) and asserts: the supervisor reaps the OWNED chrome instance (pid+startTicks gone), a
// CONTROL process is never mis-killed, and the supervisor exits cleanly. Writes the full trace to argv OUT.
//
// Requires the singleton daemon/CDP/serve ports (21420/9333/9360) FREE (stop any running eval serve first).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const REPO = "/home/hoon/_roots/labs/work/Belmont";
const OUT = process.argv[2] || path.join(REPO, "belmont-browse/tools/eval-verify/evidence/r10/ev-recovery-supervised.json");
const NODE = process.env.BELMONT_TEST_NODE || `${os.homedir()}/.nvm/versions/node/v26.8.1/bin/node`;
const SUP = path.join(REPO, "belmont-browse/tools/chrome-supervisor.py");
const SERVE = path.join(REPO, "belmont-browse/src/serve.mjs");
const STATE = path.join(REPO, "belmont-browse/.state");
const PROFILE = path.join(STATE, "chrome-profile");
const SERVE_JSON = path.join(STATE, "serve.json");
const OWNER = path.join(PROFILE, ".belmont-chrome-owner.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function startTicks(pid) { try { const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return Number(raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/)[19]); } catch { return null; } }
function alive(pid) { if (!Number.isSafeInteger(pid) || pid <= 1) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
// Safety (whole-project review round-2): cleanup signals ONLY through a pidfd bound to a verified instance
// (safe-pidfd-kill.py: os.pidfd_open + signal.pidfd_send_signal, re-verifying startTicks across the open), never a
// raw pid and never a group-number signal. Identity is REQUIRED — with no valid startTicks we REFUSE to signal
// (no raw-PID fallback), closing the check->signal reuse race GPT flagged. This is the same kernel primitive the
// product supervisor uses.
// ALL signals in this driver — crash/stop injections, ABORT cleanup, and final cleanup — go through this helper
// (GPT round-3: unify every termination path; no raw-PID fallback). Identity REQUIRED: no valid startTicks =>
// REFUSE (never a numeric-PID substitute signal).
const SAFE_KILL = path.join(REPO, "belmont-browse/tools/safe-pidfd-kill.py");
const SIGNALLED = 0, REFUSED = 3, ERROR = 4;   // exit codes from safe-pidfd-kill.py (10 = ALREADY_GONE)
// Returns the helper's result CODE so callers distinguish a delivered signal (SIGNALLED) from a no-op.
function safeKill(pid, expectedTicks, sig = "SIGKILL") {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(expectedTicks) || expectedTicks <= 0) return REFUSED; // identity required
  try { const r = spawnSync("python3", [SAFE_KILL, String(pid), String(expectedTicks), sig], { stdio: "ignore" }); return Number.isInteger(r.status) ? r.status : ERROR; } catch { return ERROR; }
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
async function health() {
  const s = readJson(SERVE_JSON); if (!s?.port) return { error: "no serve.json" };
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/health`, { headers: s.token ? { authorization: `Bearer ${s.token}` } : {} });
    let body = null; try { body = JSON.parse(await res.text()); } catch {}
    return { status: res.status, ready: body?.ready ?? null, alive: body?.alive ?? null, chromePid: body?.chromePid ?? s.chromePid ?? null };
  } catch (e) { return { error: String(e.message || e) }; }
}
function ownerNow() { const o = readJson(OWNER); return o ? { servePid: o.servePid, chromePid: o.chromePid, startTicks: o.startTicks, generation: o.generation } : null; }

const trace = { case: "recovery-supervised-crash", at: new Date().toISOString(), node: NODE, stages: [] };
const rec = (name, data) => { const e = { stage: name, t: new Date().toISOString(), ...data }; trace.stages.push(e); console.error(`[stage] ${name}`, JSON.stringify(data)); return e; };

// CONTROL: an unrelated detached process that must NEVER be touched by the reap (mis-kill guard).
const control = spawn("sleep", ["600"], { detached: true, stdio: "ignore" }); control.unref();
await sleep(150);
const controlPid = control.pid, controlTicks = startTicks(controlPid);
rec("control-started", { controlPid, controlTicks, alive: alive(controlPid) });

// clean any stale serve.json/owner so we detect the fresh ones
try { fs.rmSync(SERVE_JSON, { force: true }); } catch {}
try { fs.rmSync(OWNER, { force: true }); } catch {}

const env = { ...process.env,
  BELMONT_BROWSE_ENGINE: "909", BELMONT_BROWSE_TRANSPORT: "port", BELMONT_BROWSE_NATIVE_COMPONENTS: "1",
  BELMONT_BROWSE_CHROME: process.env.BELMONT_BROWSE_CHROME || "/home/hoon/chromium/src/out/aside/chrome",
  BELMONT_BROWSE_CHROME_ARGS: "--ignore-gpu-blocklist", BELMONT_BROWSE_DISPLAY: ":0", DISPLAY: ":0",
  BELMONT_BROWSE_STATE_DIR: STATE, BELMONT_KNOWLEDGE_DIR: path.join(REPO, ".cache/eval-verify-909/knowledge"),
  BELMONT_BROWSE_SITES_OVERLAY: "1" };
const serveArgs = ["--port", "9360", "--engine", "909", "--transport", "port", "--cdp-port", "9333", "--relay-port", "9361"];

const sup = spawn("python3", [SUP, PROFILE, "--", NODE, SERVE, ...serveArgs], { env, stdio: ["ignore", "pipe", "pipe"] });
let supOut = ""; sup.stdout.on("data", (d) => { supOut += d; }); sup.stderr.on("data", (d) => { supOut += d; });
let supExit = null; sup.on("exit", (code, sig) => { supExit = { code, sig }; });

// Capture the serve's identity at the FIRST serve.json sighting (earliest the harness can observe a non-child
// process), BEFORE the ready-wait completes — so a die+reuse during a long wait can't make us adopt a reused
// PID's ticks (GPT round-4). The residual (<= one 100ms poll between serve.json write and our read) is inherent
// to observing a non-child process via serve.json; the serve is alive and just announced itself in that window.
let servePid0 = null, serveTicks = null;
for (let i = 0; i < 600 && servePid0 === null; i++) { const sp = readJson(SERVE_JSON)?.pid; if (Number.isSafeInteger(sp)) { servePid0 = sp; serveTicks = startTicks(sp); break; } await sleep(100); }
// then wait for /health ready:true
let ready = false;
for (let i = 0; i < 180 && !ready; i++) { const h = await health(); if (h.ready === true) { ready = true; break; } await sleep(500); }
const h0 = await health();
const o0 = ownerNow();
const chromePid = o0?.chromePid ?? h0.chromePid;
const chromeTicks = o0?.startTicks ?? (chromePid ? startTicks(chromePid) : null);
rec("serve-ready", { ready, servePid: servePid0, serveTicks, serveJsonPidNow: readJson(SERVE_JSON)?.pid, health: h0, owner: o0, chromeAlive: alive(chromePid), chromeTicksLive: chromePid ? startTicks(chromePid) : null });

if (!ready || !Number.isSafeInteger(chromePid)) {
  rec("ABORT", { reason: "serve did not become ready / no owned chrome", supTail: supOut.slice(-1500) });
  safeKill(servePid0, serveTicks, "SIGTERM");   // pidfd-bound; refuses if identity absent (no raw-PID fallback)
  safeKill(controlPid, controlTicks);
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(trace, null, 2));
  process.exit(2);
}

// STAGE: crash the serve (SIGKILL — no in-process chrome cleanup runs; this is the orphan window the supervisor
// closes). The crash signal is instance-bound via the pidfd helper, same as cleanup.
const servePid = servePid0;
rec("pre-crash", { servePid, serveTicks, chromePid, chromeTicks, chromeAlive: alive(chromePid), chromeTicksMatch: startTicks(chromePid) === chromeTicks });
const crashCode = safeKill(servePid, serveTicks, "SIGKILL");   // require an actually-delivered SIGNALLED result
rec("serve-crash-signal", { code: crashCode, signalled: crashCode === SIGNALLED });

// the supervisor (serve's parent) must regain control and reap the owned chrome, then exit
let waited = 0; while (supExit === null && waited < 30000) { await sleep(250); waited += 250; }
await sleep(500);
rec("post-crash", {
  supExit, supWaitedMs: waited,
  chromeAlive: alive(chromePid),
  chromeTicksNow: alive(chromePid) ? startTicks(chromePid) : null,
  chromeReaped: !alive(chromePid),
  controlAlive: alive(controlPid),
  controlUntouched: alive(controlPid) && startTicks(controlPid) === controlTicks,
  supMentionsReap: /reaping owned chrome instance|chrome exited on SIG/.test(supOut),
});

// verdict — the crash signal must have been actually DELIVERED (SIGNALLED), not a no-op helper exit
const crashSig = trace.stages.find((s) => s.stage === "serve-crash-signal");
const chromeReaped = !alive(chromePid);
const controlUntouched = alive(controlPid) && startTicks(controlPid) === controlTicks;
const supClean = supExit && supExit.code === 0;
trace.verdict = { serveCrashSignalled: crashSig?.signalled === true, chromeReaped, controlUntouched, supExitClean: supClean };
trace.result = Object.values(trace.verdict).every(Boolean) ? "PASS" : "FAIL";
trace.supervisorLog = supOut.slice(-2500);

// cleanup: instance-bound pidfd kill only (identity required; refuses on absence/mismatch — no raw-PID fallback)
safeKill(controlPid, controlTicks);
safeKill(chromePid, chromeTicks);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(trace, null, 2));
console.log("RESULT:", trace.result, "-> traces:", OUT);
process.exit(trace.result === "PASS" ? 0 : 1);
