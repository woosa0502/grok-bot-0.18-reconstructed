import { useEffect as useBrowserEffect, useState as useBrowserState } from 'react';
import { BrowserBotScreen } from '../components/BrowserBotChat';
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { api } from "../api";
import { BabyGrokAvatar } from "../components/BabyGrokAvatar";
import { Icon } from "../components/Icon";
import type { AppRoute, SurfaceId } from "../navigation";
import type { Bot, ComputerState } from "../types";

type FitMode = "scale" | "actual";
type PointerMode = "direct" | "trackpad";
type LinkState = "loading" | "connecting" | "connected" | "disconnected";
const FIT_KEY = "linear-computer-fit";
const POINTER_KEY = "linear-computer-pointer";
const TRACKPAD_HINT = "트랙패드: 손가락을 밀면 포인터 이동 · 탭 = 클릭 · 두 번 탭하고 끌기 = 드래그 · 두 손가락 = 스크롤 · 길게 누르기 = 오른쪽 클릭";

/**
 * noVNC reads its options from the query string: `resize=scale` shrinks the whole desktop to the phone width
 * (a 1280×800 desktop lands in a 384×240 strip on a portrait phone), while `resize=off` keeps desktop pixels 1:1
 * and `view_clip=1` lets the viewer pan the visible part with its drag mode instead of scrolling the page.
 */
/** The window index carried in a route's `value` (from the 화면 전환 sheet), if any. */
export function routeWindowIndex(value: string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function viewerSource(viewerUrl: string, fit: FitMode): string {
  const url = new URL(viewerUrl, window.location.origin);
  url.searchParams.set("resize", fit === "scale" ? "scale" : "off");
  // If the desktop's VNC server restarts, come back on our own instead of showing a dead frame.
  url.searchParams.set("reconnect", "1");
  url.searchParams.set("reconnect_delay", "1500");
  if (fit === "actual") url.searchParams.set("view_clip", "1");
  else url.searchParams.delete("view_clip");
  return `${url.pathname}${url.search}`;
}

function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(() => window.matchMedia("(orientation: portrait)").matches);
  useEffect(() => {
    const media = window.matchMedia("(orientation: portrait)");
    const sync = () => setPortrait(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return portrait;
}

/** The viewer is proxied from the app's own origin, so its hidden noVNC controls can be driven from here. */
function viewerDocument(frame: HTMLIFrameElement | null): Document | null {
  try { return frame?.contentDocument ?? null; } catch { return null; }
}

/**
 * Laptop-style pointer for the phone: noVNC's own touch handling moves the pointer to wherever the finger
 * lands (touchscreen style), which the recovered app called "direct". This layer sits over the viewer,
 * turns finger travel into relative pointer motion and taps into clicks, and feeds noVNC the same
 * mouse events a desktop browser would (the viewer is same-origin, so its canvas is reachable).
 */
function TrackpadLayer({ frame, sensitivity = 1.4 }: { frame: React.RefObject<HTMLIFrameElement | null>; sensitivity?: number }) {
  const st = useRef({ pointer: null as { x: number; y: number } | null, start: { x: 0, y: 0, at: 0 }, last: { x: 0, y: 0 }, moved: false, holding: false, rightClicked: false, lastTapAt: 0, twoY: null as number | null, longTimer: 0 });
  function canvas(): HTMLCanvasElement | null {
    // The canvas lives in the viewer frame's realm, so `instanceof HTMLCanvasElement` from here is always false.
    const node = viewerDocument(frame.current)?.querySelector("canvas") as HTMLCanvasElement | null | undefined;
    return node != null && node.tagName === "CANVAS" && node.width > 0 ? node : null;
  }
  function place(): { canvas: HTMLCanvasElement; rect: DOMRect } | null {
    const node = canvas();
    if (node == null) return null;
    const rect = node.getBoundingClientRect();
    const s = st.current;
    if (s.pointer == null) s.pointer = { x: rect.width / 2, y: rect.height / 2 };
    s.pointer.x = Math.max(0, Math.min(rect.width - 1, s.pointer.x));
    s.pointer.y = Math.max(0, Math.min(rect.height - 1, s.pointer.y));
    return { canvas: node, rect };
  }
  function mouse(type: "mousedown" | "mouseup" | "mousemove", button: number, buttons: number) {
    const target = place();
    if (target == null) return;
    const view = target.canvas.ownerDocument.defaultView;
    if (view == null) return;
    const p = st.current.pointer!;
    target.canvas.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, clientX: target.rect.left + p.x, clientY: target.rect.top + p.y, button, buttons }));
  }
  function wheel(deltaY: number) {
    const target = place();
    if (target == null) return;
    const view = target.canvas.ownerDocument.defaultView;
    if (view == null) return;
    const p = st.current.pointer!;
    target.canvas.dispatchEvent(new view.WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: target.rect.left + p.x, clientY: target.rect.top + p.y, deltaY, deltaMode: 0 }));
  }
  function clearLong() { if (st.current.longTimer) { window.clearTimeout(st.current.longTimer); st.current.longTimer = 0; } }
  function onStart(event: React.TouchEvent<HTMLDivElement>) {
    const s = st.current; const touches = event.touches; const now = Date.now();
    if (touches.length === 1) {
      const t = touches[0]!; s.start = { x: t.clientX, y: t.clientY, at: now }; s.last = { x: t.clientX, y: t.clientY }; s.moved = false; s.rightClicked = false; s.twoY = null;
      if (now - s.lastTapAt < 320 && !s.holding) { s.holding = true; mouse("mousedown", 0, 1); } // double-tap-and-hold starts a drag
      clearLong();
      s.longTimer = window.setTimeout(() => { if (!s.moved && !s.holding) { mouse("mousedown", 2, 2); mouse("mouseup", 2, 0); s.rightClicked = true; } }, 600);
    } else if (touches.length === 2) {
      clearLong(); s.twoY = (touches[0]!.clientY + touches[1]!.clientY) / 2; s.moved = true;
    }
  }
  function onMove(event: React.TouchEvent<HTMLDivElement>) {
    const s = st.current; const touches = event.touches;
    if (touches.length === 1 && s.twoY == null) {
      const t = touches[0]!; const dx = t.clientX - s.last.x; const dy = t.clientY - s.last.y; s.last = { x: t.clientX, y: t.clientY };
      if (Math.hypot(t.clientX - s.start.x, t.clientY - s.start.y) > 6) { s.moved = true; clearLong(); }
      if (place() == null) return;
      s.pointer!.x += dx * sensitivity; s.pointer!.y += dy * sensitivity;
      mouse("mousemove", 0, s.holding ? 1 : 0);
    } else if (touches.length === 2) {
      const mid = (touches[0]!.clientY + touches[1]!.clientY) / 2;
      if (s.twoY != null) wheel((s.twoY - mid) * 2.2);
      s.twoY = mid;
    }
  }
  function onEnd(event: React.TouchEvent<HTMLDivElement>) {
    const s = st.current; clearLong();
    if (event.touches.length > 0) return;
    const now = Date.now();
    if (s.holding) { mouse("mouseup", 0, 0); s.holding = false; }
    else if (!s.moved && !s.rightClicked && s.twoY == null && now - s.start.at < 350) { mouse("mousedown", 0, 1); mouse("mouseup", 0, 0); s.lastTapAt = now; }
    s.rightClicked = false; s.twoY = null;
  }
  return <div aria-label="트랙패드 영역" className="trackpad-layer" onTouchCancel={onEnd} onTouchEnd={onEnd} onTouchMove={onMove} onTouchStart={onStart} role="application" />;
}

const LINK_LABEL: Record<LinkState, string> = { loading: "불러오는 중", connecting: "연결 중", connected: "연결됨", disconnected: "연결 끊김" };

function OriginalComputerScreen({ bot, onBack, onOpen, windowIndex }: { bot: Bot; onBack: () => void; onOpen: (name: SurfaceId, route?: Omit<AppRoute, "name">) => void; /** Desktop window picked in the 화면 전환 sheet; the default is the bot's main window. */ windowIndex?: number }) {
  const [computer, setComputer] = useState<ComputerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fit, setFit] = useState<FitMode>(() => { try { return localStorage.getItem(FIT_KEY) === "actual" ? "actual" : "scale"; } catch { return "scale"; } });
  // Trackpad is the default (the user's choice): a stored "direct" is the only way to get touchscreen-style pointing.
  const [pointerMode, setPointerMode] = useState<PointerMode>(() => { try { return localStorage.getItem(POINTER_KEY) === "direct" ? "direct" : "trackpad"; } catch { return "trackpad"; } });
  const [link, setLink] = useState<LinkState>("loading");
  const [dragging, setDragging] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const portrait = usePortrait();
  const source = useMemo(() => computer?.ready && computer.viewerUrl ? viewerSource(computer.viewerUrl, fit) : null, [computer?.ready, computer?.viewerUrl, fit]);

  async function load() {
    setLoading(true);
    setError("");
    try { setComputer(await (windowIndex == null ? api.computer(bot.id) : api.computerWindow(bot.id, windowIndex))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "컴퓨터 상태를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    try { setComputer(await api.ensureComputer(bot.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "컴퓨터를 시작하지 못했습니다."); }
    finally { setStarting(false); }
  }

  useEffect(() => { void load(); }, [bot.id, windowIndex]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [menuOpen]);

  // Mirror the viewer's connection state (noVNC flags it on its <html> element) and its pan-mode toggle.
  useEffect(() => {
    if (!source) return;
    setLink("loading");
    const timer = window.setInterval(() => {
      const doc = viewerDocument(frame.current);
      if (doc == null || doc.readyState !== "complete" || doc.getElementById("noVNC_container") == null) return;
      const flags = doc.documentElement.className;
      setLink(flags.includes("noVNC_connected") ? "connected" : /noVNC_(connecting|reconnecting)/.test(flags) ? "connecting" : "disconnected");
      setDragging(doc.getElementById("noVNC_view_drag_button")?.classList.contains("noVNC_selected") === true);
    }, 700);
    return () => window.clearInterval(timer);
  }, [source, reloadKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function pressViewer(id: string): boolean {
    const target = viewerDocument(frame.current)?.getElementById(id);
    if (target == null) { setNotice("뷰어가 아직 준비되지 않았습니다"); return false; }
    target.click();
    return true;
  }
  function toggleFit() {
    setFit((current) => {
      const next: FitMode = current === "scale" ? "actual" : "scale";
      try { localStorage.setItem(FIT_KEY, next); } catch {}
      return next;
    });
  }
  async function pasteToComputer() {
    const doc = viewerDocument(frame.current);
    const box = doc?.getElementById("noVNC_clipboard_text") as HTMLTextAreaElement | null;
    if (box == null) { setNotice("뷰어가 아직 준비되지 않았습니다"); return; }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { setNotice("휴대폰 클립보드가 비어 있습니다"); return; }
      box.value = text;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      setNotice("컴퓨터 클립보드에 넣었습니다. 붙여넣기(Ctrl+V)로 사용하세요");
    } catch { setNotice("클립보드 읽기 권한이 없습니다"); }
  }
  async function copyFromComputer() {
    const box = viewerDocument(frame.current)?.getElementById("noVNC_clipboard_text") as HTMLTextAreaElement | null;
    const text = box?.value ?? "";
    if (!text) { setNotice("컴퓨터에서 복사한 내용이 아직 없습니다"); return; }
    try { await navigator.clipboard.writeText(text); setNotice("휴대폰 클립보드로 복사했습니다"); }
    catch { setNotice("휴대폰 클립보드에 쓰지 못했습니다"); }
  }
  function togglePointerMode() {
    setPointerMode((current) => {
      const next: PointerMode = current === "direct" ? "trackpad" : "direct";
      try { localStorage.setItem(POINTER_KEY, next); } catch {}
      setNotice(next === "trackpad" ? TRACKPAD_HINT : "직접 터치: 손가락이 닿은 곳으로 포인터가 갑니다");
      return next;
    });
  }
  function toggleFullscreen() {
    const node = canvas.current;
    if (node == null) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void node.requestFullscreen?.().catch(() => setNotice("이 브라우저는 전체 화면을 지원하지 않습니다"));
  }

  const statusHint = link === "connected"
    ? `${portrait ? "가로로 돌리면 크게 보입니다. " : ""}검은 화면이면 Bot이 아직 창을 열지 않은 것입니다.`
    : link === "disconnected" ? "우측 상단 … 메뉴에서 다시 연결을 누르세요." : "";

  return (
    <main className="computer-screen">
      <header className="computer-toolbar">
        <button aria-label="대화로" className="dark-circle" onClick={onBack} type="button"><Icon name="back" size={22} /></button>
        <div className="computer-identity"><BabyGrokAvatar color={bot.avatar.color} shape={bot.avatar.shape} size={34} state={loading || starting ? "working" : "idle"} /><span><strong>{bot.name}</strong><small>컴퓨터</small></span></div>
        <div className="computer-menu-wrap" ref={menu}>
          <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label="컴퓨터 설정 메뉴" className="dark-circle" onClick={() => setMenuOpen((value) => !value)} type="button"><Icon name="more" size={19} /></button>
          {menuOpen ? <div aria-label="컴퓨터 설정" className="computer-menu" role="menu">
            <button disabled={!source} onClick={togglePointerMode} role="menuitem" type="button"><Icon name="settings" size={17} /><span><strong>조작 방식</strong><small>{pointerMode === "trackpad" ? "트랙패드" : "직접 터치"}</small></span></button>
            <button disabled={!source} onClick={toggleFit} role="menuitem" type="button"><Icon name="display" size={17} /><span><strong>화면 크기</strong><small>{fit === "scale" ? "맞춤" : "원본 크기"}</small></span></button>
            <button disabled={!source} onClick={() => { setMenuOpen(false); setLink("loading"); setReloadKey((value) => value + 1); }} role="menuitem" type="button"><Icon name="refresh" size={17} /><span><strong>다시 연결</strong><small>컴퓨터 화면 새로고침</small></span></button>
            <button onClick={() => { setMenuOpen(false); onOpen("ComputerHelpSheet", { botId: bot.id }); }} role="menuitem" type="button"><Icon name="help" size={17} /><span><strong>도움말</strong><small>터치와 키보드 사용법</small></span></button>
            <button onClick={() => { setMenuOpen(false); onOpen("BoxScreen", { botId: bot.id }); }} role="menuitem" type="button"><Icon name="tools" size={17} /><span><strong>컴퓨터 정보</strong><small>도구와 실행 환경</small></span></button>
          </div> : null}
        </div>
      </header>
      <section className="computer-canvas" ref={canvas}>
        {source ? <iframe allow="clipboard-read; clipboard-write; fullscreen" key={`${source}#${reloadKey}`} ref={frame} src={source} title={`${bot.name} 컴퓨터`} /> : (
          <div className="computer-state">
            <Icon name="display" size={34} />
            <strong>{loading ? "컴퓨터 확인 중" : "컴퓨터가 꺼져 있습니다"}</strong>
            <p>{error || "Bot의 화면을 휴대폰에서 직접 확인하고 조작할 수 있습니다."}</p>
            {!loading ? <button disabled={starting} onClick={() => void start()} type="button">{starting ? "시작하는 중" : "컴퓨터 시작"}</button> : <span className="computer-loader" />}
          </div>
        )}
        {source && pointerMode === "trackpad" && link === "connected" ? <TrackpadLayer frame={frame} /> : null}
        {notice ? <div className="computer-notice" role="status">{notice}</div> : null}
      </section>
      <footer className="computer-dock">
        {source ? (
          <p className="computer-status"><i className={`link-dot ${link}`} />{LINK_LABEL[link]}{statusHint ? ` · ${statusHint}` : ""}</p>
        ) : <p className="computer-status">두 손가락으로 확대하고 한 손가락으로 조작하세요.</p>}
        <div aria-label="컴퓨터 도구" className="computer-tools">
          {(computer?.windows?.length ?? 0) > 1 ? <button onClick={() => onOpen("ComputerSwitcherSheet", { botId: bot.id })} type="button"><Icon name="display" size={15} />화면</button> : null}
          {source ? (
            <>
              <button disabled={link !== "connected"} onClick={() => pressViewer("noVNC_keyboard_button")} type="button"><Icon name="keyboard" size={15} />키보드</button>
              <button disabled={link !== "connected"} onClick={() => pressViewer("noVNC_send_esc_button")} type="button">Esc</button>
              <button disabled={link !== "connected"} onClick={() => pressViewer("noVNC_send_tab_button")} type="button">Tab</button>
              <button disabled={link !== "connected"} onClick={() => void pasteToComputer()} type="button"><Icon name="paperclip" size={15} />붙여넣기</button>
              <button disabled={link !== "connected"} onClick={() => void copyFromComputer()} type="button"><Icon name="copy" size={15} />복사</button>
              {fit === "actual" ? <button aria-pressed={dragging} disabled={link !== "connected"} onClick={() => pressViewer("noVNC_view_drag_button")} type="button">이동</button> : null}
              <button onClick={toggleFullscreen} type="button">전체 화면</button>
            </>
          ) : null}
        </div>
      </footer>
    </main>
  );
}

export function ComputerScreen(props: Parameters<typeof OriginalComputerScreen>[0]) {
  const nav = props as unknown as { bot?: { id: string }; onBack?: () => void; onComputer?: () => void };
  const [enabled,setEnabled] = useBrowserState<boolean | null>(null);
  useBrowserEffect(() => { let alive=true; if (!nav.bot?.id) { setEnabled(false); return; } setEnabled(null); fetch('/api/bots/' + encodeURIComponent(nav.bot.id) + '/browser/runtime', {credentials:'same-origin'}).then(r=>r.ok?r.json():{enabled:false}).then(v=>{if(alive)setEnabled(v.enabled===true);}).catch(()=>{if(alive)setEnabled(false);}); return()=>{alive=false;}; }, [nav.bot?.id]);
  if (enabled === null && nav.bot?.id) return <p role="status">브라우저 종류 확인 중…</p>;
  if (enabled && nav.bot?.id) return <BrowserBotScreen botId={nav.bot.id} onBack={nav.onBack} />;
  return <OriginalComputerScreen {...props} />;
}
