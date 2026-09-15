import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BelmontMemoryBridge, listKnowledgeMarkdown } from "../dist/index.js";
import { setup, remember, NOW } from "./helpers.mjs";
test("host bridge retries confirmedRemember safely after generation changes", (t) => {
  const s = setup(); t.after(() => s.kernel.close()); const bridge = new BelmontMemoryBridge(s.user, s.agent);
  const input = { scope: "user:demo", content: "좋아하는 자리", kind: "profile", messageId: "ui-confirm-17", occurredAt: NOW };
  const one = bridge.confirmedRemember(input); remember(s.user, "unrelated");
  assert.deepEqual(bridge.confirmedRemember(input), one);
});
test("knowledge enumerator rejects outside symlink and terminates cycles", (t) => {
  const base = mkdtempSync(join(tmpdir(), "belmont-path-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "knowledge"), sites = join(root, "sites"); mkdirSync(sites, { recursive: true });
  writeFileSync(join(sites, "allowed.md"), "allowed"); writeFileSync(join(base, "secret.md"), "secret");
  symlinkSync(join(base, "secret.md"), join(sites, "escape.md")); symlinkSync(root, join(sites, "loop"));
  assert.deepEqual(listKnowledgeMarkdown(sites, root), [join(sites, "allowed.md")]);
});
test("canonical knowledge root itself may be a symlink", (t) => {
  const base = mkdtempSync(join(tmpdir(), "belmont-root-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const actual = join(base, "actual"), link = join(base, "knowledge"); mkdirSync(actual); writeFileSync(join(actual, "page.md"), "page"); symlinkSync(actual, link);
  assert.deepEqual(listKnowledgeMarkdown(link, link), [join(actual, "page.md")]);
});
