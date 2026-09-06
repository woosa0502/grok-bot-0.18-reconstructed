import path from "node:path";
import { repoRoot } from "./lib/config.mjs";
import { assertSupportedNodeRuntime } from "./lib/wsl-runtime.mjs";
import { buildProductionRenderer } from "./renderer-production-build.mjs";

// This prepares a reviewable renderer artifact. It never installs or launches it.
assertSupportedNodeRuntime();
const built = await buildProductionRenderer({ outputRoot: path.join(repoRoot, ".build", "editable-renderer") });
console.log(`Audited editable renderer: ${built.rendererRoot}`);
console.log(`Source and output provenance: ${built.provenancePath}`);
