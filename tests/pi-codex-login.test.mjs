// In-app Pi Codex OAuth: host login session state machine, gateway/coordinator
// wiring, and the desktop account service driven by the real credential.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadTs(relativePath, externals = []) {
  const result = await build({
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", external: externals,
    // Some transitive electron-main modules use CJS `require` for node builtins; give the
    // data: URL bundle a real require.
    banner: { js: "import { createRequire as __belmontCreateRequire } from 'node:module'; import { pathToFileURL as __belmontToUrl } from 'node:url'; const require = __belmontCreateRequire(__belmontToUrl(process.cwd() + '/'));" },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("login session: device code is exposed, completion and failure are recorded, cancel aborts", async () => {
  const { createPiCodexLoginSession } = await loadTs("source/host/extensions/inference/pi-codex-login-session.ts");
  let finish;
  let seenSignal;
  const login = (interaction) => new Promise((resolve, reject) => {
    seenSignal = interaction.signal;
    void interaction.prompt({ type: "select", message: "How?", options: [{ id: "device_code" }, { id: "browser" }] }).then((choice) => {
      assert.equal(choice, "device_code");
      interaction.notify({ type: "info", message: "starting" });
      interaction.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://example.test/device" });
    });
    finish = { resolve, reject };
    interaction.signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const changes = [];
  const session = createPiCodexLoginSession({ login, onChange: (s) => changes.push(s.state) });
  assert.equal(session.status().state, "idle");
  const pending = await session.start();
  assert.equal(pending.state, "pending");
  assert.equal(pending.userCode, "ABCD-1234");
  assert.equal(pending.verificationUri, "https://example.test/device");
  // start() while pending is idempotent (same flow, same code).
  assert.equal((await session.start()).userCode, "ABCD-1234");
  finish.resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(session.status().state, "completed");

  // A second login that fails.
  const failing = createPiCodexLoginSession({ login: async () => { throw new Error("nope"); }, codeWaitMs: 200 });
  const failed = await failing.start();
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /nope/);

  // Cancel aborts the interaction signal.
  const cancellable = createPiCodexLoginSession({ login, codeWaitMs: 200 });
  await cancellable.start();
  const cancelled = cancellable.cancel();
  assert.equal(cancelled.state, "failed");
  assert.equal(cancelled.error, "cancelled");
  assert.equal(seenSignal.aborted, true);
  assert.deepEqual(changes, ["pending", "pending", "pending", "completed"]);
});

test("login session: text prompts cannot be answered from the app", async () => {
  const { createPiCodexLoginSession, PI_CODEX_LOGIN_CLI_HINT } = await loadTs("source/host/extensions/inference/pi-codex-login-session.ts");
  const session = createPiCodexLoginSession({
    login: async (interaction) => { await interaction.prompt({ type: "text", message: "Paste the code" }); },
    codeWaitMs: 200,
  });
  const state = await session.start();
  assert.equal(state.state, "failed");
  assert.match(state.error, /text input/);
  assert.ok(state.error.includes(PI_CODEX_LOGIN_CLI_HINT));
});

test("desktop account service follows the real credential and drives sign-in through the host", async () => {
  const { createLocalCodexAccountService } = await loadTs("source/electron-main/adapters/account-oauth.ts", ["electron"]);
  let configured = false;
  let loginState = { state: "idle" };
  const opened = [];
  const emitted = [];
  const legs = {
    getProviderAuthStatus: async () => ({ configured }),
    startProviderLogin: async () => { loginState = { state: "pending", userCode: "WXYZ-0000", verificationUri: "https://example.test/device" }; return loginState; },
    getProviderLoginStatus: async () => loginState,
    cancelProviderLogin: async () => { loginState = { state: "failed", error: "cancelled" }; },
    providerLogout: async () => { configured = false; },
  };
  const context = {
    coordinatorLegs: { legs },
    native: { shell: { openExternal: async (url) => { opened.push(url); } } },
    requireMainEdge: () => ({ emit: (name, status) => emitted.push([name, status.kind]) }),
  };
  const service = createLocalCodexAccountService(context, { readCredentialStatus: () => configured, refreshIntervalMs: 60_000, sleep: async () => { loginState = { state: "completed" }; } });
  assert.equal((await service.getStatus()).kind, "logged-out");
  const auth = await service.getAuthService();
  const signedIn = await auth.login();
  assert.equal(signedIn.kind, "logged-in");
  assert.deepEqual(opened, ["https://example.test/device"]);
  assert.deepEqual(emitted.map(([, kind]) => kind), ["logging-in", "logged-in"]);
  configured = true;
  assert.equal((await service.getStatus()).kind, "logged-in");
  assert.equal((await auth.logout()).kind, "logged-out");
  assert.equal(configured, false);
  await service.dispose();
});

test("inference readiness accepts the Pi credential in local Codex mode (routines/hooks/wakes gate on it)", () => {
  const extension = read("source/host/extensions/inference/extension.ts");
  assert.match(extension, /isReady: async \(\) => process\.env\.SAND_AGENT_MOCK_RESPONSE != null \|\| context\.deps\.auth\.peekAccessToken\(\) !== null \|\| \(isLocalCodexMode\(process\.env\) && \(await getPiCodexAuthStatus\(\)\.catch\(\(\) => \(\{ configured: false \}\)\)\)\.configured\)/);
});

test("provider auth methods are wired through the gateway protocol, host API, and coordinator table", () => {
  const protocol = read("source/host/gateway-protocol.ts");
  const api = read("source/host/host-gateway-api.ts");
  const table = read("source/shared/rpc/coordinator-main.ts");
  const extension = read("source/host/extensions/inference/extension.ts");
  for (const name of ["getProviderAuthStatus", "startProviderLogin", "getProviderLoginStatus", "cancelProviderLogin", "providerLogout"]) {
    assert.match(protocol, new RegExp(`${name}: \\(api: GatewayApi\\) => api\\.${name}\\(\\)`));
    assert.match(api, new RegExp(`${name}:`));
    assert.match(table, new RegExp(`${name}: \\{ args: "none" \\}`));
    assert.match(extension, new RegExp(`${name}:`));
  }
  assert.match(api, /method\(deps\.extensions\.api\("trays"\), "pushError"\)\(\{\s*title: "Codex sign-in"/);
  const account = read("source/electron-main/adapters/account-oauth.ts");
  assert.match(account, /return createLocalCodexAccountService\(context\)/);
  assert.doesNotMatch(account, /getStatus: async \(\) => LOCAL_CODEX_STATUS/);
});
