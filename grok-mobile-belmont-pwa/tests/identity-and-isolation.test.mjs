import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Linear owns the app identity while Belmont remains the chief bot", async () => {
  const [manifestText, index, onboarding] = await Promise.all([
    fs.readFile(resolve(root, "public/manifest.webmanifest"), "utf8"),
    fs.readFile(resolve(root, "index.html"), "utf8"),
    fs.readFile(resolve(root, "src/screens/OnboardingScreen.tsx"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "Linear");
  assert.equal(manifest.short_name, "Linear");
  assert.match(index, /<title>Linear<\/title>/u);
  assert.match(onboarding, /<h1>Linear<\/h1>/u);
  assert.match(onboarding, /Belmont/u);
});

test("new client is isolated from the legacy PWA implementation", async () => {
  const sourceFiles = [
    "server.mjs",
    "src/App.tsx",
    "src/api.ts",
    "src/screens/HomeScreen.tsx",
    "src/screens/ChatScreen.tsx",
    "src/screens/ComputerScreen.tsx",
  ];
  for (const file of sourceFiles) {
    const contents = await fs.readFile(resolve(root, file), "utf8");
    assert.doesNotMatch(contents, /belmont-mobile-pwa/u, `${file} must not import the legacy PWA`);
  }
});

test("recovered original assets are direct build inputs", async () => {
  const [avatar, engine, icon, styles] = await Promise.all([
    fs.readFile(resolve(root, "src/components/BabyGrokAvatar.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/grok-engine.js"), "utf8"),
    fs.readFile(resolve(root, "src/components/Icon.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/styles.css"), "utf8"),
  ]);
  // The avatar mounts the desktop's own character renderer (GrokMark, carried verbatim in src/grok-engine.js)
  // rather than a hand-rolled reimplementation or the earlier APK geometry sheet.
  assert.match(avatar, /import\("\.\.\/grok-engine\.js"\)/u);
  assert.match(avatar, /mountGrokMark/u);
  assert.match(engine, /mountGrokMark/u);
  assert.match(engine, /GrokMark/u);
  assert.match(icon, /codepoints/u);
  assert.match(styles, /CursorIcons16-Regular\.ttf/u);
});
