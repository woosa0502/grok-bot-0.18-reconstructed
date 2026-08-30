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
import { LocalDisplayManager } from "../../packages/local-exec/computer-use/display-manager.js";

export const LOCAL_COMPUTER_USE_ENABLED = process.env.SAND_LOCAL_COMPUTER_USE === "1";
const LOCAL_COMPUTER_DISPLAY = { width: 1280, height: 800 } as const;

let sharedLocalDisplayManager: LocalDisplayManager | undefined;

function localDisplayManager(): LocalDisplayManager {
  if (sharedLocalDisplayManager === undefined) {
    sharedLocalDisplayManager = new LocalDisplayManager({
      width: LOCAL_COMPUTER_DISPLAY.width,
      height: LOCAL_COMPUTER_DISPLAY.height,
      // Start x11vnc + websockify(noVNC) so the desktop can be watched in the app's
      // "Open computer" panel. Best-effort: skipped if the tools are not installed.
      vnc: true,
      log: (message) => console.error(message),
    });
    // Start the virtual display eagerly so the first Computer action is fast.
    void sharedLocalDisplayManager.ensure().catch((error) =>
      console.error(`[local-computer] display start failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  return sharedLocalDisplayManager;
}

/**
 * noVNC URL for watching the local computer-use desktop, once the display manager
 * has started the VNC stack. Ensures the display (and VNC) is starting; returns
 * undefined until websockify is up (the UI falls back to its no-stream message).
 */
export function localComputerVncUrl(): string | undefined {
  const manager = localDisplayManager();
  void manager.ensure().catch(() => {});
  return manager.vncUrl;
}

/**
 * X display number of the local computer-use desktop (":99" → 99). Computer auto-review
 * identifies the reviewed display by number; locally there is exactly one, owned by the
 * shared display manager.
 */
export function localComputerDisplayNumber(): number {
  const display = localDisplayManager().display;
  const parsed = Number.parseInt(display.replace(/^:/u, ""), 10);
  return Number.isFinite(parsed) ? parsed : 99;
}

/**
 * Wraps a box resource accessor so `computerUseExecutorResource` resolves to the
 * local Xvfb-backed executor. The local entry takes precedence over the base
 * accessor's own computer-use resource (gateway passthrough / no-monitor stub).
 */
export function withLocalComputerUse<A>(accessor: A): A {
  const executor = new LocalComputerUseExecutor({
    display: localDisplayManager().display,
    displaySize: { width: LOCAL_COMPUTER_DISPLAY.width, height: LOCAL_COMPUTER_DISPLAY.height },
  });
  return new CombinedResourceAccessor(
    accessor as unknown as ResourceAccessor<unknown>,
    [resourceEntry(computerUseExecutorResource, executor)],
  ) as unknown as A;
}
