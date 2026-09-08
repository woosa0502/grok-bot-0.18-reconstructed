import { Children, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { keyPageDirection, keyPageLayout } from "../windows-key-pages";

/** Discrete DOM pages avoid a native horizontal scrolling surface next to the video. */
export function WindowsKeyPager({ children, label, className, minimum = 76 }: {
  children: ReactNode;
  label: string;
  className: string;
  minimum?: number;
}) {
  const items = Children.toArray(children);
  const [width, setWidth] = useState(0);
  const [requestedPage, setPage] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef({ id: null as number | null, x: 0, y: 0, direction: 0, moved: false });
  const suppressClick = useRef(false);
  const pendingTouchTurn = useRef(0);
  const layout = keyPageLayout(items.length, width, minimum, requestedPage);

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => { setWidth(element.clientWidth); gesture.current.id = null; pendingTouchTurn.current = 0; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const cancelHorizontalGesture = (event: TouchEvent) => {
      const state = gesture.current;
      if (state.id === null || event.touches.length !== 1) return;
      const dx = event.touches[0]!.clientX - state.x, dy = event.touches[0]!.clientY - state.y;
      // Pointer-event cancellation does not cancel the browser's native touch gesture.
      // Cancel only horizontal movement so the following tap remains a distinct gesture.
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchmove", cancelHorizontalGesture, { passive: false });
    return () => element.removeEventListener("touchmove", cancelHorizontalGesture);
  }, []);
  useEffect(() => { if (layout.page !== requestedPage) setPage(layout.page); }, [layout.page, requestedPage]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") { gesture.current.id = null; pendingTouchTurn.current = 0; } };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);

  const turn = (direction: number) => setPage(Math.max(0, Math.min(layout.pages - 1, layout.page + direction)));
  return <div
    aria-label={label}
    className={`windows-key-pager ${className}`}
    data-page={layout.page + 1}
    data-pages={layout.pages}
    ref={root}
    onClickCapture={(event) => {
      // A swipe must never activate the key under the finger after the page is replaced.
      // Touch click can also have detail=0; genuine keyboard activation has no pointerType.
      if (suppressClick.current && (event.detail !== 0 || Boolean((event.nativeEvent as PointerEvent).pointerType))) { event.preventDefault(); event.stopPropagation(); }
    }}
    onPointerDownCapture={(event) => {
      pendingTouchTurn.current = 0;
      if (!event.isPrimary) { gesture.current.id = null; suppressClick.current = true; return; }
      if (event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, direction: 0, moved: false };
    }}
    onPointerMoveCapture={(event) => {
      const state = gesture.current;
      if (state.id !== event.pointerId) return;
      const dx = event.clientX - state.x, dy = event.clientY - state.y;
      if (Math.hypot(dx, dy) > 10) { state.moved = true; suppressClick.current = true; }
      state.direction = keyPageDirection(dx, dy);
      if (state.direction) {
        event.preventDefault();
        // Keep delivery at the pager when a mouse/pen leaves the pressed key.
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      }
    }}
    onPointerUpCapture={(event) => {
      const state = gesture.current;
      if (state.id !== event.pointerId) return;
      state.id = null;
      if (state.moved) event.preventDefault();
      if (state.direction) {
        // Keep the original touch target mounted for its complete touch sequence.
        if (event.pointerType === "touch") pendingTouchTurn.current = state.direction;
        else turn(state.direction);
      }
    }}
    onTouchEndCapture={(event) => {
      const direction = pendingTouchTurn.current;
      pendingTouchTurn.current = 0;
      if (event.touches.length === 0 && direction) turn(direction);
    }}
    onTouchCancelCapture={() => { pendingTouchTurn.current = 0; }}
    onPointerCancelCapture={() => { gesture.current.id = null; pendingTouchTurn.current = 0; suppressClick.current = true; }}
    onLostPointerCapture={(event) => { if (event.target === event.currentTarget) gesture.current.id = null; }}
    role="group"
  >
    <button aria-label={`${label} 이전 페이지`} className="windows-page-button" disabled={layout.page === 0} onClick={() => turn(-1)} type="button">‹</button>
    <div className="windows-key-page" ref={grid} style={{ "--key-columns": layout.columns } as CSSProperties}>
      {items.slice(layout.start, layout.end)}
    </div>
    <button aria-label={`${label} 다음 페이지`} className="windows-page-button" disabled={layout.page === layout.pages - 1} onClick={() => turn(1)} type="button">›</button>
    <span aria-live="polite" className="windows-page-position">{layout.page + 1}/{layout.pages}</span>
  </div>;
}
