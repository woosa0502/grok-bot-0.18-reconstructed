// Real-PRODUCER tests for the chrome ownership registration (C-2) and its fail-closed behavior (R2). These
// drive the ACTUAL ensureChrome() orphan-adopt path (not a Python fake that hand-writes the registration JSON),
// which is exactly how GPT's whole-project review reproduced both the C-2 leak and the R2 swallowed-failure:
// the real ensureChrome() with a stub CDP-readiness endpoint and a throwaway `sleep` standing in for Chrome.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { ensureChrome } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/chrome.mjs")).href);
const { writeChromeOwner, readChromeOwner, processStartTicks, isProcessAlive } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/browser-lifecycle.mjs")).href);

const DEAD_SERVE_PID = 2147480000;   // > pid_max on Linux -> isProcessAlive() is always false, never reused
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Set up a stub CDP endpoint + a throwaway "orphan chrome" + a valid adopt-able owner record. Returns the
// pieces plus a cleanup(). The caller sets BELMONT_CHROME_REG before invoking ensureChrome().
async function setupOrphan() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-reg-"));
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ Browser: "stub/1.0", webSocketDebuggerUrl: "ws://127.0.0.1:0/devtools/browser/stub" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const fakeChrome = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  fakeChrome.unref();
  await sleepMs(150);
  const startTicks = processStartTicks(fakeChrome.pid);
  assert.ok(Number.isInteger(startTicks) && isProcessAlive(fakeChrome.pid), "fake chrome should be alive with start ticks");
  // chrome alive, owning serve DEAD -> planReuseOwnership() returns "adopt".
  writeChromeOwner(profileDir, { servePid: DEAD_SERVE_PID, chromePid: fakeChrome.pid, pgid: fakeChrome.pid, startTicks });
  const cleanup = async () => {
    try { process.kill(fakeChrome.pid, "SIGKILL"); } catch {}
    await new Promise((r) => server.close(r));
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  };
  return { profileDir, port, fakeChrome, startTicks, cleanup };
}

// C-2: the real adopt branch push-registers the adopted instance under THIS serve's pid.
async function testAdoptRegistersControl() {
  const o = await setupOrphan();
  const regPath = path.join(o.profileDir, ".belmont-chrome-reg.jsonl");
  process.env.BELMONT_CHROME_REG = regPath;
  try {
    const res = await ensureChrome({ port: o.port, profileDir: o.profileDir, log: () => {} });
    assert.equal(res.adopted, true, "ensureChrome should ADOPT the orphaned CDP");
    assert.equal(res.pid, o.fakeChrome.pid, "adopted pid should be the orphan chrome");
    assert.ok(fs.existsSync(regPath), "registration log must exist after adopt");
    const lines = fs.readFileSync(regPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const mine = lines.find((e) => e.pid === o.fakeChrome.pid && e.servePid === process.pid);
    assert.ok(mine, `adopt path must register {pid:${o.fakeChrome.pid}, servePid:${process.pid}}; got ${JSON.stringify(lines)}`);
    assert.equal(mine.startTicks, o.startTicks, "registered startTicks must match the adopted instance");
    console.log("PASS adopt-registration (real producer): ensureChrome()'s adopt branch push-registers the adopted chrome under this serve's pid");
  } finally { delete process.env.BELMONT_CHROME_REG; await o.cleanup(); }
}

// R2: under supervision, an adopt registration WRITE failure must fail-closed — ensureChrome() throws instead
// of returning a successful (untracked) adoption, it does NOT kill the pre-existing browser, and it leaves the
// owner record under this serve so the next serve re-adopts.
async function testAdoptRegistrationFailClosed() {
  const o = await setupOrphan();
  // point registration at a path that cannot be appended to (parent dir does not exist; appendFileSync won't mkdir)
  const badReg = path.join(o.profileDir, "no-such-subdir", "reg.jsonl");
  process.env.BELMONT_CHROME_REG = badReg;
  try {
    await assert.rejects(
      () => ensureChrome({ port: o.port, profileDir: o.profileDir, log: () => {} }),
      /failed to register adopted chrome/,
      "adopt must FAIL-CLOSED when supervised registration cannot be written",
    );
    assert.ok(isProcessAlive(o.fakeChrome.pid), "R2: the pre-existing browser must NOT be killed on a registration fault");
    const owner = readChromeOwner(o.profileDir);
    assert.ok(owner && owner.servePid === process.pid, "R2: the owner record is left under this serve for re-adoption");
    assert.ok(!fs.existsSync(badReg), "no registration line was written");
    console.log("PASS adopt-fail-closed (real producer, R2): a supervised adopt registration failure throws, spares the browser, and leaves it re-adoptable");
  } finally { delete process.env.BELMONT_CHROME_REG; await o.cleanup(); }
}

await testAdoptRegistersControl();
await testAdoptRegistrationFailClosed();
console.log("ALL ADOPT-REGISTRATION TESTS PASS");
