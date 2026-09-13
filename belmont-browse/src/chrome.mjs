// belmont-browse: launch (or reuse) a stock Chrome with CDP on the Belmont virtual display (our code).
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fetchJson, MiniCdp } from "./cdp-mini.mjs";
import { observeChild, readChromeOwner, writeChromeOwner, planReuseOwnership, createChromeTreeStop, withOwnerLock, processStartTicks, processGroupMembers, isProcessAlive, procStat } from "./browser-lifecycle.mjs";

const CHROME_CANDIDATES = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

/** BELMONT_BROWSE_NO_SANDBOX is a boolean option: "1"/"true"/"yes"/"on" disable the Chromium sandbox; "0"/"false"/
 * "no"/"off"/unset keep it. Any other value is rejected so a typo cannot silently drop the sandbox. */
export function isNoSandboxRequested(value = process.env.BELMONT_BROWSE_NO_SANDBOX) {
  if (value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "" || ["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  throw new Error(`BELMONT_BROWSE_NO_SANDBOX must be 1/true/yes/on or 0/false/no/off, got ${JSON.stringify(value)}`);
}

export function findChromeBinary() {
  const fromEnv = process.env.BELMONT_BROWSE_CHROME?.trim();
  if (fromEnv) return fromEnv;
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome binary not found; set BELMONT_BROWSE_CHROME");
  return found;
}

export async function isCdpUp(baseUrl) {
  try {
    await fetchJson(`${baseUrl}/json/version`, { timeoutMs: 1500 });
    return true;
  } catch {
    return false;
  }
}

export async function ensureChrome({ port = 9333, display = ":99", profileDir, windowSize = "1280,800", startUrl = "about:blank", log = console.error, chromeBinary, nativeComponentVersion, asideHome, startupTimeoutMs = 20000, shutdownTimeoutMs = 10000, pollIntervalMs = 250 }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  if (await isCdpUp(baseUrl)) {
    if (nativeComponentVersion) {
      await verifyReusableNativeChrome({ baseUrl, profileDir, nativeComponentVersion, asideHome });
    }
    // DEF-L19-CHROME-ORPHAN-001 (hardened per GPT-6 Pro round-5). Never reuse with a noop stop. Decide
    // ownership under an exclusive lock (CAS) so two serves cannot both adopt the same orphan (B5); only
    // adopt when the owner serve is provably dead and the pid identity checks out; otherwise leave the
    // browser untouched (shared/foreign/unknown => noop). The adopted stop re-verifies identity right
    // before killing and reaps the whole group (B2/B3/B4).
    const adopted = withOwnerLock(profileDir, () => {
      const owner = readChromeOwner(profileDir);
      const plan = planReuseOwnership(owner);
      if (plan.mode !== "adopt") return { plan, owner };
      // A-3: the AUTHORITATIVE process group is the live root's actual pgrp, not whatever the owner file
      // claims. Prefer the live pgrp so a stale/wrong owner.pgid can never point group signals elsewhere.
      const pgid = procStat(owner.chromePid)?.pgrp ?? (Number.isSafeInteger(owner.pgid) && owner.pgid > 1 ? owner.pgid : null);
      const startTicks = Number.isSafeInteger(owner.startTicks) ? owner.startTicks : processStartTicks(owner.chromePid);
      const rec = writeChromeOwner(profileDir, { servePid: process.pid, chromePid: owner.chromePid, pgid, startTicks, startedAt: owner.startedAt, adoptedFrom: owner.servePid });
      return { plan, owner, pgid, startTicks, generation: rec?.generation };
    });
    if (adopted && adopted.plan?.mode === "adopt" && adopted.generation) {
      const { owner, pgid, startTicks, generation } = adopted;
      log(`[chrome] adopting orphaned CDP at ${baseUrl} (owner serve pid=${owner.servePid} dead; chrome pid=${owner.chromePid}, pgid=${pgid}); taking termination ownership`);
      // Re-verify ownership right before we terminate: our generation still stands, the pid was not
      // reused, and the live CDP endpoint is actually our owned browser process (B3).
      const verifyIdentity = async () => {
        const cur = readChromeOwner(profileDir);
        if (!cur || cur.__corrupt || cur.generation !== generation) throw new Error("adopt aborted: owner record changed since adoption");
        if (!isProcessAlive(cur.chromePid)) return; // already gone; the tree stop will just finish
        if (Number.isSafeInteger(cur.startTicks) && processStartTicks(cur.chromePid) !== cur.startTicks) throw new Error("adopt aborted: chrome pid was reused (start ticks differ)");
      };
      const stop = createChromeTreeStop({ browserPid: owner.chromePid, pgid, startTicks, profileDir, generation, timeoutMs: shutdownTimeoutMs, log,
        verifyIdentity,
        // A-2: verify identity and send Browser.close on the SAME CDP connection; on lookup failure or a
        // pid mismatch, do NOT close (the OS tree-kill handles the owned range independently).
        requestClose: ({ signal, timeoutMs }) => verifiedCloseViaCdp({ baseUrl, expectedPid: owner.chromePid, pgid, signal, timeoutMs: Math.min(timeoutMs ?? shutdownTimeoutMs, 2000) }) });
      const detach = async () => { /* keep the adopted browser alive; leave the owner file for the next serve */ };
      return { baseUrl, child: null, adopted: true, pid: owner.chromePid, stop, detach };
    }
    const plan = adopted?.plan ?? { mode: "unknown", reason: "owner lock unavailable" };
    const owner = adopted?.owner;
    log(`[chrome] reusing CDP at ${baseUrl} (${plan.mode}: ${plan.reason})`);
    return { baseUrl, child: null, pid: plan.mode === "shared" && owner ? owner.chromePid : null, stop: async () => {}, detach: async () => {} };
  }
  mkdirSync(profileDir, { recursive: true });
  const bin = chromeBinary ?? findChromeBinary();
  const extraArgs = process.env.BELMONT_BROWSE_CHROME_ARGS?.split(/\s+/).filter(Boolean) ?? [];
  if (nativeComponentVersion && extraArgs.includes("--")) {
    throw new Error("Native component pinning does not accept an end-of-options marker in extra Chrome flags");
  }
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${windowSize}`,
    "--window-position=0,0",
    "--no-first-run",
    ...(isNoSandboxRequested(process.env.BELMONT_BROWSE_NO_SANDBOX) ? ["--no-sandbox"] : []),
    // Original Aside Browsing Agent extension (built by tools/build-aside-ext.mjs). Branded Google Chrome ignores
    // --load-extension since 137; point BELMONT_BROWSE_CHROME at a Chromium/Chrome-for-Testing build.
    ...(process.env.BELMONT_BROWSE_EXTENSION ? [`--disable-extensions-except=${process.env.BELMONT_BROWSE_EXTENSION}`, `--load-extension=${process.env.BELMONT_BROWSE_EXTENSION}`] : []),
    "--no-default-browser-check",
    "--disable-features=TranslateUI",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--password-store=basic",
    // Extra flags for diagnostics (e.g. "--enable-logging=stderr --v=1").
    ...extraArgs,
    ...(nativeComponentVersion ? [`--aside-component-version=${nativeComponentVersion}`] : []),
    startUrl,
  ];
  const child = spawn(bin, args, {
    env: { ...process.env, DISPLAY: display, ...(asideHome ? { ASIDE_HOME: path.resolve(asideHome) } : {}) },
    stdio: ["ignore", "ignore", "pipe"],
    // DEF-L19-CHROME-ORPHAN-001: lead a process group so the whole renderer/gpu tree is reapable with
    // one group signal, and so a SIGKILL-orphaned tree can be adopted+reaped by the next serve.
    detached: true,
  });
  const observed = observeChild(child);
  const startTicks = processStartTicks(child.pid);
  // PUSH registration for an external supervisor (closes the owner-file poll-gap: an append-only log the
  // supervisor tails sees EVERY spawned chrome the instant it exists, even if the owner file is later
  // replaced/deleted). Written synchronously right after spawn, before any await — the residual spawn->append
  // microgap is far tighter than owner-file polling. Best-effort: never blocks a launch.
  if (process.env.BELMONT_CHROME_REG) {
    try { appendFileSync(process.env.BELMONT_CHROME_REG, JSON.stringify({ pid: child.pid, pgid: child.pid, startTicks, servePid: process.pid, ts: Date.now() }) + "\n"); } catch {}
  }
  // Record ownership immediately after spawn — before CDP is up — so a crash during startup still leaves
  // an adoptable/reap-able record (closes the spawn->ready->write gap, B5). child.pid is the pgid
  // (spawned detached). The generation scopes deletion so a stale stop cannot delete a newer owner (B1/B5).
  const ownerRec = withOwnerLock(profileDir, () => writeChromeOwner(profileDir, { servePid: process.pid, chromePid: child.pid, pgid: child.pid, startTicks }));
  // A-5: a failed owner publish must NOT return a successful launch with no ownership tracking. Reap the
  // just-spawned child and fail, rather than leaking an untracked browser.
  if (!ownerRec?.generation) { try { child.kill("SIGKILL"); } catch {} throw new Error("failed to publish chrome ownership record; aborted launch to avoid an untracked browser"); }
  const generation = ownerRec.generation;
  // Unified hardened termination: verified graceful Browser.close (ownsProcess on the same connection), then
  // group SIGTERM->SIGKILL bound to the owned group, reaping the WHOLE tree (not just the root) and clearing
  // the owner only on confirmed exit AND generation match. On timeout it throws with the record preserved.
  const verifyIdentity = () => { if (Number.isSafeInteger(startTicks) && processStartTicks(child.pid) !== startTicks) throw new Error("owned stop aborted: chrome pid was reused (start ticks differ)"); };
  const stop = createChromeTreeStop({ browserPid: child.pid, pgid: child.pid, startTicks, profileDir, generation, timeoutMs: shutdownTimeoutMs, log,
    verifyIdentity,
    requestClose: ({ signal, timeoutMs }) => closeOwnedCdpBrowser({ child, baseUrl, signal, timeoutMs: Math.min(timeoutMs ?? shutdownTimeoutMs, 2000) }),
  });
  let stderrTail = "";
  const chromeLog = process.env.BELMONT_BROWSE_CHROME_LOG;
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    if (chromeLog) { try { appendFileSync(chromeLog, chunk); } catch {} }
  });
  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (observed.error) throw observed.error;
      if (observed.exited) throw new Error(`Chrome exited early (code ${child.exitCode}, signal ${child.signalCode}): ${stderrTail}`);
      if (await isCdpUp(baseUrl)) {
        if (observed.exited) throw new Error(`Chrome exited while opening its CDP endpoint: ${stderrTail}`);
        log(`[chrome] started ${path.basename(bin)} pid=${child.pid} display=${display} cdp=${baseUrl}`);
        const pid = child.pid;
        const detach = async () => {
          // Explicit --keep-chrome releases only parent event-loop ownership. CDP,
          // process and profile stay intact; the CLI can finish without killing Chrome.
          observed.dispose();
          child.unref();
          child.stderr?.unref?.();
        };
        return { baseUrl, child, pid, stop, detach };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Chrome did not expose CDP on ${baseUrl} within ${startupTimeoutMs}ms: ${stderrTail}`);
  } catch (error) {
    try { await stop(); }
    catch (cleanupError) {
      const combined = new AggregateError([error, cleanupError], `Chrome startup failed and graceful cleanup requires recovery: ${cleanupError.message}`);
      combined.recoverable = true; combined.pid = child.pid; combined.profileDir = profileDir; combined.stop = stop;
      throw combined;
    }
    throw error;
  }
}

/** Native reuse must retain the launch-time pin, including after UI upgrades. */
export async function verifyReusableNativeChrome({ baseUrl, profileDir, nativeComponentVersion, asideHome }) {
  const cdp = new MiniCdp(baseUrl);
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const pid = processInfo?.find((process) => process.type === "browser")?.id;
    if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== "linux") {
      throw new Error("Cannot verify the existing native browser's launch-time component pin");
    }
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    const optionEnd = argv.indexOf("--");
    const options = optionEnd < 0 ? argv : argv.slice(0, optionEnd);
    const lastFlag = (name) => options.map((argument) => argument.match(new RegExp(`^-{1,2}${name}=(.*)$`)))
      .filter(Boolean).at(-1)?.[1];
    const observedVersion = lastFlag("aside-component-version");
    const observedProfile = lastFlag("user-data-dir");
    if (observedVersion !== nativeComponentVersion || !observedProfile
      || path.resolve(observedProfile) !== path.resolve(profileDir)) {
      throw new Error("Existing native browser has a different profile or no matching component-version pin; its owner must restart it with the matching native components");
    }
    let observedHome;
    if (asideHome) {
      const entries = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      observedHome = entries.find((entry) => entry.startsWith("ASIDE_HOME="))?.slice("ASIDE_HOME=".length);
      if (!observedHome || path.resolve(observedHome) !== path.resolve(asideHome)) {
        throw new Error("Existing native browser has a different or missing Aside account home; its owner must restart it with the selected account home");
      }
    }
    return { pid, version: observedVersion, profileDir: path.resolve(observedProfile), ...(observedHome ? { asideHome: path.resolve(observedHome) } : {}) };
  } finally {
    await cdp.close();
  }
}

function ownsProcess(childPid, browserPid) {
  if (!Number.isSafeInteger(browserPid) || browserPid <= 0) return false;
  let pid = browserPid;
  for (let depth = 0; depth < 64 && pid > 1; depth++) {
    if (pid === childPid) return true;
    if (process.platform !== "linux") return false;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    } catch { return false; }
  }
  return false;
}

/** The browser process pid behind a CDP endpoint (via SystemInfo.getProcessInfo), or null. Used by the
 * adopt path to bind the CDP endpoint to the owner record before terminating (B3). */
export async function cdpBrowserPid(baseUrl, timeoutMs = 2000) {
  const cdp = new MiniCdp(baseUrl, { connectTimeoutMs: timeoutMs, closeTimeoutMs: 500 });
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo", {}, undefined, { timeoutMs });
    const pid = processInfo?.find((entry) => entry.type === "browser")?.id;
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
  finally { await cdp.close(); }
}

/** Graceful Browser.close for an ADOPTED endpoint, with identity bound to the close (A-2): verify the CDP
 * endpoint's browser pid is our owned pid (or in its group) and send Browser.close ON THE SAME connection.
 * On a lookup failure or a pid mismatch, THROW without closing — the OS tree-kill reaps the owned range
 * independently, and we never Browser.close a browser that swapped onto the port. */
async function verifiedCloseViaCdp({ baseUrl, expectedPid, pgid, signal, timeoutMs }) {
  const cdp = new MiniCdp(baseUrl, { connectTimeoutMs: timeoutMs, closeTimeoutMs: 500 });
  const abort = () => { void cdp.close(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo", {}, undefined, { timeoutMs });
    const browserPid = processInfo?.find((entry) => entry.type === "browser")?.id;
    if (!Number.isSafeInteger(browserPid)) throw new Error("CDP identity lookup failed; refusing Browser.close");
    if (browserPid !== expectedPid && !processGroupMembers(pgid).members.includes(browserPid)) {
      throw new Error(`CDP browser pid ${browserPid} is not the owned pid ${expectedPid}; refusing Browser.close`);
    }
    await cdp.send("Browser.close", {}, undefined, { timeoutMs }); // same connection whose identity we just verified
  } catch (error) { if (!signal.aborted && !/socket closed|CDP.*closed/i.test(error.message)) throw error; }
  finally { signal.removeEventListener("abort", abort); await cdp.close(); }
}

async function closeOwnedCdpBrowser({ child, baseUrl, signal, timeoutMs }) {
  const cdp = new MiniCdp(baseUrl, { connectTimeoutMs: timeoutMs, closeTimeoutMs: 500 });
  const abort = () => { void cdp.close(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    // A port could have been occupied after the initial probe. Never send Browser.close
    // to a browser unless its real browser process is our child or descendant.
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo", {}, undefined, { timeoutMs });
    const browserPid = processInfo?.find((entry) => entry.type === "browser")?.id;
    if (!ownsProcess(child.pid, browserPid)) throw new Error("CDP endpoint does not identify the owned Chrome process");
    try { await cdp.send("Browser.close", {}, undefined, { timeoutMs }); }
    catch (error) { if (!signal.aborted && !/socket closed|CDP.*closed/i.test(error.message)) throw error; }
  } finally {
    signal.removeEventListener("abort", abort);
    await cdp.close();
  }
}
