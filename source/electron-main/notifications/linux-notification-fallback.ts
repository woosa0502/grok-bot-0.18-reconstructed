import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// OS-notification fallback for Linux/WSL, where Electron's Notification rides
// libnotify/D-Bus and `Notification.isSupported()` is typically false (no session
// bus, no notification daemon under WSLg). Preference order:
//   1. `notify-send` (libnotify-bin) when installed;
//   2. under WSL, a Windows balloon tip via powershell.exe (interop) so the
//      notification appears in the Windows tray.
// The port mimics the small surface SandOsNotificationManager uses: on("click")
// is unavailable in both fallbacks (accepted loss), and "close" fires when the
// spawned notifier exits so the manager's active-set bookkeeping still works.

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
    return { command: "notify-send", args: ["-u", options.urgency === "critical" ? "critical" : "normal", "-a", "Grok Bot", "--", options.title, options.body] };
  }
  const title = escapePowerShellSingleQuoted(options.title).slice(0, 120);
  const body = escapePowerShellSingleQuoted(options.body).slice(0, 240);
  const script = [
    "[void][reflection.assembly]::LoadWithPartialName('System.Windows.Forms')",
    "[void][reflection.assembly]::LoadWithPartialName('System.Drawing')",
    "$n = New-Object System.Windows.Forms.NotifyIcon",
    "$n.Icon = [System.Drawing.SystemIcons]::Information",
    "$n.Visible = $true",
    `$n.ShowBalloonTip(7000, '${title}', '${body}', [System.Windows.Forms.ToolTipIcon]::${options.urgency === "critical" ? "Warning" : "Info"})`,
    "Start-Sleep -Seconds 8",
    "$n.Dispose()",
  ].join("; ");
  return { command: WSL_POWERSHELL_PATH, args: ["-NoProfile", "-NonInteractive", "-Command", script] };
}

export function createFallbackNotification(
  kind: LinuxNotifierKind,
  options: FallbackNotificationOptions,
  spawnProcess: (command: string, args: readonly string[]) => { on(event: "exit" | "error", listener: () => void): unknown; unref?: () => void } = (command, args) => spawn(command, [...args], { stdio: "ignore", detached: true }),
): FallbackNotificationPort {
  const closeListeners: Array<() => void> = [];
  let closed = false;
  const emitClose = () => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners.splice(0)) listener();
  };
  return {
    on(event, callback) { if (event === "close") closeListeners.push(callback); },
    once(event, callback) { if (event === "close") closeListeners.push(callback); },
    show() {
      try {
        const { command, args } = buildNotifyCommand(kind, options);
        const child = spawnProcess(command, args);
        child.on("exit", emitClose);
        child.on("error", emitClose);
        child.unref?.();
      } catch {
        emitClose();
      }
    },
    close() { emitClose(); },
  };
}
