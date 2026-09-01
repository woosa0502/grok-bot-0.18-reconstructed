/* Persona characters ported from the local Belmont desktop renderer
   (frontend/src/recovered/features/onboarding/signed-in/character.tsx).
   Same shape constructors, same deterministic id hashes, same 11-color
   gradient table — an agent shows the identical character on phone and
   desktop because both sides hash the same agent id. */

const VIEWBOX = "-15 -15 259 259";
const CENTER = 114.2705;
const TAU = Math.PI * 2;
const BLOB_PATH = "M228.541 114.228C228.541 130.133 225.184 145.994 218.738 160.534C212.674 174.217 203.904 186.669 193.065 196.988C155.933 232.34 99.497 238.596 55.5255 212.24C45.097 205.99 35.6851 198.072 27.7451 188.866C19.1926 178.953 12.3686 167.569 7.65781 155.351C2.60712 142.264 0 128.257 0 114.228C0 98.3219 3.35751 82.4611 9.80315 67.9215C15.8672 54.2382 24.6377 41.7862 35.4767 31.4668C72.6081 -3.88483 129.044 -10.1413 173.016 16.2153C183.444 22.4653 192.856 30.3829 200.796 39.5896C209.349 49.5018 216.173 60.8859 220.883 73.1037C225.934 86.1906 228.541 100.198 228.541 114.228Z";

export const PERSONA_COLORS = {
  black: { light: "#000000", dark: "#FFFFFF" },
  brown: { light: "#A27952", dark: "#855C36" },
  red: { light: "#FF3E51", dark: "#E02135" },
  orange: { light: "#FF781C", dark: "#FF6700" },
  yellow: { light: "#FFAF38", dark: "#FF9800" },
  green: { light: "#00C972", dark: "#009957" },
  cyan: { light: "#1CC3B0", dark: "#00A592" },
  blue: { light: "#2A92FE", dark: "#0E74E0" },
  violet: { light: "#A97EFE", dark: "#804EE0" },
  magenta: { light: "#FF5EB1", dark: "#E02A88" },
  gray: { light: "#959595", dark: "#777777" }
};

const SHIPPED_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"];

function shippedRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = value + 1831565813 | 0;
    let next = Math.imul(value ^ value >>> 15, 1 | value);
    next = next + Math.imul(next ^ next >>> 7, 61 | next) ^ next;
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function shippedHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function shippedColorIndex(value) {
  const seed = (shippedHash(value) ^ Math.imul(1, 2654435769)) >>> 0;
  return Math.floor(shippedRandom((seed ^ 2654435769) >>> 0)() * 10);
}

function shippedShapeHash(value) {
  let hash = shippedHash(value);
  hash = Math.imul(hash ^ hash >>> 16, 73244475);
  hash = Math.imul(hash ^ hash >>> 13, 3266489909);
  return (hash ^ hash >>> 16) >>> 0;
}

export function resolvePersonaColor(agentId, color) {
  if (color != null && PERSONA_COLORS[color] != null) return color;
  return ["brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"][shippedColorIndex(agentId)] ?? "gray";
}

export function resolvePersonaShape(agentId, shape) {
  if (shape != null && SHIPPED_SHAPES.includes(shape)) return shape;
  return SHIPPED_SHAPES[shippedShapeHash(agentId) % SHIPPED_SHAPES.length] ?? "blob";
}

const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, minimum, maximum) => value < minimum ? minimum : value > maximum ? maximum : value;

function smoothPath(points) {
  const path = [`M${round2(points[0][0])} ${round2(points[0][1])}`];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    path.push(`C${round2(current[0] + (next[0] - previous[0]) / 6)} ${round2(current[1] + (next[1] - previous[1]) / 6)} ${round2(next[0] - (afterNext[0] - current[0]) / 6)} ${round2(next[1] - (afterNext[1] - current[1]) / 6)} ${round2(next[0])} ${round2(next[1])}`);
  }
  return `${path.join("")}Z`;
}

function sampledPath(generator, count = 128) {
  const points = [];
  for (let index = 0; index < count; index += 1) points.push(generator(index / count * TAU));
  return smoothPath(points);
}

class ArtifactPath {
  d = ""; x = 0; y = 0;
  move(x, y) { this.d += `M${round2(x)} ${round2(y)}`; this.x = x; this.y = y; return this; }
  line(x, y) { this.d += `L${round2(x)} ${round2(y)}`; this.x = x; this.y = y; return this; }
  curve(x1, y1, x2, y2, x, y) { this.d += `C${round2(x1)} ${round2(y1)} ${round2(x2)} ${round2(y2)} ${round2(x)} ${round2(y)}`; this.x = x; this.y = y; return this; }
  corner(previous, current, next, radius) {
    const unit = (from, to) => {
      const x = from[0] - to[0], y = from[1] - to[1], length = Math.hypot(x, y) || 1;
      return [x / length, y / length];
    };
    const before = unit(previous, current), after = unit(next, current);
    const start = [current[0] + before[0] * radius, current[1] + before[1] * radius];
    const end = [current[0] + after[0] * radius, current[1] + after[1] * radius];
    if (this.d) this.line(start[0], start[1]); else this.move(start[0], start[1]);
    this.d += `Q${round2(current[0])} ${round2(current[1])} ${round2(end[0])} ${round2(end[1])}`;
    this.x = end[0]; this.y = end[1]; return this;
  }
  arc(cx, cy, rx, ry, start, end) {
    const segments = Math.max(1, Math.ceil(Math.abs(end - start) / (Math.PI / 2)));
    const step = (end - start) / segments;
    const control = 4 / 3 * Math.tan(step / 4);
    let angle = start;
    for (let index = 0; index < segments; index += 1) {
      const nextAngle = angle + step;
      const from = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
      const to = [cx + rx * Math.cos(nextAngle), cy + ry * Math.sin(nextAngle)];
      this.curve(from[0] - control * rx * Math.sin(angle), from[1] + control * ry * Math.cos(angle), to[0] + control * rx * Math.sin(nextAngle), to[1] - control * ry * Math.cos(nextAngle), to[0], to[1]);
      angle = nextAngle;
    }
    return this;
  }
  close() { return `${this.d}Z`; }
}

function roundedPolygon(radius, sides, cornerRadius, start = 0) {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = start + index / sides * TAU;
    return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
  });
  const path = new ArtifactPath();
  for (let index = 0; index < sides; index += 1) path.corner(points[(index - 1 + sides) % sides], points[index], points[(index + 1) % sides], cornerRadius);
  return path.close();
}

function cloudPath(circles, count = 160) {
  return sampledPath((angle) => {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let radius = 0;
    for (const [x, y, circleRadius] of circles) {
      const dx = x - CENTER, dy = y - CENTER, projection = cos * dx + sin * dy;
      const discriminant = projection * projection - (dx * dx + dy * dy) + circleRadius * circleRadius;
      if (discriminant <= 0) continue;
      radius = Math.max(radius, projection + Math.sqrt(discriminant));
    }
    return [CENTER + cos * radius, CENTER + sin * radius];
  }, count);
}

function squirclePath(width, height, exponent) {
  return sampledPath((angle) => {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [CENTER + Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent) * width, CENTER + Math.sign(sin) * Math.pow(Math.abs(sin), 2 / exponent) * height];
  });
}

function tabletPath(width, height) {
  return new ArtifactPath().move(CENTER - width + height, CENTER - height).line(CENTER + width - height, CENTER - height)
    .arc(CENTER + width - height, CENTER, height, height, -Math.PI / 2, Math.PI / 2).line(CENTER - width + height, CENTER + height)
    .arc(CENTER - width + height, CENTER, height, height, Math.PI / 2, Math.PI * 3 / 2).close();
}

function teardropPath(width, top, bottom, cornerRadius) {
  const ratio = clamp(width / (bottom - top), -1, 1), height = Math.sqrt(1 - ratio * ratio);
  const right = [CENTER + width * height, bottom - width * ratio];
  const left = [CENTER - width * height, bottom - width * ratio];
  const angle = Math.atan2(right[1] - bottom, right[0] - CENTER);
  return new ArtifactPath().corner(right, [CENTER, top], left, cornerRadius).line(left[0], left[1]).arc(CENTER, bottom, width, width, Math.PI - angle, angle).close();
}

function pathSamples(path) {
  const tokens = path.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const samples = [];
  let index = 0, command = "", startX = 0, startY = 0, x = 0, y = 0;
  const number = () => Number(tokens[index++]);
  const addLine = (toX, toY) => {
    const length = Math.hypot(toX - x, toY - y), count = Math.max(2, Math.ceil(length / 4));
    for (let step = 1; step <= count; step += 1) samples.push([x + (toX - x) * step / count, y + (toY - y) * step / count]);
    x = toX; y = toY;
  };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++].toUpperCase();
    if (command === "Z") { addLine(startX, startY); continue; }
    if (command === "M") { x = number(); y = number(); startX = x; startY = y; samples.push([x, y]); command = "L"; continue; }
    if (command === "L") { addLine(number(), number()); continue; }
    if (command === "Q") {
      const x1 = number(), y1 = number(), endX = number(), endY = number(), fromX = x, fromY = y;
      const count = Math.max(2, Math.ceil((Math.hypot(x1 - x, y1 - y) + Math.hypot(endX - x1, endY - y1)) / 4));
      for (let step = 1; step <= count; step += 1) { const t = step / count, inverse = 1 - t; samples.push([inverse * inverse * fromX + 2 * inverse * t * x1 + t * t * endX, inverse * inverse * fromY + 2 * inverse * t * y1 + t * t * endY]); }
      x = endX; y = endY; continue;
    }
    if (command === "C") {
      const x1 = number(), y1 = number(), x2 = number(), y2 = number(), endX = number(), endY = number(), fromX = x, fromY = y;
      const count = Math.max(2, Math.ceil((Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(endX - x2, endY - y2)) / 4));
      for (let step = 1; step <= count; step += 1) { const t = step / count, inverse = 1 - t; samples.push([inverse ** 3 * fromX + 3 * inverse ** 2 * t * x1 + 3 * inverse * t ** 2 * x2 + t ** 3 * endX, inverse ** 3 * fromY + 3 * inverse ** 2 * t * y1 + 3 * inverse * t ** 2 * y2 + t ** 3 * endY]); }
      x = endX; y = endY; continue;
    }
    index += 1;
  }
  return samples;
}

function normalizeArtifactPath(path) {
  const samples = pathSamples(path);
  const xs = samples.map(([x]) => x), ys = samples.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const offsetX = CENTER - (minX + maxX) / 2, offsetY = CENTER - (minY + maxY) / 2;
  const scale = clamp(228.44 / Math.max(maxX - minX, maxY - minY), .9, 1.35);
  if (Math.abs(scale - 1) < .005 && Math.abs(offsetX) < .5 && Math.abs(offsetY) < .5) return path;
  let numberIndex = 0;
  return path.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (value) => {
    const coordinate = Number(value) + (numberIndex++ % 2 === 0 ? offsetX : offsetY);
    return String(round2(CENTER + (coordinate - CENTER) * scale));
  });
}

export const PERSONA_SHAPE_PATHS = {
  blob: normalizeArtifactPath(BLOB_PATH),
  pebble: normalizeArtifactPath(sampledPath((angle) => { const radius = 108 * (1 + .075 * (Math.sin(angle * 2 + 1.1) * .6 + Math.sin(angle * 3 - 1.1) * .4)); return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius * .98]; })),
  squircle: normalizeArtifactPath(squirclePath(107, 107, 4.2)),
  tablet: normalizeArtifactPath(tabletPath(114, 74)),
  wedge: normalizeArtifactPath(roundedPolygon(130, 3, 60, -Math.PI / 2)),
  hex: normalizeArtifactPath(roundedPolygon(114, 6, 20, Math.PI / 6)),
  cloud: normalizeArtifactPath(cloudPath([[CENTER - 62, CENTER + 26, 56], [CENTER + 62, CENTER + 26, 54], [CENTER, CENTER + 34, 62], [CENTER - 24, CENTER - 30, 62], [CENTER + 38, CENTER - 26, 54]])),
  teardrop: normalizeArtifactPath(teardropPath(88, CENTER - 114, CENTER + 26, 18))
};

const STATE_FACE = {
  idle: { eye: 1, tilt: 0, smile: false, wobble: false },
  busy: { eye: 1, tilt: -3, smile: false, wobble: true },
  waiting: { eye: 1, tilt: -2, smile: false, wobble: false },
  done: { eye: 1.08, tilt: 0, smile: true, wobble: false }
};

/* The desktop renderer's motion table (character.tsx MOTION), verbatim shape:
   sine bob + tilt + eye scale per state, plus pointer-following gaze. Desktop
   applies the bob in 259-unit viewBox coordinates; here it lands on the svg
   root in CSS pixels so a 30px roster avatar moves as legibly as the big
   desktop character. */
export const PERSONA_MOTION = {
  idle: { amplitude: 1.5, period: 9000, tilt: 0, eye: 1 },
  listening: { amplitude: 1.8, period: 2800, tilt: -2, eye: 1 },
  thinking: { amplitude: 1, period: 2000, tilt: 3, eye: .75 },
  searching: { amplitude: 2, period: 1000, tilt: -4, eye: .9 },
  working: { amplitude: 2, period: 1800, tilt: -3, eye: 1 },
  loading: { amplitude: 2, period: 6000, tilt: 3, eye: .9 },
  orbit: { amplitude: 2, period: 4000, tilt: 12, eye: 1 },
  sending: { amplitude: 2, period: 4000, tilt: 0, eye: 1 },
  happy: { amplitude: 3, period: 2500, tilt: 0, eye: 1.08 }
};

const MOTION_BY_STATUS = {
  idle: PERSONA_MOTION.idle,
  waiting: PERSONA_MOTION.listening,
  busy: PERSONA_MOTION.working,
  composing: PERSONA_MOTION.working,
  done: PERSONA_MOTION.happy
};

/** One shared rAF loop drives every persona on the page, exactly like the
    desktop tick: face bob+tilt, eyes gaze+scale. Idle characters barely
    breathe; working ones visibly rock. */
export function startPersonaMotion() {
  if (typeof window === "undefined") return () => {};
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  const gaze = { x: 0, y: 0 };
  window.addEventListener("pointermove", (event) => {
    gaze.x = Math.max(-1, Math.min(1, event.clientX / window.innerWidth * 2 - 1));
    gaze.y = Math.max(-1, Math.min(1, event.clientY / window.innerHeight * 2 - 1));
  }, { passive: true });
  let frame = 0;
  const tick = (time) => {
    for (const wrapper of document.querySelectorAll(".maus-avatar")) {
      const svg = wrapper.firstElementChild;
      if (!svg || !svg.classList.contains("persona")) continue;
      // Exact desktop instances are driven by the live mirror; leave them be.
      if (svg.classList.contains("persona--exact")) continue;
      const motion = PERSONA_MOTION[wrapper.dataset.motion]
        ?? MOTION_BY_STATUS[wrapper.dataset.status]
        ?? PERSONA_MOTION.idle;
      const seed = Number(svg.dataset.seed) || 0;
      const phase = time / motion.period * Math.PI * 2 + seed;
      const bob = Math.sin(phase) * motion.amplitude * 2;
      svg.style.translate = `0 ${(-bob).toFixed(2)}px`;
      svg.style.rotate = svg.classList.contains("persona--dots") ? "0deg" : `${motion.tilt}deg`;
      const eyes = svg.querySelector(".persona-eyes");
      if (eyes) eyes.setAttribute("transform", `translate(${(gaze.x * 4).toFixed(2)} ${(gaze.y * 3).toFixed(2)}) scale(1 ${motion.eye})`);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/* Jelly morph: resample the outline to a fixed 48 points, push each point
   radially with a travelling wave, and let SMIL interpolate between the
   variants. All variants share one command structure, so the browser can
   morph the actual shape — the 꿀렁꿀렁 effect. */
const WOBBLE_POINTS = 48;
const WOBBLE_AMOUNT = 0.055;
const wobbleCache = new Map();

function resampledOutline(path) {
  const samples = pathSamples(path);
  const points = [];
  for (let index = 0; index < WOBBLE_POINTS; index += 1) {
    points.push(samples[Math.floor(index * samples.length / WOBBLE_POINTS)]);
  }
  return points;
}

function wobbleVariant(points, phase) {
  return smoothPath(points.map(([x, y]) => {
    const angle = Math.atan2(y - CENTER, x - CENTER);
    const factor = 1 + WOBBLE_AMOUNT * Math.sin(angle * 3 + phase);
    return [CENTER + (x - CENTER) * factor, CENTER + (y - CENTER) * factor];
  }));
}

function wobbleFrames(shape) {
  const cached = wobbleCache.get(shape);
  if (cached) return cached;
  const points = resampledOutline(PERSONA_SHAPE_PATHS[shape]);
  const frames = [
    smoothPath(points),
    wobbleVariant(points, 0),
    wobbleVariant(points, Math.PI * 2 / 3),
    wobbleVariant(points, Math.PI * 4 / 3)
  ];
  wobbleCache.set(shape, frames);
  return frames;
}

let personaSequence = 0;

/** Desktop-identical character as an SVG string. `status` is the PWA's
    idle/busy/waiting/done vocabulary. */
export function personaSvg({ id, shape = null, color = null, status = "idle" }) {
  const agentId = String(id || "persona");
  const resolvedShape = resolvePersonaShape(agentId, shape || null);
  const resolvedColor = PERSONA_COLORS[resolvePersonaColor(agentId, color || null)] ?? PERSONA_COLORS.black;
  const face = STATE_FACE[status] ?? STATE_FACE.idle;
  const gradientId = `persona-ink-${++personaSequence}`;
  // Desktop behavior: while the bot is writing its reply, the character itself
  // turns into three bot-colored dots (seen in the transcript pending slot and
  // the sidebar avatar alike).
  if (status === "composing") {
    return `<svg class="persona persona--dots" data-seed="${(personaSequence % 12) * 0.52}" viewBox="${VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="${resolvedColor.light}">
        <circle class="pdot" cx="${CENTER - 64}" cy="${CENTER}" r="21" />
        <circle class="pdot" cx="${CENTER}" cy="${CENTER}" r="21" />
        <circle class="pdot" cx="${CENTER + 64}" cy="${CENTER}" r="21" />
      </g>
    </svg>`;
  }
  const eyeRy = 7;
  const smile = face.smile
    ? `<path d="M${CENTER - 20} ${CENTER + 24} Q${CENTER} ${CENTER + 38} ${CENTER + 20} ${CENTER + 24}" fill="none" stroke="var(--surface, #fff)" stroke-linecap="round" stroke-width="5" />`
    : "";
  let body;
  if (face.wobble) {
    const [base, ...variants] = wobbleFrames(resolvedShape);
    body = `<path d="${base}" fill="url(#${gradientId})"><animate attributeName="d" dur="1.3s" repeatCount="indefinite" values="${base};${variants[0]};${variants[1]};${variants[2]};${base}" /></path>`;
  } else {
    body = `<path d="${PERSONA_SHAPE_PATHS[resolvedShape]}" fill="url(#${gradientId})" />`;
  }
  return `<svg class="persona" data-seed="${(personaSequence % 12) * 0.52}" viewBox="${VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="${gradientId}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${resolvedColor.light}" /><stop offset="1" stop-color="${resolvedColor.dark}" /></linearGradient></defs>
    <g class="persona-face">
      ${body}
      <g class="persona-eyes" fill="var(--surface, #fff)" transform="translate(0 0) scale(1 ${face.eye})">
        <ellipse cx="${CENTER - 29}" cy="${CENTER - 8}" rx="10" ry="${eyeRy}" />
        <ellipse cx="${CENTER + 29}" cy="${CENTER - 8}" rx="10" ry="${eyeRy}" />
      </g>
      ${smile}
    </g>
  </svg>`;
}
