// Fixture serve for the R2 supervisor-integration test. It runs the REAL ensureChrome() adopt path with the
// registration append forced to fail, UNDER the real chrome-supervisor.py. If the fix holds, the aborted adopt
// leaves the orphan's ORIGINAL (dead-serve) owner untouched, so the supervisor's owner-fallback never pins it
// and the pre-existing browser survives the supervisor's exit. Invoked as: node <this> <profileDir>
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const profile = process.argv[2];
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const { ensureChrome } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/chrome.mjs")).href);
const { writeChromeOwner, processStartTicks } = await import(pathToFileURL(path.join(REPO, "belmont-browse/src/browser-lifecycle.mjs")).href);
const DEAD = 2147480000;  // > pid_max: always a dead, non-reusable serve pid

// stub CDP endpoint so ensureChrome() takes the ADOPT path (isCdpUp -> true), not a real spawn.
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ Browser: "stub/1.0", webSocketDebuggerUrl: "ws://127.0.0.1:0/devtools/browser/stub" }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const orphan = spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
orphan.unref();
await new Promise((r) => setTimeout(r, 150));
const startTicks = processStartTicks(orphan.pid);
writeChromeOwner(profile, { servePid: DEAD, chromePid: orphan.pid, pgid: orphan.pid, startTicks });
fs.writeFileSync(path.join(profile, "orphan-pid"), String(orphan.pid));

// Force the adopt registration to FAIL: override BELMONT_CHROME_REG (the supervisor set it to a valid path) to
// an unwritable path so the real producer's appendFileSync throws — the supervisor's own reg log stays empty.
process.env.BELMONT_CHROME_REG = path.join(profile, "no-such-subdir", "reg.jsonl");

let threw = false;
try { await ensureChrome({ port, profileDir: profile, log: () => {} }); } catch { threw = true; }
fs.writeFileSync(path.join(profile, "serve-ready"), threw ? "adopt-aborted" : "adopt-succeeded-unexpected");

// Stay up briefly so the supervisor runs several owner-fallback polls while we're alive, then exit cleanly.
await new Promise((r) => setTimeout(r, 3000));
await new Promise((r) => server.close(r));
process.exit(0);
