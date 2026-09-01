// A8 / GBF-AGT-000325: beforeSubmitPrompt actually fires and continue:false
// halts the submission. Three layers pinned here:
//  - the box daemon maps a deny hook (exit 2 / permission deny) to
//    continue:false with the hook's user_message, and a passing hook to
//    continue:true with additional_context (behavioral, real hooks.json);
//  - the remote-hooks helper turns that response into {halted, userMessage,
//    additionalContext} and fails OPEN on infrastructure trouble;
//  - the run shell fires it for user turns before prepareTurn, halting with
//    SandPromptSubmissionHaltedError and injecting hook context ahead of the
//    untouched prompt (source-pinned).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadModules() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "before-submit-entry.ts",
      contents: `
        export { BoxExecRuntime } from "./source/box-exec-daemon/server.js";
        export { ExecuteHookArgs, ExecuteHookRequest } from "./source/packages/proto/generated/agent/v1/exec_pb.js";
        export { BeforeSubmitPromptRequestQuery } from "./source/packages/proto/generated/agent/v1/agent_pb.js";
        export { executeRemoteBeforeSubmitPromptHook } from "./source/packages/agent/tools/core/remote-hooks.js";
        export { hookExecutorResource } from "./source/packages/agent-exec/hook-executor.js";
        export { createContext } from "./source/packages/context/core.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
    banner: { js: 'import { createRequire as __belmontCreateRequire } from "node:module";\nconst require = __belmontCreateRequire(import.meta.url);' },
  });
  const dir = path.join(repoRoot, "node_modules", ".cache", "belmont-tests");
  await mkdir(dir, { recursive: true });
  const bundlePath = path.join(dir, `before-submit-${process.pid}.mjs`);
  await writeFile(bundlePath, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(bundlePath, { force: true });
  }
}

const modulePromise = loadModules();

async function daemonWith(hooksConfig) {
  const { BoxExecRuntime } = await modulePromise;
  const root = await mkdtemp(path.join(tmpdir(), "belmont-before-submit-"));
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(workspace, ".cursor"), { recursive: true });
  await mkdir(path.join(root, "terminals"), { recursive: true });
  await writeFile(path.join(workspace, ".cursor", "hooks.json"), JSON.stringify(hooksConfig));
  return { runtime: new BoxExecRuntime(workspace, path.join(root, "terminals"), { PATH: process.env.PATH ?? "" }), root };
}

function promptQuery(modules, prompt) {
  const { ExecuteHookArgs, ExecuteHookRequest, BeforeSubmitPromptRequestQuery } = modules;
  return new ExecuteHookArgs({
    request: new ExecuteHookRequest({
      request: { case: "beforeSubmitPrompt", value: new BeforeSubmitPromptRequestQuery({ prompt, conversationId: "agent-1" }) },
    }),
  });
}

test("daemon: a deny hook halts with continue:false and its user message", async () => {
  const modules = await modulePromise;
  const { runtime, root } = await daemonWith({
    version: 1,
    hooks: { beforeSubmitPrompt: [{ command: `sh -c 'echo "{\\"permission\\":\\"deny\\",\\"user_message\\":\\"금지어가 포함된 프롬프트입니다\\"}"; exit 2'` }] },
  });
  try {
    const result = await runtime.executeHook(promptQuery(modules, "금지어 테스트"));
    const response = result.response?.response;
    assert.equal(response?.case, "beforeSubmitPrompt");
    assert.equal(response.value.continue, false, "a deny must set continue:false");
    assert.equal(response.value.userMessage, "금지어가 포함된 프롬프트입니다");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("daemon: a passing hook continues and carries additional context", async () => {
  const modules = await modulePromise;
  const { runtime, root } = await daemonWith({
    version: 1,
    hooks: { beforeSubmitPrompt: [{ command: `sh -c 'echo "{\\"additional_context\\":\\"오늘은 배포 금지일이다\\"}"'` }] },
  });
  try {
    const result = await runtime.executeHook(promptQuery(modules, "배포해줘"));
    const response = result.response?.response;
    assert.equal(response?.case, "beforeSubmitPrompt");
    assert.equal(response.value.continue, true);
    assert.equal(response.value.additionalContext, "오늘은 배포 금지일이다");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("helper: maps the response to {halted,...} and fails open on errors", async () => {
  const { executeRemoteBeforeSubmitPromptHook, hookExecutorResource, createContext } = await modulePromise;
  const ctx = createContext();
  const seen = [];
  const respond = (value) => ({
    resourceAccessor: {
      get(resource) {
        assert.equal(resource, hookExecutorResource);
        return {
          execute: async (_ctx, hookArgs) => {
            seen.push(hookArgs.request.request.value.prompt);
            return { response: { response: { case: "beforeSubmitPrompt", value } } };
          },
        };
      },
    },
    enableExecuteHookExec: true,
    configuredSteps: ["beforeSubmitPrompt"],
  });
  const halted = await executeRemoteBeforeSubmitPromptHook({
    ctx, prompt: "위험한 프롬프트", requestContext: { conversationId: "a" },
    options: respond({ continue: false, userMessage: "막았다" }),
  });
  assert.deepEqual({ halted: halted.halted, userMessage: halted.userMessage }, { halted: true, userMessage: "막았다" });
  assert.deepEqual(seen, ["위험한 프롬프트"]);

  const passed = await executeRemoteBeforeSubmitPromptHook({
    ctx, prompt: "p", requestContext: { conversationId: "a" },
    options: respond({ continue: true, additionalContext: "ctx" }),
  });
  assert.deepEqual({ halted: passed.halted, additionalContext: passed.additionalContext }, { halted: false, additionalContext: "ctx" });

  const broken = await executeRemoteBeforeSubmitPromptHook({
    ctx, prompt: "p", requestContext: { conversationId: "a" },
    options: {
      resourceAccessor: { get: () => ({ execute: async () => { throw new Error("daemon down"); } }) },
      enableExecuteHookExec: true, configuredSteps: ["beforeSubmitPrompt"],
    },
  });
  assert.equal(broken.halted, undefined, "infrastructure failure must fail open, never halt");

  const unconfigured = await executeRemoteBeforeSubmitPromptHook({
    ctx, prompt: "p", requestContext: { conversationId: "a" },
    options: { resourceAccessor: { get: () => { throw new Error("never"); } }, enableExecuteHookExec: true, configuredSteps: ["preToolUse"] },
  });
  assert.deepEqual(unconfigured, {}, "a step not configured is a no-op");
});

test("run shell: fires for user turns before prepareTurn, halts typed, injects context", () => {
  const shell = read("source/host/runner/turn-run-shell.ts");
  assert.match(shell, /requestSource === "turn"\s*&& !host\.isSubagentRunner\s*&& host\.runBeforeSubmitPromptHook != null/);
  assert.match(shell, /throw new SandPromptSubmissionHaltedError\(verdict\.userMessage\)/);
  assert.match(shell, /beforeSubmitPrompt hook context:/);
  const hookAt = shell.indexOf("host.runBeforeSubmitPromptHook({");
  const prepareAt = shell.indexOf("prepared = await host.prepareTurn(");
  assert.ok(hookAt > 0 && prepareAt > 0 && hookAt < prepareAt, "the hook must run before prepareTurn");
  assert.match(shell, /prepared = await host\.prepareTurn\(\s*effectivePrompt,/);
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /runBeforeSubmitPromptHook: async \(\{ prompt \}\) => \{/);
  assert.match(composition, /configuredSteps: \["beforeSubmitPrompt"\]/);
});
