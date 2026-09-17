import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { resolveWorkspaceFile } from "../server.mjs";

// GPT Pro review (2026-09-16): the attachment preview/content API must expose ONLY box-workspace
// files and ingested agent attachments — never the rest of sand-data (manager.json, credentials,
// memory) — and must not be escapable via ".." or symlinks.
const sand = realpathSync(mkdtempSync(join(tmpdir(), "sand-guard-")));
const box = join(sand, "box-workspace");
const att = join(sand, "agents", "agent1", "attachments");
mkdirSync(box, { recursive: true });
mkdirSync(att, { recursive: true });
writeFileSync(join(box, "ok.txt"), "ws");
writeFileSync(join(att, "a.md"), "note");
writeFileSync(join(sand, "manager.json"), '{"managerAgentId":"x"}');
mkdirSync(join(sand, "agents", "agent1", "private"), { recursive: true });
writeFileSync(join(sand, "agents", "agent1", "private", "s.md"), "secret");
const outside = realpathSync(mkdtempSync(join(tmpdir(), "outside-")));
writeFileSync(join(outside, "secret.txt"), "top-secret");
symlinkSync(join(outside, "secret.txt"), join(box, "link.txt"));       // symlink escaping the sandbox
symlinkSync(join(sand, "manager.json"), join(box, "mlink.json"));       // symlink to a sensitive file
test.after(() => { rmSync(sand, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

test("allows box-workspace files (path and file:// form)", () => {
  assert.equal(resolveWorkspaceFile(sand, "/workspace/ok.txt"), join(box, "ok.txt"));
  assert.equal(resolveWorkspaceFile(sand, pathToFileURL(join(box, "ok.txt")).href), join(box, "ok.txt"));
});

test("allows ingested agent attachments", () => {
  assert.equal(resolveWorkspaceFile(sand, pathToFileURL(join(att, "a.md")).href), join(att, "a.md"));
});

test("rejects sand-data escape via .. (manager.json and other internals)", () => {
  assert.equal(resolveWorkspaceFile(sand, "/workspace/../manager.json"), null);
  assert.equal(resolveWorkspaceFile(sand, pathToFileURL(join(sand, "manager.json")).href), null);
});

test("rejects non-attachment files under an agent dir", () => {
  assert.equal(resolveWorkspaceFile(sand, pathToFileURL(join(sand, "agents", "agent1", "private", "s.md")).href), null);
});

test("rejects symlink escape out of the allowed subtrees", () => {
  assert.equal(resolveWorkspaceFile(sand, "/workspace/link.txt"), null);   // → outside sandbox
  assert.equal(resolveWorkspaceFile(sand, "/workspace/mlink.json"), null);  // → sand-data/manager.json
});

test("rejects absolute paths outside the allowed subtrees", () => {
  assert.equal(resolveWorkspaceFile(sand, join(outside, "secret.txt")), null);
  assert.equal(resolveWorkspaceFile(sand, `${sand}${sep}manager.json`), null);
});
