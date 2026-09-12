// Lifecycle primitives for Chrome processes spawned by this engine only.
import { writeFileSync, readFileSync, rmSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, linkSync, readdirSync, writeSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Chrome ownership tracking (DEF-L19-CHROME-ORPHAN-001) --------------------------------------
// A serve that launches Chrome records itself as the owner in the profile dir. On restart, another
// serve reads this to decide whether an already-up CDP endpoint is (a) an orphan from a crashed owner
// it must adopt+reap, (b) a browser shared by a still-live serve, (c) a foreign browser, or (d) an
// unknown/ambiguous record it must NOT touch. Hardened per GPT-6 Pro round-5 (B1-B5): atomic owner
// file with a generation token, PID-reuse guard via /proc start ticks, whole-group reaping, and a
// pgid>1 guard so a group signal can never become kill(-1)/kill(0).
const OWNER_BASENAME = ".belmont-chrome-owner.json";
const LOCK_BASENAME = ".belmont-chrome-owner.lock";
export function chromeOwnerPath(profileDir) { return path.join(profileDir, OWNER_BASENAME); }
function ownerLockPath(profileDir) { return path.join(profileDir, LOCK_BASENAME); }

/** True if pid is a live process. EPERM means it exists but is not ours (still "alive"). */
export function isProcessAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

/** Parse /proc/<pid>/stat robustly (comm may contain spaces/parens): read the fields after the last ')'. */
export function procStat(pid, readFile = (p) => readFileSync(p, "utf8")) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || process.platform !== "linux") return null;
  try {
    const raw = readFile(`/proc/${pid}/stat`);
    const after = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    // after[0]=state(f3) [1]=ppid(f4) [2]=pgrp(f5) ... starttime is f22 => index 19
    return { ppid: Number(after[1]), pgrp: Number(after[2]), startTicks: Number(after[19]) };
  } catch { return null; }
}
/** Process start ticks (field 22) — with the pid, uniquely identifies a process across PID reuse. */
export function processStartTicks(pid) { return procStat(pid)?.startTicks ?? null; }

/** Census of a process group. Returns { status:"ok"|"error", members:[pids] }. status "error" (a /proc read
 * failed) is DISTINCT from an empty members list, so a termination judgment never mistakes an observation
 * failure for "the tree is gone" (A-4). pgid must be >1. */
export function processGroupMembers(pgid, { isAlive = isProcessAlive, readDir = () => readdirSync("/proc"), stat = procStat } = {}) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1 || process.platform !== "linux") return { status: "ok", members: [] };
  let entries; try { entries = readDir(); } catch { return { status: "error", members: [] }; }
  const out = []; let errored = false;
  for (const d of entries) {
    if (!/^\d+$/.test(d)) continue;
    const pid = Number(d);
    let s; try { s = stat(pid); } catch { errored = true; continue; } // a read error is not "absent"
    if (s === null) continue; // process is genuinely gone (procStat returns null on ENOENT)
    if (s.pgrp === pgid && isAlive(pid)) out.push(pid);
  }
  return { status: errored ? "error" : "ok", members: out };
}

// ---- per-profile ownership lock (link-based, A-1) ------------------------------------------------
// A correct userspace mutex: the lock file's content ({pid,token}) is written to a temp file and
// fsync'd BEFORE linkSync publishes it, so there is never an empty-content window for a racer to read
// as a dead holder; release unlinks ONLY when the lock still carries OUR token, so a stale/ABA holder
// can never delete a newer owner's lock. A stale lock (dead holder or too old) is stolen atomically by
// renaming it aside — only the winner of that rename proceeds.
function acquireOwnerLock(profileDir, { retries = 12, staleMs = 120000 } = {}) {
  const lock = ownerLockPath(profileDir);
  for (let attempt = 0; attempt < retries; attempt++) {
    const token = crypto.randomUUID();
    const tmp = `${lock}.acq.${process.pid}.${token.slice(0, 8)}`;
    try { const fd = openSync(tmp, "w", 0o600); try { writeSync(fd, JSON.stringify({ pid: process.pid, token, ts: Date.now() })); fsyncSync(fd); } finally { closeSync(fd); } }
    catch { return null; } // cannot even stage (e.g. non-writable dir)
    try { linkSync(tmp, lock); try { unlinkSync(tmp); } catch {} return { lock, token }; } // atomic publish
    catch (error) {
      try { unlinkSync(tmp); } catch {}
      if (error.code !== "EEXIST") return null;
      let holder = null; try { holder = JSON.parse(readFileSync(lock, "utf8")); } catch {}
      const stale = !holder || (Number.isSafeInteger(holder.pid) && !isProcessAlive(holder.pid)) || (Date.now() - (holder.ts || 0) > staleMs);
      if (!stale) return null; // a live holder owns it; caller acts conservatively
      const aside = `${lock}.stale.${process.pid}.${token.slice(0, 8)}`;
      try { renameSync(lock, aside); unlinkSync(aside); } catch {} // atomic steal; loser's rename fails -> retry
    }
  }
  return null;
}
function releaseOwnerLock(handle) {
  if (!handle) return;
  try { const cur = JSON.parse(readFileSync(handle.lock, "utf8")); if (cur.token === handle.token) unlinkSync(handle.lock); } catch { /* not ours / already gone */ }
}
/** Run fn() while holding the per-profile lock. undefined when the lock cannot be acquired. Sync fn only. */
export function withOwnerLock(profileDir, fn, opts) {
  const handle = acquireOwnerLock(profileDir, opts);
  if (!handle) return undefined;
  try { return fn(); } finally { releaseOwnerLock(handle); }
}
/** Async variant: holds the lock across an awaited critical section (spawn path). Releases after it resolves
 * (the sync withOwnerLock would release before an async fn settled). */
export async function withOwnerLockAsync(profileDir, fn, opts) {
  const handle = acquireOwnerLock(profileDir, opts);
  if (!handle) return { locked: false };
  try { return { locked: true, value: await fn() }; } finally { releaseOwnerLock(handle); }
}

/** Atomically publish the owner record (temp -> fsync -> rename). Mints a generation token if absent.
 * Returns the written record on success, or null on failure (B5: failures are observable, not silent). */
export function writeChromeOwner(profileDir, owner) {
  const rec = { ...owner, generation: owner.generation ?? crypto.randomUUID(), startedAt: owner.startedAt ?? new Date().toISOString() };
  const target = chromeOwnerPath(profileDir);
  const tmp = `${target}.tmp.${process.pid}.${crypto.randomUUID().slice(0, 8)}`;
  try {
    const fd = openSync(tmp, "w", 0o600);
    try { writeSync(fd, JSON.stringify(rec)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, target);
    return rec;
  } catch { try { unlinkSync(tmp); } catch {} return null; }
}
/** null = absent; { __corrupt:true } = present but unparseable (distinct so we never adopt blindly). */
export function readChromeOwner(profileDir) {
  let raw; try { raw = readFileSync(chromeOwnerPath(profileDir), "utf8"); } catch { return null; }
  try { return JSON.parse(raw); } catch { return { __corrupt: true }; }
}
export function clearChromeOwner(profileDir) {
  try { rmSync(chromeOwnerPath(profileDir), { force: true }); } catch { /* ignore */ }
}
/** Delete the owner record only if it is still OUR generation — under the lock — so a stale stop can
 * never delete a newer owner's file (B5, R5-OWN-04). */
export function clearChromeOwnerIfGeneration(profileDir, generation) {
  if (!generation) return false;
  return withOwnerLock(profileDir, () => {
    const cur = readChromeOwner(profileDir);
    if (cur && !cur.__corrupt && cur.generation === generation) { clearChromeOwner(profileDir); return true; }
    return false;
  }) ?? false;
}

/** Pure decision from a reuse candidate's owner record: adopt | shared | foreign | unknown.
 * unknown = ambiguous/malformed/reused-pid => the caller must NOT touch the browser (B5). */
export function planReuseOwnership(owner, { isAlive = isProcessAlive, startTicks = processStartTicks } = {}) {
  if (!owner) return { mode: "foreign", reason: "no owner file" };
  if (owner.__corrupt) return { mode: "unknown", reason: "owner file is corrupt" };
  if (!Number.isSafeInteger(owner.chromePid) || owner.chromePid <= 1) return { mode: "foreign", reason: "owner has no valid chromePid" };
  if (!isAlive(owner.chromePid)) return { mode: "foreign", reason: "owner chromePid is dead" };
  if (Number.isSafeInteger(owner.startTicks)) { const cur = startTicks(owner.chromePid); if (cur !== null && cur !== owner.startTicks) return { mode: "unknown", reason: "chromePid reused (start ticks differ)" }; }
  if (!Number.isSafeInteger(owner.servePid) || owner.servePid <= 1) return { mode: "unknown", reason: "owner has no valid servePid" };
  if (isAlive(owner.servePid)) return { mode: "shared", reason: "owning serve is alive" };
  return { mode: "adopt", reason: "owning serve is dead; chrome orphaned" };
}

/** Unified Chrome-tree termination for OWNED and ADOPTED browsers. Reaps the whole process GROUP, not
 * just the root (B2); never sends a group signal unless pgid>1 (B4); re-verifies ownership right before
 * killing via verifyIdentity() which throws to abort (B3); bounds the whole operation by timeoutMs; and
 * clears the owner record only after confirmed full-tree exit AND only if it is still our generation
 * (B1/B5). On failure it throws with the owner/recovery record preserved. */
export function createChromeTreeStop({ browserPid, pgid, startTicks, requestClose, verifyIdentity, profileDir, generation,
  timeoutMs = 10000, pollMs = 150, log = console.error, isAlive = isProcessAlive, kill = process.kill.bind(process),
  groupMembers = processGroupMembers, ticksOf = processStartTicks, stat = procStat }) {
  let active = null;
  const rootAlive = () => isAlive(browserPid, kill) && (!Number.isSafeInteger(startTicks) || ticksOf(browserPid) === startTicks);
  // A group signal is only safe when pgid is a real group (>1) that is provably the OWNED root's actual
  // process group. A valid integer pgid does NOT prove ownership — a wrong owner.pgid must never let us kill
  // another process's group (A-3). We PROVE ownership once, while the root is alive (its pgrp == pgid), and
  // cache that proof so we can still reap surviving members after the root dies (otherwise a dead root would
  // strand its own children). Without the proof we only ever signal the bare root pid.
  let ownedGroupBound = false;
  const bindGroup = () => { if (ownedGroupBound) return true; if (Number.isSafeInteger(pgid) && pgid > 1 && rootAlive()) { const s = stat(browserPid); if (s && s.pgrp === pgid) ownedGroupBound = true; } return ownedGroupBound; };
  // "alive" for termination: the root, or (only when the group is bound to our root) its live members. A
  // census READ ERROR counts as POSSIBLY alive so an observation failure is never read as "gone" (A-4).
  const treeAlive = () => {
    if (rootAlive()) return true;
    if (!ownedGroupBound) return false; // never inspect an unbound (unproven) group
    const c = groupMembers(pgid);
    if (c.status === "error") return true;
    return c.members.length > 0;
  };
  const signalTree = (sig) => {
    if (bindGroup()) { try { kill(-pgid, sig); return; } catch { /* fall through to pid */ } } // group proven ours
    if (Number.isSafeInteger(browserPid) && browserPid > 1) { try { kill(browserPid, sig); } catch { /* gone */ } } // never kill(-1)/kill(0)/wrong group
  };
  const overallDeadline = () => Date.now() + timeoutMs; // set at stop() start; monotonic total bound (A-6)
  const waitEmpty = async (deadline) => { while (Date.now() < deadline) { if (!treeAlive()) return true; await sleep(pollMs); } return !treeAlive(); };
  const finish = () => { if (profileDir && generation) clearChromeOwnerIfGeneration(profileDir, generation); };
  const withDeadline = (p, overall, label) => Promise.race([Promise.resolve().then(() => p), (async () => { while (Date.now() < overall) await sleep(pollMs); throw new Error(`${label} exceeded overall deadline`); })()]);
  return function stop() {
    if (active) return active;
    active = (async () => {
      const overall = overallDeadline();
      const phaseEnd = () => Math.min(overall, Date.now() + Math.min(timeoutMs, 3000));
      if (!treeAlive()) { finish(); return; }
      bindGroup(); // prove group ownership now, while the root is alive, so we can reap survivors later (A-3)
      // A-3: re-verify identity before acting AND before each escalation signal.
      const reverify = async () => { if (verifyIdentity) await withDeadline(verifyIdentity(), overall, "verifyIdentity"); };
      await reverify();   // throws -> do NOT kill; owner/recovery preserved (B3)
      const controller = new AbortController();
      let gracefulOk = false;
      try { await withDeadline(Promise.resolve().then(() => requestClose?.({ signal: controller.signal, timeoutMs: Math.max(0, Math.min(2000, overall - Date.now())) })), overall, "requestClose"); gracefulOk = true; }
      catch (error) { log(`[chrome] graceful close failed pid=${browserPid}: ${error.message}`); }
      if (gracefulOk && await waitEmpty(phaseEnd())) { controller.abort(); finish(); return; }
      controller.abort();
      for (const sig of ["SIGTERM", "SIGKILL"]) {
        try { await reverify(); } catch (e) { throw e; }  // re-verify ownership right before each signal (A-3)
        signalTree(sig);
        if (await waitEmpty(phaseEnd())) { finish(); return; }
      }
      throw new Error(`Chrome tree (pid=${browserPid}, pgid=${Number.isSafeInteger(pgid) ? pgid : "n/a"}) did not fully exit within ${timeoutMs}ms; owner/recovery preserved`);
    })();
    active.catch(() => { active = null; });
    return active;
  };
}

/** Backwards-compatible alias: an adopted orphan is just a tree stop with no child handle. */
export const createAdoptedChromeStop = createChromeTreeStop;

export class BrowserShutdownTimeoutError extends Error {
  constructor({ child, profileDir, timeoutMs }) {
    super(`Chrome pid=${child.pid ?? "unknown"} did not exit within ${timeoutMs}ms after graceful shutdown; its process and profile were preserved for recovery (${profileDir ?? "unknown profile"})`);
    this.name = "BrowserShutdownTimeoutError";
    this.code = "BROWSER_SHUTDOWN_TIMEOUT";
    this.recoverable = true;
    this.pid = child.pid;
    this.profileDir = profileDir;
  }
}

/** Observe immediately after spawn so asynchronous spawn errors are always handled. */
/** Whether an owned browser process is still running; null when the browser is not owned (CDP reuse). */
export function browserAlive(child) {
  if (child == null) return null;
  return child.exitCode === null && child.signalCode == null;
}

export function observeChild(child) {
  let exited = child.exitCode !== null || child.signalCode != null;
  let error = null;
  const onExit = () => { exited = true; };
  const onError = (value) => { error = value; if (!child.pid) exited = true; };
  child.on("exit", onExit);
  child.on("error", onError);
  return { get exited() { return exited || child.exitCode !== null || child.signalCode != null; }, get error() { return error; }, dispose() { child.off("exit", onExit); child.off("error", onError); } };
}

/** Browser.close first; SIGTERM is a graceful fallback only if CDP cannot be used. Never SIGKILL. */
export function createOwnedChromeStop({ child, observed = observeChild(child), requestClose, profileDir, timeoutMs = 10000, log = console.error }) {
  let active = null;
  return function stop() {
    if (active) return active;
    active = (async () => {
      if (observed.exited) { observed.dispose(); return; }
      let timer;
      let onExit;
      let onError;
      const controller = new AbortController();
      const exited = new Promise((resolve, reject) => {
        onExit = resolve;
        onError = (error) => { if (!child.pid) resolve(); else reject(error); };
        child.once("exit", onExit);
        child.once("error", onError);
        timer = setTimeout(() => reject(new BrowserShutdownTimeoutError({ child, profileDir, timeoutMs })), timeoutMs);
      });
      // Await child exit independently: neither a non-responsive CDP close request nor
      // a successful protocol acknowledgement can substitute for actual process exit.
      const request = Promise.resolve().then(() => requestClose?.({ signal: controller.signal })).catch((error) => {
        if (observed.exited || controller.signal.aborted) return;
        log(`[chrome] graceful CDP close unavailable for owned pid=${child.pid}: ${error.message}; requesting SIGTERM`);
        try { child.kill("SIGTERM"); } catch (value) { log(`[chrome] SIGTERM request failed for owned pid=${child.pid}: ${value.message}`); }
      });
      try { await exited; }
      finally {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        controller.abort(new Error("Browser shutdown finished"));
        // Catch is already attached. A timed-out process remains owned and recoverable.
        void request;
        if (observed.exited) observed.dispose();
      }
    })();
    active.catch(() => { active = null; });
    return active;
  };
}
