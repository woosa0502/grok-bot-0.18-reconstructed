import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";
import * as acorn from "../../node_modules/acorn/dist/acorn.mjs";

const browse = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(browse, "vendor/aside-ext/AsideAgentManager/assets");
const original = path.resolve(browse, "../data/artifacts/aside-restoration_20260907T041632Z/raw/extension-comparison/original-824/assets");
const names = ["-page-DIRMOM6u.js", "search-view-DIBnKvBo.js"];
const sources = names.map((name) => readFileSync(path.join(assets, name), "utf8"));
const trees = sources.map((source) => acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }));
const patcher = path.join(browse, "tools/patch-omnibox-generation.py");

function arrow(file, name, contains = "") {
  const found = [];
  function visit(node) {
    if (node.type === "VariableDeclarator" && node.id.name === name) {
      let initializer = node.init;
      if (initializer && initializer.type === "CallExpression" && initializer.arguments.length && initializer.arguments[0].type === "ArrowFunctionExpression") {
        initializer = initializer.arguments[0];
      }
      if (initializer && initializer.type === "ArrowFunctionExpression") {
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
  assert.equal(found.length, 1, `Expected exactly one ${name} initializer`);
  return found[0];
}

function evaluate(file, name, bindings = {}, contains = "") {
  return vm.runInNewContext(`(${arrow(file, name, contains)})`, bindings);
}

const withGeneration = evaluate(0, "__belmontOmniboxWithGeneration");
const sameGeneration = evaluate(0, "__belmontOmniboxSameGeneration");
const normalize = evaluate(0, "Pe");
const selectionEquals = evaluate(0, "le");
const actionEquals = evaluate(0, "st");
const matchesEqual = evaluate(0, "et", { st: actionEquals });

function match(generation) {
  return { resultSequenceId: generation, destinationUrl: "https://same.test/",
    contents: "same", description: "same", fillIntoEdit: "query", type: "search-suggest",
    actions: [{ hint: "Action" }] };
}

function event() { return { preventDefault() {}, stopPropagation() {} }; }

test("pinned consumer patch replays byte-for-byte and is idempotent", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aside-generation-replay-"));
  try {
    for (const name of names) copyFileSync(path.join(original, name), path.join(directory, name));
    const first = spawnSync("python3", [patcher, "--assets", directory], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    for (const name of names) assert.deepEqual(readFileSync(path.join(directory, name)), readFileSync(path.join(assets, name)));
    const second = spawnSync("python3", [patcher, "--assets", directory], { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.ok(JSON.parse(second.stdout).every((entry) => entry.changed === false));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("unrecognized asset rejects before either input is modified", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aside-generation-reject-"));
  try {
    for (const name of names) copyFileSync(path.join(original, name), path.join(directory, name));
    const before = readFileSync(path.join(directory, names[0]));
    writeFileSync(path.join(directory, names[1]), "unexpected upstream version");
    const result = spawnSync("python3", [patcher, "--assets", directory], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unrecognized input hash/);
    assert.deepEqual(readFileSync(path.join(directory, names[0])), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("build hook patches copied output before mutations without reading installation keys", () => {
  const source = readFileSync(path.join(browse, "tools/build-aside-ext.mjs"), "utf8");
  const tree = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const call = (name) => tree.body.filter((node) => node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.name === name);
  const [copy] = call("cpSync"), hooks = call("execFileSync"), [firstWrite] = call("writeFileSync");
  assert.equal(hooks.length, 1);
  const [hook] = hooks;
  assert.ok(copy.end < hook.start && hook.end < firstWrite.start);
  const directory = mkdtempSync(path.join(tmpdir(), "aside-generation-build-hook-"));
  try {
    const output = path.join(directory, "copied-output");
    mkdirSync(path.join(output, "assets"), { recursive: true });
    for (const name of names) copyFileSync(path.join(original, name), path.join(output, "assets", name));
    // Execute only the actual production patch hook. No daemon import, key
    // factory, source mutation, profile lookup or extension launch is performed.
    vm.runInNewContext(source.slice(hook.start, hook.end), { execFileSync, path, ROOT: browse, OUT: output });
    for (const name of names) assert.deepEqual(readFileSync(path.join(output, "assets", name)), readFileSync(path.join(assets, name)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("both complete patched original modules parse", () => {
  for (let index = 0; index < names.length; index++) {
    assert.equal(trees[index].type, "Program");
    const result = spawnSync(process.execPath, ["--check", path.join(assets, names[index])], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("selection normalization retains its rendered generation", () => {
  const selected = normalize({ line: 0, actionIndex: 1, resultSequenceId: 10 });
  assert.equal(selected.resultSequenceId, 10);
  assert.equal(withGeneration(selected, match(11)).resultSequenceId, 0);
  assert.equal(withGeneration({ line: 0 }, match(11)).resultSequenceId, 11);
  assert.equal(selectionEquals(selected, { ...selected, resultSequenceId: 11 }), false);
});

test("render equality never hides a new result with identical URL and labels", () => {
  assert.equal(matchesEqual([match(10)], [match(11)]), false);
  assert.equal(sameGeneration([match(10)], [match(11)]), false);
  assert.equal(matchesEqual([match(10)], [match(10)]), true);
});

test("original action click closure sends the rendered match generation", () => {
  const calls = [];
  const factory = evaluate(1, "H", { c: { sessionId: "session" }, chrome: { asideOmnibox: { executeAction: (...args) => calls.push(args) } } });
  const displayed = match(10);
  const click = factory(displayed, 0, 1);
  const replacement = match(11);
  replacement.actions.reverse();
  click(event());
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].resultSequenceId, 10);
  assert.equal(calls[0][1].actionIndex, 1);
});

test("original navigation and deletion closures preserve captured generation", async () => {
  const calls = [];
  const chrome = { asideOmnibox: {
    openAutocompleteMatch: (...args) => calls.push(["open", ...args]),
    deleteAutocompleteMatch: async (...args) => calls.push(["delete", ...args]),
  } };
  const factory = evaluate(1, "P", { c: { sessionId: "session" }, chrome, G: () => null, a: () => false, Q: () => null });
  factory(match(10), 0)();
  const remove = evaluate(1, "O", { c: { sessionId: "session" }, chrome, z: () => false, i() {}, S: { error(message) { throw new Error(message); } } });
  await remove(match(10), 0)(event());
  assert.deepEqual(calls.map((entry) => [entry[0], entry[2].resultSequenceId]), [["open", 10], ["delete", 10]]);
});

test("original pointer and keyword selection carry match generation", () => {
  const pointerCalls = [];
  evaluate(1, "_", { v: (value) => pointerCalls.push(value) })(0, 10)();
  assert.equal(pointerCalls[0].resultSequenceId, 10);
  const scopeCalls = [];
  const keyword = evaluate(0, "we", {
    U: { current: { sessionId: "session" } }, N: { current: null },
    w: { current: [match(11)] }, _t: () => ({ keyword: "tabs" }),
    de: (...args) => scopeCalls.push(args),
  }, "U.current?.sessionId");
  keyword(match(10), 0);
  assert.equal(scopeCalls[0][2].resultSequenceId, 10);
});

test("commit binds selection to that rendered snapshot; an old keyboard closure cannot borrow its generation", () => {
  const oldMatch = match(10), nextMatch = match(11);
  const A = { current: normalize({ line: 0, resultSequenceId: 10 }) };
  const w = { current: [oldMatch] };
  const messages = [];
  const commit = evaluate(0, "ot", {
    A, w, Z: { current: "query" },
    Pe: normalize, __belmontOmniboxWithGeneration: withGeneration,
    __belmontOmniboxSameGeneration: sameGeneration, le: selectionEquals,
    et: matchesEqual, Zr: () => true, Xr: () => true, K() {}, Se: () => false,
    p: (message) => messages.push(message),
  });
  commit({ browserInputText: "query", matches: [nextMatch], sessionId: "session", shouldSyncSelection: false });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].selection.resultSequenceId, 11);
  assert.equal(A.current.resultSequenceId, 11);

  const requests = [];
  const submit = evaluate(0, "He", {
    t: "query", u: [oldMatch], A, L: { current: "query" },
    b: { sessionId: "session" }, E: { current: false }, h: { current: true },
    j: (value) => value.trim(), Fr: () => null, Dr: (_, selected) => selected,
    Qe: (matches, line) => matches[line], Ct: () => false, we: () => false,
    je: () => null, oe() {}, K() {}, performance: { now: () => 0 },
    __belmontOmniboxWithGeneration: withGeneration,
    chrome: { asideOmnibox: { openPopupSelection: (...args) => requests.push(args) } },
  }, "openPopupSelection");
  submit({ forceSelection: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1].selection.resultSequenceId, 0);
});

test("old keyboard HTTP fast navigation rejects after a new commit while the current callback navigates", () => {
  const oldMatch = { ...match(11), destinationUrl: "https://old.test/item" };
  const nextMatch = { ...match(12), destinationUrl: "https://new.test/item" };
  const A = { current: normalize({ line: 0, resultSequenceId: 11 }) };
  const w = { current: [oldMatch] };
  const calls = [];
  const chrome = { tabs: { update: (request) => calls.push(request) }, asideOmnibox: { openPopupSelection() { throw new Error("Unexpected native handoff"); } } };
  const navigate = evaluate(0, "Oe", { chrome, K() {}, performance: { now: () => 0 }, window: {} });
  const createSubmit = (rendered) => evaluate(0, "He", {
    t: "query", u: rendered, A, w, L: { current: "query" },
    b: { sessionId: "session" }, E: { current: false }, h: { current: true },
    j: (value) => value.trim(), Fr: () => null,
    Dr: (_, selected) => selected ?? { line: 0, state: "normal" },
    Qe: (matches, line) => matches[line], Ct: () => false, we: () => false,
    je: evaluate(0, "je", { URL }), Oe: navigate, oe() {}, K() {},
    performance: { now: () => 0 }, __belmontOmniboxWithGeneration: withGeneration, chrome,
  }, "openPopupSelection");
  const oldSubmit = createSubmit([oldMatch]);
  evaluate(0, "ot", {
    A, w, Z: { current: "query" }, Pe: normalize,
    __belmontOmniboxWithGeneration: withGeneration,
    __belmontOmniboxSameGeneration: sameGeneration, le: selectionEquals,
    et: matchesEqual, Zr: () => true, Xr: () => true, K() {}, Se: () => false, p() {},
  })({ browserInputText: "query", matches: [nextMatch], sessionId: "session", shouldSyncSelection: false });
  assert.equal(A.current.resultSequenceId, 12);
  assert.equal(oldSubmit({ forceSelection: true }), false);
  assert.equal(calls.length, 0);
  // A missing shared selection must not let the old match supply both sides
  // of the comparison. The committed matches still establish the current one.
  A.current = null;
  assert.equal(oldSubmit({ forceSelection: true }), false);
  assert.equal(calls.length, 0);
  assert.equal(createSubmit([nextMatch])({ forceSelection: true }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, nextMatch.destinationUrl);
});
