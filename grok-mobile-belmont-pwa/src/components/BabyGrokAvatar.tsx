import { useId, type PointerEvent } from "react";
import geometrySource from "../../public/assets/babygrok-geometry.json";
import type { BabyGrokColor, BabyGrokShape } from "../types";

interface Geometry {
  viewBox: { minX: number; minY: number; width: number; height: number };
  headCenter: number;
  shapes: Record<BabyGrokShape, { path: string; scale: number }>;
  gradients: Record<BabyGrokColor, { light: { from: string; to?: string }; dark?: { from: string; to?: string } }>;
}

const geometry = geometrySource as Geometry;

export type BabyGrokState = "idle" | "searching" | "happy" | "working" | "curious" | "excited" | "listening" | "playful" | "proud" | "laughing" | "spawning";

export function BabyGrokAvatar({
  shape,
  color,
  state = "idle",
  size = 48,
  label,
  className = "",
}: {
  shape: BabyGrokShape;
  color: BabyGrokColor;
  state?: BabyGrokState;
  size?: number;
  label?: string;
  className?: string;
}) {
  const spec = geometry.shapes[shape] ?? geometry.shapes.blob;
  const gradient = geometry.gradients[color]?.light ?? geometry.gradients.violet.light;
  const gradientId = `grok-${useId().replace(/:/gu, "")}`;
  const { minX, minY, width, height } = geometry.viewBox;
  const [bodyPath, ...eyePaths] = spec.path.split(/(?=\sM)/u);
  const transform = `translate(${geometry.headCenter} ${geometry.headCenter}) scale(${spec.scale}) translate(${-geometry.headCenter} ${-geometry.headCenter})`;

  function moveGaze(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    event.currentTarget.style.setProperty("--gaze-x", x.toFixed(3));
    event.currentTarget.style.setProperty("--gaze-y", y.toFixed(3));
  }

  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={`baby-grok-avatar grok-state-${state} ${className}`}
      data-state={state}
      height={size}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--gaze-x", "0");
        event.currentTarget.style.setProperty("--gaze-y", "0");
      }}
      onPointerMove={moveGaze}
      role={label ? "img" : undefined}
      viewBox={`${minX} ${minY} ${width} ${height}`}
      width={size}
    >
      <defs>
        <linearGradient id={gradientId} x1="100%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor={gradient.from} />
          <stop offset="100%" stopColor={gradient.to ?? gradient.from} />
        </linearGradient>
      </defs>
      <g transform={transform}>
        <g className="grok-avatar-rig">
          <path className="grok-avatar-body" d={bodyPath} fill={`url(#${gradientId})`} />
          <g className="grok-avatar-eyes">
            {eyePaths.map((path, index) => <path d={path} fill="var(--avatar-eye, var(--bg))" key={index} />)}
          </g>
        </g>
      </g>
    </svg>
  );
}
