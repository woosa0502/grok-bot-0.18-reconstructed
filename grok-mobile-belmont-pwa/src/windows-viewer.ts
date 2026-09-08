import { stabilizeWindowsCanvas } from "./windows-canvas.ts";
import type { CanvasPipe } from "./windows-canvas.ts";
import type { RelativePointerTarget } from "./windows-pointer.ts";
import { streamlineWindowsTransport } from "./windows-transport.ts";
import type { WindowsTransport } from "./windows-transport.ts";

/** Lifecycle boundary for the installed Moonlight Web 2.10 client. */
export type ViewerPhase = "connecting" | "ready" | "suspended" | "error";

type Pipe = {
  getBase?: () => Pipe | null;
  cleanup?: () => unknown;
  errored?: boolean;
  decoder?: { state: string; close: () => void };
  currentFrame?: { timestamp?: number; displayWidth?: number; displayHeight?: number; close?: () => void } | null;
  context?: { isContextLost?: () => boolean } | null;
  animationFrameRequest?: number | null;
  writer?: { abort: () => Promise<unknown> };
  trackGenerator?: { stop: () => void };
};

export type MoonlightInput = RelativePointerTarget & {
  raiseAllKeys?: () => void;
  sendKey?: (down: boolean, key: number, modifiers: number) => void;
  keyboard?: { send: (buffer: ArrayBuffer) => void } | null;
  sendAccumulatedScroll: (deltaX: number, deltaY: number) => void;
  sendMouseButton: (isDown: boolean, button: number) => void;
  sendMouseMoveClientCoordinates: (movementX: number, movementY: number, rect: DOMRect) => void;
};

export type MoonlightWindow = Window & {
  app?: {
    getStream?: () => {
      getInput?: () => MoonlightInput;
      getVideoRenderer?: () => Pipe | null;
      getAudioPlayer?: () => Pipe | null;
      getStats?: () => { toggle: () => void };
      ws?: { readyState: number; close?: () => void };
      transport?: WindowsTransport;
    } | null;
    getStreamRect?: () => DOMRect;
    onUserInteraction?: () => void;
  };
};

function attempt(action: () => unknown) {
  try {
    // Cross-realm promises cannot reliably be tested with instanceof Promise.
    void Promise.resolve(action()).catch(() => {});
  } catch {
    // A dead frame or a half-initialized pipe must not prevent detachment.
  }
}

function pipes(root: Pipe | null | undefined): Pipe[] {
  const result: Pipe[] = [];
  for (let pipe = root; pipe && result.length < 16 && !result.includes(pipe); pipe = pipe.getBase?.()) {
    result.push(pipe);
  }
  return result;
}

function releaseViewer(frame: HTMLIFrameElement) {
  attempt(() => {
    const child = frame.contentWindow as MoonlightWindow | null;
    const stream = child?.app?.getStream?.();
    attempt(() => stream?.getInput?.()?.raiseAllKeys?.());
    // Close only this viewer. Do NOT send Sunshine Stop/Quit or cancel the host app.
    attempt(() => stream?.ws?.close?.());
    for (const media of frame.contentDocument?.querySelectorAll("video, audio") ?? []) {
      attempt(() => {
        const element = media as HTMLMediaElement;
        element.pause();
        const source = element.srcObject as MediaStream | null;
        for (const track of source?.getTracks?.() ?? []) attempt(() => track.stop());
        element.srcObject = null;
      });
    }
    for (const root of [stream?.getVideoRenderer?.(), stream?.getAudioPlayer?.()]) {
      const chain = pipes(root);
      attempt(() => root?.cleanup?.());
      // Upstream generic cleanup omits retained frames, RAF and generated-track writers.
      for (const pipe of chain) {
        attempt(() => {
          if (pipe.animationFrameRequest != null) child?.cancelAnimationFrame(pipe.animationFrameRequest);
        });
        attempt(() => pipe.currentFrame?.close?.());
        attempt(() => pipe.writer?.abort());
        attempt(() => pipe.trackGenerator?.stop());
        attempt(() => { if (pipe.decoder && pipe.decoder.state !== "closed") pipe.decoder.close(); });
      }
    }
  });
  // This element is owned imperatively, not by React. Synchronous removal discards the child
  // browsing context (including probe workers) before Android can freeze the parent page.
  frame.remove();
}

function viewerHealth(frame: HTMLIFrameElement): { ready: boolean; failed: boolean; progress?: unknown } {
  try {
    const stream = (frame.contentWindow as MoonlightWindow | null)?.app?.getStream?.();
    streamlineWindowsTransport(stream?.transport);
    if (stream?.ws && stream.ws.readyState >= 2) return { ready: false, failed: true };
    const chain = pipes(stream?.getVideoRenderer?.());
    for (const pipe of chain) stabilizeWindowsCanvas(pipe as CanvasPipe);
    if (chain.some((pipe) => pipe.errored || pipe.decoder?.state === "closed")) return { ready: false, failed: true };
    const video = frame.contentDocument?.querySelector("video");
    const canvas = frame.contentDocument?.querySelector<HTMLCanvasElement>("canvas.video-stream");
    // Document load, configured resolution, and received packets do not establish decoded video.
    const decoded = chain.find((pipe) => pipe.currentFrame?.timestamp != null)?.currentFrame;
    const context = chain.find((pipe) => pipe.context)?.context;
    const videoReady = Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
    const canvasReady = Boolean(canvas && decoded && decoded.displayWidth! > 0
      && canvas.width === decoded.displayWidth && canvas.height === decoded.displayHeight
      && context && !context.isContextLost?.());
    return {
      ready: stream?.ws?.readyState === 1 && (videoReady || canvasReady),
      failed: false,
      // VideoFrame identity changes even when upstream timestamps are constant. Keep just
      // one previous (already closed by upstream) object, never a queue of decoded frames.
      progress: canvasReady ? decoded : videoReady ? video?.currentTime : undefined,
    };
  } catch {
    return { ready: false, failed: true };
  }
}

export function createWindowsViewer(
  container: HTMLElement,
  onFrame: (frame: HTMLIFrameElement | null) => void,
  onPhase: (phase: ViewerPhase) => void,
) {
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  let frame: HTMLIFrameElement | null = null;
  let phase: ViewerPhase = "suspended";
  let disposed = false;
  let frozen = false;
  let pageHidden = false;
  let startedAt = 0;
  let readyAt = 0;
  let lastProgressAt = 0;
  let progress: unknown;
  let lastTick = Date.now();
  let retries = 0;
  const canRun = () => !disposed && !frozen && !pageHidden && doc.visibilityState === "visible";
  const publish = (next: ViewerPhase) => { phase = next; onPhase(next); };

  function detach() {
    const previous = frame;
    frame = null;
    progress = undefined;
    onFrame(null);
    if (previous) releaseViewer(previous);
  }

  function suspend() {
    detach();
    publish("suspended");
  }

  function start() {
    if (!canRun() || frame) return;
    startedAt = lastTick = Date.now();
    readyAt = 0;
    lastProgressAt = startedAt;
    publish("connecting");
    frame = doc.createElement("iframe");
    frame.title = "Windows 원격 화면";
    frame.allow = "autoplay; fullscreen; gamepad";
    frame.allowFullscreen = true;
    frame.src = "/windows/desktop";
    frame.addEventListener("load", (event) => {
      if (disposed || !frame || event.currentTarget !== frame) return;
      try {
        const childDoc = frame.contentDocument;
        if (!childDoc || childDoc.getElementById("belmont-viewer-chrome")) return;
        const style = childDoc.createElement("style");
        style.id = "belmont-viewer-chrome";
        // The parent owns menus and keyboard. Do not leave an unclickable sidebar handle
        // underneath its input surface, nor a second floating keyboard/fullscreen control.
        style.textContent = "#sidebar-root,.stream-keyboard-floating-button{display:none!important}";
        childDoc.head.appendChild(style);
      } catch { /* A navigated or crashed child is handled by the readiness watchdog. */ }
    });
    onFrame(frame);
    container.appendChild(frame);
  }

  function retry() {
    detach();
    if (!canRun()) { publish("suspended"); return; }
    // Two automatic retries per failure episode. A persistent failure must not spin up
    // unlimited decoders. Manual refresh or a genuine hide/show starts a new episode.
    if (retries >= 2) { publish("error"); return; }
    retries += 1;
    start();
  }

  function reconnect() {
    if (phase === "connecting" && Date.now() - startedAt < 20_000) return;
    retries = 0;
    detach();
    start();
  }

  function resume() {
    if (!canRun() || frame || phase === "error") return;
    retries = 0;
    start();
  }

  const visibility = () => { if (doc.visibilityState === "hidden") suspend(); else resume(); };
  const pagehide = () => { pageHidden = true; suspend(); };
  const pageshow = () => { pageHidden = false; frozen = false; resume(); };
  const freeze = () => { frozen = true; suspend(); };
  const thaw = () => { frozen = false; resume(); };
  const online = () => { if (canRun() && phase === "error") reconnect(); };

  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("freeze", freeze);
  doc.addEventListener("resume", thaw);
  win.addEventListener("pagehide", pagehide);
  win.addEventListener("pageshow", pageshow);
  win.addEventListener("online", online);
  const watchdog = win.setInterval(() => {
    const now = Date.now();
    const timerGap = now - lastTick > 3_500;
    lastTick = now;
    if (!canRun() || !frame) return;
    const health = viewerHealth(frame);
    if (health.failed || (phase === "ready" && timerGap)) { retry(); return; }
    if (health.ready && health.progress !== progress) {
      progress = health.progress;
      lastProgressAt = now;
    }
    if (phase === "ready" && now - lastProgressAt >= 8_000) { retry(); return; }
    if (health.ready) {
      if (phase !== "ready") { readyAt = now; publish("ready"); }
      if (now - readyAt >= 30_000) retries = 0;
    } else if (phase === "connecting" && now - startedAt >= 20_000) {
      retry();
    }
  }, 1_000);
  start();

  return {
    reconnect,
    dispose() {
      disposed = true;
      win.clearInterval(watchdog);
      doc.removeEventListener("visibilitychange", visibility);
      doc.removeEventListener("freeze", freeze);
      doc.removeEventListener("resume", thaw);
      win.removeEventListener("pagehide", pagehide);
      win.removeEventListener("pageshow", pageshow);
      win.removeEventListener("online", online);
      detach();
    },
  };
}
