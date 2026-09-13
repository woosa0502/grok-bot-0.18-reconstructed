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
const SAFE_KILL = path.join(REPO, "belmont-browse/tools/safe-pidfd-kill.py");
function safeKill(pid, expectedTicks) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(expectedTicks) || expectedTicks <= 0) return; // identity required
  try { spawnSync("python3", [SAFE_KILL, String(pid), String(expectedTicks), "SIGKILL"], { stdio: "ignore" }); } catch {}
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

// wait for serve ready (serve.json + /health ready:true), up to 90s
let ready = false;
for (let i = 0; i < 180 && !ready; i++) { await sleep(500); const h = await health(); if (h.ready === true) { ready = true; break; } }
const h0 = await health();
const o0 = ownerNow();
const chromePid = o0?.chromePid ?? h0.chromePid;
const chromeTicks = o0?.startTicks ?? (chromePid ? startTicks(chromePid) : null);
rec("serve-ready", { ready, health: h0, owner: o0, chromeAlive: alive(chromePid), chromeTicksLive: chromePid ? startTicks(chromePid) : null });

if (!ready || !Number.isSafeInteger(chromePid)) {
  rec("ABORT", { reason: "serve did not become ready / no owned chrome", supTail: supOut.slice(-1500) });
  try { const s = readJson(SERVE_JSON); if (s?.pid) process.kill(s.pid, "SIGTERM"); } catch {}
  try { control.kill("SIGKILL"); } catch {}
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(trace, null, 2));
  process.exit(2);
}

// STAGE: crash the serve (SIGKILL — no in-process chrome cleanup runs; this is the orphan window the supervisor closes)
const servePid = readJson(SERVE_JSON)?.pid;
rec("pre-crash", { servePid, chromePid, chromeTicks, chromeAlive: alive(chromePid), chromeTicksMatch: startTicks(chromePid) === chromeTicks });
try { process.kill(servePid, "SIGKILL"); } catch (e) { rec("serve-kill-error", { error: String(e) }); }

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

// verdict
const chromeReaped = !alive(chromePid);
const controlUntouched = alive(controlPid) && startTicks(controlPid) === controlTicks;
const supClean = supExit && supExit.code === 0;
trace.verdict = { chromeReaped, controlUntouched, supExitClean: supClean };
trace.result = (chromeReaped && controlUntouched && supClean) ? "PASS" : "FAIL";
trace.supervisorLog = supOut.slice(-2500);

// cleanup: instance-bound pidfd kill only (identity required; refuses on absence/mismatch — no raw-PID fallback)
safeKill(controlPid, controlTicks);
safeKill(chromePid, chromeTicks);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(trace, null, 2));
console.log("RESULT:", trace.result, "-> traces:", OUT);
process.exit(trace.result === "PASS" ? 0 : 1);
