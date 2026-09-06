import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// OS-notification fallback for Linux/WSL, where Electron's Notification rides
// libnotify/D-Bus and `Notification.isSupported()` is typically false (no session
// bus, no notification daemon under WSLg). Preference order:
//   1. `notify-send` (libnotify-bin) when installed;
//   2. under WSL, a Windows balloon tip via powershell.exe (interop) so the
//      notification appears in the Windows tray.
// Both notifiers report the default action on stdout. The port forwards it to
// SandOsNotificationManager's existing click handler, which focuses the agent.
// A notification daemon must support actions to make Linux clicks available.

export type LinuxNotifierKind = "notify-send" | "windows-powershell";

export interface FallbackNotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly silent: boolean;
  readonly urgency: "critical" | "normal";
}

export interface FallbackNotificationPort {
  on(event: string, callback: () => void): void;
  once(event: string, callback: () => void): void;
  show(): void;
  close(): void;
}

export const WSL_POWERSHELL_PATH = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const DEFAULT_NOTIFICATION_ACTION = "default";

export interface FallbackNotifierProcess {
  on(event: "exit" | "close" | "error", listener: () => void): unknown;
  readonly stdout?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  unref?(): void;
  kill?(): unknown;
}

export function detectLinuxNotifier(
  env: NodeJS.ProcessEnv = process.env,
  probe: (command: string, args: readonly string[]) => { status: number | null; error?: Error } = (command, args) => spawnSync(command, [...args], { timeout: 3_000 }),
  fileExists: (path: string) => boolean = existsSync,
): LinuxNotifierKind | undefined {
  if (process.platform !== "linux" && env.SAND_FORCE_LINUX_NOTIFIER !== "1") return undefined;
  try {
    const result = probe("notify-send", ["--version"]);
    if (result.error === undefined && result.status === 0) return "notify-send";
  } catch { /* not installed */ }
  if ((env.WSL_DISTRO_NAME ?? "").length > 0 && fileExists(WSL_POWERSHELL_PATH)) return "windows-powershell";
  return undefined;
}

const escapePowerShellSingleQuoted = (value: string): string => value.replace(/'/g, "''");

export function buildNotifyCommand(kind: LinuxNotifierKind, options: FallbackNotificationOptions): { command: string; args: string[] } {
  if (kind === "notify-send") {
    return { command: "notify-send", args: ["-u", options.urgency === "critical" ? "critical" : "normal", "-a", "Grok Bot", "--wait", "--expire-time=8000", `--action=${DEFAULT_NOTIFICATION_ACTION}=Open Grok Bot`, ...(options.silent ? ["--hint=boolean:suppress-sound:true"] : []), "--", options.title, options.body] };
  }
  const title = escapePowerShellSingleQuoted(options.title.slice(0, 120));
  const body = escapePowerShellSingleQuoted(options.body.slice(0, 240));
  const script = [
    "[void][reflection.assembly]::LoadWithPartialName('System.Windows.Forms')",
    "[void][reflection.assembly]::LoadWithPartialName('System.Drawing')",
    "$n = New-Object System.Windows.Forms.NotifyIcon",
    "$timer = New-Object System.Windows.Forms.Timer",
    "$n.Icon = [System.Drawing.SystemIcons]::Information",
    "$n.Visible = $true",
    `$n.add_BalloonTipClicked({ [Console]::Out.WriteLine('${DEFAULT_NOTIFICATION_ACTION}'); [Console]::Out.Flush(); [System.Windows.Forms.Application]::ExitThread() })`,
    "$n.add_BalloonTipClosed({ [System.Windows.Forms.Application]::ExitThread() })",
    "$timer.Interval = 8000",
    "$timer.add_Tick({ [System.Windows.Forms.Application]::ExitThread() })",
    `try { $timer.Start(); $n.ShowBalloonTip(7000, '${title}', '${body}', [System.Windows.Forms.ToolTipIcon]::${options.urgency === "critical" ? "Warning" : "Info"}); [System.Windows.Forms.Application]::Run() } finally { $timer.Stop(); $timer.Dispose(); $n.Dispose() }`,
  ].join("; ");
  return { command: WSL_POWERSHELL_PATH, args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", script] };
}

export function createFallbackNotification(
  kind: LinuxNotifierKind,
  options: FallbackNotificationOptions,
  spawnProcess: (command: string, args: readonly string[]) => FallbackNotifierProcess = (command, args) => spawn(command, [...args], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }),
): FallbackNotificationPort {
  const closeListeners: Array<() => void> = [];
  const clickListeners: Array<() => void> = [];
  let closed = false;
  let clicked = false;
  let shown = false;
  let pendingOutput = "";
  let child: FallbackNotifierProcess | undefined;
  const emitClick = () => {
    if (closed || clicked) return;
    clicked = true;
    for (const listener of clickListeners.splice(0)) listener();
  };
  const consumeOutput = (chunk: Buffer | string) => {
    if (closed || clicked) return;
    pendingOutput += chunk.toString();
    const lines = pendingOutput.split(/\r?\n/);
    pendingOutput = lines.pop() ?? "";
    for (const line of lines) if (line === DEFAULT_NOTIFICATION_ACTION) emitClick();
    // Only a short fixed action id is valid; do not retain arbitrary child output.
    if (pendingOutput.length > 128) pendingOutput = "";
  };
  const emitClose = () => {
    if (closed) return;
    closed = true;
    clickListeners.length = 0;
    pendingOutput = "";
    for (const listener of closeListeners.splice(0)) listener();
  };
  return {
    on(event, callback) {
      if (closed) return;
      if (event === "close") closeListeners.push(callback);
      if (event === "click" && !clicked) clickListeners.push(callback);
    },
    once(event, callback) {
      if (closed) return;
      if (event === "close") closeListeners.push(callback);
      if (event === "click" && !clicked) clickListeners.push(callback);
    },
    show() {
      if (closed || shown) return;
      shown = true;
      try {
        const { command, args } = buildNotifyCommand(kind, options);
        child = spawnProcess(command, args);
        child.stdout?.on("data", consumeOutput);
        // Node can emit exit before the last stdout bytes arrive. Wait for close
        // when a pipe exists, otherwise compatibility ports may use exit alone.
        child.on("exit", () => { if (child?.stdout == null) emitClose(); });
        child.on("close", () => {
          if (pendingOutput === DEFAULT_NOTIFICATION_ACTION) emitClick();
          emitClose();
        });
        child.on("error", emitClose);
        child.unref?.();
      } catch {
        emitClose();
      }
    },
    close() {
      if (closed) return;
      emitClose();
      try { child?.kill?.(); } catch { /* the owned notifier may already have exited */ }
    },
  };
}
