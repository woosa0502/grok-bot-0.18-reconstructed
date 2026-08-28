// Regression tests pinning the box hook config + response shapes to the repo's
// own validators (source/packages/hooks/validators). The box daemon reads
// .cursor/hooks.json and emits hook responses; these must match the schema the
// rest of the codebase validates against.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadValidators() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "belmont-hook-validators-"));
  const load = async (entry, name) => {
    const output = path.join(temporary, `${name}.mjs`);
    await build({ entryPoints: [path.join(repoRoot, entry)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
    return import(`${pathToFileURL(output).href}?${Date.now()}`);
  };
  const config = await load("source/packages/hooks/validators/hooksConfig.ts", "config");
  const pre = await load("source/packages/hooks/validators/preToolUseResponse.ts", "pre");
  const postFail = await load("source/packages/hooks/validators/postToolUseFailureResponse.ts", "postfail");
  return { config, pre, postFail, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("the hooks.json shapes the box reads validate against the repo schema", async () => {
  const { config, dispose } = await loadValidators();
  try {
    // type omitted (defaults to command), matcher, timeout, failClosed — the exact
    // features the box daemon now honors.
    const valid = {
      version: 1,
      hooks: {
        preToolUse: [{ command: "sh .cursor/gate.sh", matcher: "Read|Shell", timeout: 10, failClosed: true }],
        postToolUseFailure: [{ type: "command", command: "sh .cursor/fail.sh" }],
        subagentStop: [{ command: "sh .cursor/stop.sh" }],
      },
    };
    const result = config.validateHooksConfig(valid);
    assert.equal(result.isValid, true, `expected valid, got: ${result.errors.join("; ")}`);

    // An invalid matcher regex is rejected by the schema (the box also fails-safe
    // at runtime by matching nothing).
    const badMatcher = { version: 1, hooks: { preToolUse: [{ command: "x", matcher: "(" }] } };
    assert.equal(config.validateHooksConfig(badMatcher).isValid, false, "invalid matcher regex is rejected");

    // A non-positive timeout is rejected.
    const badTimeout = { version: 1, hooks: { preToolUse: [{ command: "x", timeout: 0 }] } };
    assert.equal(config.validateHooksConfig(badTimeout).isValid, false, "non-positive timeout is rejected");
  } finally {
    await dispose();
  }
});

test("the snake_case hook responses the box parses validate against the repo schema", async () => {
  const { pre, postFail, dispose } = await loadValidators();
  try {
    // The exact deny response the central gate / WebSearch hook emit and the box parses.
    assert.equal(pre.validatePreToolUseResponse({ permission: "deny", user_message: "blocked", additional_context: "ctx" }).isValid, true);
    assert.equal(pre.validatePreToolUseResponse({ permission: "allow", updated_input: { path: "x" } }).isValid, true);
    assert.equal(pre.validatePreToolUseResponse({ permission: "bogus" }).isValid, false, "invalid permission rejected");

    assert.equal(postFail.validatePostToolUseFailureResponse({ additional_context: "note" }).isValid, true);
  } finally {
    await dispose();
  }
});
