import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Bundle the real electron-main attachments module (resolving its local imports) so the test
// exercises the shipped sweepStagedAttachments, not a copy.
async function loadAttachments() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "belmont-attach-build-"));
  await symlink(path.join(repoRoot, "node_modules"), path.join(temporary, "node_modules"), "dir");
  const output = path.join(temporary, "module.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/attachments/attachments.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    packages: "external",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("sweepStagedAttachments removes stale staged files and keeps fresh ones", async () => {
  const { module, dispose } = await loadAttachments();
  const dir = await mkdtemp(path.join(os.tmpdir(), "belmont-staging-"));
  try {
    const stale = path.join(dir, "stale.png");
    const fresh = path.join(dir, "fresh.png");
    await writeFile(stale, "x");
    await writeFile(fresh, "y");
    const twoHoursAgoSec = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    await utimes(stale, twoHoursAgoSec, twoHoursAgoSec);

    const removed = await module.sweepStagedAttachments(dir, 60 * 60 * 1000);
    assert.equal(removed, 1, "only the stale file should be reaped");
    assert.deepEqual((await readdir(dir)).sort(), ["fresh.png"], "the fresh (in-flight) stage is untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await dispose();
  }
});

test("sweepStagedAttachments tolerates a missing staging directory", async () => {
  const { module, dispose } = await loadAttachments();
  try {
    const removed = await module.sweepStagedAttachments(path.join(os.tmpdir(), `belmont-missing-${Date.now()}`));
    assert.equal(removed, 0);
  } finally {
    await dispose();
  }
});
