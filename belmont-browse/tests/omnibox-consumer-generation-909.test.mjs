// Same checks as omnibox-consumer-generation-907.test.mjs against the 1.26.909.1820 pair; the minifier renamed the
// refinement/expansion comparators (907 en/tn -> 909 Jr/en), the trim helper (_ -> R) and the message sink (f -> p).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";
import * as acorn from "../../node_modules/acorn/dist/acorn.mjs";

const browse = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const campaign = path.resolve(browse, "../data/artifacts/aside-909-20260909");
// The pinned archive (components-909.tgz) extracts to AsideAgentManager/<version>/assets like the 907 pair; a raw CRX
// extraction keeps the flat AsideAgentManager/assets layout. Accept either so the local campaign folder and CI agree.
const original = ["AsideAgentManager/1.26.909.1820/assets", "AsideAgentManager/assets"]
  .map((relative) => path.join(campaign, relative))
  .find((candidate) => existsSync(path.join(candidate, "-page-C7w40MhN.js")));
assert.ok(original, `no 909 agent-manager assets under ${campaign}`);
const names = ["-page-C7w40MhN.js", "search-view-C5yihfsp.js"];
const patcher = path.join(browse, "tools/patch-omnibox-generation.py");
const directory = mkdtempSync(path.join(tmpdir(), "aside-generation-909-"));
for (const name of names) copyFileSync(path.join(original, name), path.join(directory, name));
const run = () => spawnSync("python3", [patcher, "--assets", directory], { encoding: "utf8" });
const first = run();
assert.equal(first.status, 0, first.stderr);
const sources = names.map((name) => readFileSync(path.join(directory, name), "utf8"));
const trees = sources.map((source) => acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }));
test.after(() => rmSync(directory, { recursive: true, force: true }));

function evaluate(file, name, bindings = {}, contains = "") {
  const found = [];
  function visit(node) {
    if (node.type === "VariableDeclarator" && node.id.name === name) {
      let initializer = node.init;
      if (initializer?.type === "CallExpression" && initializer.arguments[0]?.type === "ArrowFunctionExpression") initializer = initializer.arguments[0];
      if (initializer?.type === "ArrowFunctionExpression") {
        const source = sources[file].slice(initializer.start, initializer.end);
        if (source.includes(contains)) found.push(source);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => child && typeof child === "object" && visit(child));
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(trees[file]);
  assert.equal(found.length, 1, `Expected one ${name} containing ${contains}`);
  return vm.runInNewContext(`(${found[0]})`, bindings);
}

const bind = evaluate(0, "__belmontOmniboxWithGeneration");
const same = evaluate(0, "__belmontOmniboxSameGeneration");
const normalize = evaluate(0, "Pe");
const equalSelection = evaluate(0, "ue");
const equalMatches = evaluate(0, "st", { it: evaluate(0, "it") });
const match = (resultSequenceId, destinationUrl = "https://same.test/") => ({ resultSequenceId, destinationUrl, contents: "same", description: "same", fillIntoEdit: "query", type: "search-suggest" });

test("909 exact pinned outputs replay, parse and remain idempotent", () => {
  assert.deepEqual(JSON.parse(first.stdout).map((entry) => entry.after), [
    "93dd5f3c05c05bd92bfe802df8ef6c0a9f3be06271a01c7c380a1e7eb1064622",
    "9b55f8521ac655cb572d7b2c541638d17c94cd4a342885b02a43ae97f19f93a2",
  ]);
  for (const name of names) {
    const checked = spawnSync(process.execPath, ["--check", path.join(directory, name)], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  }
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.ok(JSON.parse(second.stdout).every((entry) => !entry.changed));
});

test("906 original pair still produces the previously pinned output", () => {
  const input = path.resolve(browse, "../data/artifacts/aside-restoration_20260907T041632Z/raw/extension-comparison/original-906/assets");
  const temporary = mkdtempSync(path.join(tmpdir(), "aside-generation-906-"));
  try {
    for (const name of ["-page-CdoPoOp1.js", "search-view--fIYrfC3.js"]) copyFileSync(path.join(input, name), path.join(temporary, name));
    const replay = spawnSync("python3", [patcher, "--assets", temporary], { encoding: "utf8" });
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(JSON.parse(replay.stdout).map((entry) => entry.after), [
      "7748b1c1cff3c3bea06d60337b8968de3f33a5f1505f2ddcf155ca538bf6a2f1",
      "13fa3b38ae3cf171615e83ebc1b48fac742bd1a9fee194af06f6357715cfffd9",
    ]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("909 corrupt second asset fails before changing first asset", () => {
  const before = readFileSync(path.join(directory, names[0]));
  const search = readFileSync(path.join(directory, names[1]));
  writeFileSync(path.join(directory, names[1]), Buffer.concat([search, Buffer.from("\n")]));
  try {
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /unrecognized input hash/);
    assert.deepEqual(readFileSync(path.join(directory, names[0])), before);
  } finally { writeFileSync(path.join(directory, names[1]), search); }
});

test("909 selections and equality distinguish identical results in different generations", () => {
  assert.equal(normalize({ line: 0, resultSequenceId: 10 }).resultSequenceId, 10);
  assert.equal(bind({ line: 0, resultSequenceId: 10 }, match(11)).resultSequenceId, 0);
  assert.equal(equalSelection({ line: 0, resultSequenceId: 10 }, { line: 0, resultSequenceId: 11 }), false);
  assert.equal(equalMatches([match(10)], [match(11)]), false);
  assert.equal(same([match(10)], [match(11)]), false);
});

test("909 commit rebinds an inherited selection to its new rendered generation", () => {
  const I = { current: normalize({ line: 0, resultSequenceId: 10 }) };
  const x = { current: [match(10)] };
  const messages = [];
  evaluate(0, "lt", {
    I, x, Y: { current: "query" }, Pe: normalize, ue: equalSelection, st: equalMatches,
    __belmontOmniboxWithGeneration: bind, __belmontOmniboxSameGeneration: same,
    Jr: () => true, en: () => true, z() {}, ye: () => false, p: (value) => messages.push(value),
  })({ browserInputText: "query", matches: [match(11)], shouldSyncSelection: false });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].selection.resultSequenceId, 11);
  assert.equal(I.current.resultSequenceId, 11);
});

test("909 old keyboard HTTP closure rejects while current generation navigates", () => {
  const old = match(10), next = match(11);
  const I = { current: normalize({ line: 0, resultSequenceId: 11 }) };
  const x = { current: [next] }, navigations = [];
  const submit = (displayed) => evaluate(0, "He", {
    t: "query", u: displayed, I, x, L: { current: "query" }, b: { sessionId: "session" },
    C: { current: false }, h: { current: true }, R: (value) => value.trim(), Hr: () => null,
    Ur: (_, selected) => selected ?? { line: 0, state: "normal" }, Ze: (matches, line) => matches[line],
    At: () => false, he: () => false, Ae: (url) => url, ce() {}, z() {},
    Oe: (url) => navigations.push(url), __belmontOmniboxWithGeneration: bind,
  }, "openPopupSelection");
  assert.equal(submit([old])({ forceSelection: true }), false);
  I.current = null;
  assert.equal(submit([old])({ forceSelection: true }), false);
  assert.equal(navigations.length, 0);
  assert.equal(submit([next])({ forceSelection: true }), true);
  assert.equal(navigations.length, 1);
});

test("909 native keyboard handoff cannot borrow the new committed generation", () => {
  const calls = [];
  const submit = evaluate(0, "He", {
    t: "query", u: [match(10)], I: { current: normalize({ line: 0, resultSequenceId: 11 }) },
    L: { current: "query" }, b: { sessionId: "session" }, C: { current: false }, h: { current: true },
    R: (value) => value.trim(), Hr: () => null, Ur: (_, selected) => selected,
    Ze: (matches, line) => matches[line], At: () => false, he: () => false, Ae: () => null,
    ce() {}, z() {}, performance: { now: () => 0 }, __belmontOmniboxWithGeneration: bind,
    chrome: { asideOmnibox: { openPopupSelection: (...args) => calls.push(args) } },
  }, "openPopupSelection");
  assert.equal(submit({ forceSelection: true }), true);
  assert.equal(calls[0][1].selection.resultSequenceId, 0);
});

test("909 pointer selection retains the event's rendered generation", () => {
  const calls = [];
  evaluate(1, "P", { v: (value) => calls.push(value) })(0, 10)();
  assert.equal(calls[0].resultSequenceId, 10);
});

test("909 scoped-query normalization and stale-query rejection remain present", () => {
  const raw = readFileSync(path.join(original, names[0]), "utf8");
  const guard = 'const O=tt(v.input??"",B.current),Z=(N.current&&jt(O,N.current))??O,G=R(Z),W=v.matches??[],We=j.current;';
  assert.ok(raw.includes(guard));
  assert.ok(sources[0].includes(guard));
  const diagnostics = [];
  const result = evaluate(0, "r", {
    b: { sessionId: "session" }, te: { current: false }, w: { current: 0 },
    window: { cancelAnimationFrame() {} }, tt: (value) => value, N: { current: null },
    B: { current: "new query" }, R: (value) => value.trim(), j: { current: null },
    z: (value) => diagnostics.push(value),
  }, "autocomplete-stale-result");
  result("session", { input: "old query", matches: [match(10)] });
  assert.deepEqual(diagnostics, ["autocomplete-stale-result"]);
});
