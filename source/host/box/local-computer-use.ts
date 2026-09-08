// Shared local computer-use wiring. When SAND_LOCAL_COMPUTER_USE=1 the standalone
// WSL/Linux build exposes a real Computer tool backed by a dedicated Xvfb display
// driven by xdotool (input) + ffmpeg (capture), instead of routing computer
// actions through the local-exec gateway (which only understands shell/file ops)
// or the "no monitor" stub.
//
// Both box layers resolve the executor from a resource accessor, so wrapping that
// accessor here — the local override wins over the base via CombinedResourceAccessor —
// makes computer-use work regardless of which box is active.
import { CombinedResourceAccessor, resourceEntry, type ResourceAccessor } from "../../packages/agent-exec/resource-provider.js";
import { computerUseExecutorResource } from "../../packages/agent-exec/computer-use.js";
import { LocalComputerUseExecutor } from "../../packages/local-exec/computer-use/executor.js";
import { LocalDisplayManager, localDisplayListeningPorts } from "../../packages/local-exec/computer-use/display-manager.js";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join as joinPath, resolve as resolvePath } from "node:path";

import { getSandRootDir } from "../host-paths.js";

function hasExecutable(name: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir.length > 0 && existsSync(joinPath(dir, name)));
}

// Readiness is part of the gate (AUDIT-W17): advertising a Computer tool whose
// display stack cannot start is worse than not offering it. Xvfb hosts the
// display, xdotool drives input, ffmpeg captures screenshots — all three are
// required for the tool to actually work.
const LOCAL_COMPUTER_REQUIRED_BINARIES = ["Xvfb", "xdotool", "ffmpeg"] as const;
const missingComputerBinaries = process.env.SAND_LOCAL_COMPUTER_USE !== "0"
  ? LOCAL_COMPUTER_REQUIRED_BINARIES.filter((name) => !hasExecutable(name))
  : [];
if (process.env.SAND_LOCAL_COMPUTER_USE !== "0" && missingComputerBinaries.length > 0) {
  console.error(`[local-computer] disabled: missing ${missingComputerBinaries.join(", ")} (install them to enable the Computer tool)`);
}
export const LOCAL_COMPUTER_USE_ENABLED =
  process.env.SAND_LOCAL_COMPUTER_USE !== "0" && missingComputerBinaries.length === 0;
const LOCAL_COMPUTER_DISPLAY = { width: 1280, height: 800 } as const;

/**
 * Every bot gets its own virtual desktop, like the original product's per-agent box: a
 * dedicated Xvfb display with its own x11vnc/websockify pair, so two bots working at once
 * never draw into each other's screen and the phone shows each bot its own desktop.
 *
 * Display numbers are assigned once per agent and remembered in `local-displays.json`
 * under the data root, so a bot keeps its desktop (and whatever a detached Xvfb still
 * holds) across host restarts. :99 stays the legacy/shared number: the belmont-browse
 * service pins its Chrome there (BELMONT_BROWSE_DISPLAY), so the "browser" bot is seeded
 * to it and callers that cannot name an agent fall back to it.
 */
export const LEGACY_LOCAL_DISPLAY = 99;
const FIRST_AGENT_DISPLAY = 100;
const DISPLAY_REGISTRY_FILE = "local-displays.json";

export function localDisplayPorts(displayNumber: number): { rfbPort: number; novncPort: number } {
  const offset = displayNumber - LEGACY_LOCAL_DISPLAY;
  return { rfbPort: 5900 + offset, novncPort: 6080 + offset };
}

interface DisplayRegistry { version: 1; displays: Record<string, number> }

function registryPath(): string {
  return joinPath(getSandRootDir(), DISPLAY_REGISTRY_FILE);
}

let registry: DisplayRegistry | undefined;

function seedRegistry(): DisplayRegistry {
  const seeded: DisplayRegistry = { version: 1, displays: {} };
  // The browser bot created by belmont-browse records its id next to the service state.
  const browserBotIdFile = process.env.SAND_BROWSER_BOT_ID_FILE?.trim()
    || resolvePath(getSandRootDir(), "../../../belmont-browse/.state/browser-bot-id");
  try {
    const id = readFileSync(browserBotIdFile, "utf8").trim();
    if (id.length > 0) seeded.displays[id] = LEGACY_LOCAL_DISPLAY;
  } catch {}
  return seeded;
}

function loadRegistry(): DisplayRegistry {
  if (registry !== undefined) return registry;
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), "utf8")) as Partial<DisplayRegistry>;
    const displays: Record<string, number> = {};
    for (const [agentId, value] of Object.entries(parsed.displays ?? {})) {
      if (Number.isInteger(value) && (value as number) >= LEGACY_LOCAL_DISPLAY) displays[agentId] = value as number;
    }
    registry = { version: 1, displays };
  } catch {
    registry = seedRegistry();
    saveRegistry();
  }
  return registry;
}

function saveRegistry(): void {
  if (registry === undefined) return;
  try {
    mkdirSync(getSandRootDir(), { recursive: true });
    writeFileSync(registryPath(), `${JSON.stringify(registry, null, 2)}\n`);
  } catch (error) {
    console.error(`[local-computer] could not save ${DISPLAY_REGISTRY_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The display number owned by an agent, assigning the next free one on first use. */
export function localDisplayNumberFor(agentId: string): number {
  const current = loadRegistry();
  const known = current.displays[agentId];
  if (known !== undefined) return known;
  const taken = Object.values(current.displays);
  let next = Math.max(FIRST_AGENT_DISPLAY - 1, ...taken) + 1;
  const listening = localDisplayListeningPorts();
  while (next <= 59_554) {
    const ports = localDisplayPorts(next);
    if (!existsSync(`/tmp/.X11-unix/X${next}`) && !existsSync(`/tmp/.X${next}-lock`)
      && !listening.has(ports.rfbPort) && !listening.has(ports.novncPort)) break;
    next += 1;
  }
  if (next > 59_554) throw new Error("No free local desktop display and VNC port pair");
  current.displays[agentId] = next;
  saveRegistry();
  return next;
}

/** Drops a registry entry (used by tests and when an agent is forgotten); the running display is left alone. */
export function forgetLocalDisplay(agentId: string): void {
  const current = loadRegistry();
  if (!(agentId in current.displays)) return;
  delete current.displays[agentId];
  saveRegistry();
}

const managers = new Map<number, LocalDisplayManager>();

function managerForDisplay(displayNumber: number): LocalDisplayManager {
  let manager = managers.get(displayNumber);
  if (manager === undefined) {
    const ports = localDisplayPorts(displayNumber);
    manager = new LocalDisplayManager({
      displayNumber,
      rfbPort: ports.rfbPort,
      novncPort: ports.novncPort,
      width: LOCAL_COMPUTER_DISPLAY.width,
      height: LOCAL_COMPUTER_DISPLAY.height,
      // Start x11vnc + websockify(noVNC) so the desktop can be watched in the app's
      // "Open computer" panel and on the phone. Best-effort: skipped if not installed.
      vnc: true,
      log: (message) => console.error(message),
    });
    managers.set(displayNumber, manager);
  }
  return manager;
}

function managerFor(agentId: string | undefined): LocalDisplayManager {
  return managerForDisplay(agentId === undefined ? LEGACY_LOCAL_DISPLAY : localDisplayNumberFor(agentId));
}

/** Starts the agent's desktop (Xvfb + VNC) if it is not up yet; resolves once it accepts clients. */
export async function ensureLocalComputerDisplay(agentId?: string): Promise<void> {
  await managerFor(agentId).ensure();
}

/**
 * noVNC URL for watching an agent's desktop, once its display manager has started the VNC
 * stack. Starts the display if needed; returns undefined until websockify is up (the UI
 * falls back to its no-stream message).
 */
export function localComputerVncUrl(agentId?: string): string | undefined {
  const manager = managerFor(agentId);
  void manager.ensure().catch((error) =>
    console.error(`[local-computer] display start failed: ${error instanceof Error ? error.message : String(error)}`));
  return manager.vncUrl;
}

/**
 * X display number of an agent's desktop (":100" → 100). Computer auto-review identifies the
 * reviewed display by number. Without an agent id this is the legacy shared display.
 */
export function localComputerDisplayNumber(agentId?: string): number {
  return agentId === undefined ? LEGACY_LOCAL_DISPLAY : localDisplayNumberFor(agentId);
}
/**
 * Wraps a box resource accessor so `computerUseExecutorResource` resolves to the
 * local Xvfb-backed executor. The local entry takes precedence over the base
 * accessor's own computer-use resource (gateway passthrough / no-monitor stub).
 */
export function withLocalComputerUse<A>(accessor: A, agentId?: string): A {
  const manager = managerFor(agentId);
  void manager.ensure().catch(() => {});
  const executor = new LocalComputerUseExecutor({
    display: manager.display,
    displaySize: { width: LOCAL_COMPUTER_DISPLAY.width, height: LOCAL_COMPUTER_DISPLAY.height },
  });
  return new CombinedResourceAccessor(
    accessor as unknown as ResourceAccessor<unknown>,
    [resourceEntry(computerUseExecutorResource, executor)],
  ) as unknown as A;
}
