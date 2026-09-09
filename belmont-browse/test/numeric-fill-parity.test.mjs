import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const patcher = path.join(root, "tools", "patch-daemon.py");
const temp = mkdtempSync(path.join(os.tmpdir(), "aside-numeric-fill-"));
test.after(() => rmSync(temp, { recursive: true, force: true }));

function functionSlice(bundle, start, end) {
  const from = bundle.indexOf(start);
  const to = bundle.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing extracted function: ${start}`);
  return bundle.slice(from, to);
}

function makeFill(bundle, { kind = "input", type = "text", format = (value) => value } = {}) {
  const calls = { inserts: 0, inputEvents: 0 };
  class Element {
    #value = "";
    constructor() {
      this.tagName = kind === "input" ? "INPUT" : kind === "textarea" ? "TEXTAREA" : "DIV";
      this.type = type;
      this.isContentEditable = kind === "contenteditable";
      this.innerText = "";
      this.ownerDocument = { getSelection: () => null };
    }
    get value() { return this.#value; }
    set value(value) { this.#value = value; }
    focus() {}
    select() {}
    dispatchEvent(event) {
      if (event.type === "input") { calls.inputEvents++; this.value = format(this.value); }
    }
  }
  const target = new Element();
  const context = vm.createContext({
    Event,
    __aside: { retarget: (element) => element, checkEditable: () => ({ ok: true }) },
    resolveActionSessionId: async () => "fixture",
    callOnElementSync: async (_client, _locator, declaration, ...args) => vm.runInContext(`(${declaration})`, context).apply(target, args),
    kSetValueInputTypes: ["color", "date", "datetime-local", "month", "range", "time", "week"],
    kTypeIntoInputTypes: ["", "email", "number", "password", "search", "tel", "text", "url"],
    defaultModifierState: {},
    keyDown: async () => {},
    keyUp: async () => {},
  });
  vm.runInContext(functionSlice(bundle, "function contentEditableValueMatches(", "function isStaleObjectError("), context);
  const fill = vm.runInContext(`(${functionSlice(bundle, "async function fillElement(", "async function selectOptionElement(")})`, context);
  const client = { cdp: { send: async (method, { text }) => {
    assert.equal(method, "Input.insertText");
    calls.inserts++;
    if (kind === "contenteditable") target.innerText = format(text);
    else { target.value = text; target.dispatchEvent(new Event("input")); }
  } } };
  return { fill: (value) => fill(client, {}, value), target, calls };
}

for (const version of ["824", "902"]) {
  const bundle = readFileSync(path.join(root, `vendor/aside-${version}/apps/daemon/build/daemon.mjs`), "utf8");
  const oldReadback = "`function(kind) {\n" +
    "        const target = globalThis.__aside?.retarget(this, 'follow-label') || this;\n" +
    "        if (kind === 'contenteditable') return target.innerText || '';\n" +
    "        return typeof target.value === 'string' ? target.value : '';\n" +
    "      }`,";
  const unpatched = bundle.replace(/`function\(kind, expectedValue\) \{[\s\S]*?\n      \}`,(Jn|ri)\.kind,\1\.expectedValue\)/,
    (_match, result) => `${oldReadback}${result}.kind)`);
  assert.notEqual(unpatched, bundle);
  test(`${version}: original readback rejects grouping and maintained patch fixes that fixture`, async () => {
    await assert.rejects(makeFill(unpatched, { format: () => "200,000" }).fill("200000"), /expected value/);
    const file = path.join(temp, `${version}-original-readback.mjs`);
    writeFileSync(file, unpatched);
    const patched = spawnSync("python3", [patcher, "--refresh-numeric-fill", file], { encoding: "utf8" });
    assert.equal(patched.status, 0, patched.stderr);
    assert.equal(readFileSync(file, "utf8"), bundle);
  });
  for (const type of ["text", "search", "tel"]) {
    test(`${version}: ${type} accepts a lossless grouped number without fallback`, async () => {
      const f = makeFill(bundle, { type, format: () => "200,000" });
      await f.fill("200000");
      assert.equal(f.target.value, "200,000");
      assert.equal(f.calls.inputEvents, 1);
    });
  }
  test(`${version}: preserves leading zeros and arbitrary precision`, async () => {
    for (const [expected, actual] of [["000123", "000,123"], ["9007199254740993123", "9,007,199,254,740,993,123"]]) {
      await makeFill(bundle, { format: () => actual }).fill(expected);
    }
    await assert.rejects(makeFill(bundle, { format: () => "200,000" }).fill("0200000"), /expected value/);
  });
  for (const actual of ["100,000", "20,00,00", "200,00", " 200,000", "200,000원", "+200,000", "200,000.0"]) {
    test(`${version}: rejects altered or malformed numeric result ${actual}`, async () => {
      await assert.rejects(makeFill(bundle, { format: () => actual }).fill("200000"), /expected value/);
    });
  }
  test(`${version}: ordinary text retains exact matching`, async () => {
    await makeFill(bundle).fill("hello, world");
    await assert.rejects(makeFill(bundle, { format: () => "hello world" }).fill("hello, world"), /expected value/);
  });
  for (const type of ["number", "email", "url", "password"]) {
    test(`${version}: ${type} does not get numeric display normalization`, async () => {
      await assert.rejects(makeFill(bundle, { type, format: () => "200,000" }).fill("200000"), /expected value/);
    });
  }
  for (const kind of ["textarea", "contenteditable"]) {
    test(`${version}: ${kind} retains its existing matching contract`, async () => {
      await makeFill(bundle, { kind }).fill("200000");
      await assert.rejects(makeFill(bundle, { kind, format: () => "200,000" }).fill("200000"), /expected/);
    });
  }
  test(`${version}: patch refresh is idempotent and rejects changed anchors without writing`, () => {
    const file = path.join(temp, `${version}.mjs`);
    writeFileSync(file, bundle);
    const result = spawnSync("python3", [patcher, "--refresh-numeric-fill", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(file, "utf8"), bundle);
    const malformed = bundle.replace("function(kind, expectedValue) {", "function(changedKind, expectedValue) {");
    assert.notEqual(malformed, bundle);
    writeFileSync(file, malformed);
    const rejected = spawnSync("python3", [patcher, "--refresh-numeric-fill", file], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /anchor mismatch/);
    assert.equal(readFileSync(file, "utf8"), malformed);
  });
}
