import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const src = path.resolve(import.meta.dirname, "../belmont-browse/src");
const bundlePath = path.resolve(src, "../vendor/aside-907/apps/daemon/build/daemon.mjs");
const available = existsSync(bundlePath);
const bundle = available ? readFileSync(bundlePath, "utf8") : "";
// Exercise the exact bundled dependency, without importing the full daemon or
// starting its native memory, network, or account lifecycle.
const start = bundle.indexOf("require_signals=__commonJSMin(");
const end = bundle.indexOf(",require_mtime_precision=", start);
const primitive = bundle.slice(start, end);

async function exercise({ adapter, signal, startup = false, oldOnce = false, linger = false }) {
  assert.ok(start >= 0 && end > start, "907 signal-exit anchor must match");
  const dir = mkdtempSync(path.join(os.tmpdir(), "aside-signal-drain-"));
  const complete = path.join(dir, "cleanup-finished");
  const fixture = path.join(dir, "fixture-core.mjs");
  writeFileSync(fixture, `
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const __require = createRequire(import.meta.url);
const __commonJSMin = (factory) => { let cache; return () => { if (!cache) { cache = { exports: {} }; factory(cache.exports, cache); } return cache.exports; }; };
const ${primitive};
export async function createBrowseEngine() {
  require_signal_exit()(() => {});
  console.error("fixture-startup");
  await delay(120);
  let stopped;
  const handle = { id: "fixture-session", toJSON: () => ({ id: "fixture-session", status: "running" }), stop: async () => {} };
  return {
    model: {}, version: "fixture", account: { id: 0 }, chrome: {},
    A: { settings: () => ({ get: () => ({}) }) }, stats: () => ({ ready: true }),
    startSession: () => handle,
    stop: () => stopped ??= (async () => { console.error("fixture-draining"); await delay(160); writeFileSync(${JSON.stringify(complete)}, "complete"); ${linger ? "setInterval(() => {}, 1000);" : ""} })(),
  };
}
`);
  let source = readFileSync(path.join(src, `${adapter}.mjs`), "utf8");
  source = source.replaceAll('"./core.mjs"', JSON.stringify(pathToFileURL(fixture).href));
  source = source.replace(/"\.\/([^"\n]+)"/g, (_, file) => JSON.stringify(pathToFileURL(path.join(src, file)).href));
  if (oldOnce) source = source.replace(/process\.on\("SIG(INT|TERM)"/g, 'process.once("SIG$1"');
  const entry = path.join(dir, `${adapter}.mjs`);
  writeFileSync(entry, source);
  const args = adapter === "serve" ? ["--port", "0", "--state-dir", dir] : ["--task", "fixture", "--no-keep-chrome"];
  const child = spawn(process.execPath, [entry, ...args], { env: { ...process.env, BELMONT_BROWSE_STATE_DIR: dir, BELMONT_BROWSE_STATE_FILE: path.join(dir, "absent.json"), ...(linger ? { BELMONT_BROWSE_EXIT_GRACE_MS: "300" } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let exited = false;
  const exit = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); }); });
  try {
    const waitFor = async (marker) => {
      const deadline = Date.now() + 5000;
      while (!output.includes(marker) && !exited && Date.now() < deadline) await delay(5);
      assert.ok(output.includes(marker), `Missing ${marker}: ${output}`);
    };
    await waitFor(startup ? "fixture-startup" : adapter === "serve" ? "[serve] listening" : "[session] fixture-session");
    child.kill(signal);
    if (!oldOnce) {
      await waitFor("fixture-draining");
      child.kill(signal);
      await delay(15);
      child.kill(signal === "SIGTERM" ? "SIGINT" : "SIGTERM");
    }
    const result = await Promise.race([exit, delay(5000).then(() => { throw new Error(`Drain timed out: ${output}`); })]);
    if (oldOnce) {
      assert.equal(result.signal, signal);
      assert.equal(existsSync(complete), false);
    } else {
      assert.equal(result.signal, null, output);
      assert.equal(result.code, adapter === "serve" ? 0 : signal === "SIGINT" ? 130 : 143, output);
      assert.equal(readFileSync(complete, "utf8"), "complete");
      assert.equal(output.split("fixture-draining").length - 1, 1);
      if (adapter === "serve") assert.equal(existsSync(path.join(dir, "serve.json")), false);
      // A handle that outlives a finished shutdown (2026-09-09: a daemon idled after "shutdown finished" until
      // SIGKILL) is named and the process still leaves with the shutdown's exit code.
      if (linger) assert.match(output, /forcing exit \(open: .*Timeout/, output);
      else assert.doesNotMatch(output, /forcing exit/, output);
    }
  } finally {
    if (!exited) { child.kill("SIGKILL"); await exit; }
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const adapter of ["serve", "run"]) {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`${adapter}: ${signal} and repeated mixed signals await cleanup with original signal-exit`, { skip: !available }, () => exercise({ adapter, signal }));
  }
  test(`${adapter}: startup signal remains owned until cleanup finishes`, { skip: !available }, () => exercise({ adapter, signal: "SIGTERM", startup: true }));
  test(`${adapter}: original once listener is a failing control`, { skip: !available }, () => exercise({ adapter, signal: "SIGTERM", oldOnce: true }));
}
test("serve: a handle that outlives the finished shutdown does not keep the process alive", { skip: !available }, () => exercise({ adapter: "serve", signal: "SIGTERM", linger: true }));
