import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertWslBuildSourceIdentity, captureWslBuildSourceIdentity, writeWslBuildLineage } from "../scripts/lib/wsl-build-lineage.mjs";

function fakeGit(outputs) {
  return async (_command, args) => {
    const operation = args.slice(2).join(" ");
    if (operation === "rev-parse HEAD") return { stdout: `${"a".repeat(40)}\n` };
    if (operation === "status --porcelain=v1 --untracked-files=all") return { stdout: outputs.status ?? "" };
    if (operation === "diff --binary --no-ext-diff HEAD --") return { stdout: outputs.diff ?? "" };
    if (operation === "ls-files --others --exclude-standard -z") return { stdout: outputs.untracked ?? "" };
    throw new Error(`unexpected git operation: ${operation}`);
  };
}

test("WSL build lineage detects stale tracked and untracked source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-build-lineage-"));
  try {
    await writeFile(path.join(root, "new.ts"), "one\n");
    const first = await captureWslBuildSourceIdentity({ repoRoot: root, executeGit: fakeGit({ status: "?? new.ts\n", untracked: "new.ts\0" }) });
    const lineagePath = path.join(root, "runtime", "dist", "wsl-build-lineage.json");
    const lineage = await writeWslBuildLineage(lineagePath, first, () => new Date("2026-08-26T00:00:00.000Z"));
    assert.equal(assertWslBuildSourceIdentity(lineage, first), lineage);
    assert.deepEqual(JSON.parse(await readFile(lineagePath, "utf8")), lineage);

    await writeFile(path.join(root, "new.ts"), "two\n");
    const changedUntracked = await captureWslBuildSourceIdentity({ repoRoot: root, executeGit: fakeGit({ status: "?? new.ts\n", untracked: "new.ts\0" }) });
    assert.notEqual(changedUntracked.combinedSha256, first.combinedSha256);
    assert.throws(() => assertWslBuildSourceIdentity(lineage, changedUntracked), /runtime is stale/u);

    const changedTracked = await captureWslBuildSourceIdentity({ repoRoot: root, executeGit: fakeGit({ status: " M source.ts\n", diff: "tracked change\n" }) });
    assert.notEqual(changedTracked.combinedSha256, first.combinedSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WSL build lineage rejects missing metadata", () => {
  assert.throws(() => assertWslBuildSourceIdentity({}, { head: "b".repeat(40), combinedSha256: "c".repeat(64) }), /no valid build lineage/u);
});
