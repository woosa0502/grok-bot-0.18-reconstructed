// Lifecycle primitives for Chrome processes spawned by this engine only.
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
