import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { downloadArtifact } from "@electron/get";

import {
  buildFidelityDistribution,
  overlayAuditMetadata,
} from "./clean-build.mjs";
import { createRendererArtifactProvenance, overlayCleanDistribution } from "./lib/clean-build.mjs";
import { repoRoot, sourceAppDir } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";
import { captureWslBuildSourceIdentity, writeWslBuildLineage } from "./lib/wsl-build-lineage.mjs";
import { assertSupportedNodeRuntime, assertWslPlatform } from "./lib/wsl-runtime.mjs";

const electronVersion = "42.1.0";
const electronRoot = path.join(repoRoot, "node_modules", "electron");
const electronDist = path.join(electronRoot, "dist");
const electronBinary = path.join(electronDist, "electron");
const buildRoot = path.join(repoRoot, ".build", "belmont-wsl-build");
const runtimeRoot = path.join(repoRoot, ".build", "belmont-wsl-runtime");
const requiredUpstreamInputs = [
  "dist/electron-main/main.cjs",
  "dist/host/host-main.cjs",
  "dist/renderer/index.html",
];

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureUpstreamEvidence() {
  const ready = await Promise.all(
    requiredUpstreamInputs.map(relative => exists(path.join(sourceAppDir, relative))),
  );
  if (ready.every(Boolean)) return;
  await import("./bootstrap-runtime.mjs");
}

async function ensureLinuxElectron() {
  const installedVersion = await readFile(path.join(electronDist, "version"), "utf8").catch(() => "");
  if (installedVersion.trim().replace(/^v/u, "") === electronVersion && await exists(electronBinary)) return;
  const archive = await downloadArtifact({
    version: electronVersion,
    artifactName: "electron",
    platform: "linux",
    arch: process.arch,
    checksums: JSON.parse(await readFile(path.join(electronRoot, "checksums.json"), "utf8")),
  });
  await rm(electronDist, { recursive: true, force: true });
  await mkdir(electronDist, { recursive: true });
  await run("/usr/bin/unzip", ["-o", archive, "-d", electronDist]);
  await chmod(electronBinary, 0o755);
  await writeFile(path.join(electronRoot, "path.txt"), "electron");
}

async function stageFidelityRuntime(built) {
  await rm(runtimeRoot, { recursive: true, force: true });
  await cp(sourceAppDir, runtimeRoot, { recursive: true, dereference: false, preserveTimestamps: true });
  await overlayCleanDistribution(built.outputRoot, {
    stageRoot: runtimeRoot,
    composition: built.buildManifest.runtimeComposition,
  });
  await overlayAuditMetadata(built, { stageRoot: runtimeRoot });
}

async function assertFidelityRenderer(built) {
  const renderer = built.buildManifest.runtimeComposition.find(item => item.runtime === "renderer");
  const stagedRenderer = await createRendererArtifactProvenance({
    artifactRoot: path.join(runtimeRoot, "dist", "renderer"),
  });
  if (built.buildManifest.buildKind !== "fidelity-hybrid-reconstruction"
    || !built.hostActivation.clean
    || !built.electronMainActivation.clean
    || built.compositionAudit.summary.blockedFallbacks.length > 0
    || renderer?.mode !== "checksum-pinned-artifact-runtime"
    || renderer?.artifactRoot !== "src/app/dist/renderer"
    || built.renderer?.mode !== "checksum-pinned-artifact-runtime"
    || !built.renderer.files.some(file => file.path === "index.html")
    || stagedRenderer.fileCount !== built.renderer.fileCount
    || stagedRenderer.inventorySha256 !== built.renderer.inventorySha256) {
    throw new Error("Belmont WSL runtime did not preserve the checksum-pinned shipped renderer.");
  }
  for (const required of requiredUpstreamInputs) {
    await access(path.join(runtimeRoot, required)).catch(() => {
      throw new Error(`Belmont WSL runtime is missing required staged file: ${required}`);
    });
  }
}

assertSupportedNodeRuntime();
assertWslPlatform();
process.env.npm_config_devdir ??= path.join(repoRoot, ".cache", "node-gyp");
const sourceIdentityBeforeBuild = await captureWslBuildSourceIdentity({ repoRoot });
await ensureUpstreamEvidence();
await ensureLinuxElectron();

const built = await buildFidelityDistribution({ outputRoot: buildRoot });
await stageFidelityRuntime(built);
await assertFidelityRenderer(built);
const sourceIdentityAfterBuild = await captureWslBuildSourceIdentity({ repoRoot });
if (sourceIdentityAfterBuild.combinedSha256 !== sourceIdentityBeforeBuild.combinedSha256) {
  throw new Error("Belmont source changed while the WSL runtime was building. Run npm run wsl:setup again from a stable tree.");
}
await writeWslBuildLineage(path.join(runtimeRoot, "dist", "wsl-build-lineage.json"), sourceIdentityAfterBuild);
await writeFile(path.join(runtimeRoot, "package.json"), `${JSON.stringify({
  name: "belmont-wsl",
  productName: "Belmont",
  version: "0.18.0",
  private: true,
  main: "dist/electron-main/main.cjs",
  sandLab: true,
  sandTrack: "stable",
}, null, 2)}\n`);

console.log(`Belmont WSL runtime ready: ${runtimeRoot}`);
console.log(`Shipped renderer preserved: ${built.renderer.fileCount} files (${built.renderer.inventorySha256})`);
