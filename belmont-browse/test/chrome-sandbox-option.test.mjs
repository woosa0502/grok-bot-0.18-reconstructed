import assert from "node:assert/strict";
import test from "node:test";
import { isNoSandboxRequested } from "../src/chrome.mjs";

test("the sandbox option is a boolean, not string presence (audit C01)", () => {
  for (const off of [undefined, "", " ", "0", "false", "no", "off", "FALSE", " Off "]) assert.equal(isNoSandboxRequested(off), false, JSON.stringify(off));
  for (const on of ["1", "true", "yes", "on", "TRUE", " 1 "]) assert.equal(isNoSandboxRequested(on), true, JSON.stringify(on));
  assert.throws(() => isNoSandboxRequested("disabled"), /BELMONT_BROWSE_NO_SANDBOX must be/);
});
