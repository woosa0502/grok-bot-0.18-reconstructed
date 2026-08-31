// Prompt diet (A6-1 item 4, scope doc §5): the local Codex build must not
// advertise Cursor-backend features that do not exist here. A section about a
// feature that cannot work is not just wasted tokens — it actively misroutes
// the model (SearchPlugins-first mandates, "install the connector", "use
// Cursor directly"). The container prompts keep every section, pinned by the
// control assertions, so the diet cannot silently leak into them.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadPrompts() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "prompt-diet-entry.ts",
      contents: `
        export {
          DEFAULT_SAND_SYSTEM_PROMPT,
          SAND_SYSTEM_PROMPT_CLOUD_AGENTS_DISABLED,
          SAND_SYSTEM_PROMPT_LOCAL_CODEX,
        } from "./source/host/runner/system-prompt.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const promptsPromise = loadPrompts();

test("the local prompt drops Cursor-backend advertising the local build cannot honor", async () => {
  const { SAND_SYSTEM_PROMPT_LOCAL_CODEX: local } = await promptsPromise;
  for (const dead of [
    "Cursor Origin",            // Cursor's source-control product context
    "cursor.com/codebase",
    "Cursor account",           // marketplace installs synced to the account
    "SearchPlugins",            // marketplace search tool mandates
    // (AuthenticateMcpServer stays: a locally-configured remote MCP server can
    // still need OAuth; whether that path fully works locally is A7's audit.)
    "install it",               // "once the user agrees, install it"
    "team's admin",             // there is no team admin in a personal build
    "using Cursor directly",
  ]) {
    assert.ok(!local.includes(dead), `local prompt still advertises: ${dead}`);
  }
});

test("the local prompt keeps honest denials and gains the local realities", async () => {
  const { SAND_SYSTEM_PROMPT_LOCAL_CODEX: local } = await promptsPromise;
  // Honest denial beats silent removal for features the model might still try.
  assert.match(local, /Image generation is not available in this setup: there is no GenerateImage tool/);
  assert.match(local, /in this local build the desktop is shared too/);
  // The local replacements: connectors come from local MCP config, and
  // repository work happens on this machine instead of a cloud agent.
  assert.match(local, /connectors come from the local MCP configuration on this machine/);
  assert.match(local, /never claim you can install one yourself/);
  assert.match(local, /repository work is yours to do directly on your own computer/);
  assert.match(local, /no configured connector covers the service/);
});

test("the container prompts keep every section the diet removed locally", async () => {
  const {
    DEFAULT_SAND_SYSTEM_PROMPT: cloud,
    SAND_SYSTEM_PROMPT_CLOUD_AGENTS_DISABLED: teamDisabled,
  } = await promptsPromise;
  for (const kept of ["Cursor Origin", "SearchPlugins", "Cursor account"]) {
    assert.ok(cloud.includes(kept), `cloud prompt lost: ${kept}`);
    assert.ok(teamDisabled.includes(kept), `team-disabled prompt lost: ${kept}`);
  }
  // The team-disabled story stays exactly the team-disabled story.
  assert.ok(teamDisabled.includes("disabled by your team's admin"));
  assert.ok(!cloud.includes("disabled by your team's admin"));
});

test("the diet actually shrinks the local prompt", async () => {
  const { DEFAULT_SAND_SYSTEM_PROMPT: cloud, SAND_SYSTEM_PROMPT_LOCAL_CODEX: local } = await promptsPromise;
  assert.ok(
    local.length < cloud.length - 4_000,
    `local prompt (${local.length} chars) should be well under the cloud prompt (${cloud.length} chars)`,
  );
});
