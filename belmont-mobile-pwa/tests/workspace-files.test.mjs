import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listWorkspace, resolveWorkspacePath } from "../belmont-adapter.mjs";

test("workspace paths stay inside the root, through dot-dot and symlinks alike", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "belmont-ws-"));
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  await mkdir(path.join(root, "reports"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "reports", "weekly.md"), "# weekly");
  await writeFile(path.join(root, ".secret"), "hidden");
  await writeFile(path.join(outside, "leak.txt"), "nope");
  await symlink(outside, path.join(root, "escape"));
  try {
    assert.equal((await resolveWorkspacePath(root, "")).relative, "");
    assert.equal((await resolveWorkspacePath(root, "reports/weekly.md")).relative, "reports/weekly.md");
    assert.equal(await resolveWorkspacePath(root, "../outside/leak.txt"), null);
    assert.equal(await resolveWorkspacePath(root, "escape/leak.txt"), null, "symlink out of the root must be refused");
    assert.equal(await resolveWorkspacePath(root, "missing.txt"), null);
    assert.equal(await resolveWorkspacePath(root, ".secret"), null, "dot paths are not reachable");
    const listing = await listWorkspace(await resolveWorkspacePath(root, ""));
    assert.deepEqual(listing.entries.map((entry) => `${entry.kind}:${entry.name}`), ["dir:reports"], "hidden files and escaping symlinks are not listed");
    const reports = await listWorkspace(await resolveWorkspacePath(root, "reports"));
    assert.equal(reports.entries[0].name, "weekly.md");
    assert.equal(reports.entries[0].kind, "text");
    assert.equal(reports.entries[0].size, 8);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
