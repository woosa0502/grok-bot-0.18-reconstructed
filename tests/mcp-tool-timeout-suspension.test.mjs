// Approval waits must not be killed by the per-call tool budget (2026-09-05). CallMcpTool ran under a
// plain Promise.race: after 840s the call was "terminated" while its Auto-review card was still
// waiting for the user, and the approval stayed pending — every later side effect was refused with
// "Another action is waiting for Auto-review approval" until the next user message. The budget now
// pauses while the tool is parked on an approval (withToolExecutionTimeoutSuspended) and cancels the
// child context when it really runs out, so a pending approval is retired instead of leaked.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function loadAll() {
  // One bundle so the suspension context key is a single symbol shared by every module.
  const result = await build({
    absWorkingDir: repoRoot, bundle: true, write: false, format: "esm", platform: "node", target: "node22",
    stdin: {
      resolveDir: repoRoot, loader: "ts",
      contents: [
        'export * from "./source/host/runner/tools/mcp-meta-tools.ts";',
        'export { createContext } from "./source/packages/context/core.ts";',
        'export { withToolExecutionTimeoutSuspended } from "./source/packages/agent/tools/tool-timeout-suspension.ts";',
      ].join("\n"),
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = async function* () { yield "{}"; };
const registry = { resolveToolName: () => "CallMcpTool" };

test("a tool parked on an approval outlives the per-call budget", async () => {
  const m = await loadAll();
  const tool = {
    name: "CallMcpTool", dynamicToolMetaRole: "invocation",
    execute: async (ctx) => m.withToolExecutionTimeoutSuspended(ctx, async () => { await sleep(120); return "approved-and-done"; }),
  };
  const wrapped = m.wrapDynamicInvocationToolWithTimeout(tool, registry, false, () => 40);
  assert.equal(await wrapped.execute(m.createContext(), {}, args(), {}), "approved-and-done");
});

test("a tool that is simply slow still times out, and its context is cancelled so a pending approval retires", async () => {
  const m = await loadAll();
  let seen;
  const tool = { name: "CallMcpTool", execute: async (ctx) => { seen = ctx; await sleep(150); return "late"; } };
  const wrapped = m.wrapDynamicInvocationToolWithTimeout(tool, registry, false, () => 40);
  await assert.rejects(wrapped.execute(m.createContext(), {}, args(), {}), (error) => {
    assert.equal(error.name, "ToolCallExecutionTimeoutError");
    assert.match(error.message, /timed out after 0 seconds and was terminated/);
    return true;
  });
  assert.equal(seen.signal.aborted, true, "the child context is cancelled: an approval waiting on ctx.signal is retired, not leaked");
});

test("the budget resumes where it left off after the approval wait", async () => {
  const m = await loadAll();
  const tool = {
    name: "CallMcpTool",
    execute: async (ctx) => {
      await m.withToolExecutionTimeoutSuspended(ctx, () => sleep(100)); // parked: does not count
      await sleep(30); // counts against the 40ms budget
      return "ok";
    },
  };
  const wrapped = m.wrapDynamicInvocationToolWithTimeout(tool, registry, false, () => 40);
  assert.equal(await wrapped.execute(m.createContext(), {}, args(), {}), "ok");
  const slowAfter = {
    name: "CallMcpTool",
    execute: async (ctx) => { await m.withToolExecutionTimeoutSuspended(ctx, () => sleep(60)); await sleep(120); return "too late"; },
  };
  await assert.rejects(m.wrapDynamicInvocationToolWithTimeout(slowAfter, registry, false, () => 40).execute(m.createContext(), {}, args(), {}), /timed out/);
});

test("a context without cancel/suspension support keeps the plain race", async () => {
  const m = await loadAll();
  const tool = { name: "CallMcpTool", execute: async () => { await sleep(100); return "late"; } };
  await assert.rejects(m.wrapDynamicInvocationToolWithTimeout(tool, registry, false, () => 30).execute({}, {}, args(), {}), /timed out/);
  const fast = { name: "CallMcpTool", execute: async () => "fast" };
  assert.equal(await m.wrapDynamicInvocationToolWithTimeout(fast, registry, false, () => 30).execute({}, {}, args(), {}), "fast");
});

test("the default budget for CallMcpTool is still the shipped 14-minute guard", async () => {
  const m = await loadAll();
  assert.equal(m.sandToolCallExecutionTimeoutMs("CallMcpTool", false), 14 * 60 * 1000);
});
