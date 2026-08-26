import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertSupportedNodeRuntime,
  assertWslGuiRuntime,
  assertWslPlatform,
  gatewayUrlFromDiscovery,
  initialLocalSettingsUpdate,
  parseDebugPort,
  wslDataRoot,
  wslElectronArgs,
  wslHostEnvironment,
  wslRuntimeEnvironment,
} from "../scripts/lib/wsl-runtime.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("WSL setup uses the checksum-pinned shipped renderer", async () => {
  const setup = await readFile(path.join(repositoryRoot, "scripts", "setup-wsl.mjs"), "utf8");
  assert.match(setup, /buildFidelityDistribution/);
  assert.doesNotMatch(setup, /buildCleanDistribution/);
  assert.match(setup, /overlayCleanDistribution/);
  assert.match(setup, /overlayAuditMetadata/);
  assert.match(setup, /stageRoot: runtimeRoot/);
  assert.match(setup, /built\.hostActivation\.clean/);
  assert.match(setup, /built\.electronMainActivation\.clean/);
  assert.match(setup, /blockedFallbacks\.length > 0/);
  assert.match(setup, /createRendererArtifactProvenance/);
  assert.match(setup, /stagedRenderer\.inventorySha256 !== built\.renderer\.inventorySha256/);
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

test("WSL runtime owns an isolated local Codex host", () => {
  const profileDir = path.resolve("profile");
  const environment = wslRuntimeEnvironment({ KEEP: "yes", SAND_ATTACH_PROD_BOX: "1" });
  assert.equal(environment.SAND_LOCAL_CODEX_MODE, "1");
  assert.equal(environment.SAND_ATTACH_PROD_BOX, "0");
  assert.equal(environment.SAND_DISABLE_UPDATES, "1");
  assert.equal(environment.KEEP, "yes");
  const host = wslHostEnvironment({ profileDir, env: { KEEP: "yes" } });
  assert.equal(host.SAND_DATA_ROOT, wslDataRoot(profileDir));
  assert.equal(host.SAND_GATEWAY_BIND_HOST, "127.0.0.1");
  assert.equal(host.SAND_HOST_PORT, "0");
  assert.equal(gatewayUrlFromDiscovery({ pid: 42, port: 15432, host: "127.0.0.1" }, 42), "http://127.0.0.1:15432");
  assert.equal(gatewayUrlFromDiscovery({ pid: 41, port: 15432 }, 42), null);
  assert.equal(gatewayUrlFromDiscovery({ pid: 42, port: 15432, host: "0.0.0.0" }, 42), null);
});

test("local settings initialize missing values without overwriting persisted choices", () => {
  const seededReview = { isEnabled: false, allowInstructions: [], blockInstructions: [] };
  assert.deepEqual(initialLocalSettingsUpdate(null), { inferenceProvider: "codex", hasSeenOnboarding: true, autoReviewInstructions: seededReview });
  assert.deepEqual(initialLocalSettingsUpdate({ inferenceProvider: "claude-code", hasSeenOnboarding: false }), { autoReviewInstructions: seededReview });
  assert.deepEqual(initialLocalSettingsUpdate({ inferenceProvider: "codex" }), { hasSeenOnboarding: true, autoReviewInstructions: seededReview });
  // A persisted auto-review choice (on or off) is never overwritten by the seed.
  assert.deepEqual(initialLocalSettingsUpdate({ inferenceProvider: "codex", hasSeenOnboarding: true, autoReviewInstructions: { isEnabled: true, allowInstructions: [], blockInstructions: [] } }), {});
});
