// Lifecycle primitives for Chrome processes spawned by this engine only.
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Chrome ownership tracking (DEF-L19-CHROME-ORPHAN-001) --------------------------------------
// A serve that launches Chrome records itself as the owner in the profile dir. On restart, another
// serve reads this to decide whether an already-up CDP endpoint is (a) an orphan from a crashed
// owner it must adopt+reap, (b) a browser shared by a still-live serve, or (c) a foreign browser.
const OWNER_BASENAME = ".belmont-chrome-owner.json";
export function chromeOwnerPath(profileDir) { return path.join(profileDir, OWNER_BASENAME); }

/** True if pid is a live process. EPERM means it exists but is not ours (still "alive"). */
export function isProcessAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

export function writeChromeOwner(profileDir, owner) {
  try {
    writeFileSync(chromeOwnerPath(profileDir),
      JSON.stringify({ ...owner, startedAt: owner.startedAt ?? new Date().toISOString() }),
      { mode: 0o600 });
  } catch { /* best-effort; ownership tracking never blocks a launch */ }
}
export function readChromeOwner(profileDir) {
  try { return JSON.parse(readFileSync(chromeOwnerPath(profileDir), "utf8")); }
  catch { return null; }
}
export function clearChromeOwner(profileDir) {
  try { rmSync(chromeOwnerPath(profileDir), { force: true }); } catch { /* ignore */ }
}

/** Pure decision: given a reuse candidate's owner record, is it ours-to-adopt, shared, or foreign? */
export function planReuseOwnership(owner, { isAlive = isProcessAlive } = {}) {
  if (!owner || !Number.isSafeInteger(owner.chromePid)) return { mode: "foreign", reason: "no owner file" };
  if (!isAlive(owner.chromePid)) return { mode: "foreign", reason: "owner file names a dead chromePid" };
  if (Number.isSafeInteger(owner.servePid) && isAlive(owner.servePid)) return { mode: "shared", reason: "owning serve is alive" };
  return { mode: "adopt", reason: "owning serve is dead; chrome orphaned" };
}

/** Real termination for an ADOPTED orphan (no child handle): Browser.close (graceful) then escalate
 * SIGTERM->SIGKILL to the whole process group (fallback to the bare pid), verifying actual exit. */
export function createAdoptedChromeStop({ browserPid, pgid = browserPid, requestClose, profileDir,
  timeoutMs = 10000, pollMs = 200, log = console.error, isAlive = isProcessAlive, kill = process.kill.bind(process) }) {
  let active = null;
  const done = () => { if (profileDir) clearChromeOwner(profileDir); };
  const signalGroup = (sig) => { try { kill(-pgid, sig); } catch { try { kill(browserPid, sig); } catch { /* gone */ } } };
  const waitGone = async (deadline) => { while (Date.now() < deadline) { if (!isAlive(browserPid, kill)) return true; await sleep(pollMs); } return !isAlive(browserPid, kill); };
  return function stop() {
    if (active) return active;
    active = (async () => {
      if (!isAlive(browserPid, kill)) { done(); return; }
      const controller = new AbortController();
      try { await Promise.resolve().then(() => requestClose?.({ signal: controller.signal })); }
      catch (error) { log(`[chrome] adopted graceful close failed pid=${browserPid}: ${error.message}`); }
      if (await waitGone(Date.now() + Math.min(timeoutMs, 3000))) { controller.abort(); done(); return; }
      controller.abort();
      for (const sig of ["SIGTERM", "SIGKILL"]) {
        signalGroup(sig);
        if (await waitGone(Date.now() + Math.min(timeoutMs, 4000))) { done(); return; }
      }
      throw new Error(`Adopted Chrome pid=${browserPid} (pgid=${pgid}) did not exit after SIGTERM/SIGKILL`);
    })();
    active.catch(() => { active = null; });
    return active;
  };
}

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
