// A4 / GBF-AGT-000251: steering a running subagent restarts it with the steer
// prompt prepended (context kept), exercised behaviorally against the real
// subagent runtime with a scripted runner:
//  - MessageSubagent-style steer interrupts the run, and the settle path
//    RESTARTS the same runner with formatSteerPrompt(message);
//  - a steer racing a finished run reports "not-running" instead of vanishing;
//  - StopSubagent clears a pending steer so an aborted child never restarts.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "steer-entry.ts",
      contents: 'export { createSubagentRuntime } from "./source/host/runner/subagent-runtime.js";',
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
    banner: { js: 'import { createRequire as __belmontCreateRequire } from "node:module";\nconst require = __belmontCreateRequire(import.meta.url);' },
  });
  const dir = path.join(repoRoot, "node_modules", ".cache", "belmont-tests");
  await mkdir(dir, { recursive: true });
  const bundlePath = path.join(dir, `steer-${process.pid}.mjs`);
  await writeFile(bundlePath, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(bundlePath, { force: true });
  }
}

function buildWorld(module) {
  const host = {
    getConversationId: () => "parent-1",
    resolveBoxId: () => "box-1",
    emitAsyncTasksChanged: () => {},
    computerUse: { freeWindow: () => {} },
  };
  const runtime = module.createSubagentRuntime(host);
  const runs = [];
  let settleCurrent;
  const runner = {
    run(prompt) {
      runs.push(prompt);
      return new Promise((resolve) => { settleCurrent = resolve; });
    },
    interrupt(reason) {
      runner.interrupts.push(reason);
      settleCurrent?.({ text: "", aborted: true });
    },
    interrupts: [],
    getObservedToolCallCount: () => 0,
    getActivitySnapshot: () => [],
    getTranscriptPath: () => null,
    getResolvedOutline: async () => [],
  };
  const finish = (text) => settleCurrent?.({ text, aborted: false });
  const drain = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };
  return { runtime, runner, runs, finish, drain };
}

test("a steer interrupts the run and restarts it with the steer prompt", async () => {
  const module = await loadRuntime();
  const { runtime, runner, runs, finish, drain } = buildWorld(module);
  runtime.sessions.set("child-1", runner);
  runtime.dispatchBackgroundSubagent({
    subagentAgentId: "child-1", subagentType: "generalPurpose", toolCallId: "t1",
    prompt: "원래 작업을 해라", run: () => runner.run("원래 작업을 해라"),
  });
  assert.deepEqual(runs, ["원래 작업을 해라"]);

  assert.equal(runtime.steerSubagent("child-1", "방향 수정: X를 먼저 확인해"), "ok");
  await drain();
  assert.equal(runner.interrupts.length, 1, "the steer must interrupt the in-flight run");
  assert.equal(runs.length, 2, "the settle path must restart the runner");
  assert.match(runs[1], /\[Steering message from the parent agent that dispatched you\]/);
  assert.match(runs[1], /방향 수정: X를 먼저 확인해/);
  assert.match(runs[1], /do not start over/, "the restart keeps context rather than starting over");

  finish("다 했다");
  await drain();
  const record = [...runtime.registryEntries()].find(([id]) => id === "child-1")?.[1];
  assert.equal(record?.status, "done", "the steered run settles normally afterwards");
});

test("steering a settled child reports not-running; stop clears a pending steer", async () => {
  const module = await loadRuntime();
  const { runtime, runner, runs, finish, drain } = buildWorld(module);
  runtime.sessions.set("child-2", runner);
  runtime.dispatchBackgroundSubagent({
    subagentAgentId: "child-2", subagentType: "generalPurpose", toolCallId: "t2",
    prompt: "작업", run: () => runner.run("작업"),
  });
  finish("done");
  await drain();
  assert.equal(runtime.steerSubagent("child-2", "너무 늦은 지시"), "not-running");

  const second = buildWorld(module);
  second.runtime.sessions.set("child-3", second.runner);
  second.runtime.dispatchBackgroundSubagent({
    subagentAgentId: "child-3", subagentType: "generalPurpose", toolCallId: "t3",
    prompt: "작업", run: () => second.runner.run("작업"),
  });
  assert.equal(second.runtime.steerSubagent("child-3", "steer"), "ok");
  assert.equal(second.runtime.abortSubagent("child-3"), "ok");
  await second.drain();
  assert.equal(second.runs.length, 1, "an aborted child must never restart from a stale steer");
  const record = [...second.runtime.registryEntries()].find(([id]) => id === "child-3")?.[1];
  assert.equal(record?.status, "aborted");
});
