// L19.RUNNING.NO_CLEANUP (R6, stricter per GPT-6 Pro round-5 §C3). Fixes the r5 false-PASS conditions:
//   * read failure is UNKNOWN (-1), not 0; PASS requires bootBefore===1 AND bootAfter===1 exactly.
//   * the new serve pid must equal the pid we actually spawned (not merely != old).
//   * the full recovered session object is preserved (not resumed ?? null).
//   * "orphan bounded" is a REAL host process census of the eval profile, not "orphan was alive".
//   * the observation window (8s) is recorded, not asserted as unbounded no-reexec.
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
const PROFILE = path.join(STATE, "chrome-profile");
const SERVE_LOG = path.join(SP, "eval-serve.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
const readServe = () => JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
function sessionDir(id) { const base = path.join(STATE, "aside-home-909/u/0/sessions"); const hit = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.endsWith(`_${id}`)) : null; return hit ? path.join(base, hit) : null; }
// -1 = read failure (UNKNOWN), >=0 = line count
function countLinesStrict(p) { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).length; } catch { return -1; } }
// host census of the eval profile. root = the actual browser process (has the profile, no --type=child-role);
// tree = every process on the profile (root + renderers/gpu/zygote/utility). --remote-debugging-port propagates
// to children in this build, so it does NOT isolate the root — use the absence of --type= instead.
function census() {
  let root = 0, tree = 0;
  for (const d of fs.readdirSync("/proc")) { if (!/^\d+$/.test(d)) continue; let cl; try { cl = fs.readFileSync(`/proc/${d}/cmdline`, "utf8"); } catch { continue; }
    if (cl.includes(PROFILE)) { tree++; if (!cl.includes("--type=")) root++; } }
  return { root, tree };
}
function startServe() {
  const env = { ...process.env, BELMONT_BROWSE_ENGINE: "909", BELMONT_BROWSE_TRANSPORT: "port", BELMONT_BROWSE_NATIVE_COMPONENTS: "1",
    BELMONT_BROWSE_CHROME: "/home/hoon/chromium/src/out/aside/chrome", BELMONT_BROWSE_CHROME_ARGS: "--ignore-gpu-blocklist",
    BELMONT_BROWSE_DISPLAY: ":0", DISPLAY: ":0", BELMONT_BROWSE_STATE_DIR: PROFILE.replace(/\/chrome-profile$/, ""),
    BELMONT_KNOWLEDGE_DIR: path.join(REPO, ".cache/eval-verify-909/knowledge"), BELMONT_BROWSE_SITES_OVERLAY: "1" };
  const out = fs.openSync(SERVE_LOG, "a");
  const child = spawn(NODE, ["belmont-browse/src/serve.mjs", "--port", "9360", "--engine", "909", "--transport", "port", "--cdp-port", "9333", "--relay-port", "9361"],
    { cwd: REPO, env, stdio: ["ignore", out, out], detached: true });
  child.unref(); fs.writeFileSync(path.join(SP, "eval-serve.pid"), String(child.pid)); return child.pid;
}

const nonce = crypto.randomUUID().slice(0, 8);
const R = { case: "l19-nocleanup-r6", at: new Date().toISOString(), nonce, observationWindowMs: 8000 };
let serve = readServe();
let servePid1 = Number(fs.readFileSync(path.join(SP, "eval-serve.pid"), "utf8").trim());
let api = createEvaluationApi(serve);
const task = `Run this one bash command and nothing else (do not reply until it ends): echo boot-${nonce} >> BOOT-${nonce}; for i in $(seq 1 600); do echo hb-${nonce}-$i >> HB-${nonce}; sleep 1; done`;
const A = await api("POST", "/sessions", { task, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: false });
let sdir = null, hbPath = null, bootPath = null;
for (let i = 0; i < 40; i++) { sdir = sessionDir(A.id); if (sdir) { hbPath = path.join(sdir, `HB-${nonce}`); bootPath = path.join(sdir, `BOOT-${nonce}`); if (countLinesStrict(hbPath) >= 3) break; } await sleep(1000); }
R.preCrash = { sessionDir: sdir, bootBefore: countLinesStrict(bootPath), hbBefore: countLinesStrict(hbPath), census: census() };
console.log("pre-crash:", JSON.stringify(R.preCrash));

try { execSync(`kill -9 ${servePid1}`); } catch (e) { R.killError = e.message; }
await sleep(2500);
R.crash = { census: census() };

const spawnedPid = startServe();
let serve2 = null;
for (let i = 0; i < 60; i++) { try { const s = readServe(); if (s.pid && s.pid !== servePid1) { serve2 = s; break; } } catch {} await sleep(1000); }
api = createEvaluationApi(serve2);
R.restart = { spawnedPid, serve2Pid: serve2?.pid, newServePidMatchesSpawned: serve2?.pid === spawnedPid };

await sleep(R.observationWindowMs);
let recovered = null; try { recovered = await api("GET", `/sessions/${A.id}`); } catch (e) { recovered = { error: e.message }; }
const bootAfter = countLinesStrict(bootPath);
R.recovered = { fullSnapshot: recovered, statusAfter: recovered?.status ?? recovered?.error, bootBefore: R.preCrash.bootBefore, bootAfter, censusAfter: census(),
  sameSessionDir: sessionDir(A.id) === sdir };
console.log("recovered:", JSON.stringify({ status: R.recovered.statusAfter, bootBefore: R.recovered.bootBefore, bootAfter, censusAfter: R.recovered.censusAfter }));

R.verdict = {
  read_ok_and_boot_1_1: R.preCrash.bootBefore === 1 && bootAfter === 1,                 // no read failure, exact 1->1
  no_reexec_in_window: bootAfter === R.preCrash.bootBefore,                              // within the 8s window
  recovered_interrupted: R.recovered.statusAfter === "interrupted",
  same_session_identity: R.recovered.sameSessionDir,
  new_serve_is_spawned_pid: R.restart.newServePidMatchesSpawned === true,
  single_root_browser: R.recovered.censusAfter.root === 1,                               // exactly one browser instance (not accumulating)
  tree_not_grown: R.recovered.censusAfter.tree <= R.preCrash.census.tree,                // adopt reused the same tree; nothing added
};
R.verdict_pass = Object.values(R.verdict).every(Boolean);
fs.writeFileSync(path.join(SP, "ev-l19-nocleanup-r6.json"), JSON.stringify(R, null, 2));
console.log("VERDICT:", JSON.stringify(R.verdict), "PASS:", R.verdict_pass);

process.exit(R.verdict_pass ? 0 : 1); // B-4: verdict failure => non-zero exit
