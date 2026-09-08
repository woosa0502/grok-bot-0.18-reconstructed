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
    const sourceIdentity = { schemaVersion: 1, head: "c".repeat(40), treeClean: false, statusSha256: "e".repeat(64), trackedDiffSha256: "f".repeat(64), untrackedSha256: "0".repeat(64), untrackedPaths: [], combinedSha256: "1".repeat(64) };
    const buildLineage = { schemaVersion: 1, builtAt: "2026-08-25T00:00:00.000Z", sourceIdentity };
    await writeFile(path.join(appRoot, "dist", "wsl-build-lineage.json"), JSON.stringify(buildLineage));
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
      buildLineage,
      sourceIdentity,
    });
    assert.equal(lineage.runtimeGenerationId, "generation-test");
    assert.equal(lineage.debugEndpoint, "http://127.0.0.1:9347");
    assert.equal(lineage.git.head, "c".repeat(40));
    assert.equal(lineage.git.treeClean, false);
    assert.deepEqual(lineage.git.treeStatus, []);
    assert.equal(lineage.git.sourceIdentitySha256, "1".repeat(64));
    assert.equal(lineage.profileDir, profileDir);
    assert.equal(lineage.processes.electron.pid, 12);
    assert.equal(lineage.build.rendererProvenance.mode, "checksum-pinned-artifact-runtime");
    assert.equal(lineage.build.rendererProvenance.inventorySha256, "a".repeat(64));
    assert.match(lineage.build.electronMain.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(gitCalls.length, 0);
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
    await writeFile(path.join(appRoot, "dist", "renderer-artifact-provenance.json"), JSON.stringify({ mode: "checksum-pinned-artifact-runtime" }));
    const sourceIdentity = { schemaVersion: 1, head: "d".repeat(40), treeClean: true, statusSha256: "e".repeat(64), trackedDiffSha256: "f".repeat(64), untrackedSha256: "0".repeat(64), untrackedPaths: [], combinedSha256: "2".repeat(64) };
    const buildLineage = { schemaVersion: 1, builtAt: "2026-08-25T00:00:00.000Z", sourceIdentity };
    await writeFile(path.join(appRoot, "dist", "wsl-build-lineage.json"), JSON.stringify(buildLineage));
    const lineage = await collectWslRuntimeLineage({
      repoRoot: root,
      appRoot,
      profileDir: path.join(root, "profile"),
      debugPort: null,
      processes: { runner: { pid: 1, startedAt: "x" }, host: { pid: 2, startedAt: "x" }, electron: { pid: 3, startedAt: "x" } },
      executeGit: async (_command, args) => ({ stdout: args.includes("rev-parse") ? `${"d".repeat(40)}\n` : "" }),
      buildLineage,
      sourceIdentity,
    });
    assert.equal(lineage.debugEndpoint, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editable WSL lineage selects source provenance and cannot fall back to leftover pinned metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-editable-lineage-"));
  const appRoot = path.join(root, "runtime");
  const sourceProvenancePath = path.join(appRoot, "dist", "renderer", "renderer-source-provenance.json");
  const sourceIdentity = { head: "d".repeat(40), treeClean: true, statusSha256: "e".repeat(64), combinedSha256: "f".repeat(64) };
  const buildLineage = { schemaVersion: 1, builtAt: "2026-09-08T00:00:00.000Z", sourceIdentity };
  const options = {
    repoRoot: root, appRoot, profileDir: path.join(root, "profile"), debugPort: null,
    rendererMode: "editable", processes: {}, sourceIdentity, buildLineage,
  };
  try {
    for (const [relative, contents] of [
      ["dist/electron-main/main.cjs", "main"],
      ["dist/host/host-main.cjs", "host"],
      ["dist/renderer/index.html", "source renderer"],
      ["dist/wsl-build-lineage.json", JSON.stringify(buildLineage)],
      ["dist/renderer/renderer-source-provenance.json", JSON.stringify({ mode: "clean-source", entrypoint: "frontend/src/main.tsx" })],
    ]) {
      await mkdir(path.dirname(path.join(appRoot, relative)), { recursive: true });
      await writeFile(path.join(appRoot, relative), contents);
    }
    const sourceOnly = await collectWslRuntimeLineage(options);
    assert.equal(sourceOnly.rendererMode, "editable");
    assert.equal(sourceOnly.build.rendererProvenance.mode, "clean-source");
    assert.equal(sourceOnly.build.rendererProvenance.entrypoint, "frontend/src/main.tsx");
    assert.equal(sourceOnly.build.rendererProvenance.path, path.relative(root, sourceProvenancePath));
    await writeFile(path.join(appRoot, "dist", "renderer-artifact-provenance.json"), JSON.stringify({
      mode: "checksum-pinned-artifact-runtime", inventorySha256: "a".repeat(64),
    }));
    const withLeftover = await collectWslRuntimeLineage(options);
    assert.deepEqual(withLeftover.build.rendererProvenance, sourceOnly.build.rendererProvenance);
    await rm(sourceProvenancePath);
    await assert.rejects(collectWslRuntimeLineage(options), { code: "ENOENT" });
    await writeFile(sourceProvenancePath, JSON.stringify({ mode: "checksum-pinned-artifact-runtime" }));
    await assert.rejects(collectWslRuntimeLineage(options), /incompatible renderer provenance/u);
    await writeFile(sourceProvenancePath, JSON.stringify({ mode: "clean-source", entrypoint: "some-other-renderer.ts" }));
    await assert.rejects(collectWslRuntimeLineage(options), /incompatible renderer provenance/u);
    await assert.rejects(collectWslRuntimeLineage({ ...options, rendererMode: "unknown" }), /invalid renderer mode/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
