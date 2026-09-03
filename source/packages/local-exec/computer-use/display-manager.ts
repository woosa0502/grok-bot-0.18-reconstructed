// Manages a dedicated Xvfb virtual display for local (WSL/Linux) computer-use.
// A single Xvfb is started lazily and reused for the process lifetime; a
// lightweight window manager (openbox, if present) is started so apps are
// framed/positioned. Screenshot/input then target this display via the executor.
import { spawn, execFile } from "node:child_process";
import { connect } from "node:net";
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
  private vncWatch: NodeJS.Timeout | undefined;
  private vncHealing = false;

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
   * noVNC page URL for watching this display. Only set once websockify has been
   * confirmed LISTENING (A11): the box re-reads this on every ensureReady, so
   * returning undefined while the stack is still binding (the UI shows its
   * no-stream fallback) beats handing out a URL that never connects — which is
   * exactly what the old optimistic fallback did when x11vnc/websockify were
   * not installed or failed to start.
   */
  get vncUrl(): string | undefined {
    if (!this.vncEnabled) return undefined;
    return this.vncUrlValue;
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
        // -noreset: an X server resets (black root, "X" cursor, all state) when its last client
        // disconnects; without it every xsetroot below is undone the moment xsetroot exits.
        [display, "-screen", "0", `${this.width}x${this.height}x24`, "-nolisten", "tcp", "-noreset"],
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
    await this.applyRootDefaults();
    if (this.startWm) await this.startWindowManager();
    if (this.vncEnabled) await this.startVnc().catch((error) =>
      this.log(`[local-computer] VNC start failed: ${error instanceof Error ? error.message : String(error)}`));
    // A display adopted from an earlier host may have been started without -noreset and
    // reset since; now that x11vnc holds a connection the defaults stick.
    if (this.vncEnabled) await this.applyRootDefaults();
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
    // A previous host instance may have left its (detached) x11vnc/websockify serving
    // this display; a second x11vnc on the same rfb port would just exit. Adopt what is
    // listening and let the watchdog below take over once it goes away.
    if (await this.isListening(this.rfbPort)) this.log(`[local-computer] adopting x11vnc already listening on ${this.rfbPort}`);
    else { this.spawnX11vnc(); await delay(800); }
    if (await this.isListening(this.novncPort)) this.log(`[local-computer] adopting websockify already listening on ${this.novncPort}`);
    else this.spawnWebsockify();
    // Publish the URL only after the noVNC port actually accepts connections;
    // a URL that never readies stays unpublished (the UI keeps its fallback).
    if (await this.waitForTcp(this.novncPort, 8_000)) {
      this.vncUrlValue = `http://127.0.0.1:${this.novncPort}/vnc.html?autoconnect=1&resize=scale&path=websockify`;
    } else {
      this.log(`[local-computer] websockify did not start listening on ${this.novncPort}; VNC viewer URL withheld`);
    }
    this.watchVnc();
  }

  /** Background colour + arrow cursor. Only durable while some client stays connected (or with -noreset). */
  private async applyRootDefaults(): Promise<void> {
    await this.run("xsetroot", ["-solid", "#1e2a3a"]).catch((error) => this.log(`[local-computer] xsetroot background failed on ${this.display}: ${describe(error)}`));
    // A bare X server shows the "X" root cursor; give the desktop a real arrow so
    // viewers (VNC, the phone stream) see a pointer, not a crosshair.
    await this.run("xsetroot", ["-cursor_name", "left_ptr"]).catch((error) => this.log(`[local-computer] xsetroot cursor failed on ${this.display}: ${describe(error)}`));
  }

  private vncEnv(): NodeJS.ProcessEnv {
    // x11vnc bails if it thinks the session is Wayland (WSLg exports WAYLAND_DISPLAY).
    const vncEnv: NodeJS.ProcessEnv = { ...process.env, DISPLAY: this.display };
    delete vncEnv.WAYLAND_DISPLAY;
    delete vncEnv.XDG_SESSION_TYPE;
    return vncEnv;
  }

  private spawnX11vnc(): void {
    this.log(`[local-computer] starting x11vnc on ${this.display} (rfb ${this.rfbPort})`);
    // -localhost is load-bearing (A11): this VNC server is passwordless
    // (-nopw) and can drive the desktop, so it must never listen beyond
    // loopback — without it, anyone on the LAN could watch and control the
    // user's sessions. The app's own viewer connects via 127.0.0.1 only.
    // -xdamage plus 5 ms defer/wait roughly halves screen-update latency versus
    // the 20 ms defaults (measured 88 ms → 33 ms through the phone viewer);
    // -nap backs off while the desktop is idle.
    const child = spawn(
      "x11vnc",
      ["-display", this.display, "-nopw", "-forever", "-shared", "-localhost", "-rfbport", String(this.rfbPort), "-quiet", "-xdamage", "-defer", "5", "-wait", "5", "-nap"],
      { env: this.vncEnv(), detached: true, stdio: "ignore" },
    );
    child.unref();
    child.once("exit", (code, signal) => {
      if (this.x11vnc === child) this.x11vnc = undefined;
      this.log(`[local-computer] x11vnc exited (${code ?? signal ?? "?"}); the watchdog restarts it`);
    });
    this.x11vnc = child;
  }

  private spawnWebsockify(): void {
    this.log(`[local-computer] starting websockify(noVNC) on ${this.novncPort} -> ${this.rfbPort}`);
    const child = spawn(
      "websockify",
      [`--web=${this.novncWebRoot}`, `127.0.0.1:${this.novncPort}`, `localhost:${this.rfbPort}`],
      { env: this.vncEnv(), detached: true, stdio: "ignore" },
    );
    child.unref();
    child.once("exit", (code, signal) => {
      if (this.websockify === child) this.websockify = undefined;
      this.log(`[local-computer] websockify exited (${code ?? signal ?? "?"}); the watchdog restarts it`);
    });
    this.websockify = child;
  }

  /**
   * Keeps the viewer alive for the life of the host: an x11vnc (ours or an adopted orphan)
   * that dies used to leave the computer screen black until the app was restarted.
   */
  private watchVnc(): void {
    if (this.vncWatch !== undefined) return;
    this.vncWatch = setInterval(() => { void this.healVnc(); }, 3_000);
    this.vncWatch.unref();
  }

  private async healVnc(): Promise<void> {
    if (this.vncHealing) return;
    this.vncHealing = true;
    try {
      if (!(await this.isDisplayReady())) return; // nothing to serve; Xvfb itself is not ours to revive here
      if (!(await this.isListening(this.rfbPort))) {
        this.log(`[local-computer] x11vnc is not listening on ${this.rfbPort}; restarting`);
        this.spawnX11vnc();
        await delay(800);
        // The old x11vnc's exit may have been the last client: the server reset to a black
        // root and "X" cursor, so paint the defaults again now that a client is attached.
        await this.applyRootDefaults();
      }
      if (!(await this.isListening(this.novncPort))) {
        this.log(`[local-computer] websockify is not listening on ${this.novncPort}; restarting`);
        this.spawnWebsockify();
        if (await this.waitForTcp(this.novncPort, 8_000)) {
          this.vncUrlValue = `http://127.0.0.1:${this.novncPort}/vnc.html?autoconnect=1&resize=scale&path=websockify`;
        }
      }
    } catch (error) {
      this.log(`[local-computer] VNC watchdog: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.vncHealing = false;
    }
  }

  private isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port }, () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.setTimeout(1_000, () => { socket.destroy(); resolve(false); });
    });
  }

  private waitForTcp(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = (): Promise<boolean> => new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port }, () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.setTimeout(1_000, () => { socket.destroy(); resolve(false); });
    });
    return (async () => {
      while (Date.now() < deadline) {
        if (await tryOnce()) return true;
        await delay(250);
      }
      return false;
    })();
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
    if (this.vncWatch !== undefined) { clearInterval(this.vncWatch); this.vncWatch = undefined; }
    try { this.websockify?.kill("SIGKILL"); } catch {}
    try { this.x11vnc?.kill("SIGKILL"); } catch {}
    try { this.wm?.kill("SIGKILL"); } catch {}
    try { this.xvfb?.kill("SIGKILL"); } catch {}
    this.websockify = undefined;
    this.x11vnc = undefined;
    this.wm = undefined;
    this.xvfb = undefined;
    this.ready = undefined;
    this.vncUrlValue = undefined;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
