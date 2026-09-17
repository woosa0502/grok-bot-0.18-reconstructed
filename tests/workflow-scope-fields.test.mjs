import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// This pure metadata module has no runtime imports. Exercise the actual source
// with Node's built-in type stripping; no npm dependencies or app state required.
const source = readFileSync(new URL("../source/shared/workflow-scope.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source);
const { readWorkflowScopeFields: readScope } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const keys = ["globs", "environments", "scoped_to"];

for (const [label, value] of [
  ["undefined", undefined], ["null", null], ["boolean", true],
  ["number", 42], ["string", "*.ts"], ["array", []], ["function", () => {}],
]) {
  test(`scope metadata ignores non-record input: ${label}`, () => {
    assert.deepEqual(readScope(value), {});
  });
}

test("all three scope fields are copied as passive metadata", () => {
  const input = { globs: ["**/*.ts", "*coupang*"], environments: ["production"], scoped_to: ["agent-a"] };
  assert.deepEqual(readScope(input), input);
});

test("missing fields are absent rather than synthesized empty arrays", () => {
  const actual = readScope({ name: "Legacy skill" });
  assert.deepEqual(actual, {});
  for (const key of keys) assert.equal(Object.hasOwn(actual, key), false);
});

for (const key of keys) {
  test(`${key}: scalar/object values are ignored without coercion`, () => {
    for (const invalid of [undefined, null, "*.ts", 1, false, { allow: ["a"] }]) {
      assert.deepEqual(readScope({ [key]: invalid }), {});
    }
  });
  test(`${key}: trims, drops invalid entries, and deduplicates in order`, () => {
    assert.deepEqual(readScope({ [key]: [" b ", 1, false, null, [], {}, "", "\t", "a", "b", "a"] }), {
      [key]: ["b", "a"],
    });
  });
  test(`${key}: explicit empty arrays remain explicit`, () => {
    assert.deepEqual(readScope({ [key]: [] }), { [key]: [] });
    assert.deepEqual(readScope({ [key]: [" ", 1, null] }), { [key]: [] });
  });
}

test("does not compile globs or normalize case, Unicode, or path separators", () => {
  const patterns = ["쿠팡*", "**/*.{ts,tsx}", "!secret/**", "[", "C:\\Work\\*.TS", "ReadMe.MD"];
  assert.deepEqual(readScope({ globs: patterns }).globs, patterns);
});

test("unrelated and future fields are not misinterpreted as the three scope fields", () => {
  assert.deepEqual(readScope({ disabled_environments: ["production"], enabled: false, metadata: { globs: ["*.ts"] } }), {});
});

test("normalization does not mutate frozen input or reuse its arrays", () => {
  const input = Object.freeze({
    globs: Object.freeze([" *.ts ", "*.ts"]),
    environments: Object.freeze(["wsl"]),
    scoped_to: Object.freeze(["a"]),
  });
  const first = readScope(input), second = readScope(input);
  assert.deepEqual(first.globs, ["*.ts"]);
  assert.deepEqual(input.globs, [" *.ts ", "*.ts"]);
  for (const key of keys) {
    assert.notStrictEqual(first[key], input[key]);
    assert.notStrictEqual(first[key], second[key]);
  }
});

test("inherited scope keys cannot accidentally become skill metadata", () => {
  const input = Object.create({ globs: ["*.ts"], environments: ["wsl"], scoped_to: ["a"] });
  assert.deepEqual(readScope(input), {});
});

test("null-prototype records and an own hasOwnProperty key are safe", () => {
  const input = Object.assign(Object.create(null), { globs: ["*.ts"], hasOwnProperty: false });
  assert.deepEqual(readScope(input), { globs: ["*.ts"] });
});
