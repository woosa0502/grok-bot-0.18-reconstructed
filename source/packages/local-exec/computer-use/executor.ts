// Local computer-use executor for WSL/Linux. Drives an X display (typically a
// dedicated Xvfb) with xdotool for input and ImageMagick `import` for capture,
// so the Computer tool works in local Codex mode without the cloud box image.
//
// The model works in a normalized API coordinate space (see scaling.ts / display.ts);
// this executor scales those coordinates to real display pixels before issuing xdotool.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CoordinateScaler } from "./scaling.js";
import { buildResolutionConfig, parseXrandrOutput } from "./display.js";
import { exec, executionSignal, throwIfExecutionAborted } from "./shell.js";
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
  readonly capture?: (display: string, size: { width: number; height: number }, outPath: string, signal?: AbortSignal) => Promise<void>;
}

export class LocalComputerUseExecutor {
  private readonly display: string;
  private readonly displaySize: { readonly width: number; readonly height: number } | undefined;
  private scaler: CoordinateScaler | undefined;
  private readonly captureFn: NonNullable<LocalComputerExecutorOptions["capture"]>;

  constructor(options: LocalComputerExecutorOptions) {
    this.display = options.display;
    this.displaySize = options.displaySize;
    this.captureFn = options.capture ?? defaultCapture;
  }

  private env(): NodeJS.ProcessEnv {
    return { DISPLAY: this.display };
  }

  private async ensureScaler(signal?: AbortSignal): Promise<CoordinateScaler> {
    throwIfExecutionAborted(signal);
    if (this.scaler === undefined) {
      const size = this.displaySize ?? parseXrandrOutput(await exec(
        "xrandr", ["--display", this.display], { timeoutMs: 5_000, signal },
      ));
      throwIfExecutionAborted(signal);
      const resolution = buildResolutionConfig(size.width, size.height);
      this.scaler = new CoordinateScaler(resolution);
    }
    return this.scaler;
  }

  private async toDisplay(coordinate: Coordinate | undefined, signal?: AbortSignal): Promise<{ x: number; y: number } | undefined> {
    if (coordinate === undefined) return undefined;
    const scaler = await this.ensureScaler(signal);
    return scaler.apiToDisplay(coordinate.x, coordinate.y);
  }

  private async xdotool(args: (string | number)[], signal?: AbortSignal): Promise<string> {
    return exec("xdotool", args, { env: this.env(), timeoutMs: 15_000, signal });
  }

  private async runAction(action: ComputerUseAction, pressedButtons: Set<number>, signal?: AbortSignal): Promise<void> {
    throwIfExecutionAborted(signal);
    const a = action.action;
    switch (a.case) {
      case "mouseMove": {
        const p = await this.toDisplay(a.value.coordinate, signal);
        if (p) await this.xdotool(["mousemove", p.x, p.y], signal);
        break;
      }
      case "click": {
        const p = await this.toDisplay(a.value.coordinate, signal);
        const btn = MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1;
        const count = Math.max(1, a.value.count || 1);
        if (p) await this.xdotool(["mousemove", p.x, p.y], signal);
        await this.xdotool(["click", "--repeat", count, btn], signal);
        break;
      }
      case "mouseDown": {
        const button = MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1;
        await this.xdotool(["mousedown", button], signal);
        pressedButtons.add(button);
        break;
      }
      case "mouseUp": {
        const button = MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1;
        await this.xdotool(["mouseup", button], signal);
        pressedButtons.delete(button);
        break;
      }
      case "drag": {
        const btn = MOUSE_BUTTON_TO_X[a.value.button as MouseButton] ?? 1;
        const path = a.value.path ?? [];
        if (path.length > 0) {
          const first = await this.toDisplay(path[0], signal);
          if (first) await this.xdotool(["mousemove", first.x, first.y], signal);
          await this.xdotool(["mousedown", btn], signal);
          try {
            for (let i = 1; i < path.length; i++) {
              const p = await this.toDisplay(path[i], signal);
              if (p) await this.xdotool(["mousemove", p.x, p.y], signal);
            }
          } finally {
            // Release only the button this drag successfully pressed, even if
            // cancellation prevents any further requested input actions.
            await this.xdotool(["mouseup", btn]);
          }
        }
        break;
      }
      case "scroll": {
        const p = await this.toDisplay(a.value.coordinate, signal);
        if (p) await this.xdotool(["mousemove", p.x, p.y], signal);
        const btn = SCROLL_DIRECTION_TO_X[a.value.direction as ScrollDirection] ?? 5;
        const amount = Math.max(1, a.value.amount || 1);
        await this.xdotool(["click", "--repeat", amount, btn], signal);
        break;
      }
      case "type": {
        await this.xdotool(["type", "--clearmodifiers", "--", a.value.text ?? ""], signal);
        break;
      }
      case "key": {
        // xdotool key accepts "+"-joined chords like "ctrl+a"; pass through.
        await this.xdotool(["key", "--clearmodifiers", a.value.key ?? ""], signal);
        break;
      }
      case "wait": {
        await delay(Math.min(10_000, Math.max(0, a.value.durationMs || 0)), undefined, { signal });
        break;
      }
      case "screenshot":
      case "cursorPosition":
      case undefined:
        break;
    }
  }

  // Matches Executor<ComputerUseArgs, ComputerUseResult>.execute(ctx, args, options?).
  async execute(ctx: unknown, args: ComputerUseArgs, _options?: unknown): Promise<ComputerUseResult> {
    const signal = executionSignal(ctx);
    const start = Date.now();
    const actions = args.actions ?? [];
    const pressedButtons = new Set<number>();
    try {
      throwIfExecutionAborted(signal);
      for (const action of actions) {
        await this.runAction(action, pressedButtons, signal);
      }
      await delay(SCREENSHOT_SETTLE_MS, undefined, { signal });
      const screenshot = await this.captureBase64(signal);
      throwIfExecutionAborted(signal);
      return new ComputerUseResultMsg({
        result: {
          case: "success",
          value: new ComputerUseSuccess({ actionCount: actions.length, durationMs: Date.now() - start, screenshot }),
        },
      });
    } catch (error) {
      const errors = [signal?.aborted ? "Computer use execution canceled" : error instanceof Error ? error.message : String(error)];
      for (const button of pressedButtons) {
        try {
          await this.xdotool(["mouseup", button]);
        } catch (releaseError) {
          errors.push(`Failed to release mouse button ${button}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
        }
      }
      return new ComputerUseResultMsg({
        result: {
          case: "error",
          value: new ComputerUseError({
            error: errors.join("; "),
            actionCount: actions.length,
            durationMs: Date.now() - start,
          }),
        },
      });
    }
  }

  private async captureBase64(signal?: AbortSignal): Promise<string> {
    const scaler = await this.ensureScaler(signal);
    const size = { width: scaler.displayWidth, height: scaler.displayHeight };
    const captureDir = await mkdtemp(join(tmpdir(), "sand-cu-"));
    const outPath = join(captureDir, "screenshot.png");
    try {
      throwIfExecutionAborted(signal);
      await this.captureFn(this.display, size, outPath, signal);
      throwIfExecutionAborted(signal);
      const bytes = await readFile(outPath, { signal });
      return bytes.toString("base64");
    } finally {
      await rm(captureDir, { recursive: true, force: true });
    }
  }
}

// ffmpeg x11grab reliably captures a full-color frame of the X root on Xvfb,
// where ImageMagick `import -window root` can degrade to a 1-bit/blank image.
async function defaultCapture(display: string, size: { width: number; height: number }, outPath: string, signal?: AbortSignal): Promise<void> {
  await exec(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "x11grab", "-video_size", `${size.width}x${size.height}`, "-i", display, "-frames:v", "1", outPath],
    { env: { DISPLAY: display }, timeoutMs: 15_000, signal },
  );
}
