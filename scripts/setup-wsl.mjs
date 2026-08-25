import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { downloadArtifact } from "@electron/get";

import { buildFidelityDistribution } from "./lib/clean-build.mjs";
import { repoRoot, sourceAppDir } from "./lib/config.mjs";
import { run } from "./lib/process.mjs";
import { assertSupportedNodeRuntime, assertWslPlatform } from "./lib/wsl-runtime.mjs";

const electronVersion = "42.1.0";
const electronRoot = path.join(repoRoot, "node_modules", "electron");
const electronDist = path.join(electronRoot, "dist");
const electronBinary = path.join(electronDist, "electron");
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

function assertFidelityRenderer(built) {
  const renderer = built.buildManifest.runtimeComposition.find(item => item.runtime === "renderer");
  if (built.buildManifest.buildKind !== "fidelity-hybrid-reconstruction"
    || renderer?.mode !== "checksum-pinned-artifact-runtime"
    || renderer?.artifactRoot !== "src/app/dist/renderer"
    || built.renderer?.mode !== "checksum-pinned-artifact-runtime"
    || !built.renderer.files.some(file => file.path === "index.html")) {
    throw new Error("Belmont WSL runtime did not preserve the checksum-pinned shipped renderer.");
  }
}

assertSupportedNodeRuntime();
assertWslPlatform();
process.env.npm_config_devdir ??= path.join(repoRoot, ".cache", "node-gyp");
await ensureUpstreamEvidence();
await ensureLinuxElectron();

const built = await buildFidelityDistribution({ outputRoot: runtimeRoot });
assertFidelityRenderer(built);
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
