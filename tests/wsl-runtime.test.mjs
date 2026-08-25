import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertSupportedNodeRuntime,
  assertWslGuiRuntime,
  assertWslPlatform,
  parseDebugPort,
  wslElectronArgs,
} from "../scripts/lib/wsl-runtime.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("WSL setup uses the checksum-pinned shipped renderer", async () => {
  const setup = await readFile(path.join(repositoryRoot, "scripts", "setup-wsl.mjs"), "utf8");
  assert.match(setup, /buildFidelityDistribution/);
  assert.doesNotMatch(setup, /buildCleanDistribution/);
  assert.match(setup, /checksum-pinned-artifact-runtime/);
  assert.match(setup, /src\/app\/dist\/renderer/);
});

test("WSL platform and GUI checks are separate", () => {
  assert.doesNotThrow(() => assertWslPlatform({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }));
  assert.throws(() => assertWslPlatform({ platform: "linux", env: {} }), /requires Linux under WSL2/);
  assert.doesNotThrow(() => assertWslGuiRuntime({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu", DISPLAY: ":0" } }));
  assert.throws(() => assertWslGuiRuntime({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" } }), /WSLg is unavailable/);
});

test("WSL runtime validates Node and loopback-only debug arguments", () => {
  assert.doesNotThrow(() => assertSupportedNodeRuntime("26.5.0"));
  assert.throws(() => assertSupportedNodeRuntime("22.22.0"), /Node.js >=26.5.0 <27/);
  assert.equal(parseDebugPort("9333"), 9333);
  assert.equal(parseDebugPort(""), null);
  assert.throws(() => parseDebugPort("80"), /between 1024 and 65535/);
  const args = wslElectronArgs({ appRoot: "runtime", profileDir: "profile", debugPort: 9333 });
  assert.ok(args.includes("--no-sandbox"));
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.includes("--remote-debugging-port=9333"));
  assert.equal(args.some(value => /docker/iu.test(value)), false);
});
