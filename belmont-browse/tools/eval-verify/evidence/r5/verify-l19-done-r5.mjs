// L19.DONE (R5) — a session that COMPLETED (done) before an unattended crash+restart must:
//   PERSISTED:   still be queryable as terminal (done) after restart.
//   EFFECT_ONLY: its external side effect (a file line) survives restart intact (exactly one).
//   CONTINUE.NO_DUP: continuing it does NOT re-execute the original work (effect stays exactly one; no duplicate).
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
const effectCount = (id, name) => { const d = sessionDir(id); if (!d) return 0; try { return fs.readFileSync(path.join(d, name), "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
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

const nonce = crypto.randomUUID().slice(0, 8);
const R = { case: "l19-done-r5", at: new Date().toISOString(), nonce };
let serve = readServe();
let servePid1 = Number(fs.readFileSync(path.join(SP, "eval-serve.pid"), "utf8").trim());
let api = createEvaluationApi(serve);

// A: write exactly one effect line, then finish.
const A = await api("POST", "/sessions", { task: `Run this one bash command and nothing else: echo effect-${nonce} >> EFFECT-${nonce} ; then reply DONE.`, model: "gpt-5.5", thinking: "high", mode: "guard", autoApprove: false });
let v; for (let i = 0; i < 60; i++) { v = await api("GET", `/sessions/${A.id}`); if (TERMINAL.has(v?.status)) break; await sleep(1500); }
R.preCrash = { status: v?.status, effect: effectCount(A.id, `EFFECT-${nonce}`) };
console.log("pre-crash:", JSON.stringify(R.preCrash));

// crash + unattended restart
try { execSync(`kill -9 ${servePid1}`); } catch (e) { R.killError = e.message; }
await sleep(2500);
const servePid2 = startServe();
let serve2 = null; for (let i = 0; i < 60; i++) { try { const s = readServe(); if (s.pid && s.pid !== servePid1) { serve2 = s; break; } } catch {} await sleep(1000); }
api = createEvaluationApi(serve2);
R.restart = { servePid2, serve2Pid: serve2?.pid };

// PERSISTED + EFFECT_ONLY
let after = null; try { after = await api("GET", `/sessions/${A.id}`); } catch (e) { after = { error: e.message }; }
R.persisted = { statusAfter: after?.status ?? after?.error, effectAfter: effectCount(A.id, `EFFECT-${nonce}`) };
console.log("persisted:", JSON.stringify(R.persisted));

// CONTINUE.NO_DUP: continue with a trivial follow-up; the original effect must NOT be re-executed.
let continued = null, contErr = null;
try { continued = await api("POST", `/sessions/${A.id}/continue`, { text: "Reply OK and do nothing else. Do not repeat any previous command." }); }
catch (e) { contErr = e.message; }
let cv; for (let i = 0; i < 60; i++) { try { cv = await api("GET", `/sessions/${A.id}`); } catch {} if (TERMINAL.has(cv?.status)) break; await sleep(1500); }
await sleep(3000);
R.continue = { accepted: !contErr, error: contErr, statusAfterContinue: cv?.status, effectAfterContinue: effectCount(A.id, `EFFECT-${nonce}`) };
console.log("continue:", JSON.stringify(R.continue));

R.verdict = {
  persisted_terminal: after?.status === "done" || TERMINAL.has(after?.status),
  effect_survived_exactly_one: R.persisted.effectAfter === 1 && R.preCrash.effect === 1,
  continue_no_dup: R.continue.effectAfterContinue === 1, // original effect not re-run by continue
};
R.verdict_pass = R.verdict.persisted_terminal && R.verdict.effect_survived_exactly_one && R.verdict.continue_no_dup;
fs.writeFileSync(path.join(SP, "ev-l19-done-r5.json"), JSON.stringify(R, null, 2));
console.log("VERDICT:", JSON.stringify(R.verdict), "PASS:", R.verdict_pass);
