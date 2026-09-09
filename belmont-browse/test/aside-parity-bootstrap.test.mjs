import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "aside-bootstrap-parity-"));
process.env.BELMONT_KNOWLEDGE_DIR = path.join(fixtureRoot, "knowledge");
mkdirSync(path.join(process.env.BELMONT_KNOWLEDGE_DIR, "sites"), { recursive: true });
const { syncKnowledgeIntoAccount, syncKnowledgeReadPermission, createBrowseSession, KNOWLEDGE_DIR } = await import("../src/session.mjs");
test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function fixture(permission = {}, link = "valid") {
  const accountRoot = mkdtempSync(path.join(fixtureRoot, "account-"));
  mkdirSync(path.join(accountRoot, "memory"));
  const sites = path.join(accountRoot, "memory", "sites");
  if (link === "valid") syncKnowledgeIntoAccount(accountRoot);
  if (link === "unrelated") symlinkSync(fixtureRoot, sites);
  if (link === "broken") symlinkSync(path.join(fixtureRoot, "absent"), sites);
  if (link === "directory") mkdirSync(sites);
  let stored = structuredClone(permission);
  let writes = 0;
  const store = {
    get: (key) => { assert.equal(key, "permission"); return structuredClone(stored); },
    set: (key, update) => { assert.equal(key, "permission"); stored = update(structuredClone(stored)); writes++; },
  };
  const A = { settings: (id) => { assert.equal(id, 0); return store; } };
  return { A, accountRoot, permission: () => stored, writes: () => writes, store };
}

test("knowledge bootstrap grants only canonical sites read access, preserving explicit policies", () => {
  const original = {
    rules: { default: "ask", allow: [{ toolName: "read_file" }], deny: [{ toolName: "terminal" }], ask: [] },
    files: { readableRoots: ["/previous/read"], writableRoots: ["/previous/write"], outsideRead: "ask", outsideWrite: "deny" },
    sandbox: { enabled: true },
  };
  const f = fixture(original);
  assert.equal(syncKnowledgeReadPermission(f.A, 0, f.accountRoot), true);
  assert.deepEqual(f.permission(), {
    ...original,
    files: { ...original.files, readableRoots: ["/previous/read", realpathSync(path.join(KNOWLEDGE_DIR, "sites"))] },
  });
  assert.equal(syncKnowledgeReadPermission(f.A, 0, f.accountRoot), false);
  assert.equal(f.writes(), 1);
  const playbook = path.join(KNOWLEDGE_DIR, "sites", "fresh.md");
  writeFileSync(playbook, "updated after bootstrap");
  assert.equal(readFileSync(path.join(f.accountRoot, "memory", "sites", "fresh.md"), "utf8"), "updated after bootstrap");
});

test("explicit outsideRead deny opts out without rewriting permission", () => {
  const original = { files: { outsideRead: "deny" }, rules: { default: "deny" }, sandbox: { enabled: true } };
  const f = fixture(original);
  assert.equal(syncKnowledgeReadPermission(f.A, 0, f.accountRoot), false);
  assert.deepEqual(f.permission(), original);
  assert.equal(f.writes(), 0);
});

for (const link of ["unrelated", "broken", "directory", "missing"]) {
  test(`${link} memory/sites never grants external roots`, () => {
    const f = fixture({}, link);
    assert.equal(syncKnowledgeReadPermission(f.A, 0, f.accountRoot), false);
    assert.deepEqual(f.permission(), {});
    assert.equal(f.writes(), 0);
  });
}

test("the locked settings callback respects a deny arriving after its initial read", () => {
  const f = fixture({ files: { outsideRead: "ask" } });
  let final;
  f.store.set = (_key, update) => { final = update({ files: { outsideRead: "deny" } }); };
  assert.equal(syncKnowledgeReadPermission(f.A, 0, f.accountRoot), false);
  assert.deepEqual(final, { files: { outsideRead: "deny" } });
});

test("direct browse session inherits account permissions without a broad knowledge override", () => {
  const f = fixture({ files: { outsideRead: "deny" } });
  let inserted;
  Object.assign(f.A, {
    getSessionStorageDir: () => path.join(f.accountRoot, "session"),
    createDefaultToolState: () => ({}),
    SessionStore: { insert: (_id, value) => { inserted = value; return value; } },
  });
  createBrowseSession(f.A, { accountId: 0, cwd: path.join(f.accountRoot, "cwd"), permissionMode: "guard" });
  assert.equal(Object.hasOwn(inserted, "permission"), false);
  assert.equal(inserted.permissionMode, "guard");
});
