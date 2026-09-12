// L19.CHROME.ADOPT.FINAL_REAP (R6) — the acceptance GPT-6 Pro round-5 §D1 demanded: not just "adopted the
// same Chrome", but that a NORMAL serve shutdown actually reaps the entire OWNED tree, while an unrelated
// control browser survives. Flow: (control browser up) -> crash serve -> restart adopts -> NORMAL stop serve
// (SIGTERM) -> assert eval-profile census == 0 and owner file cleared, control browser still alive.
import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
const REPO = "/home/hoon/_roots/labs/work/Belmont";
const NODE = `${process.env.HOME}/.nvm/versions/node/v26.8.1/bin/node`;
const SP = process.argv[2] || "/tmp";
const STATE = path.join(REPO, "belmont-browse/.state");
const PROFILE = path.join(STATE, "chrome-profile");
const OWNER = path.join(PROFILE, ".belmont-chrome-owner.json");
const SERVE_LOG = path.join(SP, "eval-serve.log");
const CHROME = "/home/hoon/chromium/src/out/aside/chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readServe = () => JSON.parse(fs.readFileSync(path.join(STATE, "serve.json"), "utf8"));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function census() { let root = 0, tree = 0; for (const d of fs.readdirSync("/proc")) { if (!/^\d+$/.test(d)) continue; let cl; try { cl = fs.readFileSync(`/proc/${d}/cmdline`, "utf8"); } catch { continue; } if (cl.includes(PROFILE)) { tree++; if (!cl.includes("--type=")) root++; } } return { root, tree }; }
function startServe() {
  const env = { ...process.env, BELMONT_BROWSE_ENGINE: "909", BELMONT_BROWSE_TRANSPORT: "port", BELMONT_BROWSE_NATIVE_COMPONENTS: "1",
    BELMONT_BROWSE_CHROME: CHROME, BELMONT_BROWSE_CHROME_ARGS: "--ignore-gpu-blocklist", BELMONT_BROWSE_DISPLAY: ":0", DISPLAY: ":0",
    BELMONT_BROWSE_STATE_DIR: path.join(REPO, "belmont-browse/.state"), BELMONT_KNOWLEDGE_DIR: path.join(REPO, ".cache/eval-verify-909/knowledge"), BELMONT_BROWSE_SITES_OVERLAY: "1" };
  const out = fs.openSync(SERVE_LOG, "a");
  const child = spawn(NODE, ["belmont-browse/src/serve.mjs", "--port", "9360", "--engine", "909", "--transport", "port", "--cdp-port", "9333", "--relay-port", "9361"], { cwd: REPO, env, stdio: ["ignore", out, out], detached: true });
  child.unref(); fs.writeFileSync(path.join(SP, "eval-serve.pid"), String(child.pid)); return child.pid;
}

const R = { case: "l19-chrome-finalreap-r6", at: new Date().toISOString() };
// control browser on a DIFFERENT profile + port; must survive the serve's cleanup (we only reap what we own).
const CTRL_PROFILE = path.join(SP, "ctrl-chrome-profile");
const ctrl = spawn(CHROME, [`--user-data-dir=${CTRL_PROFILE}`, "--remote-debugging-port=9998", "--headless=new", "--no-first-run", "--ignore-gpu-blocklist", "about:blank"], { env: { ...process.env, DISPLAY: ":0" }, stdio: ["ignore", "ignore", "ignore"], detached: true });
ctrl.unref();
await sleep(4000);
R.control = { pid: ctrl.pid, aliveBefore: alive(ctrl.pid) };

let servePid1 = Number(fs.readFileSync(path.join(SP, "eval-serve.pid"), "utf8").trim());
R.beforeCrash = { census: census(), owner: fs.existsSync(OWNER) };
// crash + restart (adopt)
try { execSync(`kill -9 ${servePid1}`); } catch {}
await sleep(2500);
const spawnedPid = startServe();
let serve2 = null; for (let i = 0; i < 60; i++) { try { const s = readServe(); if (s.pid && s.pid !== servePid1) { serve2 = s; break; } } catch {} await sleep(1000); }
R.afterAdopt = { serve2Pid: serve2?.pid, census: census(), owner: fs.existsSync(OWNER), adoptLogged: /adopting orphaned CDP/.test(fs.readFileSync(SERVE_LOG, "utf8").slice(-4000)) };
console.log("after adopt:", JSON.stringify(R.afterAdopt));

// NORMAL shutdown: SIGTERM the serve and wait for it to exit; its cleanup must reap the owned tree.
try { process.kill(serve2.pid, "SIGTERM"); } catch (e) { R.termError = e.message; }
for (let i = 0; i < 40; i++) { if (!alive(serve2.pid)) break; await sleep(500); }
await sleep(3000); // grace for the tree to fully exit
R.afterNormalStop = { serveAlive: alive(serve2.pid), census: census(), owner: fs.existsSync(OWNER), controlAlive: alive(ctrl.pid) };
console.log("after normal stop:", JSON.stringify(R.afterNormalStop));

R.verdict = {
  adopted_same_tree: R.afterAdopt.census.root === 1 && R.afterAdopt.adoptLogged,
  serve_exited: R.afterNormalStop.serveAlive === false,
  owned_tree_fully_reaped: R.afterNormalStop.census.root === 0 && R.afterNormalStop.census.tree === 0,
  owner_file_cleared: R.afterNormalStop.owner === false,
  control_browser_survived: R.afterNormalStop.controlAlive === true,
};
R.verdict_pass = Object.values(R.verdict).every(Boolean);
fs.writeFileSync(path.join(SP, "ev-l19-chrome-finalreap-r6.json"), JSON.stringify(R, null, 2));
// cleanup control browser explicitly
try { process.kill(-ctrl.pid, "SIGKILL"); } catch { try { process.kill(ctrl.pid, "SIGKILL"); } catch {} }
console.log("VERDICT:", JSON.stringify(R.verdict), "PASS:", R.verdict_pass);
