import assert from "node:assert/strict";
import test from "node:test";
import { stabilizeWindowsCanvas } from "../src/windows-canvas.ts";

function fixture() {
  const writes = [];
  const draws = [];
  const canvas = new EventTarget();
  let width = 1280, height = 720;
  Object.defineProperties(canvas, {
    width: { get: () => width, set: (value) => { width = value; writes.push(["width", value]); } },
    height: { get: () => height, set: (value) => { height = value; writes.push(["height", value]); } },
  });
  const context = { drawImage: (...args) => draws.push(args), isContextLost: () => false };
  const base = { implementationName: "canvas", canvas, setCanvasSize(w,h) { canvas.width=w; canvas.height=h; }, useCanvasContext: () => ({ context, error: null }), commitFrame() {} };
  const frame = { displayWidth: 1280, displayHeight: 720 };
  const pipe = { implementationName: "canvas_frame -> canvas", drawOnSubmit: true, currentFrame: frame, getBase: () => base, drawCurrentFrameIfReady() { throw Error("old draw"); } };
  assert.equal(stabilizeWindowsCanvas(pipe), true);
  return { writes, draws, canvas, context, base, frame, pipe, paint: () => pipe.drawCurrentFrameIfReady() };
}

test("duplicate display ticks do not clear, resize or redraw an unchanged decoded frame", () => {
  const f = fixture();
  for (let i = 0; i < 120; i++) f.paint();
  assert.equal(f.draws.length, 1);
  assert.deepEqual(f.writes, []);
  assert.equal(f.pipe.belmontPresentation.duplicateSkips, 119);
  assert.equal(f.pipe.belmontPresentation.failures, 0);
  assert.equal(f.pipe.drawOnSubmit, false);
});

test("new frame identities paint even with equal timestamps; dimensions change only if needed", () => {
  const f = fixture();
  f.paint();
  f.pipe.currentFrame = { ...f.frame };
  f.paint();
  assert.equal(f.draws.length, 2);
  assert.deepEqual(f.writes, []);
  f.pipe.currentFrame = { displayWidth: 640, displayHeight: 720 };
  f.paint();
  assert.deepEqual(f.writes, [["width", 640]]);
  assert.equal(f.draws.length, 3);
  assert.deepEqual(f.draws.at(-1).slice(1), [0, 0, 640, 720]);
});

test("restored context or externally resized canvas repaints a retained frame", () => {
  const f = fixture();
  f.paint();
  f.canvas.dispatchEvent(new Event("contextrestored"));
  f.paint();
  assert.equal(f.draws.length, 2);
  f.canvas.width = 100;
  f.paint();
  assert.equal(f.draws.length, 3);
  assert.equal(f.canvas.width, 1280);
});

test("repeated upstream setup at unchanged dimensions cannot erase a duplicate frame", () => {
  const f = fixture();
  f.paint();
  f.base.setCanvasSize(1280, 720);
  f.paint();
  assert.deepEqual(f.writes, []);
  assert.equal(f.draws.length, 1);
  f.base.setCanvasSize(640, 720);
  f.paint();
  assert.equal(f.draws.length, 2);
  assert.deepEqual(f.writes, [["width", 640], ["width", 1280]]);
});

test("missing or lost context does not consume the next frame; drawing errors reach watchdog", () => {
  const f = fixture();
  f.context.isContextLost = () => true;
  f.paint();
  assert.equal(f.draws.length, 0);
  f.context.isContextLost = () => false;
  f.paint();
  assert.equal(f.draws.length, 1);
  f.pipe.currentFrame = { ...f.frame };
  f.context.drawImage = () => { throw new Error("closed GPU frame"); };
  f.paint();
  assert.equal(f.pipe.errored, true);
  assert.equal(f.pipe.belmontPresentation.failures, 1);
  assert.equal(f.pipe.belmontPresentation.draws, 1);
});

test("adapter is idempotent and leaves unknown pipeline implementations alone", () => {
  const f = fixture();
  const draw = f.pipe.drawCurrentFrameIfReady;
  assert.equal(stabilizeWindowsCanvas(f.pipe), true);
  assert.equal(f.pipe.drawCurrentFrameIfReady, draw);
  const other = { ...f.pipe, belmontPresentation: undefined, implementationName: "rgba_canvas_frame -> canvas" };
  assert.equal(stabilizeWindowsCanvas(other), false);
  assert.equal(other.drawCurrentFrameIfReady, draw);
});
