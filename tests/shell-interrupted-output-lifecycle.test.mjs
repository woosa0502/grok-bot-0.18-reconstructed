import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const subjectPromise = (async () => {
  const compiled = await build({
    stdin: {
      contents: `
        export { createShellTool } from "./source/packages/agent/tools/core/shell/create-shell-tool.ts";
        export { createContext } from "./source/packages/context/core.ts";
        export { getInterruptedShellOutputSnapshot, clearInterruptedShellOutputSnapshot } from "./source/packages/agent/tools/core/shell/interrupted-shell-output.ts";
        export { buildInterruptedPendingToolCallMessages } from "./source/packages/agent/actions/user-message-action/interrupted-tool-reconstruction.ts";
        export { fromRedactedCoreMessages } from "./source/packages/redaction/core-message.ts";
        export { PrivacyMode } from "./source/packages/redaction/privacy-mode.ts";
        export { PrivacyCapability } from "./source/packages/redaction/classification.ts";
        export { ShellStream, ShellAbortReason } from "./source/packages/proto/generated/agent/v1/shell_exec_pb.ts";
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    target: "node26",
    write: false,
    logLevel: "silent",
  });
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${compiled.outputFiles[0].text}\n})`, {
    filename: path.join(root, "shell-interrupted-output-test.cjs"),
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  wrapper(createRequire(path.join(root, "package.json")), module, module.exports);
  return module.exports;
})();

let nextId = 0;

async function fixture(t, scenario, { toolCallId = `shell-output-test-${++nextId}`, interaction = {}, ...options } = {}) {
  const subject = await subjectPromise;
  const [ctx, cancel] = subject.createContext().withCancel();
  const event = (kind, value) => new subject.ShellStream({ event: { case: kind, value } });
  const executor = {
    async *execute(executionCtx) {
      yield* scenario({ ctx: executionCtx, cancel, event, subject });
    },
  };
  const tool = subject.createShellTool({ get: () => executor }, options);
  t.after(() => subject.clearInterruptedShellOutputSnapshot(toolCallId));
  return {
    subject,
    tool,
    toolCallId,
    snapshot: () => subject.getInterruptedShellOutputSnapshot(toolCallId),
    run: () => tool.execute(ctx, {
      getAbortSignal: context => context.signal,
      emitPartialToolCall: async () => {},
      executeToolCall: async (context, _call, _id, execute) => execute(context),
      ...interaction,
    }, (async function* () { yield JSON.stringify({ command: "printf fixture-only" }); })(), { toolCallId }),
    reconstruct: () => {
      const messages = subject.buildInterruptedPendingToolCallMessages({
        getRawPendingMessages: () => [{
          unwrap: () => JSON.stringify({ role: "assistant", content: [{ type: "tool-call", toolCallId, toolName: tool.name, args: {} }] }),
        }],
        getPrivacyMode: () => subject.PrivacyMode.NO_STORAGE,
      }, [tool], undefined, undefined);
      return subject.fromRedactedCoreMessages(messages, subject.PrivacyCapability.UNSAFE_ALWAYS_ALLOWED)[1].content[0];
    },
  };
}

test("cancelled shell output reaches the next-turn reconstruction once, in stream order", async t => {
  const shell = await fixture(t, async function* ({ cancel, event }) {
    yield event("stdout", { data: "STEP_COMPLETED=result-7\n" });
    yield event("stderr", { data: "NEXT_STEP_STARTED\n" });
    yield event("stdout", { data: "LAST_STDOUT\n" });
    cancel();
    throw new DOMException("fixture cancellation", "AbortError");
  });
  await assert.rejects(shell.run(), { name: "AbortError" });
  assert.equal(shell.snapshot(), "STEP_COMPLETED=result-7\nNEXT_STEP_STARTED\nLAST_STDOUT\n");
  const restored = shell.reconstruct();
  assert.match(restored.result, /Output collected before interruption/);
  assert.match(restored.result, /STEP_COMPLETED=result-7\nNEXT_STEP_STARTED\nLAST_STDOUT/);
  assert.equal(restored.experimental_content[0].text, restored.result);
  assert.equal(shell.snapshot(), undefined, "the reconstruction consumes the snapshot");
  assert.doesNotMatch(shell.reconstruct().result, /STEP_COMPLETED|Output collected/);
});

test("a received chunk survives an observer that rejects before normal accumulation", async t => {
  const failure = new Error("stream observer failed");
  const shell = await fixture(t, async function* ({ event }) {
    yield event("stderr", { data: "received-before-observer-error\n" });
  }, { onStreamEvent: async () => { throw failure; } });
  await assert.rejects(shell.run(), error => error === failure);
  assert.equal(shell.snapshot(), "received-before-observer-error\n");
});

test("a late stream chunk cannot recreate a snapshot already consumed by reconstruction", async t => {
  let restored;
  let observations = 0;
  const shell = await fixture(t, async function* ({ cancel, event }) {
    yield event("stdout", { data: "available-at-interruption\n" });
    cancel();
    yield event("stderr", { data: "late-after-reconstruction\n" });
    throw new DOMException("fixture cancellation", "AbortError");
  }, {
    onStreamEvent: async () => {
      if (++observations === 1) restored = shell.reconstruct();
    },
  });
  await assert.rejects(shell.run(), { name: "AbortError" });
  assert.match(restored.result, /available-at-interruption/);
  assert.equal(shell.snapshot(), undefined);
});

test("unexpected stream closure keeps collected output available for recovery", async t => {
  const shell = await fixture(t, async function* ({ event }) {
    yield event("stdout", { data: "remote-work-completed\n" });
  });
  await assert.rejects(shell.run(), /without an exit event/);
  assert.equal(shell.snapshot(), "remote-work-completed\n");
});

test("interaction failure after shell completion preserves the snapshot", async t => {
  const failure = new Error("result delivery failed");
  const shell = await fixture(t, async function* ({ event }) {
    yield event("stdout", { data: "completed-but-not-delivered\n" });
    yield event("exit", { code: 0, cwd: "/fixture" });
  }, {
    interaction: {
      executeToolCall: async (ctx, _call, _id, execute) => {
        await execute(ctx);
        throw failure;
      },
    },
  });
  await assert.rejects(shell.run(), error => error === failure);
  assert.equal(shell.snapshot(), "completed-but-not-delivered\n");
});

for (const exitCode of [0, 7]) {
  test(`delivered exit ${exitCode} preserves the full ordinary result and clears its snapshot`, async t => {
    const stdout = "ordinary-output\n".repeat(2_000);
    const stderr = "ordinary-stderr\n";
    let beforeDelivery;
    const shell = await fixture(t, async function* ({ event }) {
      yield event("stdout", { data: stdout });
      yield event("stderr", { data: stderr });
      yield event("exit", { code: exitCode, cwd: "/fixture", localExecutionTimeMs: 9 });
    }, {
      interaction: {
        executeToolCall: async (ctx, _call, _id, execute) => {
          const result = await execute(ctx);
          beforeDelivery = shell.snapshot();
          return result;
        },
      },
    });
    const result = await shell.run();
    assert.equal(result.result.case, exitCode === 0 ? "success" : "failure");
    assert.equal(result.result.value.stdout, stdout);
    assert.equal(result.result.value.stderr, stderr);
    assert.equal(result.result.value.interleavedOutput, stdout + stderr);
    assert.equal(result.result.value.workingDirectory, "/fixture");
    assert.equal(beforeDelivery, (stdout + stderr).slice(-20_000));
    assert.equal(shell.snapshot(), undefined);
  });
}

test("a delivered background result includes its output and releases the snapshot", async t => {
  const shell = await fixture(t, async function* ({ event }) {
    yield event("stdout", { data: "background-started\n" });
    yield event("backgrounded", { shellId: 41, command: "printf fixture-only", workingDirectory: "/fixture" });
  });
  const result = await shell.run();
  assert.equal(result.isBackground, true);
  assert.equal(result.result.value.shellId, 41);
  assert.equal(result.result.value.stdout, "background-started\n");
  assert.equal(shell.snapshot(), undefined);
});

test("an aborted exit retains output even when the interaction resolves", async t => {
  const shell = await fixture(t, async function* ({ event, subject }) {
    yield event("stdout", { data: "aborted-result-output\n" });
    yield event("exit", { code: 143, aborted: true, abortReason: subject.ShellAbortReason.USER_ABORT });
  });
  const result = await shell.run();
  assert.equal(result.result.case, "failure");
  assert.equal(result.result.value.aborted, true);
  assert.equal(shell.snapshot(), "aborted-result-output\n");
});

test("cancellation alongside a normal exit retains output for a pending turn", async t => {
  const shell = await fixture(t, async function* ({ cancel, event }) {
    yield event("stdout", { data: "exit-cancellation-race\n" });
    cancel();
    yield event("exit", { code: 0 });
  });
  await shell.run();
  assert.equal(shell.snapshot(), "exit-cancellation-race\n");
});

test("retained output is bounded per tool call and does not leak across calls or retries", async t => {
  const suffix = "newest-interrupted-output\n";
  const first = await fixture(t, async function* ({ event }) {
    yield event("stdout", { data: "old-output".repeat(3_000) });
    yield event("stderr", { data: suffix });
    throw new Error("first disconnected");
  });
  await assert.rejects(first.run(), /first disconnected/);
  assert.equal(first.snapshot(), ("old-output".repeat(3_000) + suffix).slice(-20_000));

  const second = await fixture(t, async function* ({ event }) {
    yield event("stderr", { data: "independent-tool-output\n" });
    throw new Error("second disconnected");
  });
  await assert.rejects(second.run(), /second disconnected/);
  assert.equal(second.snapshot(), "independent-tool-output\n");
  assert.ok(first.snapshot().endsWith(suffix));

  const retry = await fixture(t, async function* () {
    throw new Error("retry disconnected before output");
  }, { toolCallId: first.toolCallId });
  await assert.rejects(retry.run(), /retry disconnected/);
  assert.equal(retry.snapshot(), "", "a fresh execution replaces an older snapshot with the same id");
  assert.equal(second.snapshot(), "independent-tool-output\n");
});
