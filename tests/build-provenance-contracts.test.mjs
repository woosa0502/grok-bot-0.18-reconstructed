import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyMobileSourceInputs } from "../scripts/lib/mobile-source-inputs.mjs";
import { assertEditableRendererStage, selectRendererRuntime } from "../scripts/lib/renderer-runtime-selection.mjs";

test("renderer selection preserves pinned paths and isolates editable output and default profile", () => {
  const pinned = selectRendererRuntime({ repoRoot: "/fixture" });
  const editable = selectRendererRuntime({ repoRoot: "/fixture", args: ["--renderer", "editable"] });
  assert.equal(pinned.runtimeRoot, "/fixture/.build/belmont-wsl-runtime");
  assert.equal(pinned.profileDir, "/fixture/.cache/belmont-wsl-profile");
  for (const key of ["buildRoot", "runtimeRoot", "profileDir"]) assert.notEqual(pinned[key], editable[key]);
  assert.equal(selectRendererRuntime({ repoRoot: "/fixture", env: { BELMONT_RENDERER: "editable" } }).mode, "editable");
  assert.equal(selectRendererRuntime({ repoRoot: "/fixture", args: ["--renderer=pinned"], env: { BELMONT_RENDERER: "editable" } }).mode, "pinned");
  for (const args of [["--renderer"], ["--renderer=typo"], ["--render=editable"], ["--renderer=pinned", "--renderer=editable"]]) {
    assert.throws(() => selectRendererRuntime({ repoRoot: "/fixture", args }));
  }
});

test("editable staging rejects missing, substituted, or artifact-mode renderer bytes", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "belmont-renderer-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const html = Buffer.from("<!doctype html><p>source fixture</p>");
  await mkdir(path.join(root, "dist/renderer"), { recursive: true });
  await writeFile(path.join(root, "dist/renderer/index.html"), html);
  const built = {
    buildManifest: { buildKind: "source-aware-reconstruction", runtimeComposition: [{ runtime: "renderer", mode: "clean-source", source: "frontend/src/main.tsx" }] },
    hostActivation: { clean: true }, electronMainActivation: { clean: true },
    compositionAudit: { summary: { blockedFallbacks: [] } },
    renderer: { provenance: { mode: "clean-source", entrypoint: "frontend/src/main.tsx" }, outputs: [{ path: "dist/renderer/index.html", bytes: html.length, sha256: createHash("sha256").update(html).digest("hex") }] },
  };
  await assertEditableRendererStage(built, root);
  await writeFile(path.join(root, "dist/renderer/index.html"), Buffer.alloc(html.length, 65));
  await assert.rejects(assertEditableRendererStage(built, root), /staging drift/u);
  await writeFile(path.join(root, "dist/renderer/index.html"), html);
  const wrongMode = structuredClone(built);
  wrongMode.renderer.provenance.mode = "checksum-pinned-artifact-runtime";
  await assert.rejects(assertEditableRendererStage(wrongMode, root), /clean-source renderer provenance/u);
  await rm(path.join(root, "dist/renderer/index.html"));
  await assert.rejects(assertEditableRendererStage(built, root), /ENOENT/u);
});

test("mobile input verification detects asset substitution, filesystem escape, and external source dependencies", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "belmont-mobile-inputs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mobile = path.join(root, "mobile");
  await mkdir(path.join(mobile, "docs"), { recursive: true });
  await mkdir(path.join(mobile, "src"));
  const bytes = Buffer.from("font-fixture");
  const asset = { path: "font.bin", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), license: "test-fixture" };
  const manifestPath = path.join(mobile, "docs/asset-provenance.json");
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, assets: [asset] }));
  await writeFile(path.join(mobile, "font.bin"), bytes);
  await writeFile(path.join(mobile, "src/main.ts"), 'export const ready = true;');
  assert.equal((await verifyMobileSourceInputs(mobile)).assets, 1);
  await writeFile(path.join(mobile, "font.bin"), "wrong");
  await assert.rejects(verifyMobileSourceInputs(mobile), /asset drift/u);
  await rm(path.join(mobile, "font.bin"));
  await writeFile(path.join(root, "outside.bin"), bytes);
  await symlink(path.join(root, "outside.bin"), path.join(mobile, "font.bin"));
  await assert.rejects(verifyMobileSourceInputs(mobile), /escapes source root/u);
  await rm(path.join(mobile, "font.bin"));
  await writeFile(path.join(mobile, "font.bin"), bytes);
  await writeFile(path.join(mobile, "src/main.ts"), 'import data from "../../data/artifacts/raw/input.json";');
  await assert.rejects(verifyMobileSourceInputs(mobile), /external recovery or user files/u);
  assert.equal((await readFile(path.join(root, "outside.bin"))).toString(), "font-fixture");
});
