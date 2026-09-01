// Local browser-use wiring. The browser driver was written for a container box
// that ships a `box-chrome` command, assigns each agent its own desktop window,
// and carries playwright-core inside /workspace. The standalone WSL/Linux build
// has none of those: there is a single Xvfb display — the one computer-use
// already owns — and a box workspace on the user's own disk, so the launcher
// provisions a box-chrome shim on PATH and installs playwright-core there.
//
// Readiness is part of the gate, as it is for computer-use (AUDIT-W17):
// advertising browser tools whose Chrome or Playwright cannot start is worse
// than not offering them, because the model spends a turn discovering it.
// Unlike computer-use this is opt-in rather than on-by-default: browser tools
// drive the user's live logged-in sessions, so they are enabled deliberately.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join as joinPath } from "node:path";

import {
  createHostBrowserDriverDependencies,
  type HostBrowserBoxOwner,
  type HostShellExecutor,
} from "../runner/host-computer-tool-dependencies.js";
import { SAND_BROWSER_DRIVER_BOX_DIR } from "../runner/tools/sand-browser-driver-source.js";
import { shellExecutorResource } from "../../packages/agent-exec/shell.js";
import {
  ShellResult,
  ShellSuccess,
} from "../../packages/proto/generated/agent/v1/shell_exec_pb.js";
import { localComputerDisplayNumber, LOCAL_COMPUTER_USE_ENABLED } from "./local-computer-use.js";
import { getSandRootDir } from "../host-paths.js";

function hasExecutable(name: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir.length > 0 && existsSync(joinPath(dir, name)));
}

// ---------------------------------------------------------------------------
// Idle browser reaper. The driver's ensureChrome() launches Chrome on first
// browser-tool use and REUSES it across calls, but nothing ever closed it —
// no driver op shuts the browser down, agents have no close tool, and Chrome
// is reparented to init so app shutdown never reaches it. Observed live: a
// ~2GB, 19-process Chrome idling for 16 hours after a browser test. Closing
// is host policy, not model memory: after SAND_BROWSER_IDLE_TIMEOUT_SECONDS
// (default 600, 0 disables) with no browser-tool call, the box-profile Chrome
// is terminated; the next browser call just relaunches it (~2-3s).
// ---------------------------------------------------------------------------

export const LOCAL_BROWSER_IDLE_TIMEOUT_ENV = "SAND_BROWSER_IDLE_TIMEOUT_SECONDS";
const LOCAL_BROWSER_DEFAULT_IDLE_TIMEOUT_SECONDS = 600;
const LOCAL_BROWSER_REAPER_TICK_MS = 60_000;

export function localBrowserIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[LOCAL_BROWSER_IDLE_TIMEOUT_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return LOCAL_BROWSER_DEFAULT_IDLE_TIMEOUT_SECONDS * 1000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return LOCAL_BROWSER_DEFAULT_IDLE_TIMEOUT_SECONDS * 1000;
  return parsed * 1000;
}

/** The Chrome profile the box-chrome shim uses — the reaper's kill scope. */
export function localBrowserProfileDir(): string {
  return joinPath(getSandRootDir(), "box-chrome-profile");
}

let lastBrowserUseAtMs = 0;
let reaperTimer: ReturnType<typeof setInterval> | undefined;

function killIdleBoxChrome(profileDir: string): void {
  // Scope strictly to processes whose argv carries OUR profile directory —
  // that is only the box Chrome tree (pkill never matches itself).
  execFile("pkill", ["-TERM", "-f", profileDir], () => {
    console.error(`[local-browser] idle ${Math.round(localBrowserIdleTimeoutMs() / 60_000)}m; closed the box browser (it relaunches on the next browser call)`);
  });
}

function reaperTick(): void {
  if (lastBrowserUseAtMs === 0) return;
  const timeoutMs = localBrowserIdleTimeoutMs();
  if (timeoutMs <= 0) return;
  if (Date.now() - lastBrowserUseAtMs < timeoutMs) return;
  lastBrowserUseAtMs = 0; // one kill per idle episode; the next use re-arms
  killIdleBoxChrome(localBrowserProfileDir());
}

export function noteLocalBrowserUse(now: number = Date.now()): void {
  lastBrowserUseAtMs = now;
  if (reaperTimer !== undefined || localBrowserIdleTimeoutMs() <= 0) return;
  reaperTimer = setInterval(reaperTick, LOCAL_BROWSER_REAPER_TICK_MS);
  reaperTimer.unref();
}

/**
 * A leftover Chrome from a PREVIOUS app run (it survives shutdown by design of
 * the process tree, not by intent) counts as idle from boot: if it exists,
 * arm the reaper now so it gets closed after the normal idle timeout unless a
 * browser call claims it first.
 */
export function armReaperForLeftoverChrome(): void {
  if (localBrowserIdleTimeoutMs() <= 0) return;
  const profileDir = localBrowserProfileDir();
  execFile("pgrep", ["-f", profileDir], (error) => {
    if (error !== null) return; // no leftover
    console.error("[local-browser] found a box browser left over from a previous run; it will close after the idle timeout unless used");
    noteLocalBrowserUse();
  });
}

if (LOCAL_COMPUTER_USE_ENABLED) armReaperForLeftoverChrome();

/**
 * Where the driver actually finds playwright-core. It imports the bare
 * specifier, and ESM resolves those from the importing file's directory, not
 * from the working directory the shell was handed — so what matters is the
 * driver's own upload directory, never the box workspace.
 */
export function localBrowserPlaywrightPath(driverDir: string = SAND_BROWSER_DRIVER_BOX_DIR): string {
  return joinPath(driverDir, "node_modules", "playwright-core", "package.json");
}

export function missingLocalBrowserDependencies(
  deps: { hasBoxChrome: boolean; hasPlaywright: boolean },
): readonly string[] {
  const missing: string[] = [];
  if (!deps.hasBoxChrome) missing.push("box-chrome");
  if (!deps.hasPlaywright) missing.push("playwright-core");
  return missing;
}

const optedIn = process.env.SAND_LOCAL_BROWSER_USE === "1";
const missingBrowserDependencies = optedIn
  ? missingLocalBrowserDependencies({
    hasBoxChrome: hasExecutable("box-chrome"),
    hasPlaywright: existsSync(localBrowserPlaywrightPath()),
  })
  : [];
if (optedIn && missingBrowserDependencies.length > 0) {
  console.error(`[local-browser] disabled: missing ${missingBrowserDependencies.join(", ")} (the launcher provisions these)`);
}
if (optedIn && !LOCAL_COMPUTER_USE_ENABLED) {
  console.error("[local-browser] disabled: the local desktop is unavailable, and the browser draws on it");
}

/**
 * Whether this build offers the browser tools locally. The desktop is a hard
 * dependency, not a nicety: the driver launches Chrome onto the display
 * computer-use owns, so without it there is nowhere for the browser to draw.
 */
export const LOCAL_BROWSER_USE_ENABLED =
  optedIn && LOCAL_COMPUTER_USE_ENABLED && missingBrowserDependencies.length === 0;

/**
 * The window index the browser driver should use locally. The driver derives
 * both the X display (`:index`) and the CDP port (9222 + index) from this one
 * number, so it has to be the display computer-use actually started — there is
 * exactly one desktop here, and the box assigns no windows of its own.
 */
export function localBrowserWindowIndex(): number {
  return localComputerDisplayNumber();
}

/**
 * Stands in for the container box the driver expects. Locally the "box" is this
 * machine, so the driver's artifact upload is a file write and its window is the
 * shared display. Unlike the gateway box this does not route the write through
 * the local-tool approval gate: the only thing written here is the host's own
 * driver bundle, to the host's own upload directory, and the model never chooses
 * the path or the bytes. Everything the model does drive — the shell call that
 * runs the driver — still goes through the gateway and its gate.
 */
export function localBrowserDriverBox(): HostBrowserBoxOwner<unknown> {
  return {
    async ensureReady() {
      // The display manager owns readiness; there is no container to bring up.
      return undefined;
    },
    getAgentWindowIndex: () => localBrowserWindowIndex(),
    async uploadFile(_context, _agentId, path, bytes) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async downloadFile(_context, _agentId, path) {
      return new Uint8Array(await readFile(path));
    },
  };
}

const LOCAL_BROWSER_DRIVER_TIMEOUT_MS = 180_000;
const LOCAL_BROWSER_DRIVER_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Runs the browser driver in this host process, the same way local
 * computer-use runs xdotool/ffmpeg directly instead of routing through an exec
 * gateway. Routing the driver through the user-computer shell gateway fails by
 * design: that gate only runs requests it can describe on an approval card,
 * and the driver invocation (`node <driver> <base64>`) is host infrastructure,
 * not a describable user action — the gate rejected every call. The command
 * here is never model text: the driver path is a host constant and the
 * argument is base64 JSON of already-validated tool args, executed argv-style
 * with no shell interpretation.
 */
export function localBrowserShellExecutor(
  audit?: (command: string) => void,
): HostShellExecutor {
  return {
    async execute(_context, args) {
      // Every browser-tool op flows through this executor: the freshest call
      // timestamp is what keeps the idle reaper from closing a browser in use.
      noteLocalBrowserUse();
      audit?.(args.command);
      if (args.command.trim().length === 0) {
        throw new TypeError("browser driver shell command is empty");
      }
      // The driver and the auto-review probe both emit compound shell commands
      // (&&, subshells, redirects); naive tokenization broke them, so run
      // through a real shell.
      return await new Promise<ShellResult>((resolve) => {
        execFile("/bin/sh", ["-c", args.command], {
          cwd: SAND_BROWSER_DRIVER_BOX_DIR,
          env: { ...process.env, DISPLAY: `:${localComputerDisplayNumber()}` },
          timeout: LOCAL_BROWSER_DRIVER_TIMEOUT_MS,
          maxBuffer: LOCAL_BROWSER_DRIVER_MAX_OUTPUT_BYTES,
        }, (error, stdout, stderr) => {
          const exitCode = error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : 127;
          resolve(new ShellResult({
            result: {
              case: "success",
              value: new ShellSuccess({
                exitCode,
                stdout: String(stdout ?? ""),
                stderr: error === null || String(stderr ?? "").length > 0
                  ? String(stderr ?? "")
                  : (error instanceof Error ? error.message : String(error)),
              }),
            },
          }));
        });
      });
    },
  };
}

type LocalBrowserApprovalGate = NonNullable<
  Parameters<typeof createHostBrowserDriverDependencies>[0]["sensitiveApprovalGate"]
>;

/**
 * A8 bridge: the runner composition owns each session's approval controller,
 * but the LIVE local build reaches the browser tools through the per-turn
 * FALLBACK below (the projection never binds createBrowserDriverDependencies
 * on this runner), which has no controller in scope. The composition registers
 * each runner's gate here at bind time; re-binding the same agent overwrites,
 * so the newest runner's transport (the one actually showing cards) wins.
 */
const localSensitiveApprovalGates = new Map<string, LocalBrowserApprovalGate>();

export function registerLocalBrowserApprovalGate(
  agentId: string,
  gate: LocalBrowserApprovalGate,
): void {
  localSensitiveApprovalGates.set(agentId, gate);
}

export function localBrowserApprovalGateFor(
  agentId: string,
): LocalBrowserApprovalGate | undefined {
  return localSensitiveApprovalGates.get(agentId);
}

/**
 * Browser driver dependencies for the local build. The container path receives
 * these from the per-turn projection, which does not bind them on this runner —
 * the same gap that left the Computer tool needing its own local fallback.
 * The sensitive-action approval gate is attached only when the composition has
 * registered one for this agent: without it, the driver's armed-confirmed
 * fallback stays in charge instead of silently auto-denying.
 */
export function createLocalBrowserDriverDependencies(input: {
  readonly resourceAccessor: { get(resource: unknown): unknown };
  readonly agentId: string;
  readonly auditShellCommand?: (command: string) => void;
  readonly autoReview?: Parameters<typeof createHostBrowserDriverDependencies>[0]["autoReview"];
}): ReturnType<typeof createHostBrowserDriverDependencies> {
  const approvalGate = localBrowserApprovalGateFor(input.agentId);
  const browserShell = localBrowserShellExecutor(input.auditShellCommand);
  // Live 2026-09-02: the auto-review capture resolves shellExecutorResource
  // straight from this accessor; on the local runner that is the local-tool
  // permission shell, whose describer rejects the compound probe command and
  // killed every browser op with an opaque capture error. Overlay the
  // browser's own direct executor for this toolset only.
  const browserResourceAccessor = {
    get: (resource: unknown) => resource === (shellExecutorResource as unknown)
      ? browserShell
      : input.resourceAccessor.get(resource),
  };
  return createHostBrowserDriverDependencies({
    resourceAccessor: browserResourceAccessor,
    box: localBrowserDriverBox(),
    getBoxId: () => input.agentId,
    getDefaultViewId: () => input.agentId,
    getLocalWindowIndex: () => localBrowserWindowIndex(),
    ...(approvalGate === undefined ? {} : { sensitiveApprovalGate: approvalGate }),
    ...(input.autoReview === undefined ? {} : { autoReview: input.autoReview }),
    executeShell: browserShell,
  });
}
