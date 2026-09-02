// Low-latency screen stream for the phone: the box display (Xvfb) is captured with
// ffmpeg (x11grab → H.264, NVENC when available), sent as one access unit per
// WebSocket message, and decoded on the phone with WebCodecs. Input travels the
// other way as JSON and is injected with `xdotool -` (a long-lived stdin session).
//
// Compared with noVNC (framebuffer polling + JS decoding) this is a video path:
// hardware encode, hardware decode, a fixed frame cadence, and no per-rectangle work.

import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

const NAL_AUD = 9;
const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;

export function nalType(byte) { return byte & 0x1f; }

/** Splits an Annex-B H.264 byte stream into access units at AUD boundaries. */
export function createAnnexBSplitter() {
  let pending = Buffer.alloc(0);
  let current = [];
  let currentIsKey = false;
  let hasAud = false;
  const finish = () => {
    if (current.length === 0) return null;
    const unit = { key: currentIsKey, data: Buffer.concat(current) };
    current = [];
    currentIsKey = false;
    return unit;
  };
  return {
    push(chunk) {
      const units = [];
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
      let cursor = 0;
      let lastStart = -1;
      while (true) {
        const next = findStartCode(pending, cursor);
        if (next == null) break;
        if (lastStart >= 0) {
          const nal = pending.subarray(lastStart, next.index);
          const unit = consumeNal(nal, nalType(nal[startCodeLength(nal)]));
          if (unit) units.push(unit);
        }
        lastStart = next.index;
        cursor = next.index + next.length;
      }
      pending = lastStart >= 0 ? Buffer.from(pending.subarray(lastStart)) : pending;
      return units;
    },
  };
  function consumeNal(nal, type) {
    if (type === NAL_AUD) {
      hasAud = true;
      const done = finish();
      current.push(nal);
      return done;
    }
    if (type === NAL_IDR) currentIsKey = true;
    if (!hasAud && (type === 1 || type === NAL_IDR) && current.some((part) => [1, NAL_IDR].includes(nalType(part[startCodeLength(part)])))) {
      // No AUDs in this stream: every slice NAL starts a new picture (single-slice encodes).
      const done = finish();
      current.push(nal);
      if (type === NAL_IDR) currentIsKey = true;
      return done;
    }
    current.push(nal);
    return null;
  }
}

function startCodeLength(buffer) {
  return buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 ? 3 : 4;
}

function findStartCode(buffer, from) {
  for (let i = from; i + 2 < buffer.length; i += 1) {
    if (buffer[i] !== 0 || buffer[i + 1] !== 0) continue;
    if (buffer[i + 2] === 1) return { index: i, length: 3 };
    if (buffer[i + 2] === 0 && buffer[i + 3] === 1) return { index: i, length: 4 };
  }
  return null;
}

/** WebCodecs codec string ("avc1.PPCCLL") from the SPS NAL found in a key access unit. */
export function codecFromAccessUnit(data) {
  let cursor = 0;
  while (true) {
    const start = findStartCode(data, cursor);
    if (start == null) return null;
    const header = start.index + start.length;
    if (nalType(data[header]) === NAL_SPS && data.length >= header + 4) {
      const hex = (value) => value.toString(16).padStart(2, "0").toUpperCase();
      return `avc1.${hex(data[header + 1])}${hex(data[header + 2])}${hex(data[header + 3])}`;
    }
    cursor = header;
  }
}

export function hasParameterSets(data) {
  let cursor = 0; let sps = false; let pps = false;
  while (true) {
    const start = findStartCode(data, cursor);
    if (start == null) return sps && pps;
    const type = nalType(data[start.index + start.length]);
    if (type === NAL_SPS) sps = true;
    if (type === NAL_PPS) pps = true;
    cursor = start.index + start.length;
  }
}

const ENCODERS = {
  nvenc: (fps) => ["-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll", "-rc", "cbr", "-b:v", "8M", "-maxrate", "8M", "-bufsize", "2M", "-g", String(fps), "-bf", "0", "-profile:v", "main", "-aud", "1", "-forced-idr", "1"],
  x264: (fps) => ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline", "-b:v", "6M", "-maxrate", "6M", "-bufsize", "1M", "-x264-params", `aud=1:keyint=${fps}:min-keyint=${fps}:repeat-headers=1:sliced-threads=0:threads=4`],
};

export function ffmpegArgs({ display, width, height, fps, encoder }) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "x11grab", "-framerate", String(fps), "-video_size", `${width}x${height}`, "-draw_mouse", "1", "-i", display,
    ...ENCODERS[encoder](fps),
    "-pix_fmt", "yuv420p", "-f", "h264", "-",
  ];
}

function displayGeometry(display) {
  return new Promise((resolve) => {
    const child = spawn("xdotool", ["getdisplaygeometry"], { env: { ...process.env, DISPLAY: display } });
    let out = "";
    child.stdout.on("data", (data) => { out += String(data); });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const match = /(\d+)\s+(\d+)/u.exec(out);
      resolve(match ? { width: Number(match[1]), height: Number(match[2]) } : null);
    });
  });
}

// xdotool's stdin mode parses each line like a shell word list; keep text out of it
// and send characters as key events so quotes, spaces and Unicode all arrive intact.
export function keyCommandsForText(text) {
  const commands = [];
  for (const char of text) {
    if (char === "\n") { commands.push("key Return"); continue; }
    if (char === "\t") { commands.push("key Tab"); continue; }
    const code = char.codePointAt(0);
    if (code === 0x20) { commands.push("key space"); continue; }
    commands.push(`key U${code.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return commands;
}

const KEY_NAMES = new Map([
  ["Enter", "Return"], ["Backspace", "BackSpace"], ["Tab", "Tab"], ["Escape", "Escape"], ["Delete", "Delete"],
  ["ArrowLeft", "Left"], ["ArrowRight", "Right"], ["ArrowUp", "Up"], ["ArrowDown", "Down"], ["Home", "Home"], ["End", "End"],
  ["PageUp", "Prior"], ["PageDown", "Next"], [" ", "space"],
]);

export function createScreenStreamServer({ display = ":99", fps = 60, log = () => {}, encoderOrder = ["nvenc", "x264"] } = {}) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  const clients = new Set();

  wss.on("connection", async (ws) => {
    clients.add(ws);
    const geometry = (await displayGeometry(display)) ?? { width: 1280, height: 800 };
    let ffmpeg = null;
    let encoderIndex = 0;
    let encoderName = null;
    let framesSent = 0;
    let closed = false;
    let droppingUntilKey = false;
    const startedAt = Date.now();

    const startEncoder = () => {
      if (closed || encoderIndex >= encoderOrder.length) { ws.close(1011, "no usable encoder"); return; }
      encoderName = encoderOrder[encoderIndex];
      const splitter = createAnnexBSplitter();
      const child = spawn("ffmpeg", ffmpegArgs({ display, ...geometry, fps, encoder: encoderName }), { env: { ...process.env, DISPLAY: display }, stdio: ["ignore", "pipe", "pipe"] });
      ffmpeg = child;
      let produced = 0;
      let stderr = "";
      child.stderr.on("data", (data) => { stderr = `${stderr}${data}`.slice(-2000); });
      child.stdout.on("data", (data) => {
        for (const unit of splitter.push(data)) {
          produced += 1;
          if (ws.readyState !== ws.OPEN) return;
          // Never queue a backlog: when the phone falls behind, skip deltas until the next key frame.
          if (ws.bufferedAmount > 1_500_000) { if (!unit.key) { droppingUntilKey = true; continue; } droppingUntilKey = false; }
          else if (droppingUntilKey && !unit.key) continue;
          else droppingUntilKey = false;
          const frame = Buffer.allocUnsafe(unit.data.length + 1);
          frame[0] = unit.key ? 1 : 0;
          unit.data.copy(frame, 1);
          ws.send(frame, { binary: true });
          framesSent += 1;
          if (framesSent === 1) send({ t: "encoder", encoder: encoderName, fps });
        }
      });
      child.on("error", () => {});
      child.on("close", (code) => {
        if (closed || ffmpeg !== child) return;
        if (produced === 0) {
          log(`[screen] ${encoderName} failed (${code}): ${stderr.trim().split("\n").pop() ?? ""}`);
          encoderIndex += 1;
          startEncoder();
        } else {
          ws.close(1011, "encoder stopped");
        }
      });
    };

    const send = (payload) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); };
    send({ t: "info", width: geometry.width, height: geometry.height, fps, display });
    startEncoder();

    // Input: one xdotool per viewer, fed line by line; pointer moves are coalesced to the
    // encoder cadence so a flood of touch events never queues up behind the display.
    const xdo = spawn("xdotool", ["-"], { env: { ...process.env, DISPLAY: display }, stdio: ["pipe", "ignore", "ignore"] });
    xdo.on("error", () => {});
    let pendingMove = null;
    const write = (line) => { if (!xdo.killed && xdo.stdin.writable) xdo.stdin.write(`${line}\n`); };
    const flushMove = () => { if (pendingMove) { write(`mousemove ${pendingMove.x} ${pendingMove.y}`); pendingMove = null; } };
    const moveTimer = setInterval(flushMove, 1000 / Math.min(fps, 60));
    const clamp = (value, max) => Math.max(0, Math.min(max - 1, Math.round(Number(value) || 0)));

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const x = clamp(message.x, geometry.width);
      const y = clamp(message.y, geometry.height);
      switch (message.t) {
        case "move": pendingMove = { x, y }; break;
        case "down": pendingMove = { x, y }; flushMove(); write(`mousedown ${buttonOf(message)}`); break;
        case "up": pendingMove = { x, y }; flushMove(); write(`mouseup ${buttonOf(message)}`); break;
        case "click": pendingMove = { x, y }; flushMove(); write(`click ${buttonOf(message)}`); break;
        case "scroll": {
          pendingMove = { x, y }; flushMove();
          const steps = Math.min(10, Math.max(1, Math.round(Math.abs(Number(message.dy) || 0) / 40)));
          for (let i = 0; i < steps; i += 1) write(`click ${Number(message.dy) < 0 ? 4 : 5}`);
          break;
        }
        case "text": for (const command of keyCommandsForText(String(message.text ?? "").slice(0, 500))) write(command); break;
        case "key": {
          const name = KEY_NAMES.get(String(message.key));
          if (name) write(`key ${name}`);
          break;
        }
        case "ping": send({ t: "pong", at: message.at ?? null, frames: framesSent, uptimeMs: Date.now() - startedAt }); break;
        default: break;
      }
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(moveTimer);
      clients.delete(ws);
      try { ffmpeg?.kill("SIGKILL"); } catch {}
      try { xdo.stdin.end(); xdo.kill("SIGTERM"); } catch {}
      log(`[screen] viewer closed after ${framesSent} frames (${encoderName ?? "no encoder"})`);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  return {
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    },
    close() {
      for (const ws of clients) { try { ws.close(1001, "server closing"); } catch {} }
      wss.close();
    },
    viewerCount: () => clients.size,
  };
}

function buttonOf(message) {
  const button = Number(message.button);
  return button === 3 ? 3 : button === 2 ? 2 : 1;
}
