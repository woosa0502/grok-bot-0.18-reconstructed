// P1-1 recovery re-verify — ORPHAN-ADOPT path (the in-process reaper/adopt, distinct from the supervisor),
// with a per-stage (pid,startTicks) + health + termination trace. serve1 runs DIRECTLY (no supervisor) and is
// SIGKILLed so its detached chrome is ORPHANED (survives); serve2 (also direct) ADOPTS the SAME chrome
// instance (pid+startTicks preserved, not respawned); a normal stop of serve2 reaps it. A CONTROL process is
// asserted untouched throughout. Requires 21420/9333/9360 FREE.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const REPO = "/home/hoon/_roots/labs/work/Belmont";
const OUT = process.argv[2] || path.join(REPO, "belmont-browse/tools/eval-verify/evidence/r10/ev-recovery-orphan-adopt.json");
const NODE = process.env.BELMONT_TEST_NODE || `${os.homedir()}/.nvm/versions/node/v26.8.1/bin/node`;
const SERVE = path.join(REPO, "belmont-browse/src/serve.mjs");
const STATE = path.join(REPO, "belmont-browse/.state");
const PROFILE = path.join(STATE, "chrome-profile");
const SERVE_JSON = path.join(STATE, "serve.json");
const OWNER = path.join(PROFILE, ".belmont-chrome-owner.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function startTicks(pid) { try { const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return Number(raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/)[19]); } catch { return null; } }
function alive(pid) { if (!Number.isSafeInteger(pid) || pid <= 1) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
async function health() {
  const s = readJson(SERVE_JSON); if (!s?.port) return { error: "no serve.json" };
  try { const res = await fetch(`http://127.0.0.1:${s.port}/health`, { headers: s.token ? { authorization: `Bearer ${s.token}` } : {} });
    let b = null; try { b = JSON.parse(await res.text()); } catch {} return { status: res.status, ready: b?.ready ?? null, servePid: s.pid, chromePid: b?.chromePid ?? s.chromePid ?? null };
  } catch (e) { return { error: String(e.message || e) }; }
}
const ownerNow = () => { const o = readJson(OWNER); return o ? { servePid: o.servePid, chromePid: o.chromePid, startTicks: o.startTicks, generation: o.generation } : null; };

const env = { ...process.env,
  BELMONT_BROWSE_ENGINE: "909", BELMONT_BROWSE_TRANSPORT: "port", BELMONT_BROWSE_NATIVE_COMPONENTS: "1",
  BELMONT_BROWSE_CHROME: process.env.BELMONT_BROWSE_CHROME || "/home/hoon/chromium/src/out/aside/chrome",
  BELMONT_BROWSE_CHROME_ARGS: "--ignore-gpu-blocklist", BELMONT_BROWSE_DISPLAY: ":0", DISPLAY: ":0",
  BELMONT_BROWSE_STATE_DIR: STATE, BELMONT_KNOWLEDGE_DIR: path.join(REPO, ".cache/eval-verify-909/knowledge"),
  BELMONT_BROWSE_SITES_OVERLAY: "1" };
const serveArgs = ["--port", "9360", "--engine", "909", "--transport", "port", "--cdp-port", "9333", "--relay-port", "9361"];
const trace = { case: "recovery-orphan-adopt", at: new Date().toISOString(), stages: [] };
const rec = (name, data) => { trace.stages.push({ stage: name, t: new Date().toISOString(), ...data }); console.error(`[stage] ${name}`, JSON.stringify(data)); };
const startServe = () => spawn(NODE, [SERVE, ...serveArgs], { env, stdio: ["ignore", "ignore", "ignore"], detached: false });
async function waitReady(ms = 90000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const h = await health(); if (h.ready === true) return h; await sleep(500); } return await health(); }

const control = spawn("sleep", ["600"], { detached: true, stdio: "ignore" }); control.unref();
await sleep(150); const controlPid = control.pid, controlTicks = startTicks(controlPid);
rec("control-started", { controlPid, controlTicks });
try { fs.rmSync(SERVE_JSON, { force: true }); } catch {} try { fs.rmSync(OWNER, { force: true }); } catch {}

// serve1 (direct)
const s1 = startServe();
const h1 = await waitReady();
const o1 = ownerNow(); const chromePid = o1?.chromePid ?? h1.chromePid; const chromeTicks = o1?.startTicks ?? (chromePid ? startTicks(chromePid) : null);
rec("serve1-ready", { serve1Pid: readJson(SERVE_JSON)?.pid, ready: h1.ready, owner: o1, chromePid, chromeTicks, chromeAlive: alive(chromePid) });
if (h1.ready !== true || !Number.isSafeInteger(chromePid)) { rec("ABORT", { reason: "serve1 not ready" }); try { s1.kill("SIGKILL"); } catch {} try { control.kill("SIGKILL"); } catch {}
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(trace, null, 2)); process.exit(2); }

// CRASH serve1 with no supervisor -> chrome is orphaned (survives)
const serve1Pid = readJson(SERVE_JSON)?.pid;
try { process.kill(serve1Pid, "SIGKILL"); } catch {}
await sleep(2000);
rec("after-serve1-crash", { serve1Alive: alive(serve1Pid), chromeAlive: alive(chromePid), chromeTicksMatch: startTicks(chromePid) === chromeTicks, ownerStillNamesDeadServe1: ownerNow()?.servePid === serve1Pid, orphanSurvived: alive(chromePid) });

// serve2 (direct) -> must ADOPT the same chrome instance
const s2 = startServe();
const h2 = await waitReady();
const o2 = ownerNow();
rec("serve2-adopt", { serve2Pid: readJson(SERVE_JSON)?.pid, ready: h2.ready, owner: o2,
  adoptedSameChrome: o2?.chromePid === chromePid, sameStartTicks: o2?.startTicks === chromeTicks,
  ownerNowServe2: o2?.servePid === readJson(SERVE_JSON)?.pid, chromeAlive: alive(chromePid) });

// normal stop serve2 -> in-process reaper reaps the adopted chrome
const serve2Pid = readJson(SERVE_JSON)?.pid;
try { process.kill(serve2Pid, "SIGTERM"); } catch {}
let waited = 0; while (alive(serve2Pid) && waited < 20000) { await sleep(250); waited += 250; }
await sleep(1500);
rec("after-serve2-stop", { serve2Alive: alive(serve2Pid), chromeAlive: alive(chromePid), chromeReaped: !alive(chromePid), controlAlive: alive(controlPid), controlUntouched: alive(controlPid) && startTicks(controlPid) === controlTicks });

const orphanSurvived = trace.stages.find((s) => s.stage === "after-serve1-crash")?.orphanSurvived === true;
const adopted = trace.stages.find((s) => s.stage === "serve2-adopt");
const adoptedSame = adopted?.adoptedSameChrome === true && adopted?.sameStartTicks === true;
const reaped = !alive(chromePid);
const controlUntouched = alive(controlPid) && startTicks(controlPid) === controlTicks;
trace.verdict = { orphanSurvived, adoptedSameInstance: adoptedSame, reapedOnStop: reaped, controlUntouched };
trace.result = (orphanSurvived && adoptedSame && reaped && controlUntouched) ? "PASS" : "FAIL";

// cleanup
try { control.kill("SIGKILL"); } catch {}
for (const p of [serve1Pid, serve2Pid, chromePid]) { if (alive(p)) { try { process.kill(-p, "SIGKILL"); } catch {} try { process.kill(p, "SIGKILL"); } catch {} } }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(trace, null, 2));
console.log("RESULT:", trace.result, "-> traces:", OUT);
process.exit(trace.result === "PASS" ? 0 : 1);
