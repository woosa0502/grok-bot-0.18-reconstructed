import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("Belmont product launcher is independent from the user-test harness", async () => {
  const source = await readFile(path.join(repositoryRoot, "scripts", "run-wsl.mjs"), "utf8");
  const selector = await readFile(path.join(repositoryRoot, "scripts", "lib", "renderer-runtime-selection.mjs"), "utf8");
  assert.doesNotMatch(source, /grok-user-test-runtime|user-test|test-supervisor/);
  assert.match(source, /acquireBelmontRuntimeLock/);
  assert.match(source, /selectRendererRuntime/);
  assert.match(selector, /"belmont-wsl"/);
  assert.match(selector, /BELMONT_WSL_PROFILE/);
  assert.match(source, /appRoot = selection\.runtimeRoot/);
  assert.match(source, /profileDir = selection\.profileDir/);
  assert.match(source, /initialLocalSettingsUpdate/);
});
