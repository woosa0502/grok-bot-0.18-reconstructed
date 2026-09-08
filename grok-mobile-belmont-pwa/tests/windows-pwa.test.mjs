import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("home Windows action opens a same-origin PWA surface instead of an Android intent", async () => {
  const [app, home, navigation, screen, serviceWorker, viewer, videoSettings] = await Promise.all([
    fs.readFile(resolve(root, "src/App.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/HomeScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/navigation.ts"), "utf8"),
    fs.readFile(resolve(root, "src/screens/WindowsDesktopScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "public/sw.js"), "utf8"),
    fs.readFile(resolve(root, "src/windows-viewer.ts"), "utf8"),
    fs.readFile(resolve(root, "src/windows-video-settings.ts"), "utf8"),
  ]);
  assert.match(home, /aria-label="Windows 화면 열기"/u);
  assert.match(app, /onOpenWindows=\{\(\) => open\("WindowsDesktopScreen"\)\}/u);
  assert.match(app, /route\.name === "WindowsDesktopScreen"/u);
  assert.match(navigation, /"WindowsDesktopScreen"/u);
  assert.match(viewer, /frame\.src = "\/windows\/desktop"/u);
  assert.match(screen, /applyWindowsVideoProfile\(localStorage, frameRate\)/u);
  assert.match(videoSettings, /storage\.setItem\("mlSettings"/u);
  assert.match(videoSettings, /dataTransport: "websocket"/u);
  assert.doesNotMatch(screen, /window\.location\.replace/u);
  assert.match(screen, /function MoonlightTrackpad/u);
  assert.match(screen, /pointer\.current\.move\(target\.input/u);
  assert.match(screen, /sendMouseButton\(true, button\)/u);
  assert.match(screen, /sendAccumulatedScroll/u);
  assert.match(screen, /stream\.ws\.readyState >= 2/u);
  assert.match(screen, /if \(event\.pointerType !== "touch"\) relay\(true\)/u);
  assert.match(screen, /Windows 트랙패드 직접 입력/u);
  assert.match(viewer, /allowFullscreen = true/u);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/windows"\)/u);
  assert.doesNotMatch(app, /openWindowsDesktop|intent:\/\//u);
});

test("raw touch input is feature-gated, exclusive after first raw event, and removed on cleanup", async () => {
  const screen = await fs.readFile(resolve(root, "src/screens/WindowsDesktopScreen.tsx"), "utf8");
  assert.match(screen, /"onpointerrawupdate" in window/u);
  assert.match(screen, /event\.pointerId !== state\.rawPointerId/u);
  assert.match(screen, /state\.touchCount !== 1 \|\| state\.twoY !== null/u);
  assert.match(screen, /state\.rawActive = true;\s+movePointer\(event\.clientX, event\.clientY\)/u);
  assert.match(screen, /state\.twoY == null && !state\.rawActive/u);
  assert.match(screen, /addEventListener\("pointerrawupdate", rawMove, \{ passive: true \}\)/u);
  assert.match(screen, /removeEventListener\("pointerrawupdate", rawMove\)/u);
});
