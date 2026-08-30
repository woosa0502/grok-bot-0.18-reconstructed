// Local computer-use executor for WSL/Linux. Drives an X display (typically a
// dedicated Xvfb) with xdotool for input and ImageMagick `import` for capture,
// so the Computer tool works in local Codex mode without the cloud box image.
//
// The model works in a normalized API coordinate space (see scaling.ts / display.ts);
// this executor scales those coordinates to real display pixels before issuing xdotool.
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoordinateScaler } from "./scaling.js";
import { buildResolutionConfig, detectDisplay } from "./display.js";
import { exec } from "./shell.js";
import type {
  ComputerUseArgs,
  ComputerUseResult,
  ComputerUseAction,
  Coordinate,
  MouseButton,
  ScrollDirection,
} from "../../proto/generated/agent/v1/computer_use_tool_pb.js";
import {
  ComputerUseResult as ComputerUseResultMsg,
  ComputerUseSuccess,
  ComputerUseError,
} from "../../proto/generated/agent/v1/computer_use_tool_pb.js";

// proto MouseButton (LEFT=1,RIGHT=2,MIDDLE=3,BACK=4,FORWARD=5) -> X/xdotool button numbers.
const MOUSE_BUTTON_TO_X: Record<number, number> = { 1: 1, 2: 3, 3: 2, 4: 8, 5: 9 };
// proto ScrollDirection (UP=1,DOWN=2,LEFT=3,RIGHT=4) -> X scroll button numbers.
const SCROLL_DIRECTION_TO_X: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 7 };

const SCREENSHOT_SETTLE_MS = 400;

export interface LocalComputerExecutorOptions {
  /** X display string, e.g. ":99". */
  readonly display: string;
  /**
   * Known display pixel size. When provided the scaler is built directly and
   * `xrandr` is skipped — preferred for a Xvfb we start ourselves (its geometry
   * is known and xrandr can be unreliable/absent on a bare Xvfb).
   */
  readonly displaySize?: { readonly width: number; readonly height: number };
  /** Override capture method; defaults to ffmpeg x11grab (reliable on Xvfb). */
  readonly capture?: (display: string, size: { width: number; height: number }, outPath: string) => Promise<void>;
}

export class LocalComputerUseExecutor {
  private readonly display: string;
  private readonly displaySize: { readonly width: number; readonly height: number } | undefined;
  private scaler: CoordinateScaler | undefined;
  private readonly captureFn: (display: string, size: { width: number; height: number }, outPath: string) => Promise<void>;

  constructor(options: LocalComputerExecutorOptions) {
    this.display = options.display;
    this.displaySize = options.displaySize;
    this.captureFn = options.capture ?? defaultCapture;
  }

  private env(): NodeJS.ProcessEnv {
    return { DISPLAY: this.display };
  }

  private async ensureScaler(): Promise<CoordinateScaler> {
    if (this.scaler === undefined) {
      const resolution = this.displaySize !== undefined
        ? buildResolutionConfig(this.displaySize.width, this.displaySize.height)
        : (await detectDisplay(this.display)).resolution;
      this.scaler = new CoordinateScaler(resolution);
    }
    return this.scaler;
  }

  private async toDisplay(coordinate: Coordinate | undefined): Promise<{ x: number; y: number } | undefined> {
    if (coordinate === undefined) return undefined;
    const scaler = await this.ensureScaler();
    return scaler.apiToDisplay(coordinate.x, coordinate.y);
  }

  private async xdotool(args: (string | number)[]): Promise<string> {
    return exec("xdotool", args, { env: this.env(), timeoutMs: 15_000 });
  }

  private async runAction(action: ComputerUseAction): Promise<void> {
    const a = action.action;
    switch (a.case) {
      case "mouseMove": {
        const p = await this.toDisplay(a.value.coordinate);
        if (p) await this.xdotool(["mousemove", p.x, p.y]);
        break;
      }
      case "click": {
        const p = await this.toDisplay(a.value.coordinate);
        const btn = MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1;
        const count = Math.max(1, a.value.count || 1);
        if (p) await this.xdotool(["mousemove", p.x, p.y]);
        await this.xdotool(["click", "--repeat", count, btn]);
        break;
      }
      case "mouseDown": {
        await this.xdotool(["mousedown", MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1]);
        break;
      }
      case "mouseUp": {
        await this.xdotool(["mouseup", MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1]);
        break;
      }
      case "drag": {
        const btn = MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1;
        const path = a.value.path ?? [];
        if (path.length > 0) {
          const first = await this.toDisplay(path[0]);
          if (first) await this.xdotool(["mousemove", first.x, first.y]);
          await this.xdotool(["mousedown", btn]);
          for (let i = 1; i < path.length; i++) {
            const p = await this.toDisplay(path[i]);
            if (p) await this.xdotool(["mousemove", p.x, p.y]);
          }
          await this.xdotool(["mouseup", btn]);
        }
        break;
      }
      case "scroll": {
        const p = await this.toDisplay(a.value.coordinate);
        if (p) await this.xdotool(["mousemove", p.x, p.y]);
        const btn = SCROLL_DIRECTION_TO_X[a.value.direction as ScrollDirection] ?? 5;
        const amount = Math.max(1, a.value.amount || 1);
        await this.xdotool(["click", "--repeat", amount, btn]);
        break;
      }
      case "type": {
        await this.xdotool(["type", "--clearmodifiers", "--", a.value.text ?? ""]);
        break;
      }
      case "key": {
        // xdotool key accepts "+"-joined chords like "ctrl+a"; pass through.
        await this.xdotool(["key", "--clearmodifiers", a.value.key ?? ""]);
        break;
      }
      case "wait": {
        await delay(Math.min(10_000, Math.max(0, a.value.durationMs || 0)));
        break;
      }
      case "screenshot":
      case "cursorPosition":
      case undefined:
        break;
    }
  }

  // Matches Executor<ComputerUseArgs, ComputerUseResult>.execute(ctx, args, options?).
  async execute(_ctx: unknown, args: ComputerUseArgs, _options?: unknown): Promise<ComputerUseResult> {
    const start = Date.now();
    const actions = args.actions ?? [];
    try {
      for (const action of actions) {
        await this.runAction(action);
      }
      await delay(SCREENSHOT_SETTLE_MS);
      const screenshot = await this.captureBase64();
      return new ComputerUseResultMsg({
        result: {
          case: "success",
          value: new ComputerUseSuccess({ actionCount: actions.length, durationMs: Date.now() - start, screenshot }),
        },
      });
    } catch (error) {
      return new ComputerUseResultMsg({
        result: {
          case: "error",
          value: new ComputerUseError({
            error: error instanceof Error ? error.message : String(error),
            actionCount: actions.length,
            durationMs: Date.now() - start,
          }),
        },
      });
    }
  }

  private async captureBase64(): Promise<string> {
    const scaler = await this.ensureScaler();
    const size = { width: scaler.displayWidth, height: scaler.displayHeight };
    const outPath = join(tmpdir(), `sand-cu-${process.pid}-${Date.now()}.png`);
    try {
      await this.captureFn(this.display, size, outPath);
      const bytes = await readFile(outPath);
      return bytes.toString("base64");
    } finally {
      await unlink(outPath).catch(() => {});
    }
  }
}

// ffmpeg x11grab reliably captures a full-color frame of the X root on Xvfb,
// where ImageMagick `import -window root` can degrade to a 1-bit/blank image.
async function defaultCapture(display: string, size: { width: number; height: number }, outPath: string): Promise<void> {
  await exec(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "x11grab", "-video_size", `${size.width}x${size.height}`, "-i", display, "-frames:v", "1", outPath],
    { env: { DISPLAY: display }, timeoutMs: 15_000 },
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
