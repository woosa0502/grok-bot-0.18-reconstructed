import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function loadModule() {
  const result = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    entryPoints: ["source/electron-main/adapters/local-codex-mode.ts"],
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("Belmont local Codex mode is explicit and uses checked-in experiment defaults", async () => {
  const { LOCAL_CODEX_STATUS, createLocalExperimentSnapshot } = await loadModule();
  const snapshot = createLocalExperimentSnapshot();
  assert.equal(LOCAL_CODEX_STATUS.kind, "logged-in");
  assert.equal(LOCAL_CODEX_STATUS.authId, "local-codex");
  assert.equal(LOCAL_CODEX_STATUS.displayName, "Belmont Local");
  assert.equal(snapshot.isInitialized, true);
  assert.equal(snapshot.featureGates.focus_gate_local_agent_pr_poll, true);
  assert.equal(snapshot.featureGates.agent_goal_continuation, false);
  assert.ok(Object.keys(snapshot.dynamicConfigs).length > 0);
  assert.ok(Object.keys(snapshot.experiments).length > 0);
});

test("the real login path is production-anchored, not just constants (AUDIT-F4)", async () => {
  // The constants above only describe the logged-in shape; the actual sign-in
  // truth lives in the adapter + coordinator gating. Pin the load-bearing parts:
  const { readFile } = await import("node:fs/promises");
  const adapter = await readFile(new URL("../source/electron-main/adapters/account-oauth.ts", import.meta.url), "utf8");
  // W13: the host login session starts BEFORE "logging-in" is announced (the
  // announcement makes the renderer re-adopt the coordinator port), and status
  // polling tolerates a transient port re-adoption.
  const runLogin = adapter.slice(adapter.indexOf("const runLogin"), adapter.indexOf("const service"));
  assert.ok(runLogin.indexOf("startProviderLogin") < runLogin.indexOf('emit({ kind: "logging-in" })'), "login starts before the logging-in emit");
  assert.match(runLogin, /catch \{\s*await sleep\(LOCAL_CODEX_LOGIN_POLL_MS\);\s*continue;\s*\}/);
  // Status prefers the host's answer over the on-disk fallback.
  assert.match(adapter, /configured = hostStatus === undefined \? readCredentialStatus\(\) : hostStatus\.configured;/);
  const runtime = await readFile(new URL("../source/electron-main/coordinator/coordinator-account-runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /return isLocalCodexMode\(\) \? LOCAL_CODEX_AUTH_ID : null;/, "logged-out local mode keeps a coordinator slot (fresh login reachable)");
});
