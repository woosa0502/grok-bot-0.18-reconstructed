import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import test, { after, before } from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const originalPath = process.env.PATH;
let fixture;
let api;

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const exists = async file => stat(file).then(() => true, error => {
  if (error.code === "ENOENT") return false;
  throw error;
});
async function events() {
  return (await readFile(path.join(fixture, "events.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
}
async function until(predicate) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail("fixture did not reach the expected process boundary");
}
async function configure(value = {}) {
  await writeFile(path.join(fixture, "events.jsonl"), "");
  await writeFile(path.join(fixture, "config.json"), JSON.stringify(value));
}
function actions(...items) {
  return new api.ComputerUseArgs({ actions: items.map(([kind, value]) => ({ action: { case: kind, value } })) });
}
function computer(capture = async (_display, _size, output) => writeFile(output, "fixture-image"), extra = {}) {
  return new api.LocalComputerUseExecutor({ display: ":unused-test", displaySize: { width: 1280, height: 800 }, capture, ...extra });
}
function assertCanceled(result) {
  assert.equal(result.result.case, "error");
  assert.match(result.result.value.error, /cancel|abort/i);
}

before(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "belmont-local-ui-lifecycle-"));
  await mkdir(path.join(fixture, "bin"));
  await configure();
  const fakeExecutable = `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const root = ${JSON.stringify(fixture)};
const executable = basename(process.argv[1]);
const args = process.argv.slice(2);
const config = JSON.parse(readFileSync(root + "/config.json", "utf8"));
const record = event => appendFileSync(root + "/events.jsonl", JSON.stringify({ executable, args, event, pid: process.pid }) + "\\n");
record("start");
process.on("SIGTERM", () => {});
const finish = () => {
  if (executable === "ffmpeg") writeFileSync(args.at(-1), "ffmpeg-fixture");
  if (executable === "xrandr") process.stdout.write("current 1280 x 800\\n");
  record("done");
};
if (config.delayExecutable === executable && (!config.delayArg || args.includes(config.delayArg))) {
  setTimeout(finish, config.delayMs ?? 500);
} else finish();
`;
  for (const name of ["xdotool", "xrandr", "ffmpeg"]) {
    const file = path.join(fixture, "bin", name);
    await writeFile(file, fakeExecutable);
    await chmod(file, 0o755);
  }
  await writeFile(path.join(fixture, "tree.mjs"), `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [mode, prefix] = process.argv.slice(2);
if (mode === "leaf") {
  process.on("SIGTERM", () => {});
  writeFileSync(prefix + ".ready", String(process.pid));
  setTimeout(() => writeFileSync(prefix + ".done", "completed"), 500);
} else {
  spawn(process.execPath, [process.argv[1], "leaf", prefix], { stdio: "ignore" });
  setInterval(() => {}, 1000);
}
`);
  process.env.PATH = `${path.join(fixture, "bin")}${path.delimiter}${originalPath ?? ""}`;
  const built = await build({
    stdin: { contents: `
      export { localBrowserShellExecutor } from "./source/host/box/local-browser-use.ts";
      export { createSandBrowserTools } from "./source/host/runner/tools/sand-browser-tools.ts";
      export { LocalComputerUseExecutor } from "./source/packages/local-exec/computer-use/executor.ts";
      export { execResult } from "./source/packages/local-exec/computer-use/shell.ts";
      export { createContext } from "./source/packages/context/core.ts";
      export { ComputerUseArgs } from "./source/packages/proto/generated/agent/v1/computer_use_tool_pb.ts";
    `, loader: "ts", resolveDir: root },
    bundle: true, platform: "node", format: "cjs", target: "node26", packages: "external", write: false,
    define: {
      "process.env.SAND_LOCAL_COMPUTER_USE": '"0"',
      "process.env.SAND_LOCAL_BROWSER_USE": '"0"',
      "process.env.SAND_BROWSER_IDLE_TIMEOUT_SECONDS": '"0"',
    },
    plugins: [{ name: "task-owned-browser-working-directory", setup(plugin) {
      plugin.onLoad({ filter: /sand-browser-driver-source\.ts$/ }, async ({ path: file }) => {
        const contents = await readFile(file, "utf8");
        const original = 'export const SAND_BROWSER_DRIVER_BOX_DIR = "/tmp/.sand-browser";';
        assert.ok(contents.includes(original));
        return { contents: contents.replace(original, `export const SAND_BROWSER_DRIVER_BOX_DIR = ${JSON.stringify(fixture)};`), loader: "ts" };
      });
    } }],
  });
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${built.outputFiles[0].text}\n})`);
  wrapper(createRequire(path.join(root, "package.json")), module, module.exports);
  api = module.exports;
});

after(async () => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

test("browser shell preserves compound commands, output and nonzero exit controls", async () => {
  const shell = api.localBrowserShellExecutor();
  const result = await shell.execute(api.createContext(), { command: "printf first && (printf second; printf warning >&2); exit 7" });
  assert.equal(result.result.case, "success");
  assert.equal(result.result.value.exitCode, 7);
  assert.equal(result.result.value.stdout, "firstsecond");
  assert.equal(result.result.value.stderr, "warning");
});

test("browser pre-abort does not audit or spawn; midflight abort kills owned grandchildren only", async () => {
  const [preContext, preCancel] = api.createContext().withCancel();
  preCancel(new Error("test cancel"));
  let audits = 0;
  const preMarker = path.join(fixture, "pre-aborted");
  const pre = await api.localBrowserShellExecutor(() => audits++).execute(preContext, { command: `printf forbidden > ${quote(preMarker)}` });
  assert.equal(pre.result.case, "failure");
  assert.equal(pre.result.value.aborted, true);
  assert.match(pre.result.value.stderr, /cancel/i);
  assert.equal(audits, 0);
  assert.equal(await exists(preMarker), false);

  const canceledPrefix = path.join(fixture, "canceled-tree");
  const controlPrefix = path.join(fixture, "separate-control");
  const control = spawn(process.execPath, [path.join(fixture, "tree.mjs"), "leaf", controlPrefix], { detached: true, stdio: "ignore" });
  const controlClosed = new Promise(resolve => control.once("close", resolve));
  const [context, cancel] = api.createContext().withCancel();
  const pending = api.localBrowserShellExecutor().execute(context, { command: `${quote(process.execPath)} ${quote(path.join(fixture, "tree.mjs"))} tree ${quote(canceledPrefix)} & wait` });
  try {
    await until(async () => await exists(canceledPrefix + ".ready") && await exists(controlPrefix + ".ready"));
    const started = performance.now();
    cancel(new Error("midflight cancel"));
    const result = await pending;
    assert.equal(result.result.case, "failure");
    assert.equal(result.result.value.aborted, true);
    assert.equal(result.result.value.exitCode, 130);
    assert.ok(performance.now() - started < 1000);
    await controlClosed;
    await delay(80);
    assert.equal(await exists(canceledPrefix + ".done"), false);
    assert.equal(await readFile(controlPrefix + ".done", "utf8"), "completed");
  } finally {
    cancel();
    control.kill("SIGKILL");
    await pending;
    await controlClosed;
  }
});

test("computer pre-abort and wait abort prevent all input and capture", async () => {
  await configure();
  let captures = 0;
  const executor = computer(async () => { captures++; });
  for (const when of ["before", "wait"]) {
    const [context, cancel] = api.createContext().withCancel();
    if (when === "before") cancel();
    const started = performance.now();
    const pending = executor.execute(context, actions(["wait", { durationMs: 5000 }], ["type", { text: "forbidden" }]));
    if (when === "wait") setTimeout(cancel, 30);
    assertCanceled(await pending);
    assert.ok(performance.now() - started < 1000);
  }
  assert.deepEqual(await events(), []);
  assert.equal(captures, 0);
});

test("computer cancellation stops in-flight input and display detection without later actions", async () => {
  for (const executable of ["xdotool", "xrandr"]) {
    await configure({ delayExecutable: executable });
    let captures = 0;
    const executor = computer(async () => { captures++; }, executable === "xrandr" ? { displaySize: undefined } : {});
    const [context, cancel] = api.createContext().withCancel();
    const pending = executor.execute(context, actions(["click", { coordinate: { x: 10, y: 10 } }], ["type", { text: "forbidden" }]));
    try {
      await until(async () => (await events()).some(event => event.executable === executable && event.event === "start"));
      cancel();
      assertCanceled(await pending);
      await delay(550);
      const recorded = await events();
      assert.equal(recorded.filter(event => event.event === "done").length, 0);
      assert.equal(recorded.some(event => event.args.includes("forbidden") || event.args[0] === "click"), false);
      assert.equal(captures, 0);
    } finally { cancel(); await pending; }
  }
});

test("cancel during drag releases its pressed button and stops subsequent input", async () => {
  await configure({ delayExecutable: "xdotool", delayArg: "20" });
  let captures = 0;
  const [context, cancel] = api.createContext().withCancel();
  const pending = computer(async () => { captures++; }).execute(context, actions(
    ["drag", { path: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }], button: 1 }],
    ["type", { text: "forbidden" }],
  ));
  try {
    await until(async () => (await events()).some(event => event.event === "start" && event.args.includes("20")));
    cancel();
    assertCanceled(await pending);
    const recorded = await events();
    assert.ok(recorded.some(event => event.event === "done" && event.args[0] === "mousedown"));
    assert.ok(recorded.some(event => event.event === "done" && event.args[0] === "mouseup"));
    assert.equal(recorded.some(event => event.args.includes("30") || event.args.includes("forbidden")), false);
    assert.equal(captures, 0);
  } finally { cancel(); await pending; }
});

test("cancel during screenshot settling prevents capture", async () => {
  await configure();
  let captures = 0;
  const [context, cancel] = api.createContext().withCancel();
  const pending = computer(async () => { captures++; }).execute(context, actions(["type", { text: "allowed" }]));
  await until(async () => (await events()).some(event => event.event === "done"));
  cancel();
  assertCanceled(await pending);
  assert.equal(captures, 0);
});

test("cancel after a standalone mouseDown releases only this call's pressed button", async () => {
  await configure();
  const [context, cancel] = api.createContext().withCancel();
  const pending = computer().execute(context, actions(["mouseDown", { button: 2 }], ["wait", { durationMs: 5000 }], ["type", { text: "forbidden" }]));
  try {
    await until(async () => (await events()).some(event => event.event === "done" && event.args[0] === "mousedown"));
    await delay(50);
    cancel();
    assertCanceled(await pending);
    const recorded = await events();
    assert.deepEqual(recorded.filter(event => event.event === "done").map(event => event.args), [["mousedown", "3"], ["mouseup", "3"]]);
  } finally { cancel(); await pending; }
});

test("default ffmpeg capture observes cancellation and cleans its exclusive directory", async () => {
  await configure({ delayExecutable: "ffmpeg" });
  const [context, cancel] = api.createContext().withCancel();
  const pending = computer(undefined, { capture: undefined }).execute(context, actions());
  try {
    await until(async () => (await events()).some(event => event.executable === "ffmpeg"));
    const output = (await events()).find(event => event.executable === "ffmpeg").args.at(-1);
    cancel();
    assertCanceled(await pending);
    await delay(550);
    assert.equal(await exists(path.dirname(output)), false);
    assert.equal((await events()).some(event => event.event === "done"), false);
  } finally { cancel(); await pending; }
});

test("same-millisecond concurrent captures isolate bytes and cleanup across displays and one executor", async () => {
  const originalNow = Date.now;
  Date.now = () => 1234567890;
  const paths = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const make = label => computer(async (_display, _size, output) => {
    paths.push(output);
    assert.equal((await stat(path.dirname(output))).mode & 0o777, 0o700);
    if (paths.length === 3) release();
    await barrier;
    await writeFile(output, `image-${label}`);
    if (label === "A") await delay(40);
  }, { display: `:test-${label}` });
  const a = make("A");
  try {
    const results = await Promise.all([a.execute(api.createContext(), actions()), make("B").execute(api.createContext(), actions()), a.execute(api.createContext(), actions())]);
    assert.equal(new Set(paths).size, 3);
    for (const [index, expected] of ["A", "B", "A"].entries()) {
      assert.equal(results[index].result.case, "success");
      assert.equal(Buffer.from(results[index].result.value.screenshot, "base64").toString(), `image-${expected}`);
    }
    for (const output of paths) assert.equal(await exists(path.dirname(output)), false);
  } finally { Date.now = originalNow; release(); }
});

test("capture failure and late custom-capture cancellation cannot delete another capture", async () => {
  const paths = [];
  let cancel;
  const make = mode => computer(async (_display, _size, output, signal) => {
    paths.push(output);
    await writeFile(output, mode);
    if (mode === "failure") throw new Error("capture fixture failure");
    if (mode === "canceled") {
      cancel();
      assert.equal(signal.aborted, true);
      await delay(30);
      await writeFile(output, "late custom capture");
    }
  });
  const [context, cancelContext] = api.createContext().withCancel();
  cancel = cancelContext;
  const [failed, canceled, succeeded] = await Promise.all([
    make("failure").execute(api.createContext(), actions()),
    make("canceled").execute(context, actions()),
    make("control").execute(api.createContext(), actions()),
  ]);
  assert.equal(failed.result.case, "error");
  assert.match(failed.result.value.error, /capture fixture failure/);
  assertCanceled(canceled);
  assert.equal(succeeded.result.case, "success");
  assert.equal(Buffer.from(succeeded.result.value.screenshot, "base64").toString(), "control");
  for (const output of paths) assert.equal(await exists(path.dirname(output)), false);
});

test("local process execution retains bounded timeout, output and missing-command failure", async () => {
  await assert.rejects(api.execResult(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 30 }), /timed out/);
  await assert.rejects(api.execResult(process.execPath, ["-e", "process.stdout.write('x'.repeat(2000))"], { maxBuffer: 100 }), /output exceeded/);
  await assert.rejects(api.execResult(path.join(fixture, "does-not-exist"), []), /ENOENT/);
});

test("browser fill dispatches an empty value while missing value and other empty required strings stay rejected", async () => {
  const dispatched = [];
  const tools = api.createSandBrowserTools({
    resourceAccessor: { get() { throw new Error("unused fixture resource"); } },
    getWindowIndex: async () => 990, getBoxId: () => "fixture", getDefaultViewId: () => "fixture",
    uploadFile: async () => {}, downloadFile: async () => new Uint8Array(),
    executeShell: async (_context, input) => {
      const request = JSON.parse(Buffer.from(input.command.split(" ").at(-1), "base64").toString());
      dispatched.push(request);
      return { case: "success", exitCode: 0, stdout: '__SAND_BROWSER_RESULT__{"ok":true,"summary":"Filled fixture input"}' };
    },
  });
  const fill = tools.find(tool => tool.name === "browser_fill");
  for (const value of ["replacement", ""]) {
    const result = await fill.execute(api.createContext(), { ref: "e1", value }, { toolCallId: "fill-test" });
    assert.notEqual(result.isError, true);
    assert.equal(dispatched.at(-1).value, value);
  }
  const count = dispatched.length;
  for (const [name, args] of [["browser_fill", { ref: "e1" }], ["browser_fill", { ref: "", value: "" }], ["browser_navigate", { url: "" }], ["browser_type", { ref: "e1", text: "" }]]) {
    const result = await tools.find(tool => tool.name === name).execute(api.createContext(), args, { toolCallId: "invalid-test" });
    assert.equal(result.isError, true);
    assert.match(result.text, /required/);
  }
  assert.equal(dispatched.length, count);
});
