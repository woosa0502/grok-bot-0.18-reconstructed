import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = filename => stat(filename).then(() => true, () => false);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function loadRuntime() {
  const result = await build({
    stdin: { resolveDir: repoRoot, loader: "ts", contents: `
      export { BoxExecRuntime } from "./source/box-exec-daemon/server.js";
      export { ReadArgs } from "./source/packages/proto/generated/agent/v1/read_exec_pb.js";
      export { WriteArgs } from "./source/packages/proto/generated/agent/v1/write_exec_pb.js";
      export { ShellArgs, TimeoutBehavior } from "./source/packages/proto/generated/agent/v1/shell_exec_pb.js";
      export { createReadTool } from "./source/packages/agent/tools/core/read/read.js";
      export { readExecutorResource } from "./source/packages/agent-exec/read.js";
      export { createContext } from "./source/packages/context/core.js";
    ` },
    bundle: true, format: "esm", platform: "node", write: false, packages: "external",
    supported: { using: false },
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const directory = path.join(repoRoot, "node_modules/.cache/belmont-tests");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `box-runtime-strict-${process.pid}.mjs`);
  await writeFile(filename, result.outputFiles[0].text);
  try { return await import(pathToFileURL(filename).href); }
  finally { await rm(filename, { force: true }); }
}

const runtimeModule = loadRuntime();

async function world(t, environment = {}) {
  const { BoxExecRuntime } = await runtimeModule;
  const root = await mkdtemp(path.join(tmpdir(), "belmont-box-strict-"));
  const workspace = path.join(root, "workspace");
  const terminals = path.join(root, "terminals");
  await mkdir(workspace);
  await mkdir(terminals);
  const runtime = new BoxExecRuntime(workspace, terminals, { PATH: process.env.PATH ?? "/usr/bin:/bin", ...environment });
  t.after(async () => { await runtime.stop(); await rm(root, { recursive: true, force: true }); });
  return { runtime, root, workspace, terminals };
}

async function stream(runtime, command, options = {}, signal = new AbortController().signal) {
  const { ShellArgs } = await runtimeModule;
  const events = [];
  for await (const item of runtime.shellStream({ id: 1, execId: "strict-fixture" }, new ShellArgs({ command, ...options }), signal)) {
    events.push(item.element.value.message.value.event);
  }
  return events;
}

async function waitUntil(predicate, description, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, `${description} did not complete`);
    await pause(10);
  }
}

async function hooks(workspace, step, entries) {
  await mkdir(path.join(workspace, ".cursor"), { recursive: true });
  await writeFile(path.join(workspace, ".cursor/hooks.json"), JSON.stringify({ version: 1, hooks: { [step]: entries } }));
}

const hookRequest = { request: { request: { case: "preToolUse", value: { toolName: "Read", toolInput: {} } } } };

test("Box Read uses the public 1-based and negative range contract, including rendered numbering", async t => {
  const { ReadArgs, createReadTool, readExecutorResource, createContext } = await runtimeModule;
  const { runtime, workspace } = await world(t);
  await writeFile(path.join(workspace, "lines.txt"), "alpha\nbeta\ngamma\ndelta");
  const cases = [
    [{}, "alpha\nbeta\ngamma\ndelta", false],
    [{ offset: 1, limit: 1 }, "alpha", true],
    [{ offset: 2, limit: 2 }, "beta\ngamma", true],
    [{ offset: 4, limit: 1 }, "delta", true],
    [{ offset: 0, limit: 1 }, "alpha", true],
    [{ offset: -2 }, "gamma\ndelta", true],
    [{ offset: -3, limit: 1 }, "beta", true],
    [{ offset: -100 }, "alpha\nbeta\ngamma\ndelta", true],
    [{ offset: 5 }, "alpha\nbeta\ngamma\ndelta", false],
  ];
  for (const [range, content, applied] of cases) {
    const result = (await runtime.read(new ReadArgs({ path: "lines.txt", ...range }))).result;
    assert.equal(result.case, "success");
    assert.equal(result.value.output.value, content, JSON.stringify(range));
    assert.equal(result.value.rangeApplied, applied);
    assert.equal(result.value.totalLines, 4);
    assert.equal(result.value.truncated, false);
  }
  const tool = createReadTool({ get(key) { assert.equal(key, readExecutorResource); return { execute: (_ctx, args) => runtime.read(args) }; } }, { enableLineNumbers: true }, "latest", { enableNegativeOffset: true });
  const context = createContext();
  const result = await tool.execute(context, { executeToolCall: (ctx, _call, _id, run) => run(ctx), emitPartialToolCall() {} }, (async function* () { yield JSON.stringify({ path: "lines.txt", offset: 2, limit: 2 }); })(), { toolCallId: "range" });
  const rendered = await tool.render(context, result, {});
  assert.match(rendered.content[0].text, /2\|beta\n\s*3\|gamma/);
  await writeFile(path.join(workspace, "empty.txt"), "");
  assert.equal((await runtime.read(new ReadArgs({ path: "empty.txt", offset: 1, limit: 1 }))).result.value.rangeApplied, false);
});

test("Box Read preserves supported image bytes through public image rendering", async t => {
  const { ReadArgs, createReadTool, readExecutorResource, createContext } = await runtimeModule;
  const { runtime, workspace } = await world(t);
  // Magic signatures plus binary payload exercise byte preservation; rendering
  // sniffs the bytes rather than decoding an image or trusting its extension.
  const fixtures = [
    ["png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 0]), "image/png"],
    ["jpg", Buffer.from([255, 216, 255, 224, 0, 255, 128, 0]), "image/jpeg"],
    ["gif", Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0, 255, 128, 0])]), "image/gif"],
    ["webp", Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from([255, 128, 0])]), "image/webp"],
  ];
  const tool = createReadTool({ get(key) { assert.equal(key, readExecutorResource); return { execute: (_ctx, args) => runtime.read(args) }; } }, {});
  const context = createContext();
  for (const [extension, data, mimeType] of fixtures) {
    const filename = `image.${extension}`;
    await writeFile(path.join(workspace, filename), data);
    const read = (await runtime.read(new ReadArgs({ path: filename, offset: 2, limit: 1 }))).result.value;
    assert.equal(read.output.case, "data");
    assert.deepEqual(Buffer.from(read.output.value), data);
    assert.equal(read.rangeApplied, false);
    const result = await tool.execute(context, { executeToolCall: (ctx, _call, _id, run) => run(ctx), emitPartialToolCall() {} }, (async function* () { yield JSON.stringify({ path: filename }); })(), { toolCallId: extension });
    const rendered = await tool.render(context, result, {});
    const image = rendered.content.find(item => item.type === "image");
    assert.ok(image);
    assert.equal(image.mimeType, mimeType);
    assert.deepEqual(Buffer.from(image.data, "base64"), data);
  }
});

test("Box atomic writes preserve mode and parallel writes publish whole independent payloads", async t => {
  const { WriteArgs } = await runtimeModule;
  const { runtime, workspace } = await world(t);
  const filename = path.join(workspace, "script.sh");
  await writeFile(filename, "old");
  await chmod(filename, 0o751);
  const payloads = Array.from({ length: 32 }, (_, index) => `${index}:` + String(index).repeat(8192));
  const results = await Promise.all(payloads.map(fileText => runtime.write(new WriteArgs({ path: "script.sh", fileText }))));
  assert.ok(results.every(result => result.result.case === "success"));
  assert.ok(payloads.includes(await readFile(filename, "utf8")), "the final file must equal one complete write");
  assert.equal((await stat(filename)).mode & 0o7777, 0o751);
  assert.deepEqual(await readdir(workspace), ["script.sh"]);
});

test("Pre-aborted unary and streaming shells never run commands or hooks", async t => {
  const { ShellArgs } = await runtimeModule;
  const { runtime, workspace } = await world(t);
  await hooks(workspace, "preToolUse", [{ command: "printf hook > hook-marker" }]);
  const controller = new AbortController();
  controller.abort();
  const result = await runtime.shell(new ShellArgs({ command: "printf bad > unary-marker", workingDirectory: "/workspace" }), controller.signal);
  assert.equal(result.result.case, "failure");
  assert.equal(result.result.value.aborted, true);
  const events = await stream(runtime, "printf bad > stream-marker", {}, controller.signal);
  assert.equal(events.at(-1).value.aborted, true);
  assert.equal(events.some(event => event.case === "start"), false);
  assert.deepEqual((await readdir(workspace)).sort(), [".cursor"]);

  const later = new AbortController();
  await rm(path.join(workspace, ".cursor"), { recursive: true });
  const iterator = runtime.shellStream({ id: 2, execId: "cancel-on-start" }, new ShellArgs({ command: "printf bad > after-start-marker" }), later.signal);
  await iterator.next();
  later.abort();
  for await (const _item of iterator) { /* consume cancelled exit */ }
  assert.equal(await exists(path.join(workspace, "after-start-marker")), false);
});

test("Streaming shell hard timeout still kills a child after background transition", async t => {
  const { TimeoutBehavior } = await runtimeModule;
  const { runtime, workspace, terminals } = await world(t);
  const events = await stream(runtime, "sleep 0.6; printf bad > late-marker", { timeout: 1, hardTimeout: 100, timeoutBehavior: TimeoutBehavior.BACKGROUND });
  const background = events.find(event => event.case === "backgrounded");
  assert.ok(background);
  const terminal = path.join(terminals, `${background.value.shellId}.txt`);
  await waitUntil(async () => /exit_code:/.test(await readFile(terminal, "utf8").catch(() => "")), "background timeout footer");
  await pause(650);
  assert.equal(await exists(path.join(workspace, "late-marker")), false);
  assert.match(await readFile(terminal, "utf8"), /exit_code: [1-9]/);
});

test("Late background state cannot replace a newer foreground cwd or exported variable", async t => {
  const { TimeoutBehavior } = await runtimeModule;
  const { runtime, workspace, terminals } = await world(t);
  await mkdir(path.join(workspace, "bg"));
  await mkdir(path.join(workspace, "fg"));
  const events = await stream(runtime, "while [ ! -f release ]; do sleep 0.01; done; cd bg; export OWNER=BACKGROUND", { timeout: 1, timeoutBehavior: TimeoutBehavior.BACKGROUND, conversationId: "same-owner" });
  const background = events.find(event => event.case === "backgrounded").value;
  await stream(runtime, "cd fg; export OWNER=FOREGROUND", { conversationId: "same-owner" });
  await writeFile(path.join(workspace, "release"), "release");
  await waitUntil(async () => /exit_code:/.test(await readFile(path.join(terminals, `${background.shellId}.txt`), "utf8").catch(() => "")), "background completion");
  const next = await stream(runtime, 'pwd -P; printf "%s\\n" "$OWNER"', { conversationId: "same-owner" });
  const stdout = next.filter(event => event.case === "stdout").map(event => event.value.data).join("");
  assert.equal(stdout, `${path.join(workspace, "fg")}\nFOREGROUND\n`);
});

test("Missing shell cwd becomes a graceful streamed failure and unary spawn error", async t => {
  const { ShellArgs } = await runtimeModule;
  const { runtime } = await world(t);
  const events = await stream(runtime, "printf should-not-run", { workingDirectory: "/workspace/missing" });
  assert.match(events.filter(event => event.case === "stderr").map(event => event.value.data).join(""), /Failed to spawn shell:.*ENOENT/);
  assert.equal(events.at(-1).case, "exit");
  assert.equal(events.at(-1).value.code, 1);
  const unary = await runtime.shell(new ShellArgs({ command: "true", workingDirectory: "/workspace/missing" }), new AbortController().signal);
  assert.equal(unary.result.case, "spawnError");
});

test("Hook pre-abort and missing executable resolve safely without running a child", async t => {
  const { runtime, workspace } = await world(t, { PATH: "" });
  await hooks(workspace, "preToolUse", [{ command: "printf bad > hook-marker", failClosed: true }]);
  const controller = new AbortController();
  controller.abort();
  const preaborted = await runtime.executeHook(hookRequest, controller.signal);
  assert.equal(preaborted.response.response.value.permission, "deny");
  const missing = await runtime.executeHook(hookRequest);
  assert.equal(missing.response.response.value.permission, "deny");
  await pause(20);
  assert.equal(await exists(path.join(workspace, "hook-marker")), false);
});

test("Hook timeout and abort stop owned descendants before a delayed side effect", async t => {
  for (const mode of ["timeout", "abort"]) {
    const { runtime, workspace } = await world(t);
    const ready = path.join(workspace, "ready");
    const marker = path.join(workspace, "marker");
    await writeFile(path.join(workspace, "child.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("ready", String(process.pid)); setTimeout(() => writeFileSync("marker", "bad"), 650);');
    await hooks(workspace, "preToolUse", [{ command: `${quote(process.execPath)} child.mjs; :`, timeout: mode === "timeout" ? 0.15 : 3, failClosed: true }]);
    const controller = new AbortController();
    const pending = runtime.executeHook(hookRequest, controller.signal);
    if (mode === "abort") { await waitUntil(() => exists(ready), "hook child ready"); controller.abort(); }
    const result = await pending;
    assert.equal(result.response.response.value.permission, "deny");
    await pause(700);
    assert.equal(await exists(marker), false, mode);
  }
});

test("Null hook output cannot bypass exit-code denial or throw during folding", async t => {
  const { runtime, workspace } = await world(t);
  for (const [output, code, failClosed, denied] of [["null", 2, false, true], ["null", 7, true, true], ["null", 0, false, false], ["[]", 2, false, true], ['"text"', 2, false, true]]) {
    await hooks(workspace, "preToolUse", [{ command: `printf '%s' ${quote(output)}; exit ${code}`, failClosed }]);
    const result = await runtime.executeHook(hookRequest);
    assert.equal(result.response?.response.value.permission === "deny", denied);
  }
  await hooks(workspace, "beforeShellExecution", [{ command: "printf null; exit 2" }]);
  const events = await stream(runtime, "printf bad > forbidden");
  assert.equal(events[0].case, "permissionDenied");
  assert.equal(await exists(path.join(workspace, "forbidden")), false);
});
