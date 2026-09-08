import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { Icon } from "../components/Icon";
import { WindowsKeyboardDock, WindowsSettingsMenu } from "../components/WindowsControls";
import { createWindowsViewer } from "../windows-viewer";
import { createRelativePointer } from "../windows-pointer";
import { applyWindowsVideoProfile, readWindowsFrameRate, WINDOWS_FRAME_RATE_KEY } from "../windows-video-settings";
import type { WindowsFrameRate } from "../windows-video-settings";
import type { MoonlightInput, MoonlightWindow, ViewerPhase } from "../windows-viewer";

type Relay = { input: MoonlightInput; rect: DOMRect };

/**
 * Keep touch capture in the parent PWA; it is mounted only after decoded video is available.
 */
function MoonlightTrackpad({ frame, onDisconnected, sensitivity }: { frame: React.RefObject<HTMLIFrameElement | null>; onDisconnected: () => void; sensitivity: number }) {
  const pointer = useRef(createRelativePointer());
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef({
    start: { x: 0, y: 0, at: 0 },
    last: { x: 0, y: 0 },
    moved: false,
    rightClicked: false,
    twoY: null as number | null,
    longTimer: 0,
    touchCount: 0,
    rawPointerId: null as number | null,
    rawActive: false,
  });

  function relay(activate = false): Relay | null {
    try {
      const moonlight = frame.current?.contentWindow as MoonlightWindow | null;
      const app = moonlight?.app;
      const stream = app?.getStream?.();
      if (stream?.ws?.readyState != null && stream.ws.readyState >= 2) {
        onDisconnected();
        return null;
      }
      if (stream?.ws?.readyState !== 1) return null;
      const input = stream?.getInput?.();
      const rect = app?.getStreamRect?.();
      if (input == null || rect == null || rect.width <= 0 || rect.height <= 0) return null;
      if (activate) app?.onUserInteraction?.();
      return { input, rect };
    } catch {
      return null;
    }
  }

  function clearLongPress() {
    if (gesture.current.longTimer !== 0) {
      window.clearTimeout(gesture.current.longTimer);
      gesture.current.longTimer = 0;
    }
  }

  function cancelGesture() {
    clearLongPress();
    pointer.current.reset();
    gesture.current.moved = true;
    gesture.current.twoY = null;
    gesture.current.touchCount = 0;
    gesture.current.rawPointerId = null;
    gesture.current.rawActive = false;
  }

  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") cancelGesture(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      cancelGesture();
    };
  }, []);

  function click(button: 1 | 3) {
    const target = relay(true);
    if (target == null) return;
    target.input.sendMouseButton(true, button);
    target.input.sendMouseButton(false, button);
  }

  function onStart(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    relay(true);
    pointer.current.reset();
    const state = gesture.current;
    state.touchCount = event.touches.length;
    state.rawActive = false;
    if (surface.current) surface.current.dataset.pointerInput = "touch";
    if (event.touches.length === 1) {
      const touch = event.touches[0]!;
      state.start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
      state.last = { x: touch.clientX, y: touch.clientY };
      state.moved = false;
      state.rightClicked = false;
      state.twoY = null;
      clearLongPress();
      state.longTimer = window.setTimeout(() => {
        if (!state.moved) {
          click(3);
          state.rightClicked = true;
        }
      }, 600);
    } else if (event.touches.length === 2) {
      clearLongPress();
      state.moved = true;
      state.twoY = (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2;
    }
  }

  function movePointer(x: number, y: number) {
    const state = gesture.current;
    const movementX = x - state.last.x;
    const movementY = y - state.last.y;
    state.last = { x, y };
    if (Math.hypot(x - state.start.x, y - state.start.y) > 5) {
      state.moved = true;
      clearLongPress();
    }
    const target = relay();
    if (!target || !pointer.current.move(target.input, movementX, movementY, target.rect, sensitivity)) cancelGesture();
  }

  useEffect(() => {
    const element = surface.current;
    if (!element || !("onpointerrawupdate" in window)) return;
    const rawMove = (source: Event) => {
      const event = source as PointerEvent;
      const state = gesture.current;
      if (event.pointerType !== "touch" || !event.isPrimary || event.pointerId !== state.rawPointerId
        || state.touchCount !== 1 || state.twoY !== null) return;
      // Once native raw input arrives, corresponding TouchEvents are historical duplicates.
      // Send the newest position once, without a RAF/timer or replaying coalesced samples.
      if (!state.rawActive) element.dataset.pointerInput = "raw";
      state.rawActive = true;
      movePointer(event.clientX, event.clientY);
    };
    element.addEventListener("pointerrawupdate", rawMove, { passive: true });
    return () => element.removeEventListener("pointerrawupdate", rawMove);
  }, [frame, onDisconnected, sensitivity]);

  function onMove(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    const state = gesture.current;
    if (state.touchCount === 0) return;
    if (event.touches.length === 1 && state.twoY == null && !state.rawActive) {
      const touch = event.touches[0]!;
      movePointer(touch.clientX, touch.clientY);
    } else if (event.touches.length === 2) {
      const middleY = (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2;
      const target = relay();
      if (target != null && state.twoY != null) {
        target.input.sendAccumulatedScroll(0, (middleY - state.twoY) * 10);
      }
      state.twoY = middleY;
    }
  }

  function onEnd(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    pointer.current.reset();
    gesture.current.touchCount = event.touches.length;
    gesture.current.rawActive = false;
    if (event.touches.length > 0) return;
    const state = gesture.current;
    state.rawPointerId = null;
    clearLongPress();
    if (!state.moved && !state.rightClicked && state.twoY == null && Date.now() - state.start.at < 600) click(1);
    state.rightClicked = false;
    state.twoY = null;
  }

  return (
    <div
      aria-label="Windows 트랙패드 직접 입력"
      className="windows-trackpad-layer"
      ref={surface}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") relay(true);
        else if (event.isPrimary) gesture.current.rawPointerId = event.pointerId;
      }}
      onPointerCancel={cancelGesture}
      onTouchCancel={cancelGesture}
      onTouchEnd={onEnd}
      onTouchMove={onMove}
      onTouchStart={onStart}
      role="application"
    />
  );
}

export function WindowsDesktopScreen({ onBack }: { onBack: () => void }) {
  const [frameRate, setFrameRate] = useState<WindowsFrameRate>(() => {
    try { return readWindowsFrameRate(localStorage); } catch { return 60; }
  });
  const [settingsReady, setSettingsReady] = useState(false);
  const [phase, setPhase] = useState<ViewerPhase>("connecting");
  const [sensitivity, setSensitivity] = useState(() => {
    try { const value = Number(localStorage.getItem("belmontWindowsPointerSpeed")); return [0.7, 1.4, 2].includes(value) ? value : 1.4; } catch { return 1.4; }
  });
  const [notice, setNotice] = useState("");
  const screen = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof createWindowsViewer> | null>(null);
  const reconnectStream = useCallback(() => viewer.current?.reconnect(), []);
  const getKeyboardTarget = useCallback(() => {
    try {
      const stream = (frame.current?.contentWindow as MoonlightWindow | null)?.app?.getStream?.();
      const input = stream?.getInput?.();
      if (stream?.ws?.readyState !== 1 || !input?.sendKey || !input.keyboard) return null;
      return { sendKey: input.sendKey.bind(input), keyboard: input.keyboard };
    } catch { return null; }
  }, []);

  useEffect(() => {
    const resize = () => {
      if (!screen.current) return;
      const top = Math.max(0, screen.current.getBoundingClientRect().top);
      screen.current.style.height = `${Math.max(180, (window.visualViewport?.height ?? window.innerHeight) - top)}px`;
    };
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => { window.visualViewport?.removeEventListener("resize", resize); window.removeEventListener("resize", resize); };
  }, []);

  function changeSensitivity(value: number) {
    setSensitivity(value);
    try { localStorage.setItem("belmontWindowsPointerSpeed", String(value)); } catch {}
  }
  function changeFrameRate(value: WindowsFrameRate) {
    if (value === frameRate) return;
    try { applyWindowsVideoProfile(localStorage, value); }
    catch { setNotice("영상 설정을 저장하지 못했습니다. 기존 프레임 설정을 유지합니다."); return; }
    try { localStorage.setItem(WINDOWS_FRAME_RATE_KEY, String(value)); }
    catch { setNotice("현재 영상에는 적용하지만 다음 실행까지 기억하지 못했습니다."); }
    setPhase("connecting");
    setFrameRate(value);
  }
  function fullscreen() {
    const change = document.fullscreenElement ? document.exitFullscreen() : screen.current?.requestFullscreen?.();
    if (!change) setNotice("이 브라우저에서는 전체 화면을 지원하지 않습니다.");
    else void change.catch(() => setNotice("전체 화면으로 전환하지 못했습니다."));
  }
  function toggleStats() {
    try {
      const stats = (frame.current?.contentWindow as MoonlightWindow | null)?.app?.getStream?.()?.getStats?.();
      if (stats) stats.toggle();
      else setNotice("연결 통계가 아직 준비되지 않았습니다.");
    } catch { setNotice("연결 통계를 표시하지 못했습니다."); }
  }

  useEffect(() => {
    try {
      applyWindowsVideoProfile(localStorage, frameRate);
    } catch {
      setNotice("브라우저 저장소를 사용할 수 없어 영상 설정이 기본값으로 실행될 수 있습니다.");
    }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    if (!settingsReady || !container.current) return;
    const current = createWindowsViewer(container.current, (element) => { frame.current = element; }, setPhase);
    viewer.current = current;
    return () => {
      current.dispose();
      viewer.current = null;
    };
  }, [settingsReady, frameRate]);

  return (
    <main className="windows-desktop-screen" ref={screen}>
      <header className="windows-desktop-toolbar">
        <button aria-label="뒤로" className="dark-circle" onClick={onBack} type="button"><Icon name="back" size={21} /></button>
        <span><strong>Windows</strong><small>호환 모드 · 720p / {frameRate}fps</small></span>
        <WindowsSettingsMenu frameRate={frameRate} onFrameRate={changeFrameRate} onFullscreen={fullscreen} onReconnect={reconnectStream} onSensitivity={changeSensitivity} onStats={toggleStats} ready={phase === "ready"} sensitivity={sensitivity} />
      </header>
      <section className="windows-desktop-frame">
        {phase !== "ready" ? (
          <div className="windows-desktop-loading" role="status">
            {phase === "connecting" ? <i /> : null}
            <span>{phase === "error" ? "영상을 표시하지 못했습니다. 위쪽 … 메뉴에서 다시 연결을 눌러 주세요." : phase === "suspended" ? "앱으로 돌아오면 다시 연결합니다" : "Windows 영상 수신 대기 중"}</span>
          </div>
        ) : null}
        <div ref={container} />
        {phase === "ready" ? <MoonlightTrackpad frame={frame} onDisconnected={reconnectStream} sensitivity={sensitivity} /> : null}
        {notice ? <button className="windows-display-notice" onClick={() => setNotice("")} type="button">{notice} ×</button> : null}
      </section>
      <WindowsKeyboardDock getTarget={getKeyboardTarget} ready={phase === "ready"} />
    </main>
  );
}
