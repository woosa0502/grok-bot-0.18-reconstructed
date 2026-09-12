// Regression for DEF-L19-CHROME-ORPHAN-001 (hardened per GPT-6 Pro round-5, B1-B5). Real OS processes
// for the tree-reaping paths; injected kill/isAlive/groupMembers for the pure ownership/termination logic.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isProcessAlive, processStartTicks, processGroupMembers, procStat,
  writeChromeOwner, readChromeOwner, chromeOwnerPath, clearChromeOwnerIfGeneration, withOwnerLock,
  planReuseOwnership, createChromeTreeStop,
} from "../src/browser-lifecycle.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = (tag) => mkdtempSync(path.join(tmpdir(), `belmont-${tag}-`));
async function waitDead(pid, timeoutMs = 6000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (!isProcessAlive(pid)) return true; await sleep(50); } return !isProcessAlive(pid); }
// group leader (pgid==pid) that also forks a child in the same group; optional TERM-ignoring child.
function spawnTree({ termIgnore = false } = {}) {
  const childCmd = termIgnore ? "trap '' TERM; sleep 300" : "sleep 300";
  const child = spawn("bash", ["-c", `( ${childCmd} ) & echo $! ; wait`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve) => {
    let buf = ""; child.stdout.on("data", (d) => { buf += d.toString(); const g = Number(buf.trim().split(/\s+/)[0]); if (Number.isSafeInteger(g)) resolve({ leaderPid: child.pid, grandPid: g, child }); });
  });
}
async function deadPid() { const p = spawn("true"); const pid = p.pid; await new Promise((r) => p.on("exit", r)); await sleep(30); return pid; }

// ---- ownership record: atomic write, absent vs corrupt, generation ----
test("owner file: write returns a generation; read distinguishes absent vs corrupt", () => {
  const d = prof("own");
  assert.equal(readChromeOwner(d), null, "absent -> null");
  const rec = writeChromeOwner(d, { servePid: process.pid, chromePid: 12345, pgid: 12345 });
  assert.ok(rec && rec.generation, "write returns a record with a generation");
  assert.equal(readChromeOwner(d).generation, rec.generation);
  writeFileSync(chromeOwnerPath(d), "{not json");
  assert.deepEqual(readChromeOwner(d), { __corrupt: true }, "corrupt -> distinct sentinel, not null");
  rmSync(d, { recursive: true, force: true });
});

// ---- planReuseOwnership: every mode (B5) ----
test("planReuseOwnership covers adopt/shared/foreign/unknown incl. malformed and pid-reuse", () => {
  const alive = (set) => (pid) => set.has(pid);
  // dead serve + live chrome -> adopt
  assert.equal(planReuseOwnership({ chromePid: 10, servePid: 20, startTicks: 5 }, { isAlive: alive(new Set([10])), startTicks: () => 5 }).mode, "adopt");
  // live serve -> shared
  assert.equal(planReuseOwnership({ chromePid: 10, servePid: 20 }, { isAlive: alive(new Set([10, 20])) }).mode, "shared");
  // dead chrome -> foreign
  assert.equal(planReuseOwnership({ chromePid: 10, servePid: 20 }, { isAlive: alive(new Set([20])) }).mode, "foreign");
  // no owner -> foreign; corrupt -> unknown
  assert.equal(planReuseOwnership(null).mode, "foreign");
  assert.equal(planReuseOwnership({ __corrupt: true }).mode, "unknown");
  // malformed servePid -> unknown (must NOT be treated as a dead owner => adopt)
  assert.equal(planReuseOwnership({ chromePid: 10, servePid: 0 }, { isAlive: alive(new Set([10])) }).mode, "unknown");
  assert.equal(planReuseOwnership({ chromePid: 10 }, { isAlive: alive(new Set([10])) }).mode, "unknown");
  // pid reuse: chrome alive but start ticks differ -> unknown (never adopt/kill a reused pid)
  assert.equal(planReuseOwnership({ chromePid: 10, servePid: 20, startTicks: 5 }, { isAlive: alive(new Set([10])), startTicks: () => 999 }).mode, "unknown");
  // pgid<=1 chromePid -> foreign
  assert.equal(planReuseOwnership({ chromePid: 1, servePid: 20 }, { isAlive: alive(new Set([1, 20])) }).mode, "foreign");
});

// ---- clearChromeOwnerIfGeneration: only OUR generation (B5, R5-OWN-04) ----
test("a stale stop cannot delete a newer owner's file", () => {
  const d = prof("gen");
  const first = writeChromeOwner(d, { servePid: process.pid, chromePid: 10, pgid: 10 });
  const second = writeChromeOwner(d, { servePid: process.pid, chromePid: 11, pgid: 11 }); // newer owner
  assert.notEqual(first.generation, second.generation);
  assert.equal(clearChromeOwnerIfGeneration(d, first.generation), false, "stale generation must not delete");
  assert.ok(existsSync(chromeOwnerPath(d)), "newer owner file survives a stale delete");
  assert.equal(clearChromeOwnerIfGeneration(d, second.generation), true, "current generation deletes");
  assert.ok(!existsSync(chromeOwnerPath(d)));
  rmSync(d, { recursive: true, force: true });
});

// ---- withOwnerLock: exclusive under a live holder, steals a stale lock ----
test("withOwnerLock is exclusive (returns undefined under a live holder)", () => {
  const d = prof("lock");
  const ran = withOwnerLock(d, () => withOwnerLock(d, () => "inner")); // reentrant attempt while held -> undefined
  assert.equal(ran, undefined, "cannot acquire while a live holder (self) owns it");
  assert.equal(withOwnerLock(d, () => "ok"), "ok", "acquires freely when unheld");
  rmSync(d, { recursive: true, force: true });
});

// ---- B4: pgid<=1 must never become kill(-1)/kill(0) ----
test("createChromeTreeStop never sends a group signal for pgid<=1 (B4)", async () => {
  const calls = [];
  let aliveRoot = true;
  const kill = (pid, sig) => { calls.push([pid, sig]); if (pid === 42) aliveRoot = false; }; // only the root pid dies
  const isAlive = (pid) => (pid === 42 ? aliveRoot : false);
  const stop = createChromeTreeStop({ browserPid: 42, pgid: 1, timeoutMs: 500, pollMs: 10, kill, isAlive, groupMembers: () => ({ status: "ok", members: [] }) });
  await stop();
  assert.ok(!calls.some(([pid]) => pid <= 0), `must never signal a group id <=0; calls=${JSON.stringify(calls)}`);
  assert.ok(calls.some(([pid]) => pid === 42), "falls back to signalling the bare browser pid");
  rmSync;
});

// ---- B1: a termination that cannot complete PRESERVES the owner record ----
test("stop that cannot kill throws and preserves the owner file (B1)", async () => {
  const d = prof("b1");
  const rec = writeChromeOwner(d, { servePid: process.pid, chromePid: 77, pgid: 77 });
  const stop = createChromeTreeStop({ browserPid: 77, pgid: 77, profileDir: d, generation: rec.generation,
    timeoutMs: 300, pollMs: 20, kill: () => {}, isAlive: () => true, groupMembers: () => ({ status: "ok", members: [77] }) }); // never dies
  await assert.rejects(stop(), /did not fully exit/);
  assert.ok(existsSync(chromeOwnerPath(d)), "owner/recovery record preserved on termination failure");
  rmSync(d, { recursive: true, force: true });
});

// ---- B3: identity mismatch aborts termination WITHOUT killing, owner preserved ----
test("verifyIdentity failure aborts the kill and preserves the owner (B3)", async () => {
  const d = prof("b3");
  const rec = writeChromeOwner(d, { servePid: process.pid, chromePid: 88, pgid: 88 });
  const calls = [];
  const stop = createChromeTreeStop({ browserPid: 88, pgid: 88, profileDir: d, generation: rec.generation, timeoutMs: 500, pollMs: 20,
    kill: (pid, sig) => calls.push([pid, sig]), isAlive: () => true, groupMembers: () => ({ status: "ok", members: [88] }),
    verifyIdentity: async () => { throw new Error("adopt aborted: identity mismatch"); } });
  await assert.rejects(stop(), /identity mismatch/);
  assert.equal(calls.length, 0, "no signal sent when identity fails");
  assert.ok(existsSync(chromeOwnerPath(d)), "owner preserved when identity fails");
  rmSync(d, { recursive: true, force: true });
});

// ---- B2 (real processes): adopt reaps the WHOLE group, incl. a TERM-ignoring child, then clears owner ----
test("adopt: real tree with a TERM-ignoring child is fully reaped; owner cleared only then (B2)", async () => {
  const d = prof("b2");
  const { leaderPid, grandPid } = await spawnTree({ termIgnore: true });
  const startTicks = processStartTicks(leaderPid);
  const rec = writeChromeOwner(d, { servePid: await deadPid(), chromePid: leaderPid, pgid: leaderPid, startTicks });
  const plan = planReuseOwnership(readChromeOwner(d));
  assert.equal(plan.mode, "adopt", plan.reason);
  assert.ok(isProcessAlive(leaderPid) && isProcessAlive(grandPid), "tree alive before stop");
  const stop = createChromeTreeStop({ browserPid: leaderPid, pgid: leaderPid, startTicks, profileDir: d, generation: rec.generation, timeoutMs: 6000, pollMs: 100 });
  await stop();
  assert.ok(await waitDead(leaderPid), "leader dead");
  assert.ok(await waitDead(grandPid), "TERM-ignoring grandchild reaped by SIGKILL escalation");
  assert.ok(!existsSync(chromeOwnerPath(d)), "owner cleared only after confirmed full-tree exit");
  rmSync(d, { recursive: true, force: true });
});

// ---- shared: a live-owner browser is never killed (call site returns a noop; we assert the plan) ----
test("shared: a browser owned by a live serve is not adopted (no kill)", async () => {
  const d = prof("shared");
  const { leaderPid, grandPid, child } = await spawnTree();
  writeChromeOwner(d, { servePid: process.pid, chromePid: leaderPid, pgid: leaderPid, startTicks: processStartTicks(leaderPid) });
  assert.equal(planReuseOwnership(readChromeOwner(d)).mode, "shared");
  assert.ok(isProcessAlive(leaderPid) && isProcessAlive(grandPid), "shared browser stays alive (never adopted)");
  try { process.kill(-leaderPid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
  rmSync(d, { recursive: true, force: true });
});

// ---- procStat / group members sanity on a real tree ----
test("procStat + processGroupMembers see a real detached group", async () => {
  const { leaderPid, grandPid, child } = await spawnTree();
  const s = procStat(leaderPid);
  assert.ok(s && s.pgrp === leaderPid, "leader is its own group");
  const members = processGroupMembers(leaderPid).members;
  assert.ok(members.includes(leaderPid) && members.includes(grandPid), `group members include leader+grandchild: ${members}`);
  try { process.kill(-leaderPid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
});

// ---- A-3 (round-6): a WRONG owner.pgid must NEVER group-kill another process's group ----
test("wrong pgid does not mis-kill a control group; only the owned root is signalled (A-3)", async () => {
  const d = prof("a3");
  const control = await spawnTree();      // a separate group we must NOT touch
  const owned = await spawnTree();        // the process we actually own
  // Owner record deliberately carries the CONTROL group's pgid — the exact mis-kill setup GPT reproduced.
  const startTicks = processStartTicks(owned.leaderPid);
  const rec = writeChromeOwner(d, { servePid: await deadPid(), chromePid: owned.leaderPid, pgid: control.leaderPid, startTicks });
  const stop = createChromeTreeStop({ browserPid: owned.leaderPid, pgid: control.leaderPid, startTicks, profileDir: d, generation: rec.generation, timeoutMs: 5000, pollMs: 100 });
  await stop();
  // bindGroup fails (owned root's real pgrp != control pgid) -> only the bare owned pid is signalled.
  assert.ok(await waitDead(owned.leaderPid), "owned root terminated (bare-pid fallback)");
  assert.ok(isProcessAlive(control.leaderPid), "CONTROL group leader NOT killed by a wrong pgid");
  assert.ok(isProcessAlive(control.grandPid), "CONTROL group child NOT killed by a wrong pgid");
  try { process.kill(-control.leaderPid, "SIGKILL"); } catch {}
  try { process.kill(-owned.leaderPid, "SIGKILL"); } catch {}
  rmSync(d, { recursive: true, force: true });
});

// ---- A-4 (round-6): after the root dies, a census READ ERROR must not be read as "tree gone" ----
test("census error (bound group) counts as possibly-alive; stop does not falsely clear the owner (A-4)", async () => {
  const d = prof("a4");
  const rec = writeChromeOwner(d, { servePid: process.pid, chromePid: 4242, pgid: 4242, startTicks: 5 });
  let killed = false; // root is alive until the first signal, so the group binds while it is alive
  const stop = createChromeTreeStop({ browserPid: 4242, pgid: 4242, startTicks: 5, profileDir: d, generation: rec.generation,
    timeoutMs: 200, pollMs: 20, isAlive: () => !killed, kill: () => { killed = true; }, ticksOf: () => 5,
    stat: () => ({ ppid: 1, pgrp: 4242, startTicks: 5 }),      // bindGroup succeeds while root alive
    groupMembers: () => ({ status: "error", members: [] }) });  // after root dies, census cannot be read
  await stop().catch(() => {});
  assert.ok(existsSync(chromeOwnerPath(d)), "owner preserved: an observation failure is never 'tree gone'");
  rmSync(d, { recursive: true, force: true });
});

// ---- A-6 (round-6): a hanging graceful close must not exceed the overall deadline ----
test("stop enforces an overall deadline even if requestClose hangs (A-6)", async () => {
  const d = prof("a6");
  const rec = writeChromeOwner(d, { servePid: process.pid, chromePid: 5252, pgid: 5252 });
  let killed = false;
  const stop = createChromeTreeStop({ browserPid: 5252, pgid: 5252, profileDir: d, generation: rec.generation,
    timeoutMs: 400, pollMs: 20, isAlive: () => !killed, kill: () => { killed = true; }, groupMembers: () => ({ status: "ok", members: [] }),
    requestClose: () => new Promise(() => {}) }); // never resolves
  const t0 = Date.now();
  await stop().catch(() => {});
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 4000, `stop must not hang on an unresolving requestClose (elapsed=${elapsed}ms)`);
  rmSync(d, { recursive: true, force: true });
});

// ---- A-1 (round-6): the lock is exclusive against a REAL concurrent holder ----
test("withOwnerLock is exclusive while another process holds it (A-1)", async () => {
  const d = prof("a1");
  const holder = path.join(d, "holder.mjs");
  writeFileSync(holder, `import { withOwnerLock } from ${JSON.stringify(new URL("../src/browser-lifecycle.mjs", import.meta.url).href)};
import fs from "node:fs"; const d=process.argv[2];
withOwnerLock(d, () => { fs.writeFileSync(d+"/held","1"); const end=Date.now()+2500; while(Date.now()<end && !fs.existsSync(d+"/go")){} });
`);
  const child = spawn(process.execPath, [holder, d], { stdio: "ignore" });
  try {
    for (let i = 0; i < 100 && !existsSync(path.join(d, "held")); i++) await sleep(30); // wait until the child holds it
    assert.ok(existsSync(path.join(d, "held")), "holder acquired the lock");
    const got = withOwnerLock(d, () => "acquired-while-held");
    assert.equal(got, undefined, "must NOT acquire while another live process holds the lock");
  } finally { writeFileSync(path.join(d, "go"), "1"); await new Promise((r) => child.on("exit", r)); }
  assert.equal(withOwnerLock(d, () => "ok-after-release"), "ok-after-release", "acquires after the holder releases");
  rmSync(d, { recursive: true, force: true });
});
