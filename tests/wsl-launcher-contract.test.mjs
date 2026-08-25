import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("Belmont product launcher is independent from the user-test harness", async () => {
  const source = await readFile(path.join(repositoryRoot, "scripts", "run-wsl.mjs"), "utf8");
  assert.doesNotMatch(source, /grok-user-test-runtime|user-test|test-supervisor/);
  assert.match(source, /acquireBelmontRuntimeLock/);
  assert.match(source, /belmont-wsl-runtime/);
  assert.match(source, /BELMONT_WSL_PROFILE/);
  assert.match(source, /initialLocalSettingsUpdate/);
});
