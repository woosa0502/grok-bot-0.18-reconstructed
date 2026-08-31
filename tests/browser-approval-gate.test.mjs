// A8: the browser tools' sensitive-action approval cards. When a real
// approval gate is wired, the model-facing confirmed flag is stripped, a
// driver "Sensitive action blocked" result raises a card, the user's Allow
// re-runs the SAME action with the host-owned hostApproved flag (clobbered
// after the args spread so the model cannot inject it), and a denial is the
// final answer. Without a gate, the armed-confirmed fallback stays intact.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadTools() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "browser-approval-entry.ts",
      contents: `
        export { createSandBrowserTools } from "./source/host/runner/tools/sand-browser-tools.js";
        export { SAND_BROWSER_RESULT_MARKER } from "./source/host/runner/tools/sand-browser-driver-source.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
    banner: { js: 'import { createRequire as __belmontCreateRequire } from "node:module";\nconst require = __belmontCreateRequire(import.meta.url);' },
  });
  const dir = path.join(repoRoot, "node_modules", ".cache", "belmont-tests");
  await mkdir(dir, { recursive: true });
  const bundlePath = path.join(dir, `approval-gate-${process.pid}.mjs`);
  await writeFile(bundlePath, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(bundlePath, { force: true });
  }
}

const modulePromise = loadTools();

const BLOCK_TEXT = 'Sensitive action blocked (payment/money control "결제하기"). Payment, money-transfer, and login/signup submissions run only with the user\'s explicit go-ahead: report this block to the user, wait for their approval in chat, then retry the same call with "confirmed": true.';

/**
 * A scripted driver substrate: each executeShell call decodes the driver
 * request from the command's base64 argument and answers from the script.
 */
function buildHarness({ script, gate }) {
  const shellCalls = [];
  const dependencies = {
    resourceAccessor: { get: () => undefined },
    getWindowIndex: async () => 7,
    getBoxId: () => "agent-1",
    getDefaultViewId: () => "agent-1",
    uploadFile: async () => undefined,
    downloadFile: async () => new Uint8Array(),
    async executeShell(_context, input) {
      const encoded = input.command.split(" ").at(-1);
      const request = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      shellCalls.push(request);
      const respond = script[shellCalls.length - 1] ?? { ok: true, summary: "Done." };
      const { SAND_BROWSER_RESULT_MARKER } = harness.module;
      return { case: "success", exitCode: 0, stdout: `\n${SAND_BROWSER_RESULT_MARKER}${JSON.stringify(respond)}\n`, stderr: "" };
    },
    ...(gate === undefined ? {} : { sensitiveApprovalGate: gate }),
  };
  const harness = { shellCalls, dependencies, module: null };
  return harness;
}

function clickTool(module, dependencies) {
  const tool = module.createSandBrowserTools(dependencies).find((definition) => definition.name === "browser_click");
  assert.ok(tool, "browser_click definition exists");
  return tool;
}

test("an approved card re-runs the same action with the host-owned flag", async () => {
  const module = await modulePromise;
  const approvals = [];
  const gate = {
    requestApproval: async (request) => {
      approvals.push(request);
      return { approved: true };
    },
  };
  const harness = buildHarness({
    script: [
      { ok: false, error: BLOCK_TEXT },
      { ok: true, summary: "Clicked e4", url: "https://x.test/", title: "PAID" },
    ],
    gate,
  });
  harness.module = module;
  const tool = clickTool(module, harness.dependencies);

  // The model tries to self-approve; both flags must be stripped.
  const output = await tool.execute({}, { ref: "e4", confirmed: true, hostApproved: true }, { toolCallId: "call1" });
  assert.equal(output.isError, undefined);
  assert.match(output.text, /Clicked e4/);

  assert.equal(harness.shellCalls.length, 2);
  const [first, second] = harness.shellCalls;
  assert.equal(first.confirmed, undefined, "model confirmed must be stripped when a gate is wired");
  assert.equal(first.hostApproved, false, "hostApproved is host-clobbered to false on the first attempt");
  assert.equal(second.hostApproved, true, "the approved retry carries the host-owned flag");
  assert.equal(second.confirmed, undefined);
  assert.equal(second.ref, "e4");

  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].surface, "computer");
  assert.match(approvals[0].summary, /^Browser click: payment\/money control/);
  assert.match(approvals[0].reason, /held for your approval/);
  assert.match(approvals[0].command, /"tool":"browser_click"/);
});

test("a denied card is the final answer, verbatim", async () => {
  const module = await modulePromise;
  const gate = { requestApproval: async () => ({ approved: false, reason: "Auto-review blocked this action: the user denied it." }) };
  const harness = buildHarness({ script: [{ ok: false, error: BLOCK_TEXT }], gate });
  harness.module = module;
  const tool = clickTool(module, harness.dependencies);

  const output = await tool.execute({}, { ref: "e4" }, { toolCallId: "call2" });
  assert.equal(output.isError, true);
  assert.match(output.text, /the user denied it/);
  assert.equal(harness.shellCalls.length, 1, "a denial must not re-run the action");
});

test("a non-sensitive error raises no card, and without a gate the block passes through", async () => {
  const module = await modulePromise;
  let raised = 0;
  const gate = { requestApproval: async () => { raised += 1; return { approved: true }; } };
  const errorHarness = buildHarness({ script: [{ ok: false, error: "Unknown or stale ref \"e9\"." }], gate });
  errorHarness.module = module;
  const output = await clickTool(module, errorHarness.dependencies).execute({}, { ref: "e9" }, { toolCallId: "call3" });
  assert.equal(output.isError, true);
  assert.equal(raised, 0, "ordinary errors never raise approval cards");

  // No gate wired: the armed-confirmed protocol survives untouched — the
  // block text reaches the model and confirmed is NOT stripped.
  const bare = buildHarness({ script: [{ ok: false, error: BLOCK_TEXT }] });
  bare.module = module;
  const blocked = await clickTool(module, bare.dependencies).execute({}, { ref: "e4", confirmed: true }, { toolCallId: "call4" });
  assert.equal(blocked.isError, true);
  assert.match(blocked.text, /Sensitive action blocked/);
  assert.equal(bare.shellCalls[0].confirmed, true, "without a gate the model flag still reaches the driver (armed contract)");
  assert.equal(bare.shellCalls[0].hostApproved, false, "hostApproved is still clobbered even without a gate");
});
