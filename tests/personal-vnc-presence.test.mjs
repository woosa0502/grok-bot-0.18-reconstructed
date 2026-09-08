import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";

const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, ".build"), { recursive: true });
const temp = mkdtempSync(resolve(root, ".build/personal-vnc-presence-"));
test.after(() => rmSync(temp, { recursive: true, force: true }));
const output = resolve(temp, "modules.mjs");
await build({
  stdin: {
    contents: [
      'export { useComputerExperience } from "./frontend/src/recovered/features/computer/shell/controller.ts";',
      'export { installVncUserPresenceReporter } from "./source/electron-preload/preload-vnc.ts";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, format: "esm", platform: "node", external: ["react"], outfile: output, logLevel: "silent",
});
const { useComputerExperience, installVncUserPresenceReporter } = await import(pathToFileURL(output).href);
const tick = () => new Promise((done) => setImmediate(done));

function reporter(send) {
  const listeners = new Map();
  const timers = new Set();
  const calls = [];
  const target = { addEventListener: (event, callback) => listeners.set(event, callback) };
  installVncUserPresenceReporter({
    edge: { reportUserPresence: ({ isPresent }) => { calls.push(isPresent); return send(isPresent); } },
    window: target, document: { ...target, documentElement: target },
    location: { pathname: "/vnc.html", search: "?sandInteractive=1" },
    scheduleRetry(callback, delayMs) {
      const timer = { callback, delayMs };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  });
  return {
    calls, timers, emit: (event) => listeners.get(event)(),
    async runTimer() {
      assert.equal(timers.size, 1, "one delayed retry must be scheduled");
      const timer = [...timers][0];
      assert.ok(timer.delayMs > 0);
      timers.delete(timer);
      timer.callback();
      await tick();
    },
  };
}

test("live-page leave report retries once after transient IPC rejection without another pointer event", async () => {
  let leaves = 0;
  const f = reporter(async (present) => {
    if (!present && ++leaves === 1) throw new Error("temporarily unavailable");
  });
  f.emit("mouseenter");
  await tick();
  f.emit("mouseleave");
  await tick();
  await f.runTimer();
  assert.deepEqual(f.calls, [true, false, false]);
  assert.equal(f.timers.size, 0);
});

test("autonomous retries stop after two and pagehide cancels timers with final false best effort", async () => {
  const f = reporter(async () => { throw new Error("unavailable"); });
  f.emit("mouseenter");
  await tick();
  await f.runTimer();
  await f.runTimer();
  assert.deepEqual(f.calls, [true, true, true]);
  assert.equal(f.timers.size, 0);
  f.emit("mouseleave");
  await tick();
  assert.equal(f.timers.size, 1);
  f.emit("pagehide");
  await tick();
  assert.equal(f.calls.at(-1), false);
  assert.equal(f.timers.size, 0);
  const count = f.calls.length;
  f.emit("mousemove");
  await tick();
  assert.equal(f.calls.length, count, "hidden viewer cannot announce renewed presence");
});

test("mounted computer controller clears presence on close and bot switch and ignores closed-view reports", async () => {
  const dom = new Window();
  const savedGlobals = new Map();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  const renderer = createRoot(container);
  let presence;
  let experience;
  let activeAgentId = "bot-a";
  const bridge = {
    foreverBox: { onVncUserPresence(callback) { presence = callback; return () => { presence = undefined; }; } },
    telemetry: { reportOpenComputer() {} },
  };
  const client = {
    ready: Promise.resolve(),
    call: async (method, { id }) => ["getForeverBoxStatus", "ensureForeverBox"].includes(method) ? { agentId: id, state: "running" } : [],
    subscribe: () => () => {}, subscribeTransport: () => () => {},
  };
  function Probe() {
    experience = useComputerExperience({ activeAgentId, bridge, client });
    return React.createElement("div", { "data-viewer-open": experience.isOpen }, "Computer controller");
  }
  try {
    await act(async () => renderer.render(React.createElement(Probe)));
    await act(async () => experience.open());
    presence(true);
    assert.equal(experience.statusStore.vncUserPresenceSnapshots.get(), true);
    await act(async () => experience.close());
    assert.equal(experience.isOpen, false);
    assert.equal(experience.statusStore.vncUserPresenceSnapshots.get(), false);
    presence(true);
    assert.equal(experience.statusStore.vncUserPresenceSnapshots.get(), false);
    await act(async () => experience.open());
    presence(true);
    assert.equal(experience.statusStore.vncUserPresenceSnapshots.get(), true);
    activeAgentId = "bot-b";
    await act(async () => renderer.render(React.createElement(Probe)));
    assert.equal(experience.isOpen, false);
    assert.equal(experience.statusStore.vncUserPresenceSnapshots.get(), false);
  } finally {
    await act(async () => renderer.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor == null) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
  }
});
