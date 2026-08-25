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
