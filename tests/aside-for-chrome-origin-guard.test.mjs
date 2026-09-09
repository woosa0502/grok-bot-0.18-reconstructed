import assert from "node:assert/strict";
import test from "node:test";
import { createForChromeOriginGuard, DEFAULT_FOR_CHROME_ORIGINS } from "../belmont-browse/src/daemon-server.mjs";

const EXT = DEFAULT_FOR_CHROME_ORIGINS[0];
function harness(mode) {
  const seen = [];
  const logs = [];
  const guard = createForChromeOriginGuard({ fetch: async (request) => { seen.push(`${request.method} ${new URL(request.url).pathname}`); return new Response("ok"); }, mode, log: (line) => logs.push(line) });
  const send = (method, path, origin) => guard(new Request(`http://127.0.0.1:21420${path}`, { method, headers: origin === undefined ? {} : { origin } }));
  return { send, seen, logs };
}

test("a web-origin mutation under /session/for-chrome/ is refused; the daemon never sees it", async () => {
  const h = harness("enforce");
  for (const [method, path] of [["POST", "/session/for-chrome/abc/delete"], ["POST", "/session/for-chrome/resolve-popover-action"], ["DELETE", "/session/for-chrome/abc"]]) {
    for (const origin of ["https://evil.example", "http://localhost:8080", "file://", "null"]) {
      const response = await h.send(method, path, origin);
      assert.equal(response.status, 403, `${method} ${path} ${origin}`);
      assert.equal((await response.json()).error.code, "FORBIDDEN");
    }
  }
  assert.deepEqual(h.seen, []);
  assert.ok(h.logs.every((line) => line.includes("refused")));
});

test("the extension origins, the native browser (no Origin) and local CLIs pass through unchanged", async () => {
  const h = harness("enforce");
  assert.equal((await h.send("POST", "/session/for-chrome/abc/archive", EXT)).status, 200);
  assert.equal((await h.send("POST", "/session/for-chrome/abc/archive", DEFAULT_FOR_CHROME_ORIGINS[1])).status, 200);
  assert.equal((await h.send("POST", "/session/for-chrome/mark-all-read")).status, 200);
  assert.deepEqual(h.seen, ["POST /session/for-chrome/abc/archive", "POST /session/for-chrome/abc/archive", "POST /session/for-chrome/mark-all-read"]);
});

test("reads, preflights and every other route are never touched, whatever the origin", async () => {
  const h = harness("enforce");
  for (const [method, path] of [["GET", "/session/for-chrome/recents"], ["HEAD", "/session/for-chrome/search"], ["OPTIONS", "/session/for-chrome/abc/delete"], ["POST", "/trpc/settings.getAll"], ["POST", "/shutdown"]]) {
    assert.equal((await h.send(method, path, "https://evil.example")).status, 200, `${method} ${path}`);
  }
  assert.equal(h.seen.length, 5);
});

test("report mode logs instead of refusing; off mode is inert; unknown modes are rejected", async () => {
  const report = harness("report");
  assert.equal((await report.send("POST", "/session/for-chrome/abc/delete", "https://evil.example")).status, 200);
  assert.equal(report.seen.length, 1);
  assert.match(report.logs[0], /would be refused/);
  const off = harness("off");
  assert.equal((await off.send("POST", "/session/for-chrome/abc/delete", "https://evil.example")).status, 200);
  assert.deepEqual(off.logs, []);
  assert.throws(() => createForChromeOriginGuard({ fetch: async () => new Response(), mode: "maybe" }), /must be enforce, report or off/);
});
