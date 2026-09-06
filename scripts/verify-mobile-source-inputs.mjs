import path from "node:path";
import { repoRoot } from "./lib/config.mjs";
import { verifyMobileSourceInputs } from "./lib/mobile-source-inputs.mjs";
import { assertSupportedNodeRuntime } from "./lib/wsl-runtime.mjs";

assertSupportedNodeRuntime();
console.log(JSON.stringify(await verifyMobileSourceInputs(path.join(repoRoot, "grok-mobile-belmont-pwa")), null, 2));
