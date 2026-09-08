// Every bot gets its own virtual desktop: display numbers are assigned per agent, remembered on
// disk, and the browser bot is seeded to the legacy :99 that belmont-browse's Chrome uses.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = mkdtempSync(path.join(tmpdir(), "belmont-displays-"));
const browserBotIdFile = path.join(dataRoot, "browser-bot-id");
writeFileSync(browserBotIdFile, "browser-bot-0000\n");
process.env.SAND_DATA_ROOT = dataRoot;
process.env.SAND_BROWSER_BOT_ID_FILE = browserBotIdFile;
process.env.SAND_LOCAL_COMPUTER_USE = "0"; // keep the module from probing Xvfb/xdotool/ffmpeg

async function loadModule() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "local-display-registry-entry.ts",
      contents: `export { localDisplayNumberFor, localDisplayPorts, localComputerDisplayNumber, forgetLocalDisplay, LEGACY_LOCAL_DISPLAY } from "./source/host/box/local-computer-use.js"; export { LocalDisplayManager } from "./source/packages/local-exec/computer-use/display-manager.js";`,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
  });
  // The module graph reaches packages (@bufbuild/protobuf, …) that a data: URL cannot resolve,
  // so the bundle is written inside the repo where Node's resolver finds node_modules.
  const outDir = path.join(repoRoot, ".build", "test-bundles");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `local-display-registry-${process.pid}.mjs`);
  writeFileSync(outFile, result.outputFiles[0].text);
  return import(pathToFileURL(outFile).href);
}

const modulePromise = loadModule();

test("the browser bot keeps the legacy display and other agents get their own from :100", async () => {
  const { localDisplayNumberFor, LEGACY_LOCAL_DISPLAY, localComputerDisplayNumber } = await modulePromise;
  assert.equal(localDisplayNumberFor("browser-bot-0000"), LEGACY_LOCAL_DISPLAY);
  const a = localDisplayNumberFor("agent-a");
  const b = localDisplayNumberFor("agent-b");
  assert.ok(a >= 100);
  assert.ok(b > a);
  assert.equal(localDisplayNumberFor("agent-a"), a, "assignment is stable");
  assert.equal(localComputerDisplayNumber(), LEGACY_LOCAL_DISPLAY, "callers without an agent fall back to :99");
  assert.equal(localComputerDisplayNumber("agent-b"), b);
});

test("assignments are remembered on disk and ports follow the display number", async () => {
  const { localDisplayPorts, forgetLocalDisplay, localDisplayNumberFor } = await modulePromise;
  const saved = JSON.parse(readFileSync(path.join(dataRoot, "local-displays.json"), "utf8"));
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.displays, { "browser-bot-0000": 99, "agent-a": localDisplayNumberFor("agent-a"), "agent-b": localDisplayNumberFor("agent-b") });
  assert.deepEqual(localDisplayPorts(99), { rfbPort: 5900, novncPort: 6080 });
  assert.deepEqual(localDisplayPorts(101), { rfbPort: 5902, novncPort: 6082 });
  forgetLocalDisplay("agent-a");
  assert.ok(localDisplayNumberFor("agent-c") > saved.displays["agent-b"], "freed numbers are not reused while others are higher");
  assert.equal(JSON.parse(readFileSync(path.join(dataRoot, "local-displays.json"), "utf8")).displays["agent-a"], undefined);
});


test("a newly allocated bot skips an unrelated listening viewer port", async () => {
  const { localDisplayNumberFor, localDisplayPorts } = await modulePromise;
  const candidate = localDisplayNumberFor("agent-c") + 1;
  const server = createServer();
  let ownsPort = false;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", (error) => error.code === "EADDRINUSE" ? resolve() : reject(error));
      server.listen(localDisplayPorts(candidate).novncPort, "127.0.0.1", () => { ownsPort = true; resolve(); });
    });
    const assigned = localDisplayNumberFor("agent-port-collision");
    assert.ok(assigned > candidate, "must not reuse a display whose noVNC port belongs to another service");
    assert.equal(localDisplayNumberFor("agent-port-collision"), assigned);
  } finally {
    if (ownsPort) await new Promise((resolve) => server.close(resolve));
  }
});


test("a remembered display cannot adopt an unrelated listener or keep advertising it", async () => {
  const { LocalDisplayManager } = await modulePromise;
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  for (const role of ["RFB", "noVNC"]) {
    const manager = new LocalDisplayManager({ displayNumber: 987, vnc: true,
      rfbPort: role === "RFB" ? port : 1, novncPort: role === "noVNC" ? port : 1 });
    // No display or dependencies are started; exercise actual adoption against a
    // real unrelated local socket, and the watchdog's handling of a takeover.
    manager.has = async () => true;
    manager.isDisplayReady = async () => true;
    try {
      await assert.rejects(manager.startVnc(), new RegExp(`Refusing unrelated ${role} listener`));
      assert.equal(manager.vncUrl, undefined);
      manager.vncUrlValue = "http://previously-owned-viewer";
      await manager.healVnc();
      assert.equal(manager.vncUrl, undefined);
      assert.equal(manager.x11vnc, undefined);
      assert.equal(manager.websockify, undefined);
      assert.equal(server.listening, true, "unrelated service must remain untouched");
    } finally { manager.dispose(); }
  }
  await new Promise((resolve) => server.close(resolve));
});
