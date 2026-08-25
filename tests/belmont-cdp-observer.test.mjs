import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BelmontCdpError,
  discoverBelmontTarget,
  observeBelmontPlan,
  validateBelmontCdpPlan,
} from "../scripts/lib/belmont-cdp-observer.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function plan(caseId = "BELMONT-CDP-TEST") {
  return {
    schemaVersion: 1,
    caseId,
    expectedBehavior: "The existing Belmont prompt remains visible.",
    steps: [
      { action: "assert", locator: { role: "textbox", name: "Prompt" }, expect: { visible: true } },
      { action: "snapshot", name: "prompt-visible" },
      { action: "screenshot", name: "prompt-visible" },
    ],
  };
}

function runtimeLineage(runtimeGenerationId = "runtime-a") {
  const head = "1".repeat(40);
  const sourceIdentitySha256 = "2".repeat(64);
  return {
    schemaVersion: 1,
    runtimeGenerationId,
    capturedAt: "2026-08-25T00:00:00.000Z",
    repoRoot: repositoryRoot,
    appRoot: path.join(repositoryRoot, ".build", "belmont-wsl-runtime"),
    profileDir: path.join(repositoryRoot, ".cache", "belmont-wsl-profile"),
    debugEndpoint: "http://127.0.0.1:9347",
    git: { head, treeClean: true, treeStatus: [], treeStatusSha256: "0".repeat(64), sourceIdentitySha256 },
    processes: {
      runner: { pid: 101, startedAt: "2026-08-25T00:00:00.000Z" },
      host: { pid: 102, startedAt: "2026-08-25T00:00:01.000Z" },
      electron: { pid: 103, startedAt: "2026-08-25T00:00:02.000Z" },
    },
    build: { source: { sourceIdentity: { head, combinedSha256: sourceIdentitySha256 } } },
  };
}

class FakeClient {
  constructor(targetId = "target-a") {
    this.endpoint = "http://127.0.0.1:9347";
    this.target = { id: targetId, title: "Grok Bot", url: "file:///workspace/Belmont/.build/belmont-wsl-runtime/dist/renderer/index.html" };
    this.events = [];
    this.sent = [];
  }

  clearEvents() { this.events.length = 0; }
  async send(method, params) {
    this.sent.push({ method, params });
    if (method === "DOM.getDocument") return { root: { nodeId: 7 } };
    if (method === "DOM.querySelectorAll") return { nodeIds: [11] };
    return {};
  }
  async screenshot(filePath) { await writeFile(filePath, Buffer.from("fake-png")); }
  async evaluate(expression) {
    if (expression.includes('const operation = "snapshot"')) {
      return { title: "Grok Bot", url: this.target.url, readyState: "complete", bodyText: "", activeElement: null, interactive: [], dimensions: { width: 1040, height: 760, devicePixelRatio: 1 } };
    }
    return { matches: 1, selected: { tag: "DIV", role: "textbox", name: "Prompt", text: "", value: null, visible: true, enabled: true, rect: { x: 1, y: 1, width: 10, height: 10 } } };
  }
}

test("CDP discovery attaches only to a loopback Belmont page", async () => {
  const fakeFetch = async (url) => {
    assert.equal(String(url), "http://127.0.0.1:9347/json/list");
    return new Response(JSON.stringify([
    { id: "other", type: "page", title: "Example", url: "https://example.com", webSocketDebuggerUrl: "ws://127.0.0.1:9347/devtools/page/other" },
    { id: "belmont", type: "page", title: "Grok Bot", url: "file:///workspace/Belmont/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9347/devtools/page/belmont" },
    ]), { status: 200 });
  };
  const result = await discoverBelmontTarget("http://127.0.0.1:9347", fakeFetch);
  assert.equal(result.target.id, "belmont");
  await assert.rejects(() => discoverBelmontTarget("http://192.0.2.1:9347", fakeFetch), error => error instanceof BelmontCdpError && error.code === "NON_LOOPBACK_ENDPOINT");
  await assert.rejects(
    () => discoverBelmontTarget("http://127.0.0.1:9347", async () => new Response(JSON.stringify([
      { id: "belmont-a", type: "page", title: "Grok Bot", url: "file:///Belmont/a.html", webSocketDebuggerUrl: "ws://127.0.0.1/a" },
      { id: "belmont-b", type: "page", title: "Belmont", url: "file:///Belmont/b.html", webSocketDebuggerUrl: "ws://127.0.0.1/b" },
    ]), { status: 200 })),
    error => error instanceof BelmontCdpError && error.code === "MULTIPLE_BELMONT_TARGETS",
  );
  await assert.rejects(
    () => discoverBelmontTarget("http://127.0.0.1:9347", async () => new Response(JSON.stringify([
      { id: "legacy", type: "page", title: "Grok Bot", url: "file:///old-grok-build/index.html", webSocketDebuggerUrl: "ws://127.0.0.1/legacy" },
    ]), { status: 200 })),
    error => error instanceof BelmontCdpError && error.code === "BELMONT_TARGET_NOT_FOUND",
  );
});

test("plan validation rejects arbitrary evaluation and unsafe case identifiers", () => {
  assert.equal(validateBelmontCdpPlan(plan()).caseId, "BELMONT-CDP-TEST");
  assert.throws(() => validateBelmontCdpPlan({ schemaVersion: 1, caseId: "../escape", steps: [{ action: "wait", ms: 1 }] }), /safe, stable identifier/u);
  assert.throws(() => validateBelmontCdpPlan({ schemaVersion: 1, caseId: "CASE-1", steps: [{ action: "evaluate", expression: "document.body.remove()" }] }), /Unsupported step/u);
});

test("observer stores evidence and a provisional result without self-approving product PASS", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-observer-"));
  try {
    const record = await observeBelmontPlan({ client: new FakeClient(), plan: plan(), runDir, runtimeLineage: runtimeLineage() });
    assert.equal(record.executionStatus, "ACTION_COMPLETE");
    assert.equal(record.provisionalVerdict, "PROVISIONAL_PASS");
    assert.equal(record.finalVerdict, undefined);
    await access(record.evidence.beforeScreenshot);
    await access(record.evidence.afterScreenshot);
    const ledger = (await readFile(path.join(runDir, "observations.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].caseId, "BELMONT-CDP-TEST");
    const checkpoint = JSON.parse(await readFile(path.join(runDir, "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.finalVerdictStillRequired, true);
    const run = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8"));
    assert.equal(run.schemaVersion, 2);
    assert.equal(run.runtimeLineage.git.head, "1".repeat(40));
    assert.equal(run.runtimeLineage.profileDir, path.join(repositoryRoot, ".cache", "belmont-wsl-profile"));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("observer refuses to mix a different Electron target into one run directory", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-generation-"));
  try {
    await observeBelmontPlan({ client: new FakeClient("target-a"), plan: plan("CASE-A"), runDir, runtimeLineage: runtimeLineage() });
    await assert.rejects(
      () => observeBelmontPlan({ client: new FakeClient("target-b"), plan: plan("CASE-B"), runDir, runtimeLineage: runtimeLineage() }),
      error => error instanceof BelmontCdpError && error.code === "RUN_GENERATION_CHANGED",
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("observer refuses missing, mismatched, or changed runtime lineage", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-lineage-"));
  try {
    await assert.rejects(
      () => observeBelmontPlan({ client: new FakeClient(), plan: plan("CASE-NO-LINEAGE"), runDir }),
      error => error instanceof BelmontCdpError && error.code === "RUN_LINEAGE_REQUIRED",
    );
    await assert.rejects(
      () => observeBelmontPlan({ client: new FakeClient(), plan: plan("CASE-BAD-ENDPOINT"), runDir, runtimeLineage: { ...runtimeLineage(), debugEndpoint: "http://127.0.0.1:9999" } }),
      error => error instanceof BelmontCdpError && error.code === "RUN_LINEAGE_MISMATCH",
    );
    await observeBelmontPlan({ client: new FakeClient(), plan: plan("CASE-A"), runDir, runtimeLineage: runtimeLineage("runtime-a") });
    await assert.rejects(
      () => observeBelmontPlan({ client: new FakeClient(), plan: plan("CASE-B"), runDir, runtimeLineage: runtimeLineage("runtime-b") }),
      error => error instanceof BelmontCdpError && error.code === "RUN_GENERATION_CHANGED",
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("observer sends punctuation shortcuts through CDP instead of rejecting them", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-punctuation-"));
  const client = new FakeClient();
  const keys = ["[", "]", "=", "-", ",", "+", ";", "'", "\\", "/", "`", ".", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")"];
  try {
    const record = await observeBelmontPlan({
      client,
      plan: { schemaVersion: 1, caseId: "PUNCTUATION-SHORTCUTS", steps: keys.map(key => ({ action: "press", key, modifiers: ["CTRL"] })) },
      runDir,
      runtimeLineage: runtimeLineage(),
    });
    assert.equal(record.executionStatus, "ACTION_COMPLETE");
    const keyDown = client.sent.filter(call => call.method === "Input.dispatchKeyEvent" && call.params.type === "rawKeyDown");
    assert.deepEqual(keyDown.map(call => call.params.key), keys);
    assert.deepEqual(keyDown.map(call => call.params.code), ["BracketLeft", "BracketRight", "Equal", "Minus", "Comma", "Equal", "Semicolon", "Quote", "Backslash", "Slash", "Backquote", "Period", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"]);
    assert.ok(keyDown.every(call => call.params.modifiers === 2));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("observer sends function key shortcuts through CDP instead of rejecting them", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-fkeys-"));
  const client = new FakeClient();
  const keys = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
  try {
    const record = await observeBelmontPlan({
      client,
      plan: { schemaVersion: 1, caseId: "FUNCTION-KEY-SHORTCUTS", steps: keys.map(key => ({ action: "press", key, modifiers: ["SHIFT"] })) },
      runDir,
      runtimeLineage: runtimeLineage(),
    });
    assert.equal(record.executionStatus, "ACTION_COMPLETE");
    const keyDown = client.sent.filter(call => call.method === "Input.dispatchKeyEvent" && call.params.type === "rawKeyDown");
    assert.deepEqual(keyDown.map(call => call.params.key), keys);
    assert.deepEqual(keyDown.map(call => call.params.code), keys);
    assert.deepEqual(keyDown.map(call => call.params.windowsVirtualKeyCode), [112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123]);
    assert.ok(keyDown.every(call => call.params.modifiers === 8));
    assert.ok(keyDown.every(call => call.params.text === ""));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("click and hover steps forward modifier keys to the dispatched mouse events", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-click-modifiers-"));
  const client = new FakeClient();
  try {
    const record = await observeBelmontPlan({
      client,
      plan: {
        schemaVersion: 1,
        caseId: "CLICK-MODIFIERS",
        steps: [
          { action: "hover", locator: { role: "button", name: "Row" }, modifiers: ["SHIFT"] },
          { action: "click", locator: { role: "button", name: "Row" }, modifiers: ["CTRL"] },
        ],
      },
      runDir,
      runtimeLineage: runtimeLineage(),
    });
    assert.equal(record.executionStatus, "ACTION_COMPLETE");
    const moves = client.sent.filter(call => call.method === "Input.dispatchMouseEvent" && call.params.type === "mouseMoved");
    assert.ok(moves.length >= 3, "hover settles with a pre-move plus the landing move for both steps");
    assert.ok(moves.slice(0, 2).every(call => call.params.modifiers === 8), "hover step carries SHIFT (8) on both its settle and landing moves");
    const pressed = client.sent.find(call => call.method === "Input.dispatchMouseEvent" && call.params.type === "mousePressed");
    const released = client.sent.find(call => call.method === "Input.dispatchMouseEvent" && call.params.type === "mouseReleased");
    assert.equal(pressed.params.modifiers, 2, "click step carries CTRL (2)");
    assert.equal(released.params.modifiers, 2, "click step carries CTRL (2)");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("click and hover steps reject unknown modifier names", () => {
  assert.throws(
    () => validateBelmontCdpPlan({ schemaVersion: 1, caseId: "BAD-MODIFIER", steps: [{ action: "click", locator: { role: "button", name: "Row" }, modifiers: ["OPTION"] }] }),
    BelmontCdpError,
  );
});

test("observer uploads explicit regular files through a hidden file input", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-upload-"));
  const fixture = path.join(runDir, "fixture.txt");
  const client = new FakeClient();
  try {
    await writeFile(fixture, "fixture\n");
    const record = await observeBelmontPlan({
      client,
      plan: {
        schemaVersion: 1,
        caseId: "FILE-UPLOAD",
        steps: [{ action: "upload", locator: { css: "input[type=file]", includeHidden: true }, files: [fixture] }],
      },
      runDir,
      runtimeLineage: runtimeLineage(),
    });
    assert.equal(record.executionStatus, "ACTION_COMPLETE");
    assert.deepEqual(client.sent.find(call => call.method === "DOM.querySelectorAll")?.params, { nodeId: 7, selector: "input[type=file]" });
    assert.deepEqual(client.sent.find(call => call.method === "DOM.setFileInputFiles")?.params, { files: [fixture], nodeId: 11 });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("upload plans reject non-absolute paths and missing files", async () => {
  assert.throws(
    () => validateBelmontCdpPlan({ schemaVersion: 1, caseId: "BAD-UPLOAD", steps: [{ action: "upload", locator: { css: "input[type=file]" }, files: ["fixture.txt"] }] }),
    /absolute file paths/u,
  );
  const runDir = await mkdtemp(path.join(os.tmpdir(), "belmont-cdp-upload-missing-"));
  try {
    const record = await observeBelmontPlan({
      client: new FakeClient(),
      plan: { schemaVersion: 1, caseId: "MISSING-UPLOAD", steps: [{ action: "upload", locator: { css: "input[type=file]" }, files: [path.join(runDir, "missing.txt")] }] },
      runDir,
      runtimeLineage: runtimeLineage(),
    });
    assert.equal(record.executionStatus, "HARNESS_ERROR");
    assert.equal(record.error.code, "UPLOAD_FILE_UNAVAILABLE");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("CDP observer stays independent from Belmont product process ownership", async () => {
  const cli = await readFile(path.join(repositoryRoot, "scripts", "belmont-cdp.mjs"), "utf8");
  const observer = await readFile(path.join(repositoryRoot, "scripts", "lib", "belmont-cdp-observer.mjs"), "utf8");
  assert.doesNotMatch(`${cli}\n${observer}`, /spawn\(|execFile\(|process\.kill|run-wsl|wsl-runtime-lock|BELMONT_WSL_PROFILE/u);
  assert.match(observer, /loopback endpoints only/u);
  assert.match(observer, /finalVerdictStillRequired: true/u);
});
