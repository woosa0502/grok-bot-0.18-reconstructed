import assert from "node:assert/strict";
import test from "node:test";
import { createWindowsViewer } from "../src/windows-viewer.ts";

function fixture(t, initialVisibility = "visible") {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const win = new EventTarget();
  const timers = new Map();
  let sequence = 0;
  win.setInterval = (fn) => { const id = ++sequence; timers.set(id, fn); return id; };
  win.clearInterval = (id) => timers.delete(id);
  const doc = new EventTarget();
  doc.visibilityState = initialVisibility;
  doc.defaultView = win;
  const created = [];
  const attached = new Set();
  const phases = [];
  const releases = [];
  doc.createElement = () => {
    const id = created.length;
    const pipe = {
      currentFrame: { timestamp: 1, displayWidth: 1280, displayHeight: 720, close() { releases.push([id, "frame"]); } },
      context: {},
      cleanup() { releases.push([id, "cleanup"]); },
      decoder: { state: "configured", close() { this.state = "closed"; releases.push([id, "decoder"]); } },
    };
    const stream = {
      ws: { readyState: 1, close() { this.readyState = 3; releases.push([id, "socket"]); } },
      getVideoRenderer: () => pipe,
    };
    const frame = {
      addEventListener() {},
      contentWindow: { app: { getStream: () => stream } },
      contentDocument: { querySelector: () => null, querySelectorAll: () => [] },
      remove() { attached.delete(frame); releases.push([id, "detach"]); },
      stream,
      pipe,
      ready() {
        this.contentDocument.querySelector = (selector) => selector === "video"
          ? { readyState: 2, videoWidth: 1280, videoHeight: 720, currentTime: now / 1000 }
          : null;
      },
    };
    created.push(frame);
    return frame;
  };
  const container = { ownerDocument: doc, appendChild: (frame) => attached.add(frame) };
  const controller = createWindowsViewer(container, () => {}, (phase) => phases.push(phase));
  t.after(() => controller.dispose());
  return {
    doc, win, created, attached, phases, releases, controller, timers,
    tick(ms = 1000) { now += ms; for (const fn of timers.values()) fn(); },
    visibility(state) { doc.visibilityState = state; doc.dispatchEvent(new Event("visibilitychange")); },
  };
}

test("hidden synchronously disposes media and removes the browsing context; event burst creates only one replacement", (t) => {
  const f = fixture(t);
  f.visibility("hidden");
  assert.equal(f.attached.size, 0);
  assert.deepEqual(f.releases.map((item) => item[1]), ["socket", "cleanup", "frame", "decoder", "detach"]);
  f.doc.dispatchEvent(new Event("freeze"));
  f.win.dispatchEvent(new Event("pagehide"));
  f.tick(60_000);
  assert.equal(f.created.length, 1);
  f.doc.dispatchEvent(new Event("resume"));
  f.visibility("visible");
  assert.equal(f.created.length, 1, "pagehide still blocks startup");
  f.win.dispatchEvent(new Event("pageshow"));
  f.win.dispatchEvent(new Event("online"));
  f.visibility("visible");
  assert.equal(f.created.length, 2);
  assert.equal(f.attached.size, 1);
});

test("document load and an open socket without decoded pixels are not ready", (t) => {
  const f = fixture(t);
  f.tick();
  assert.equal(f.phases.at(-1), "connecting");
  f.created[0].ready();
  f.tick();
  assert.equal(f.phases.at(-1), "ready");
});

test("canvas size alone is not ready; a decoded frame is required", (t) => {
  const f = fixture(t);
  f.created[0].contentDocument.querySelector = (selector) => selector === "canvas.video-stream" ? { width: 300, height: 150 } : null;
  f.created[0].pipe.currentFrame = null;
  f.tick();
  assert.equal(f.phases.at(-1), "connecting");
  f.created[0].pipe.currentFrame = { timestamp: 42, displayWidth: 300, displayHeight: 150 };
  f.tick();
  assert.equal(f.phases.at(-1), "ready");
});

test("stale decoded frame with an open socket cannot stay ready forever", (t) => {
  const f = fixture(t);
  f.created[0].contentDocument.querySelector = (selector) => selector === "canvas.video-stream" ? { width: 1280, height: 720 } : null;
  f.tick();
  assert.equal(f.phases.at(-1), "ready");
  for (let i = 0; i < 8; i++) f.tick();
  assert.equal(f.created.length, 2);
});

test("new decoded frames with identical upstream timestamps count as progress", (t) => {
  const f = fixture(t);
  f.created[0].contentDocument.querySelector = (selector) => selector === "canvas.video-stream" ? { width: 1280, height: 720 } : null;
  for (let i = 0; i < 40; i++) {
    f.created[0].pipe.currentFrame = { timestamp: 0, displayWidth: 1280, displayHeight: 720 };
    f.tick();
  }
  assert.equal(f.phases.at(-1), "ready");
  assert.equal(f.created.length, 1);
});

test("a lost canvas context is not decoded-and-displayable readiness", (t) => {
  const f = fixture(t);
  f.created[0].contentDocument.querySelector = (selector) => selector === "canvas.video-stream" ? { width: 1280, height: 720 } : null;
  f.created[0].pipe.context = { isContextLost: () => true };
  f.tick();
  assert.equal(f.phases.at(-1), "connecting");
});

test("missing app times out after bounded attempts and manual refresh is still possible", (t) => {
  const f = fixture(t);
  for (let index = 0; index < 3; index++) {
    delete f.created[index].contentWindow.app;
    f.tick(20_000);
  }
  assert.equal(f.created.length, 3);
  assert.equal(f.attached.size, 0);
  assert.equal(f.phases.at(-1), "error");
  f.tick(20_000);
  assert.equal(f.created.length, 3);
  f.controller.reconnect();
  assert.equal(f.created.length, 4);
});

test("a dead inaccessible iframe is detached even if reading its window throws", (t) => {
  const f = fixture(t);
  Object.defineProperty(f.created[0], "contentWindow", { get() { throw new Error("dead frame"); } });
  f.visibility("hidden");
  assert.equal(f.attached.size, 0);
  f.visibility("visible");
  assert.equal(f.created.length, 2);
});

test("freeze without visibilitychange releases viewer and thaw remounts once", (t) => {
  const f = fixture(t);
  f.doc.dispatchEvent(new Event("freeze"));
  assert.equal(f.attached.size, 0);
  f.tick(60_000);
  f.doc.dispatchEvent(new Event("resume"));
  f.win.dispatchEvent(new Event("pageshow"));
  assert.equal(f.created.length, 2);
});

test("closed control socket and decoder errors are failures, not successful video", (t) => {
  const f = fixture(t);
  f.created[0].ready();
  f.created[0].stream.ws.readyState = 3;
  f.tick();
  assert.equal(f.created.length, 2);
  f.created[1].pipe.errored = true;
  f.tick();
  assert.equal(f.created.length, 3);
});

test("dispose while hidden removes listeners and cannot reconnect later", (t) => {
  const f = fixture(t, "hidden");
  assert.equal(f.created.length, 0);
  f.controller.dispose();
  f.visibility("visible");
  f.win.dispatchEvent(new Event("pageshow"));
  assert.equal(f.created.length, 0);
  assert.equal(f.timers.size, 0);
});
