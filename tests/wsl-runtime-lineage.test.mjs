import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectWslRuntimeLineage, writeWslRuntimeLineage } from "../scripts/lib/wsl-runtime-lineage.mjs";

test("WSL launcher records reproducible Git, process, profile, and build lineage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-runtime-lineage-"));
  const appRoot = path.join(root, ".build", "belmont-wsl-runtime");
  const profileDir = path.join(root, ".cache", "belmont-wsl-profile");
  try {
    await mkdir(path.join(appRoot, "dist", "electron-main"), { recursive: true });
    await mkdir(path.join(appRoot, "dist", "host"), { recursive: true });
    await mkdir(path.join(appRoot, "dist", "renderer"), { recursive: true });
    await writeFile(path.join(appRoot, "dist", "electron-main", "main.cjs"), "main");
    await writeFile(path.join(appRoot, "dist", "host", "host-main.cjs"), "host");
    await writeFile(path.join(appRoot, "dist", "renderer", "index.html"), "renderer");
    await writeFile(path.join(appRoot, "dist", "renderer-artifact-provenance.json"), JSON.stringify({
      mode: "checksum-pinned-artifact-runtime",
      inventorySha256: "a".repeat(64),
      sourceArtifactSha256: "b".repeat(64),
    }));
    const gitCalls = [];
    const executeGit = async (_command, args) => {
      gitCalls.push(args);
      return { stdout: args.includes("rev-parse") ? `${"c".repeat(40)}\n` : " M scripts/run-wsl.mjs\n" };
    };
    const lineage = await collectWslRuntimeLineage({
      repoRoot: root,
      appRoot,
      profileDir,
      debugPort: 9347,
      processes: {
        runner: { pid: 10, startedAt: "2026-08-25T00:00:00.000Z" },
        host: { pid: 11, startedAt: "2026-08-25T00:00:01.000Z" },
        electron: { pid: 12, startedAt: "2026-08-25T00:00:02.000Z" },
      },
      now: () => new Date("2026-08-25T00:00:03.000Z"),
      executeGit,
      runtimeGenerationId: "generation-test",
    });
    assert.equal(lineage.runtimeGenerationId, "generation-test");
    assert.equal(lineage.debugEndpoint, "http://127.0.0.1:9347");
    assert.equal(lineage.git.head, "c".repeat(40));
    assert.equal(lineage.git.treeClean, false);
    assert.deepEqual(lineage.git.treeStatus, [" M scripts/run-wsl.mjs"]);
    assert.equal(lineage.profileDir, profileDir);
    assert.equal(lineage.processes.electron.pid, 12);
    assert.equal(lineage.build.rendererProvenance.mode, "checksum-pinned-artifact-runtime");
    assert.equal(lineage.build.rendererProvenance.inventorySha256, "a".repeat(64));
    assert.match(lineage.build.electronMain.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(gitCalls.length, 2);
    const output = path.join(profileDir, "sand-data", "runtime-lineage.json");
    await writeWslRuntimeLineage(output, lineage);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), lineage);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WSL lineage keeps non-CDP product starts valid", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-runtime-lineage-no-cdp-"));
  const appRoot = path.join(root, "runtime");
  try {
    await mkdir(path.join(appRoot, "dist", "electron-main"), { recursive: true });
    await mkdir(path.join(appRoot, "dist", "host"), { recursive: true });
    await mkdir(path.join(appRoot, "dist", "renderer"), { recursive: true });
    await writeFile(path.join(appRoot, "dist", "electron-main", "main.cjs"), "main");
    await writeFile(path.join(appRoot, "dist", "host", "host-main.cjs"), "host");
    await writeFile(path.join(appRoot, "dist", "renderer", "index.html"), "renderer");
    await writeFile(path.join(appRoot, "dist", "renderer-artifact-provenance.json"), JSON.stringify({}));
    const lineage = await collectWslRuntimeLineage({
      repoRoot: root,
      appRoot,
      profileDir: path.join(root, "profile"),
      debugPort: null,
      processes: { runner: { pid: 1, startedAt: "x" }, host: { pid: 2, startedAt: "x" }, electron: { pid: 3, startedAt: "x" } },
      executeGit: async (_command, args) => ({ stdout: args.includes("rev-parse") ? `${"d".repeat(40)}\n` : "" }),
    });
    assert.equal(lineage.debugEndpoint, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
