import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const compiled = await build({
  entryPoints: [resolve(root, "source/electron-preload/preload-vnc.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { installVncClipboardBridge, installVncUserPresenceReporter } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const tick = () => new Promise((resolveTask) => setImmediate(resolveTask));

function controlledSink() {
  const calls = [];
  return {
    calls,
    send(value) {
      const pending = Promise.withResolvers();
      calls.push({ value, ...pending });
      return pending.promise;
    },
  };
}

function clipboardFixture() {
  const sink = controlledSink();
  const textarea = { value: "copied first" };
  const listeners = new Map();
  let poll;
  let pollingDisposed = false;
  installVncClipboardBridge({
    renderer: { on: (channel, listener) => listeners.set(channel, listener) },
    edge: {
      writeClipboard: ({ text }) => sink.send(text),
      readClipboard: async () => "",
    },
    frame: null,
    window: { addEventListener: (name, handler) => listeners.set(name, handler) },
    document: { getElementById: () => textarea, addEventListener() {} },
    location: { pathname: "/vnc.html", search: "?sandInteractive=1" },
    startPolling: ({ task }) => { poll = task; return { dispose() { pollingDisposed = true; } }; },
    isTextarea: (value) => value === textarea,
  });
  listeners.get("sand:vnc-viewer-visible")({}, true);
  return { sink, textarea, poll: () => poll(), listeners, pollingDisposed: () => pollingDisposed };
}

function presenceFixture() {
  const sink = controlledSink();
  const listeners = new Map();
  const target = { addEventListener: (name, handler) => listeners.set(name, handler) };
  installVncUserPresenceReporter({
    edge: { reportUserPresence: ({ isPresent }) => sink.send(isPresent) },
    window: target,
    document: { ...target, documentElement: target },
    location: { pathname: "/vnc.html", search: "?sandInteractive=1" },
  });
  return { sink, emit: (name) => listeners.get(name)() };
}

test("clipboard retries rejected text on the next poll and suppresses it after success", async () => {
  const target = clipboardFixture();
  target.poll();
  target.poll();
  assert.equal(target.sink.calls.length, 1, "polling must not overlap a pending write");
  target.sink.calls[0].reject(new Error("transient"));
  await tick();
  assert.equal(target.sink.calls.length, 1, "a failure must not create an immediate retry loop");
  target.poll();
  assert.deepEqual(target.sink.calls.map(({ value }) => value), ["copied first", "copied first"]);
  target.sink.calls[1].resolve();
  await tick();
  target.poll();
  assert.equal(target.sink.calls.length, 2);
});

test("clipboard samples the latest text after a pending write settles", async () => {
  const target = clipboardFixture();
  target.poll();
  target.textarea.value = "intermediate";
  target.poll();
  target.textarea.value = "latest";
  target.poll();
  assert.equal(target.sink.calls.length, 1);
  target.sink.calls[0].resolve();
  await tick();
  target.poll();
  assert.deepEqual(target.sink.calls.map(({ value }) => value), ["copied first", "latest"]);
  target.sink.calls[1].resolve();
  await tick();
  target.listeners.get("pagehide")();
  assert.equal(target.pollingDisposed(), true);
});

test("presence retries a rejected value on a later same-state event", async () => {
  const target = presenceFixture();
  target.emit("mouseenter");
  target.sink.calls[0].reject(new Error("transient"));
  await tick();
  assert.equal(target.sink.calls.length, 1);
  target.emit("mousemove");
  assert.deepEqual(target.sink.calls.map(({ value }) => value), [true, true]);
  target.sink.calls[1].resolve();
  await tick();
  target.emit("mousemove");
  assert.equal(target.sink.calls.length, 2);
});

test("presence coalesces pending events and preserves a return to the confirmed state", async () => {
  const target = presenceFixture();
  target.emit("mouseleave");
  target.sink.calls[0].resolve();
  await tick();
  target.emit("mouseenter");
  target.emit("mousemove");
  target.emit("blur");
  assert.deepEqual(target.sink.calls.map(({ value }) => value), [false, true]);
  target.sink.calls[1].resolve();
  await tick();
  assert.deepEqual(target.sink.calls.map(({ value }) => value), [false, true, false]);
  target.sink.calls[2].resolve();
  await tick();
});

test("presence preserves a changed desired value while the preceding request fails", async () => {
  const target = presenceFixture();
  target.emit("mouseenter");
  target.emit("pagehide");
  target.sink.calls[0].reject(new Error("transient"));
  await tick();
  assert.deepEqual(target.sink.calls.map(({ value }) => value), [true, false]);
  target.sink.calls[1].resolve();
  await tick();
});

test("same-state events during rejection coalesce into one later attempt without a failure spin", async () => {
  const target = presenceFixture();
  target.emit("mouseenter");
  for (let index = 0; index < 20; index += 1) target.emit("mousemove");
  assert.equal(target.sink.calls.length, 1);
  target.sink.calls[0].reject(new Error("persistent"));
  await tick();
  assert.equal(target.sink.calls.length, 2);
  target.sink.calls[1].reject(new Error("persistent"));
  await tick();
  await tick();
  assert.equal(target.sink.calls.length, 2);
});
