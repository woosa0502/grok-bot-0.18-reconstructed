// Every bot gets its own virtual desktop: display numbers are assigned per agent, remembered on
// disk, and the browser bot is seeded to the legacy :99 that belmont-browse's Chrome uses.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
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
      contents: `export { localDisplayNumberFor, localDisplayPorts, localComputerDisplayNumber, forgetLocalDisplay, LEGACY_LOCAL_DISPLAY } from "./source/host/box/local-computer-use.js";`,
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
  assert.equal(localDisplayNumberFor("agent-a"), 100);
  assert.equal(localDisplayNumberFor("agent-b"), 101);
  assert.equal(localDisplayNumberFor("agent-a"), 100, "assignment is stable");
  assert.equal(localComputerDisplayNumber(), LEGACY_LOCAL_DISPLAY, "callers without an agent fall back to :99");
  assert.equal(localComputerDisplayNumber("agent-b"), 101);
});

test("assignments are remembered on disk and ports follow the display number", async () => {
  const { localDisplayPorts, forgetLocalDisplay, localDisplayNumberFor } = await modulePromise;
  const saved = JSON.parse(readFileSync(path.join(dataRoot, "local-displays.json"), "utf8"));
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.displays, { "browser-bot-0000": 99, "agent-a": 100, "agent-b": 101 });
  assert.deepEqual(localDisplayPorts(99), { rfbPort: 5900, novncPort: 6080 });
  assert.deepEqual(localDisplayPorts(101), { rfbPort: 5902, novncPort: 6082 });
  forgetLocalDisplay("agent-a");
  assert.equal(localDisplayNumberFor("agent-c"), 102, "freed numbers are not reused while others are higher");
  assert.equal(JSON.parse(readFileSync(path.join(dataRoot, "local-displays.json"), "utf8")).displays["agent-a"], undefined);
});
