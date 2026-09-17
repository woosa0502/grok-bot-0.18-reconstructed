// The per-session document-read planners must (a) leave ordinary sessions untouched and (b) for eval sessions
// drop the operational site knowledge from both the bash isolate allowRoots and the read_file permission while
// re-exposing the candidate overlay and keeping the rest of account memory. Uses a real temp filesystem so the
// memory/sites symlink is resolved exactly as in production.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evalIsolate, evalPermission, evalReadableRoots, operationalSitesRoots, evalSitesDir } from "../src/eval-isolation.mjs";

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "belmont-evaliso-"));
  const accountRoot = path.join(base, "account");
  const knowledgeDir = path.join(base, "knowledge");
  const opSites = path.join(knowledgeDir, "sites");
  const overlay = path.join(base, "eval", "sites");
  fs.mkdirSync(path.join(accountRoot, "memory", "rules"), { recursive: true });
  fs.mkdirSync(opSites, { recursive: true });
  fs.mkdirSync(overlay, { recursive: true });
  fs.writeFileSync(path.join(opSites, "example.com.md"), "OPERATIONAL");
  fs.writeFileSync(path.join(overlay, "example.com.md"), "OVERLAY");
  fs.symlinkSync(opSites, path.join(accountRoot, "memory", "sites")); // syncKnowledgeIntoAccount's alias
  return { base, accountRoot, knowledgeDir, opSites, overlay, memSites: path.join(accountRoot, "memory", "sites") };
}

const evalSession = (sitesDir) => ({ runtimeConfig: { sitesDir } });

test("ordinary session: planners are pass-through", () => {
  const f = fixture();
  try {
    const perm = { files: { readableRoots: [f.accountRoot, f.opSites], writableRoots: [f.accountRoot], outsideRead: "ask", outsideWrite: "ask" } };
    assert.equal(evalSitesDir({ runtimeConfig: {} }), null);
    assert.equal(evalIsolate({ session: { runtimeConfig: {} }, accountRoot: f.accountRoot, readableRoots: [f.accountRoot], writableRoots: [], knowledgeDir: f.knowledgeDir }), null);
    assert.deepEqual(evalPermission(perm, { runtimeConfig: {} }, f.accountRoot, f.knowledgeDir), perm);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test("eval readable roots: operational sites dropped, account root kept, overlay added", () => {
  const f = fixture();
  try {
    const roots = evalReadableRoots([f.accountRoot, f.opSites, "/runtime"], f.accountRoot, f.overlay, f.knowledgeDir);
    assert.ok(roots.includes(path.resolve(f.accountRoot)), "account root kept (contains, but is not, operational)");
    assert.ok(roots.includes(path.resolve(f.overlay)), "overlay added");
    assert.ok(roots.includes("/runtime"), "unrelated root kept");
    assert.ok(!roots.includes(path.resolve(f.opSites)), "explicit operational sites root dropped");
    assert.ok(!roots.some((r) => r === fs.realpathSync(f.opSites)), "operational sites realpath dropped");
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test("operationalSitesRoots covers the memory/sites alias and the knowledge/sites target (literal + realpath)", () => {
  const f = fixture();
  try {
    const op = operationalSitesRoots(f.accountRoot, f.knowledgeDir);
    assert.ok(op.includes(path.resolve(f.memSites)), "memory/sites literal alias");
    assert.ok(op.includes(fs.realpathSync(f.memSites)), "memory/sites realpath (= operational target)");
    assert.ok(op.includes(path.resolve(f.opSites)), "knowledge/sites literal");
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test("eval isolate plan: allowRoots scoped, excludeRoots name the operational subtree", () => {
  const f = fixture();
  try {
    const plan = evalIsolate({
      session: evalSession(f.overlay), accountRoot: f.accountRoot,
      readableRoots: [f.accountRoot, f.opSites], writableRoots: [path.join(f.accountRoot, "memory")], knowledgeDir: f.knowledgeDir,
    });
    assert.ok(plan, "eval session yields a plan");
    assert.ok(plan.allowRoots.includes(path.resolve(f.overlay)), "overlay allowed");
    assert.ok(plan.allowRoots.includes(path.resolve(f.accountRoot)), "account root allowed");
    assert.ok(!plan.allowRoots.includes(path.resolve(f.opSites)), "operational sites not an allowRoot");
    assert.ok(plan.excludeRoots.includes(path.resolve(f.memSites)), "memory/sites excluded");
    assert.ok(plan.excludeRoots.includes(fs.realpathSync(f.opSites)), "operational target excluded");
    assert.deepEqual(plan.writableRoots, [path.join(f.accountRoot, "memory")], "writable roots preserved");
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test("eval permission: operational dropped, overlay added, outside read/write denied", () => {
  const f = fixture();
  try {
    const perm = { files: { readableRoots: [f.accountRoot, f.opSites], writableRoots: [f.accountRoot], outsideRead: "ask", outsideWrite: "ask" } };
    const scoped = evalPermission(perm, evalSession(f.overlay), f.accountRoot, f.knowledgeDir);
    assert.equal(scoped.files.outsideRead, "deny");
    assert.equal(scoped.files.outsideWrite, "deny");
    assert.ok(scoped.files.readableRoots.includes(path.resolve(f.overlay)), "overlay readable");
    assert.ok(scoped.files.readableRoots.includes(path.resolve(f.accountRoot)), "account root readable");
    assert.ok(!scoped.files.readableRoots.includes(path.resolve(f.opSites)), "operational sites not readable");
    assert.deepEqual(scoped.files.writableRoots, perm.files.writableRoots, "writable roots unchanged by the read scope");
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});
