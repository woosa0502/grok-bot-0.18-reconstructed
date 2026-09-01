// Manages a dedicated Xvfb virtual display for local (WSL/Linux) computer-use.
// A single Xvfb is started lazily and reused for the process lifetime; a
// lightweight window manager (openbox, if present) is started so apps are
// framed/positioned. Screenshot/input then target this display via the executor.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalDisplay {
  readonly display: string; // e.g. ":99"
  readonly displayNumber: number; // e.g. 99
  readonly width: number;
  readonly height: number;
}

export interface LocalDisplayManagerOptions {
  readonly displayNumber?: number; // default 99
  readonly width?: number; // default 1280
  readonly height?: number; // default 800
  readonly startWindowManager?: boolean; // default true (best-effort)
  /** Start x11vnc + websockify(noVNC) so the display can be watched in the UI. Default false. */
  readonly vnc?: boolean;
  readonly rfbPort?: number; // default 5900
  readonly novncPort?: number; // default 6080
  readonly novncWebRoot?: string; // default /usr/share/novnc
  readonly log?: (message: string) => void;
}

export class LocalDisplayManager {
  private readonly displayNumber: number;
  private readonly width: number;
  private readonly height: number;
  private readonly startWm: boolean;
  private readonly vncEnabled: boolean;
  private readonly rfbPort: number;
  private readonly novncPort: number;
  private readonly novncWebRoot: string;
  private readonly log: (message: string) => void;
  private ready: Promise<LocalDisplay> | undefined;
  private xvfb: ReturnType<typeof spawn> | undefined;
  private wm: ReturnType<typeof spawn> | undefined;
  private x11vnc: ReturnType<typeof spawn> | undefined;
  private websockify: ReturnType<typeof spawn> | undefined;
  private vncUrlValue: string | undefined;

  constructor(options: LocalDisplayManagerOptions = {}) {
    this.displayNumber = options.displayNumber ?? 99;
    this.width = options.width ?? 1280;
    this.height = options.height ?? 800;
    this.startWm = options.startWindowManager ?? true;
    this.vncEnabled = options.vnc ?? false;
    this.rfbPort = options.rfbPort ?? 5900;
    this.novncPort = options.novncPort ?? 6080;
    this.novncWebRoot = options.novncWebRoot ?? "/usr/share/novnc";
    this.log = options.log ?? (() => {});
  }

  get display(): string {
    return `:${this.displayNumber}`;
  }

  /**
   * noVNC page URL for watching this display. Deterministic from novncPort, so it is
   * available immediately when VNC is enabled (the box records vncUrl the first time it
   * readies, which can precede websockify finishing its bind ~1s later); returns undefined
   * when VNC is disabled.
   */
  get vncUrl(): string | undefined {
    if (!this.vncEnabled) return undefined;
    return this.vncUrlValue ?? `http://127.0.0.1:${this.novncPort}/vnc.html?autoconnect=1&resize=scale&path=websockify`;
  }

  /** Idempotent: starts Xvfb (and a WM) if needed and resolves once the display accepts X clients. */
  ensure(): Promise<LocalDisplay> {
    if (this.ready === undefined) this.ready = this.start();
    return this.ready;
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, DISPLAY: this.display };
  }

  private async isDisplayReady(): Promise<boolean> {
    try {
      await execFileAsync("xdotool", ["getmouselocation"], { env: this.env(), timeout: 2_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async start(): Promise<LocalDisplay> {
    const display = this.display;
    // Reuse an Xvfb someone already started on this display.
    if (await this.isDisplayReady()) {
      this.log(`[local-computer] reusing existing display ${display}`);
    } else {
      this.log(`[local-computer] starting Xvfb ${display} (${this.width}x${this.height})`);
      this.xvfb = spawn(
        "Xvfb",
        [display, "-screen", "0", `${this.width}x${this.height}x24`, "-nolisten", "tcp"],
        { detached: true, stdio: "ignore" },
      );
      this.xvfb.unref();
      // Poll for readiness (Xvfb takes a moment to create its socket).
      let ok = false;
      for (let i = 0; i < 40; i++) {
        await delay(250);
        if (await this.isDisplayReady()) { ok = true; break; }
      }
      if (!ok) throw new Error(`Xvfb ${display} did not become ready`);
    }
    // Best-effort background + window manager so apps are visible/framed.
    await this.run("xsetroot", ["-solid", "#1e2a3a"]).catch(() => {});
    if (this.startWm) await this.startWindowManager();
    if (this.vncEnabled) await this.startVnc().catch((error) =>
      this.log(`[local-computer] VNC start failed: ${error instanceof Error ? error.message : String(error)}`));
    return { display, displayNumber: this.displayNumber, width: this.width, height: this.height };
  }

  // Starts x11vnc (a VNC server for the Xvfb) and websockify serving noVNC, so the
  // display can be watched in the app. x11vnc bails if it thinks the session is
  // Wayland, so WAYLAND_DISPLAY/XDG_SESSION_TYPE are stripped from its environment.
  private async startVnc(): Promise<void> {
    if (!(await this.has("x11vnc")) || !(await this.has("websockify"))) {
      this.log("[local-computer] x11vnc/websockify not installed; VNC viewer disabled");
      return;
    }
    const vncEnv: NodeJS.ProcessEnv = { ...process.env, DISPLAY: this.display };
    delete vncEnv.WAYLAND_DISPLAY;
    delete vncEnv.XDG_SESSION_TYPE;
    this.log(`[local-computer] starting x11vnc on ${this.display} (rfb ${this.rfbPort})`);
    // -localhost is load-bearing (A11): this VNC server is passwordless
    // (-nopw) and can drive the desktop, so it must never listen beyond
    // loopback — without it, anyone on the LAN could watch and control the
    // user's sessions. The app's own viewer connects via 127.0.0.1 only.
    this.x11vnc = spawn(
      "x11vnc",
      ["-display", this.display, "-nopw", "-forever", "-shared", "-localhost", "-rfbport", String(this.rfbPort), "-quiet", "-noxdamage"],
      { env: vncEnv, detached: true, stdio: "ignore" },
    );
    this.x11vnc.unref();
    await delay(800);
    this.log(`[local-computer] starting websockify(noVNC) on ${this.novncPort} -> ${this.rfbPort}`);
    this.websockify = spawn(
      "websockify",
      [`--web=${this.novncWebRoot}`, `127.0.0.1:${this.novncPort}`, `localhost:${this.rfbPort}`],
      { env: vncEnv, detached: true, stdio: "ignore" },
    );
    this.websockify.unref();
    this.vncUrlValue = `http://127.0.0.1:${this.novncPort}/vnc.html?autoconnect=1&resize=scale&path=websockify`;
  }

  private async startWindowManager(): Promise<void> {
    for (const wm of ["openbox", "fluxbox", "twm"]) {
      if (await this.has(wm)) {
        this.log(`[local-computer] starting window manager ${wm}`);
        this.wm = spawn(wm, [], { env: this.env(), detached: true, stdio: "ignore" });
        this.wm.unref();
        return;
      }
    }
    this.log("[local-computer] no window manager found (apps render unframed)");
  }

  private async has(cmd: string): Promise<boolean> {
    try { await execFileAsync("which", [cmd], { timeout: 2_000 }); return true; } catch { return false; }
  }

  private async run(cmd: string, args: string[]): Promise<void> {
    await execFileAsync(cmd, args, { env: this.env(), timeout: 5_000 });
  }

  dispose(): void {
    try { this.websockify?.kill("SIGKILL"); } catch {}
    try { this.x11vnc?.kill("SIGKILL"); } catch {}
    try { this.wm?.kill("SIGKILL"); } catch {}
    try { this.xvfb?.kill("SIGKILL"); } catch {}
    this.websockify = undefined;
    this.x11vnc = undefined;
    this.wm = undefined;
    this.xvfb = undefined;
    this.ready = undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
