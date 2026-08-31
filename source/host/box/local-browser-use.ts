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
import {
  ShellResult,
  ShellSuccess,
} from "../../packages/proto/generated/agent/v1/shell_exec_pb.js";
import { localComputerDisplayNumber, LOCAL_COMPUTER_USE_ENABLED } from "./local-computer-use.js";

function hasExecutable(name: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir.length > 0 && existsSync(joinPath(dir, name)));
}

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
function localBrowserShellExecutor(
  audit?: (command: string) => void,
): HostShellExecutor {
  return {
    async execute(_context, args) {
      audit?.(args.command);
      const tokens = args.command.split(/\s+/u).filter((token) => token.length > 0);
      if (tokens.length === 0) {
        throw new TypeError("browser driver shell command is empty");
      }
      return await new Promise<ShellResult>((resolve) => {
        execFile(tokens[0]!, tokens.slice(1), {
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
  return createHostBrowserDriverDependencies({
    resourceAccessor: input.resourceAccessor,
    box: localBrowserDriverBox(),
    getBoxId: () => input.agentId,
    getDefaultViewId: () => input.agentId,
    getLocalWindowIndex: () => localBrowserWindowIndex(),
    ...(approvalGate === undefined ? {} : { sensitiveApprovalGate: approvalGate }),
    ...(input.autoReview === undefined ? {} : { autoReview: input.autoReview }),
    executeShell: localBrowserShellExecutor(input.auditShellCommand),
  });
}
