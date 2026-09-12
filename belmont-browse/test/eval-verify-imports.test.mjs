// Offline packaging smoke test: does not start an engine, model, or form server.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const root = new URL("../tools/eval-verify/", import.meta.url);

test("the committed live verifier's literal relative imports resolve", () => {
  let checked = 0;
  for (const name of ["verify-live-g4g7.mjs", "form-observer.mjs", "form-server.mjs"]) {
    const file = new URL(name, root);
    const text = readFileSync(file, "utf8");
    const imports = /(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
    for (const match of text.matchAll(imports)) {
      assert.ok(statSync(new URL(match[1], file)).isFile(), `${name}: ${match[1]}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, "must inspect at least the driver-to-observer import");
});

test("the committed form observer exposes the verifier contract", async () => {
  const observer = await import(new URL("form-observer.mjs", root));
  assert.equal(observer.id, "external-form-submission-observer-v1");
  assert.equal(observer.isolation, "resettable");
  assert.equal(typeof observer.beforeTrial, "function");
  assert.equal(typeof observer.verify, "function");
});
