// A11: the local desktop's VNC stack must never listen beyond loopback. The
// x11vnc server is passwordless and can DRIVE the desktop, so a 0.0.0.0 bind
// hands the user's screen and sessions to the whole LAN — which is exactly
// what the shipped args did (observed live: 0.0.0.0:5900 before the fix).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "source/packages/local-exec/computer-use/display-manager.ts"), "utf8");

test("x11vnc is pinned to loopback", () => {
  const spawnArgs = /spawn\(\s*"x11vnc",\s*\[([^\]]+)\]/.exec(source);
  assert.ok(spawnArgs, "x11vnc spawn args present");
  assert.match(spawnArgs[1], /"-localhost"/, "the passwordless VNC server must carry -localhost");
});

test("websockify listens on 127.0.0.1, never a bare port", () => {
  const spawnArgs = /spawn\(\s*"websockify",\s*\[([^\]]+)\]/.exec(source);
  assert.ok(spawnArgs, "websockify spawn args present");
  assert.match(spawnArgs[1], /`127\.0\.0\.1:\$\{this\.novncPort\}`/, "the noVNC listener must bind loopback explicitly");
  assert.doesNotMatch(spawnArgs[1], /String\(this\.novncPort\)/, "a bare port argument binds 0.0.0.0");
});

test("the noVNC URL is only published after websockify accepts connections (A11)", () => {
  // no optimistic fallback in the getter — undefined until confirmed listening
  assert.doesNotMatch(source, /vncUrlValue \?\? `http/, "getter must not fabricate a URL");
  assert.match(source, /if \(await this\.waitForTcp\(this\.novncPort, 8_000\)\) \{\s*this\.vncUrlValue =/);
  assert.match(source, /VNC viewer URL withheld/);
  // dispose forgets the published URL so a restart re-proves readiness
  assert.match(source, /this\.vncUrlValue = undefined;/);
});
