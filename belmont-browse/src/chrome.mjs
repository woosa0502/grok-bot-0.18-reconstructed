// belmont-browse: launch (or reuse) a stock Chrome with CDP on the Belmont virtual display (our code).
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fetchJson, MiniCdp } from "./cdp-mini.mjs";
import { createOwnedChromeStop, observeChild, readChromeOwner, writeChromeOwner, clearChromeOwner, planReuseOwnership, createAdoptedChromeStop } from "./browser-lifecycle.mjs";

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
    // DEF-L19-CHROME-ORPHAN-001: never reuse with a noop stop. If the recorded owner serve is dead,
    // this Chrome is an orphan we must adopt with a REAL group-killing stop (bounds accumulation to
    // <=1 and reaps the tree on graceful exit). Shared/foreign browsers keep a noop stop.
    const owner = readChromeOwner(profileDir);
    const plan = planReuseOwnership(owner);
    if (plan.mode === "adopt") {
      const pgid = Number.isSafeInteger(owner.pgid) ? owner.pgid : owner.chromePid;
      log(`[chrome] adopting orphaned CDP at ${baseUrl} (owner serve pid=${owner.servePid} dead; chrome pid=${owner.chromePid}); taking termination ownership`);
      writeChromeOwner(profileDir, { servePid: process.pid, chromePid: owner.chromePid, pgid, startedAt: owner.startedAt, adoptedFrom: owner.servePid });
      const stop = createAdoptedChromeStop({ browserPid: owner.chromePid, pgid, profileDir, timeoutMs: shutdownTimeoutMs, log,
        requestClose: ({ signal }) => requestCloseViaCdp({ baseUrl, signal, timeoutMs: Math.min(shutdownTimeoutMs, 2000) }) });
      const detach = async () => { /* keep the adopted browser alive; leave the owner file for the next serve */ };
      return { baseUrl, child: null, adopted: true, pid: owner.chromePid, stop, detach };
    }
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
  const rawStop = createOwnedChromeStop({ child, observed, profileDir, timeoutMs: shutdownTimeoutMs, log,
    requestClose: ({ signal }) => closeOwnedCdpBrowser({ child, baseUrl, signal, timeoutMs: Math.min(shutdownTimeoutMs, 2000) }),
  });
  // Clear the owner record once we own the graceful shutdown so a later serve does not adopt a
  // browser that already exited cleanly.
  const stop = async () => { try { return await rawStop(); } finally { clearChromeOwner(profileDir); } };
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
        // Record ownership so a restart after a crash can adopt+reap this tree (child.pid is the pgid
        // because we spawned detached).
        writeChromeOwner(profileDir, { servePid: process.pid, chromePid: child.pid, pgid: child.pid });
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

/** Graceful Browser.close for an ADOPTED endpoint (no owned child handle). Ownership was already
 * established from the owner file (the owning serve is dead), so we do not re-check process lineage
 * here; escalation to a group kill is handled by createAdoptedChromeStop. */
async function requestCloseViaCdp({ baseUrl, signal, timeoutMs }) {
  const cdp = new MiniCdp(baseUrl, { connectTimeoutMs: timeoutMs, closeTimeoutMs: 500 });
  const abort = () => { void cdp.close(); };
  signal.addEventListener("abort", abort, { once: true });
  try { await cdp.send("Browser.close", {}, undefined, { timeoutMs }); }
  catch (error) { if (!signal.aborted && !/socket closed|CDP.*closed/i.test(error.message)) throw error; }
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
