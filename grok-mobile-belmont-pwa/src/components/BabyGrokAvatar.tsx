import { useEffect, useRef } from "react";
import type { BabyGrokColor, BabyGrokShape, BabyGrokState } from "../types";

export type { BabyGrokState };

// The desktop's own character renderer, extracted verbatim from the production bundle (GrokMark). Mounting it here makes
// the mobile avatar pixel-identical to the desktop — same shapes, colours, motion and the busy "sweep" — instead of the
// hand-rolled reimplementation we had before. This mirrors how belmont-mobile-pwa hydrates its avatars from grok-engine.js.
let enginePromise: Promise<GrokEngineModule | null> | null = null;
interface GrokRoot { render(node: unknown): void; unmount?(): void }
interface GrokEngineModule {
  mountGrokMark(element: Element, props: unknown): GrokRoot;
  GrokMark: unknown;
  EngineReact: { createElement(type: unknown, props: unknown): unknown };
}
function loadEngine(): Promise<GrokEngineModule | null> {
  if (enginePromise == null) {
    // @ts-ignore - grok-engine.js is the desktop's minified engine bundle and ships no type declarations.
    enginePromise = import("../grok-engine.js").then((module) => (module.default ?? module) as GrokEngineModule).catch(() => null);
  }
  return enginePromise;
}

export function BabyGrokAvatar({
  shape,
  color,
  state = "idle",
  size = 48,
  label,
  className = "",
  paused = false,
}: {
  shape: BabyGrokShape;
  color: BabyGrokColor;
  state?: BabyGrokState;
  size?: number;
  label?: string;
  className?: string;
  paused?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<GrokRoot | null>(null);

  useEffect(() => {
    let alive = true;
    void loadEngine().then((engine) => {
      if (!alive || engine == null || hostRef.current == null) return;
      const props = { color, shape, state, sizePx: size, isFollowingPointer: false, isStatic: paused, paused, surfaceTheme: "light" };
      try {
        if (rootRef.current == null) rootRef.current = engine.mountGrokMark(hostRef.current, props);
        else rootRef.current.render(engine.EngineReact.createElement(engine.GrokMark, props));
      } catch { /* ignore */ }
    });
    return () => { alive = false; };
  }, [shape, color, state, size, paused]);

  useEffect(() => () => {
    try { rootRef.current?.unmount?.(); } catch { /* ignore */ }
    rootRef.current = null;
  }, []);

  return (
    <span
      ref={hostRef}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={`baby-grok-avatar grok-state-${state} ${className}`}
      data-state={state}
      role={label ? "img" : undefined}
      style={{ display: "inline-flex", flex: "none", width: size, height: size }}
    />
  );
}
