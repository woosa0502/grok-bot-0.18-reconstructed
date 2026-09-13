// P1-1 recovery re-verify — ORPHAN-ADOPT path (the in-process reaper/adopt, distinct from the supervisor),
// with a per-stage (pid,startTicks) + health + termination trace. serve1 runs DIRECTLY (no supervisor) and is
// SIGKILLed so its detached chrome is ORPHANED (survives); serve2 (also direct) ADOPTS the SAME chrome
// instance (pid+startTicks preserved, not respawned); a normal stop of serve2 reaps it. A CONTROL process is
// asserted untouched throughout. Requires 21420/9333/9360 FREE.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
// Safety (round-2): cleanup signals ONLY through a pidfd bound to a verified instance (safe-pidfd-kill.py),
// never a raw pid, never a group-number signal. Identity REQUIRED — no valid startTicks => REFUSE (no raw-PID
// fallback). Closes the check->signal reuse race; same kernel primitive as the product supervisor.
const SAFE_KILL = path.join(REPO, "belmont-browse/tools/safe-pidfd-kill.py");
function safeKill(pid, expectedTicks) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(expectedTicks) || expectedTicks <= 0) return;
  try { spawnSync("python3", [SAFE_KILL, String(pid), String(expectedTicks), "SIGKILL"], { stdio: "ignore" }); } catch {}
}
async function waitReady(ms = 90000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const h = await health(); if (h.ready === true) return h; await sleep(500); } return await health(); }

const control = spawn("sleep", ["600"], { detached: true, stdio: "ignore" }); control.unref();
await sleep(150); const controlPid = control.pid, controlTicks = startTicks(controlPid);
rec("control-started", { controlPid, controlTicks });
try { fs.rmSync(SERVE_JSON, { force: true }); } catch {} try { fs.rmSync(OWNER, { force: true }); } catch {}

// serve1 (direct). The SPAWNED pid (s1.pid) is the authoritative serve identity; assert serve.json matches it.
const s1 = startServe(); const s1Pid = s1.pid;
const h1 = await waitReady();
const s1Ticks = startTicks(s1Pid);
const o1 = ownerNow(); const chromePid = o1?.chromePid ?? h1.chromePid; const chromeTicks = o1?.startTicks ?? (chromePid ? startTicks(chromePid) : null);
const serve1JsonPid = readJson(SERVE_JSON)?.pid;
const serve1JsonMatches = serve1JsonPid === s1Pid;
rec("serve1-ready", { s1SpawnedPid: s1Pid, serve1JsonPid, jsonMatchesSpawned: serve1JsonMatches, s1Ticks, ready: h1.ready, owner: o1, chromePid, chromeTicks, chromeAlive: alive(chromePid) });
if (h1.ready !== true || !Number.isSafeInteger(chromePid)) { rec("ABORT", { reason: "serve1 not ready" }); try { s1.kill("SIGKILL"); } catch {} try { control.kill("SIGKILL"); } catch {}
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(trace, null, 2)); process.exit(2); }

// CRASH serve1 with no supervisor -> chrome is orphaned (survives). Kill the SPAWNED pid and REQUIRE it died.
try { process.kill(s1Pid, "SIGKILL"); } catch {}
let sw = 0; while (alive(s1Pid) && sw < 8000) { await sleep(200); sw += 200; }
await sleep(1500);
const serve1Died = !alive(s1Pid);
rec("after-serve1-crash", { s1SpawnedPid: s1Pid, serve1Died, chromeAlive: alive(chromePid), chromeTicksMatch: startTicks(chromePid) === chromeTicks, ownerStillNamesDeadServe1: ownerNow()?.servePid === s1Pid, orphanSurvived: serve1Died && alive(chromePid) });

// serve2 (direct) -> must ADOPT the same chrome instance; owner must name the SPAWNED serve2 pid.
const s2 = startServe(); const s2Pid = s2.pid;
const h2 = await waitReady();
const s2Ticks = startTicks(s2Pid);
const o2 = ownerNow(); const serve2JsonPid = readJson(SERVE_JSON)?.pid;
rec("serve2-adopt", { s2SpawnedPid: s2Pid, serve2JsonPid, jsonMatchesSpawned: serve2JsonPid === s2Pid, serve2Ready: h2.ready === true, owner: o2,
  adoptedSameChrome: o2?.chromePid === chromePid, sameStartTicks: o2?.startTicks === chromeTicks,
  ownerIsSpawnedServe2: o2?.servePid === s2Pid, chromeAlive: alive(chromePid) });

// normal stop serve2 -> in-process reaper reaps the adopted chrome
try { process.kill(s2Pid, "SIGTERM"); } catch {}
let waited = 0; while (alive(s2Pid) && waited < 20000) { await sleep(250); waited += 250; }
await sleep(1500);
rec("after-serve2-stop", { s2SpawnedPid: s2Pid, serve2Alive: alive(s2Pid), chromeAlive: alive(chromePid), chromeReaped: !alive(chromePid), controlAlive: alive(controlPid), controlUntouched: alive(controlPid) && startTicks(controlPid) === controlTicks });

const ready1 = trace.stages.find((s) => s.stage === "serve1-ready");
const crash = trace.stages.find((s) => s.stage === "after-serve1-crash");
const adopted = trace.stages.find((s) => s.stage === "serve2-adopt");
const stop = trace.stages.find((s) => s.stage === "after-serve2-stop");
// EVERY recorded stage condition is now gated in the final verdict (round-2: jsonMatchesSpawned, serve2 ready,
// chromeTicksMatch after crash, ownerStillNamesDeadServe1, and serve2Alive===false after stop).
trace.verdict = {
  serve1JsonMatchesSpawned: ready1?.jsonMatchesSpawned === true,
  serve1Died: crash?.serve1Died === true,
  chromeTicksMatchAfterCrash: crash?.chromeTicksMatch === true,
  ownerStillNamesDeadServe1: crash?.ownerStillNamesDeadServe1 === true,
  orphanSurvived: crash?.orphanSurvived === true,
  serve2JsonMatchesSpawned: adopted?.jsonMatchesSpawned === true,
  serve2Ready: adopted?.serve2Ready === true,
  adoptedSameInstance: adopted?.adoptedSameChrome === true && adopted?.sameStartTicks === true,
  ownerIsSpawnedServe2: adopted?.ownerIsSpawnedServe2 === true,
  serve2StoppedCleanly: stop?.serve2Alive === false,
  reapedOnStop: !alive(chromePid),
  controlUntouched: alive(controlPid) && startTicks(controlPid) === controlTicks,
};
trace.result = Object.values(trace.verdict).every(Boolean) ? "PASS" : "FAIL";

// cleanup — instance-bound pidfd kill only (identity required; refuses on absence/mismatch, no raw-PID fallback)
safeKill(controlPid, controlTicks);
safeKill(s1Pid, s1Ticks);
safeKill(s2Pid, s2Ticks);
safeKill(chromePid, chromeTicks);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(trace, null, 2));
console.log("RESULT:", trace.result, "-> traces:", OUT);
process.exit(trace.result === "PASS" ? 0 : 1);
