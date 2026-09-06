import { access, cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCleanDistribution, overlayAuditMetadata } from "./clean-build.mjs";
import { overlayCleanDistribution } from "./lib/clean-build.mjs";
import { repoRoot, sourceAppDir } from "./lib/config.mjs";
import { assertEditableRendererStage, selectRendererRuntime } from "./lib/renderer-runtime-selection.mjs";
import { captureWslBuildSourceIdentity, writeWslBuildLineage } from "./lib/wsl-build-lineage.mjs";
import { assertSupportedNodeRuntime, assertWslPlatform } from "./lib/wsl-runtime.mjs";

// Source renderer staging is explicit and uses its own output and launch
// profile. Shipped renderer checks and the normal WSL runtime remain separate.
assertSupportedNodeRuntime();
assertWslPlatform();
const selection = selectRendererRuntime({ repoRoot, args: ["--renderer=editable"] });
for (const relative of ["package.json", "dist/electron-main/main.cjs", "dist/host/host-main.cjs", "dist/renderer/index.html"]) {
  await access(path.join(sourceAppDir, relative)).catch(() => {
    throw new Error(`Missing recovered input ${relative}; prepare the normal bootstrap and locked dependencies before editable setup.`);
  });
}
const before = await captureWslBuildSourceIdentity({ repoRoot });
const built = await buildCleanDistribution({ outputRoot: selection.buildRoot });
await rm(selection.runtimeRoot, { recursive: true, force: true });
await cp(sourceAppDir, selection.runtimeRoot, { recursive: true, dereference: false, preserveTimestamps: true });
await overlayCleanDistribution(built.outputRoot, { stageRoot: selection.runtimeRoot, composition: built.buildManifest.runtimeComposition });
await overlayAuditMetadata(built, { stageRoot: selection.runtimeRoot });
await assertEditableRendererStage(built, selection.runtimeRoot);
const after = await captureWslBuildSourceIdentity({ repoRoot });
if (after.combinedSha256 !== before.combinedSha256) throw new Error("Belmont source changed during editable setup. Repeat from a stable tree before launching.");
await writeWslBuildLineage(path.join(selection.runtimeRoot, "dist/wsl-build-lineage.json"), after);
await writeFile(path.join(selection.runtimeRoot, "package.json"), `${JSON.stringify({
  name: "belmont-editable", productName: "Belmont Editable", version: "0.18.0", private: true,
  main: "dist/electron-main/main.cjs", sandLab: true, sandTrack: "stable",
}, null, 2)}\n`);
console.log(`Editable WSL runtime staged: ${selection.runtimeRoot}`);
console.log(`Launch separately: npm run wsl:start -- --renderer editable`);
console.log(`Default isolated profile: ${selection.profileDir}`);
