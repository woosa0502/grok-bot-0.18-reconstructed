import test from "node:test";
import assert from "node:assert/strict";
import { browserAlive } from "../src/browser-lifecycle.mjs";

test("browserAlive reports a running owned browser, a dead one, and no owned browser", () => {
  assert.equal(browserAlive({ exitCode: null, signalCode: null }), true);
  assert.equal(browserAlive({ exitCode: null, signalCode: "SIGABRT" }), false, "a crash (signal 6, like the mini popup CHECK) is not alive");
  assert.equal(browserAlive({ exitCode: 0, signalCode: null }), false);
  assert.equal(browserAlive(null), null, "CDP reuse owns no process");
});
