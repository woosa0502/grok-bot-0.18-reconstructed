// Lifecycle primitives for Chrome processes spawned by this engine only.
import { writeFileSync, readFileSync, rmSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, readdirSync, writeSync } from "node:fs";
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

/** Live host pids whose process group == pgid (pgid must be >1). [] when pgid is invalid/non-Linux. */
export function processGroupMembers(pgid, { isAlive = isProcessAlive, readDir = () => readdirSync("/proc"), stat = procStat } = {}) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1 || process.platform !== "linux") return [];
  const out = [];
  let entries; try { entries = readDir(); } catch { return []; }
  for (const d of entries) { if (!/^\d+$/.test(d)) continue; const pid = Number(d); const s = stat(pid); if (s && s.pgrp === pgid && isAlive(pid)) out.push(pid); }
  return out;
}

/** Exclusive, best-effort per-profile lock around read->plan->write of the owner record (B5). Returns
 * fn()'s value, or undefined when the lock is held by a LIVE holder (caller must act conservatively). */
export function withOwnerLock(profileDir, fn, { retries = 8 } = {}) {
  const lock = ownerLockPath(profileDir);
  for (let i = 0; i < retries; i++) {
    let fd;
    try { fd = openSync(lock, "wx"); }             // O_CREAT|O_EXCL
    catch (error) {
      if (error.code !== "EEXIST") return undefined; // e.g. non-writable dir; caller falls back
      let holder = null; try { holder = Number(readFileSync(lock, "utf8").trim()); } catch {}
      if (!isProcessAlive(holder)) { try { rmSync(lock, { force: true }); } catch {} continue; } // steal stale
      return undefined;                              // a live holder owns it; do not contend
    }
    try { writeSync(fd, String(process.pid)); } catch {}
    try { return fn(); }
    finally { try { closeSync(fd); } catch {} try { rmSync(lock, { force: true }); } catch {} }
  }
  return undefined;
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
  groupMembers = processGroupMembers, ticksOf = processStartTicks }) {
  const validPgid = Number.isSafeInteger(pgid) && pgid > 1;
  let active = null;
  const rootAlive = () => isAlive(browserPid, kill) && (!Number.isSafeInteger(startTicks) || ticksOf(browserPid) === startTicks);
  const groupAlive = () => rootAlive() || (validPgid && groupMembers(pgid).length > 0);
  const signalTree = (sig) => {
    if (validPgid) { try { kill(-pgid, sig); return; } catch { /* fall through to pid */ } }
    if (Number.isSafeInteger(browserPid) && browserPid > 1) { try { kill(browserPid, sig); } catch { /* gone */ } } // never kill(-1)/kill(0)
  };
  const waitEmpty = async (deadline) => { while (Date.now() < deadline) { if (!groupAlive()) return true; await sleep(pollMs); } return !groupAlive(); };
  const finish = () => { if (profileDir && generation) clearChromeOwnerIfGeneration(profileDir, generation); };
  // Each phase gets its own bounded window (capped by timeoutMs) so a slow/refused graceful close can
  // never starve the SIGTERM/SIGKILL escalation (regression: the graceful wait used to consume the whole
  // budget). A refused graceful close is not waited on at all.
  const phaseMs = Math.min(timeoutMs, 3000);
  return function stop() {
    if (active) return active;
    active = (async () => {
      if (!groupAlive()) { finish(); return; }
      if (verifyIdentity) await verifyIdentity();   // throws -> do NOT kill; owner/recovery preserved (B3)
      const controller = new AbortController();
      let gracefulOk = false;
      try { await Promise.resolve().then(() => requestClose?.({ signal: controller.signal, timeoutMs: Math.min(timeoutMs, 2000) })); gracefulOk = true; }
      catch (error) { log(`[chrome] graceful close failed pid=${browserPid}: ${error.message}`); }
      if (gracefulOk && await waitEmpty(Date.now() + phaseMs)) { controller.abort(); finish(); return; }
      controller.abort();
      for (const sig of ["SIGTERM", "SIGKILL"]) { signalTree(sig); if (await waitEmpty(Date.now() + phaseMs)) { finish(); return; } }
      throw new Error(`Chrome tree (pid=${browserPid}, pgid=${validPgid ? pgid : "n/a"}) did not fully exit; owner/recovery preserved`);
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
