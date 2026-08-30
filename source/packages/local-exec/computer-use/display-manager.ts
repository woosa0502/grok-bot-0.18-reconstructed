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
  readonly log?: (message: string) => void;
}

export class LocalDisplayManager {
  private readonly displayNumber: number;
  private readonly width: number;
  private readonly height: number;
  private readonly startWm: boolean;
  private readonly log: (message: string) => void;
  private ready: Promise<LocalDisplay> | undefined;
  private xvfb: ReturnType<typeof spawn> | undefined;
  private wm: ReturnType<typeof spawn> | undefined;

  constructor(options: LocalDisplayManagerOptions = {}) {
    this.displayNumber = options.displayNumber ?? 99;
    this.width = options.width ?? 1280;
    this.height = options.height ?? 800;
    this.startWm = options.startWindowManager ?? true;
    this.log = options.log ?? (() => {});
  }

  get display(): string {
    return `:${this.displayNumber}`;
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
    return { display, displayNumber: this.displayNumber, width: this.width, height: this.height };
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
    try { this.wm?.kill("SIGKILL"); } catch {}
    try { this.xvfb?.kill("SIGKILL"); } catch {}
    this.wm = undefined;
    this.xvfb = undefined;
    this.ready = undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
