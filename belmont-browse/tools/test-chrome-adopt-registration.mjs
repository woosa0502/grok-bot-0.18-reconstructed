// Real-PRODUCER test for C-2: drive the ACTUAL ensureChrome() orphan-adopt path (not a Python fake that
// hand-writes the registration JSON) and assert it emits a registration line under THIS process's pid. GPT's
// whole-project review reproduced the C-2 leak by running the real ensureChrome() with a stub CDP-readiness
// endpoint and a throwaway `sleep` standing in for Chrome; this test is that exact shape, asserting the fix.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { ensureChrome } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/chrome.mjs")).href);
const { writeChromeOwner, processStartTicks, isProcessAlive } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/browser-lifecycle.mjs")).href);

const DEAD_SERVE_PID = 2147480000;   // > pid_max on Linux -> isProcessAlive() is always false, never reused
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-reg-"));
  const regPath = path.join(profileDir, ".belmont-chrome-reg.jsonl");
  process.env.BELMONT_CHROME_REG = regPath;

  // Stub CDP endpoint so ensureChrome's initial isCdpUp() sees a live browser without a real Chrome.
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ Browser: "stub/1.0", webSocketDebuggerUrl: "ws://127.0.0.1:0/devtools/browser/stub" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  // A detached throwaway process standing in for the orphaned Chrome (its own process group, pgrp == pid).
  const fakeChrome = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  fakeChrome.unref();
  await sleepMs(150);
  const startTicks = processStartTicks(fakeChrome.pid);
  assert.ok(Number.isInteger(startTicks), "should read the fake chrome's start ticks");
  assert.ok(isProcessAlive(fakeChrome.pid), "fake chrome should be alive");

  // A valid orphan owner: chrome alive, owning serve DEAD -> planReuseOwnership() returns "adopt".
  writeChromeOwner(profileDir, { servePid: DEAD_SERVE_PID, chromePid: fakeChrome.pid, pgid: fakeChrome.pid, startTicks });

  let res;
  try {
    res = await ensureChrome({ port, profileDir, log: () => {} });
    // The REAL adopt branch ran ...
    assert.equal(res.adopted, true, "ensureChrome should ADOPT the orphaned CDP");
    assert.equal(res.pid, fakeChrome.pid, "adopted pid should be the orphan chrome");
    // ... and it must have PUSH-REGISTERED the adopted instance under THIS process's pid (the C-2 fix).
    assert.ok(fs.existsSync(regPath), "registration log must exist after adopt");
    const lines = fs.readFileSync(regPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const mine = lines.find((e) => e.pid === fakeChrome.pid && e.servePid === process.pid);
    assert.ok(mine, `adopt path must register {pid:${fakeChrome.pid}, servePid:${process.pid}}; got ${JSON.stringify(lines)}`);
    assert.equal(mine.startTicks, startTicks, "registered startTicks must match the adopted instance");
    console.log("PASS adopt-registration (real producer): ensureChrome()'s adopt branch push-registers the adopted chrome under this serve's pid");
  } finally {
    try { process.kill(fakeChrome.pid, "SIGKILL"); } catch {}
    await new Promise((r) => server.close(r));
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

await main();
