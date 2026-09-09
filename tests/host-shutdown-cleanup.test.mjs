import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  absWorkingDir: repoRoot,
  stdin: { contents: "export * from './source/host/shutdown-cleanup.ts';", resolveDir: repoRoot },
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
});
const { runCleanupSteps, perStepTimeout, CleanupStepTimeoutError } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("a rejecting step never skips the steps after it, and the failure is reported once", async () => {
  const order = [];
  const failures = [];
  const report = await runCleanupSteps([
    { name: "gateway_close", run: async () => { order.push("gateway_close"); throw new Error("socket already gone"); } },
    { name: "host_dispose", run: async () => { order.push("host_dispose"); } },
    { name: "box_exec_daemon_close", run: () => { order.push("box_exec_daemon_close"); } },
    { name: "gateway_discovery_clear", run: async () => { order.push("gateway_discovery_clear"); } },
  ], { onFailure: (outcome) => failures.push(outcome) });
  assert.deepEqual(order, ["gateway_close", "host_dispose", "box_exec_daemon_close", "gateway_discovery_clear"]);
  assert.deepEqual(report.failed.map((o) => o.name), ["gateway_close"]);
  assert.equal(failures.length, 1);
  assert.match(String(failures[0].error), /socket already gone/);
  assert.equal(report.outcomes.length, 4);
});

test("a hanging step is timed out, recorded as such, and the remaining steps still run", async () => {
  const order = [];
  let release;
  const report = await runCleanupSteps([
    { name: "host_dispose", run: () => new Promise((resolve) => { release = resolve; order.push("host_dispose"); }) },
    { name: "box_exec_daemon_close", run: () => { order.push("box_exec_daemon_close"); } },
  ], { stepTimeoutMs: 25 });
  assert.deepEqual(order, ["host_dispose", "box_exec_daemon_close"]);
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].name, "host_dispose");
  assert.equal(report.failed[0].timedOut, true);
  assert.ok(report.failed[0].error instanceof CleanupStepTimeoutError);
  release();
});

test("a synchronous throw is contained like a rejection", async () => {
  const report = await runCleanupSteps([
    { name: "sync_throw", run: () => { throw new Error("boom"); } },
    { name: "after", run: () => undefined },
  ]);
  assert.deepEqual(report.outcomes.map((o) => [o.name, o.ok]), [["sync_throw", false], ["after", true]]);
});

test("all steps succeeding reports no failure", async () => {
  const report = await runCleanupSteps([{ name: "a", run: async () => undefined }, { name: "b", run: () => undefined }]);
  assert.equal(report.failed.length, 0);
  assert.ok(report.outcomes.every((o) => o.ok));
});

test("per-step timeouts share the watchdog budget with a floor", () => {
  assert.equal(perStepTimeout(5000, 4), 1250);
  assert.equal(perStepTimeout(1000, 4), 500);
  assert.equal(perStepTimeout(1000, 0), 1000);
});
