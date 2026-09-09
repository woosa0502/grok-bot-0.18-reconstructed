import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { parseExpressionAt } from "acorn";

const repo = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(repo, "data/artifacts/aside-full-restoration_20260907T225545Z/raw/AsideDaemon-mac-x64-1.26.907.1712.mjs"), "utf8");
const patcher = path.join(repo, "belmont-browse/tools/patch-password-session.py");
const dir = mkdtempSync(path.join(tmpdir(), "aside-password-lock-"));
after(() => rmSync(dir, { recursive: true, force: true }));
function patch(input, version = "1.26.907.1712") {
  const inputPath = path.join(dir, "input.mjs");
  const outputPath = path.join(dir, "output.mjs");
  writeFileSync(inputPath, input);
  writeFileSync(outputPath, "unchanged");
  const result = spawnSync("python3", [patcher, inputPath, outputPath, version], { encoding: "utf8" });
  return { ...result, output: readFileSync(outputPath, "utf8") };
}
const result = patch(source);
assert.equal(result.status, 0, result.stderr);
const patched = result.output;
function extract(input, name) {
  const match = new RegExp(`(?:async )?function ${name.replaceAll("$", "\\$")}\\(`).exec(input);
  assert.ok(match, name);
  const node = parseExpressionAt(input, match.index, { ecmaVersion: "latest", sourceType: "module" });
  return input.slice(node.start, node.end);
}
function runtime(input, timeout) {
  let now = 1_000_000;
  const calls = [];
  const context = {
    sessionStates: new Map(), UI_LOCKED_EXPIRES_AT: 0,
    Date: { now: () => now },
    clearSessionKeychain: async () => {}, cancelPendingKeychainSave() {}, cancelKeychainExpiryTimer() {},
    clearPasswordSearchIndex() {}, scheduleKeychainClear: (...args) => calls.push(args), persistToKeychain() {},
    clearPasswordSession(id) { context.sessionStates.delete(id); },
    vaultKeyRepo: { getAll: () => [] }, vaultRepo: { getAll: () => [] },
    getPasswordManagerSettings: async () => ({ autoLockTimeout: timeout }),
    PasswordManagerError: class extends Error { constructor(message, code) { super(message); this.code = code; } },
  };
  vm.createContext(context);
  const names = ["makeEmptyState", "getState", "isExpired$1", "getSessionMasterKey", "sessionExpiresAt", "refreshPasswordSessionExpiry", "lockPasswordUiSession", "isPasswordUiSessionExplicitlyLocked", "getAgentSessionMasterKey", "setPasswordSession"];
  const start = input.indexOf("PasswordManager=class{") + "PasswordManager=".length;
  const node = parseExpressionAt(input, start, { ecmaVersion: "latest", sourceType: "module" });
  const api = vm.runInContext(names.map((name) => extract(input, name)).join("\n") + `\nvar PasswordManager=${input.slice(node.start, node.end)};\n({getState,getSessionMasterKey,getAgentSessionMasterKey,lockPasswordUiSession,isPasswordUiSessionExplicitlyLocked,refreshPasswordSessionExpiry,setPasswordSession,manager:new PasswordManager})`, context);
  const seed = (id) => {
    const state = api.getState(id);
    state.masterKey = new Uint8Array(32).fill(id);
    state.expiresAt = null;
    state.agentExpiresAt = null;
    return state;
  };
  return { api, calls, seed, advance: (ms) => now += ms };
}

test("907 password lock patch is version scoped, idempotent and fails without exact anchors", () => {
  assert.equal(patch(source, "1.26.906.1714").output, source);
  assert.equal(patch(patched).output, patched);
  for (const input of [source.replace("function refreshPasswordSessionExpiry(", "function changedExpiry("), source.replace("function isPasswordUiSessionExplicitlyLocked(", "function changedPredicate("), patched.replace("function isPasswordUiSessionExplicitlyLocked(", "function changedPredicate(")]) {
    const bad = patch(input);
    assert.notEqual(bad.status, 0);
    assert.equal(bad.output, "unchanged");
  }
});

test("original never-expire setting reproduces explicit UI lock loss", async () => {
  const r = runtime(source, -1);
  r.seed(1);
  r.api.lockPasswordUiSession(1);
  assert.equal(r.api.getSessionMasterKey(1), null);
  assert.ok(await r.api.manager.requireUnlockedMasterKey(1));
  assert.equal(r.api.isPasswordUiSessionExplicitlyLocked(1), false);
});

for (const timeout of [-1, 15]) {
  test(`explicit UI lock survives repeated activity with timeout ${timeout}`, async () => {
    const r = runtime(patched, timeout);
    r.seed(1);
    r.seed(2);
    const agentKey = r.api.getAgentSessionMasterKey(1);
    r.api.lockPasswordUiSession(1);
    for (let attempt = 0; attempt < 3; attempt++) {
      r.advance(1000);
      await assert.rejects(r.api.manager.requireUnlockedMasterKey(1), (error) => error.code === "LOCKED");
      assert.equal(r.api.getSessionMasterKey(1), null);
      assert.equal(r.api.isPasswordUiSessionExplicitlyLocked(1), true);
      assert.equal(r.api.getAgentSessionMasterKey(1), agentKey);
    }
    assert.ok(await r.api.manager.requireUnlockedMasterKey(2));
    assert.equal(r.api.isPasswordUiSessionExplicitlyLocked(2), false);
  });
}

test("unlocked activity still refreshes expiry and ordinary expiry still locks UI", async () => {
  const r = runtime(patched, 15);
  r.seed(1);
  await r.api.manager.requireUnlockedMasterKey(1);
  const first = r.api.getState(1).expiresAt;
  r.advance(1000);
  await r.api.manager.requireUnlockedMasterKey(1);
  assert.equal(r.api.getState(1).expiresAt, first + 1000);
  r.advance(15 * 60 * 1000 + 1);
  assert.equal(r.api.getSessionMasterKey(1), null);
});
