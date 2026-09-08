/** Session-local adapter for the installed Moonlight Web 2.10 CanvasFrameDrawPipe.
 * The parent selects synchronized Canvas/H264; upstream files are never modified.
 */
type Frame = { displayWidth: number; displayHeight: number };
type CanvasSurface = {
  width: number;
  height: number;
  addEventListener?: (name: string, listener: () => void) => void;
};
type Context = {
  drawImage: (frame: CanvasImageSource, x: number, y: number, width: number, height: number) => void;
  isContextLost?: () => boolean;
};
export type CanvasPipe = {
  implementationName?: string;
  getBase?: () => CanvasPipe | null;
  currentFrame?: Frame | null;
  drawOnSubmit?: boolean;
  drawCurrentFrameIfReady?: () => void;
  errored?: boolean;
  canvas?: CanvasSurface | null;
  isTransferred?: boolean;
  setCanvasSize?: (width: number, height: number) => void;
  useCanvasContext?: (type: string) => { context: Context | null; error: unknown };
  commitFrame?: () => void;
  belmontPresentation?: { version: 1; draws: number; duplicateSkips: number; resizes: number; failures: number };
};

/** Returns false for other/unknown pipelines. Never patch shared prototypes or decoder code. */
export function stabilizeWindowsCanvas(pipe: CanvasPipe): boolean {
  if (pipe.belmontPresentation?.version === 1) return true;
  if (!pipe.implementationName?.startsWith("canvas_frame -> ") || !pipe.drawCurrentFrameIfReady) return false;
  const base = pipe.getBase?.();
  if (base?.implementationName !== "canvas" || base.isTransferred || !base.canvas
    || !base.useCanvasContext || !base.commitFrame || !base.setCanvasSize) return false;

  const stats = { version: 1 as const, draws: 0, duplicateSkips: 0, resizes: 0, failures: 0 };
  let lastFrame: Frame | null = null;
  let lastContext: Context | null = null;
  let lastCanvas: CanvasSurface | null = null;
  let lastWidth = 0;
  let lastHeight = 0;
  const invalidate = () => { lastFrame = null; };
  // v2.10 buildPipeline forwards options to the canvas renderer but NOT the draw pipe.
  // Its RAF is already scheduled by setup(); explicitly select that existing paint path.
  pipe.drawOnSubmit = false;
  base.canvas.addEventListener?.("contextrestored", invalidate);
  // setup() also calls this method. Guard that path too: otherwise an unchanged-size
  // setup clears the bitmap while the duplicate guard still remembers a painted frame.
  base.setCanvasSize = (width, height) => {
    const canvas = base.canvas;
    if (!canvas || base.isTransferred) return;
    if (canvas.width !== width) { invalidate(); canvas.width = width; stats.resizes += 1; }
    if (canvas.height !== height) { invalidate(); canvas.height = height; stats.resizes += 1; }
  };

  pipe.drawCurrentFrameIfReady = () => {
    if (pipe.errored) return;
    const frame = pipe.currentFrame;
    const canvas = base.canvas;
    if (!frame || !canvas || frame.displayWidth <= 0 || frame.displayHeight <= 0) return;
    try {
      const { context, error } = base.useCanvasContext!("2d");
      if (!context || error || context.isContextLost?.()) { invalidate(); return; }
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      if (frame === lastFrame && context === lastContext && canvas === lastCanvas
        && width === lastWidth && height === lastHeight && canvas.width === width && canvas.height === height) {
        stats.duplicateSkips += 1;
        return;
      }
      // Assigning even the SAME dimensions clears the bitmap and resets its context.
      // H264 frames cover this entire surface; no intermediate transparent clear is needed.
      base.setCanvasSize!(width, height);
      context.drawImage(frame as CanvasImageSource, 0, 0, width, height);
      base.commitFrame!();
      lastFrame = frame;
      lastContext = context;
      lastCanvas = canvas;
      lastWidth = width;
      lastHeight = height;
      stats.draws += 1;
    } catch {
      // Do not count a decoded-but-undrawable frame as successfully presented.
      invalidate();
      stats.failures += 1;
      pipe.errored = true;
    }
  };
  pipe.belmontPresentation = stats;
  return true;
}
