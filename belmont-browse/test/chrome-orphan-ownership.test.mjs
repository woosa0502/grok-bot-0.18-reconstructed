// Regression for DEF-L19-CHROME-ORPHAN-001: a restart must adopt an orphaned browser with a REAL
// group-killing stop (not a noop), and must NOT kill a shared/foreign browser. Uses real OS
// processes as stand-ins for Chrome so it needs no Chrome/CDP.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isProcessAlive, writeChromeOwner, readChromeOwner, chromeOwnerPath,
  planReuseOwnership, createAdoptedChromeStop,
} from "../src/browser-lifecycle.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDead(pid, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (!isProcessAlive(pid)) return true; await sleep(50); }
  return !isProcessAlive(pid);
}
// A detached group leader (pgid == pid) that also forks a child in the same group, to prove the
// whole tree is reaped, not just the leader.
function spawnFakeChromeTree() {
  const child = spawn("bash", ["-c", "sleep 300 & echo $! ; wait"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const grandPid = Number(buf.trim().split(/\s+/)[0]);
      if (Number.isSafeInteger(grandPid)) resolve({ leaderPid: child.pid, grandPid, child });
    });
  });
}
async function makeDeadPid() {
  const p = spawn("true");
  const pid = p.pid;
  await new Promise((r) => p.on("exit", r));
  await sleep(30);
  return pid;
}

test("adopt: dead owner serve -> real stop reaps the whole browser process group", async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), "belmont-orphan-"));
  const { leaderPid, grandPid } = await spawnFakeChromeTree();
  const deadServe = await makeDeadPid();
  writeChromeOwner(profileDir, { servePid: deadServe, chromePid: leaderPid, pgid: leaderPid });

  const plan = planReuseOwnership(readChromeOwner(profileDir));
  assert.equal(plan.mode, "adopt", plan.reason);

  assert.ok(isProcessAlive(leaderPid) && isProcessAlive(grandPid), "tree alive before stop");
  const stop = createAdoptedChromeStop({ browserPid: leaderPid, pgid: leaderPid, profileDir, timeoutMs: 800 });
  await stop();
  assert.ok(await waitDead(leaderPid), "group leader must be dead after adopted stop");
  assert.ok(await waitDead(grandPid), "grandchild must be reaped by group kill");
  assert.ok(!existsSync(chromeOwnerPath(profileDir)), "owner file cleared after reap");
  rmSync(profileDir, { recursive: true, force: true });
});

test("shared: live owner serve -> decision 'shared' (noop stop, no kill)", async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), "belmont-shared-"));
  const { leaderPid, grandPid, child } = await spawnFakeChromeTree();
  writeChromeOwner(profileDir, { servePid: process.pid, chromePid: leaderPid, pgid: leaderPid }); // our pid is alive

  const plan = planReuseOwnership(readChromeOwner(profileDir));
  assert.equal(plan.mode, "shared", plan.reason);
  assert.ok(isProcessAlive(leaderPid) && isProcessAlive(grandPid), "shared browser must remain alive");

  try { process.kill(-leaderPid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } // cleanup
  rmSync(profileDir, { recursive: true, force: true });
});

test("foreign: no owner file -> decision 'foreign' (do not touch)", () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), "belmont-foreign-"));
  const plan = planReuseOwnership(readChromeOwner(profileDir));
  assert.equal(plan.mode, "foreign", plan.reason);
  rmSync(profileDir, { recursive: true, force: true });
});

test("dead chromePid in owner file -> 'foreign' (nothing to reap)", async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), "belmont-deadchrome-"));
  const deadChrome = await makeDeadPid();
  writeChromeOwner(profileDir, { servePid: await makeDeadPid(), chromePid: deadChrome, pgid: deadChrome });
  const plan = planReuseOwnership(readChromeOwner(profileDir));
  assert.equal(plan.mode, "foreign", plan.reason);
  rmSync(profileDir, { recursive: true, force: true });
});
