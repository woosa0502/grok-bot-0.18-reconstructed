import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const handlerPath = "source/packages/agent/actions/shell-command-action-handler.ts";
const formatterPath = "source/packages/agent/tools/core/shell/formatters.ts";
const sha256 = relativePath => createHash("sha256").update(readFileSync(path.join(root, relativePath))).digest("hex");
function recordEvidence(t, value) {
  const json = JSON.stringify(value);
  t.diagnostic(json);
  // Opt in only for an explicit artifact capture; TAP diagnostics escape bytes.
  if (process.env.MANUAL_SHELL_STATUS_EVIDENCE_PATH) {
    appendFileSync(process.env.MANUAL_SHELL_STATUS_EVIDENCE_PATH, json + "\n");
  }
}
const subjectPromise = (async () => {
  const compiled = await build({
    stdin: {
      contents: `
        export { ShellCommandActionHandler } from "./${handlerPath}";
        export { formatShellResult, formatShellResultDsv3 } from "./${formatterPath}";
        export { createContext } from "./source/packages/context/core.ts";
        export { fromRedactedShellOutput } from "./source/packages/redacted-protos/generated/agent/v1/agent_redacted.ts";
        export { createRedactedString } from "./source/packages/redaction/factory.ts";
        export { fromRedactedCoreMessages } from "./source/packages/redaction/core-message.ts";
        export { DataClassification, PrivacyCapability } from "./source/packages/redaction/classification.ts";
        export { PrivacyMode } from "./source/packages/redaction/privacy-mode.ts";
        export { ShellStream } from "./source/packages/proto/generated/agent/v1/shell_exec_pb.ts";
        export { ShellOutput } from "./source/packages/proto/generated/agent/v1/agent_pb.ts";
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
    filename: path.join(root, "manual-shell-terminal-status-test.cjs"),
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  wrapper(createRequire(path.join(root, "package.json")), module, module.exports);
  return module.exports;
})();

const outputEvents = [
  { event: "stdout", value: { data: "first stdout\n" } },
  { event: "stderr", value: { data: "interleaved stderr\n" } },
  { event: "stdout", value: { data: "last stdout\n" } },
];
const expectedStdout = "first stdout\nlast stdout\n";
const expectedStderr = "interleaved stderr\n";
const expectedCombined = "first stdout\ninterleaved stderr\nlast stdout\n";
const commandText = "fixture-only command; never executed";

async function runTrace(t, trace, { dsv3, execId } = {}) {
  const subject = await subjectPromise;
  const ctx = subject.createContext();
  const privacyMode = subject.PrivacyMode.NO_STORAGE;
  const recorded = [];
  const messages = [];
  const updates = [];
  const executeCalls = [];
  const executor = {
    execute(_ctx, args, options) {
      executeCalls.push({ command: args.command, skipApproval: args.skipApproval, execId: options.execId });
      if (trace.synchronousError) throw new Error(trace.synchronousError);
      return (async function* () {
        for (const input of trace.events) {
          yield new subject.ShellStream({ event: { case: input.event, value: input.value } });
        }
        if (trace.iteratorError) throw new Error(trace.iteratorError);
      })();
    },
  };
  const handler = new subject.ShellCommandActionHandler({}, { get: () => executor }, {
    sendUpdate: async (_ctx, update) => updates.push(update.message.value.event.case),
  }, {}, {});
  const structure = { marker: "fixture shell turn" };
  const returned = await handler.handle(ctx, {
    _privacyMode: privacyMode,
    execId,
    shellCommand: {
      _privacyMode: privacyMode,
      command: subject.createRedactedString(commandText, subject.DataClassification.CODE, "command", privacyMode),
    },
  }, {
    getMessages: () => [{ role: "system", content: "existing fixture message" }],
    appendMessages: incoming => messages.push(...subject.fromRedactedCoreMessages(incoming, subject.PrivacyCapability.UNSAFE_ALWAYS_ALLOWED)),
  }, {
    createShellTurn: async () => ({
      recordShellOutput: value => recorded.push(subject.fromRedactedShellOutput(value, subject.PrivacyCapability.UNSAFE_ALWAYS_ALLOWED)),
    }),
    isDsv3: () => dsv3,
    getPrivacyMode: () => privacyMode,
    computeNewStructure: async () => structure,
  }, [], () => {});
  assert.equal(returned, structure);
  assert.equal(recorded.length, 1);
  assert.equal(messages.length, 3);
  assert.deepEqual(executeCalls, [{ command: commandText, skipApproval: true, execId }]);
  const record = recorded[0];
  const roundTrip = subject.ShellOutput.fromBinary(record.toBinary());
  assert.equal(roundTrip.exitCode, record.exitCode, "the persisted status must survive the actual int32 protobuf wire format");
  const result = messages[2].content[0].result;
  const evidence = {
    scenario: trace.name,
    dsv3,
    execId: execId ?? null,
    input: trace,
    record: { stdout: record.stdout, stderr: record.stderr, exitCode: record.exitCode },
    wireExitCode: roundTrip.exitCode,
    updates,
    result,
  };
  recordEvidence(t, evidence);
  return { subject, record, result, updates };
}

test("manual shell evidence identifies the actual source and formatter", t => {
  recordEvidence(t, { node: process.version, handlerSha256: sha256(handlerPath), formatterSha256: sha256(formatterPath) });
});

for (const dsv3 of [false, true]) {
  const mode = dsv3 ? "dsv3" : "standard";
  for (const trace of [
    { name: "empty_eof", events: [] },
    { name: "output_eof", events: outputEvents },
    { name: "iterator_throw_before_output", events: [], iteratorError: "fixture transport disconnected" },
    { name: "iterator_throw_after_output", events: outputEvents, iteratorError: "fixture transport disconnected" },
    { name: "execute_throw", events: [], synchronousError: "fixture executor failed synchronously" },
  ]) {
    test(`manual shell ${mode}: ${trace.name} records an unknown result and preserves observed output`, async t => {
      const { record, result, updates } = await runTrace(t, trace, { dsv3 });
      assert.equal(record.exitCode, -1);
      assert.equal(record.stdout, trace.events.length ? expectedStdout : "");
      assert.equal(record.stderr, trace.events.length ? expectedStderr : "");
      assert.match(result, /Exit status was not observed/);
      assert.match(result, /result is unknown/);
      assert.doesNotMatch(result, /Command completed|Exit code: -1|Exit code: 0/);
      assert.deepEqual(updates, trace.events.map(input => input.event));
      if (trace.events.length) assert.ok(result.includes(expectedCombined));
      if (trace.iteratorError || trace.synchronousError) assert.match(result, /stream failed/);
    });
  }

  for (const code of [0, 23]) {
    test(`manual shell ${mode}: observed exit ${code} retains its ordinary formatter output`, async t => {
      const trace = { name: `exit_${code}`, events: [...outputEvents, { event: "exit", value: { code } }] };
      const { subject, record, result, updates } = await runTrace(t, trace, { dsv3 });
      assert.equal(record.exitCode, code);
      assert.equal(record.stdout, expectedStdout);
      assert.equal(record.stderr, expectedStderr);
      const expected = dsv3
        ? subject.formatShellResultDsv3({ combinedOutput: expectedCombined, exitCode: code, command: commandText }, commandText)
        : subject.formatShellResult({ combinedOutput: expectedCombined, exitCode: code });
      assert.equal(result, expected);
      assert.deepEqual(updates, ["stdout", "stderr", "stdout", "exit"]);
    });

    test(`manual shell ${mode}: an aborted exit ${code} does not claim successful completion`, async t => {
      const trace = { name: `aborted_exit_${code}`, events: [...outputEvents, { event: "exit", value: { code, aborted: true } }] };
      const { record, result } = await runTrace(t, trace, { dsv3 });
      assert.equal(record.exitCode, code === 0 ? -1 : code);
      assert.equal(record.stdout, expectedStdout);
      assert.equal(record.stderr, expectedStderr);
      assert.match(result, /Command aborted/);
      assert.ok(result.includes(`Observed exit code: ${code}`));
      assert.ok(result.includes(expectedCombined));
      assert.doesNotMatch(result, /Command completed|Exit code: -1|status was not observed/);
    });

    test(`manual shell ${mode}: a stream error after exit ${code} preserves the observed exit and flags stream failure`, async t => {
      const trace = { name: `throw_after_exit_${code}`, events: [...outputEvents, { event: "exit", value: { code } }], iteratorError: "fixture trailing stream failure" };
      const { record, result } = await runTrace(t, trace, { dsv3 });
      assert.equal(record.exitCode, code);
      assert.equal(record.stdout, expectedStdout);
      assert.equal(record.stderr, expectedStderr);
      assert.ok(result.includes(`Observed exit code: ${code}`));
      assert.match(result, /stream failed after an exit event/);
      assert.match(result, /stream result is unconfirmed/);
      assert.ok(result.includes(expectedCombined));
      assert.doesNotMatch(result, /Command completed|status was not observed/);
    });
  }

  test(`manual shell ${mode}: an execId suppresses duplicate updates while preserving unknown output`, async t => {
    const trace = { name: "exec_id_output_eof", events: outputEvents };
    const { record, result, updates } = await runTrace(t, trace, { dsv3, execId: "fixture-exec-id" });
    assert.equal(record.exitCode, -1);
    assert.equal(record.stdout, expectedStdout);
    assert.equal(record.stderr, expectedStderr);
    assert.match(result, /Exit status was not observed/);
    assert.deepEqual(updates, []);
  });
}
