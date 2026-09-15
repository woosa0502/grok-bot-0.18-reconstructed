#!/usr/bin/env node
// Administrative migration entrypoint. No phase runs implicitly; never starts a host or an Aside task.
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { values } = parseArgs({ options: {
  "sand-root": { type: "string" }, principal: { type: "string" }, phase: { type: "string" },
  "approved-by": { type: "string" }, "validation-artifact": { type: "string" }, "inventory-digest": { type: "string" },
} });
const phases = new Set(["freeze", "inventory", "barriers", "import", "validation-ready", "shadow-read", "cutover", "pause", "status"]);
if (!values["sand-root"] || !values.principal || !phases.has(values.phase)) {
  throw new Error("Usage: node scripts/memory-migrate.mjs --sand-root <profile/sand-data> --principal <exact host principal> --phase <freeze|inventory|barriers|import|validation-ready|shadow-read|cutover|pause|status>. Cutover also requires --approved-by --validation-artifact --inventory-digest.");
}
// Bundle only this administrative adapter into memory, using the already locked esbuild dependency.
// The application/renderer is not built or launched by this command.
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../source/host/extensions/memory/memory-learning-runtime.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", target: "node26", logLevel: "silent" });
const { BelmontMemoryLearningRuntime } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const sandRoot = resolve(values["sand-root"]);
const runtime = new BelmontMemoryLearningRuntime({ sandRoot, agentsRootDir: resolve(sandRoot, "agents"), getPrincipalId: () => values.principal, onChange() {}, report: (message) => process.stderr.write(`${message}\n`) });
try {
  const migration = runtime.migration();
  let result;
  switch (values.phase) {
    case "freeze": result = migration.freeze(); break;
    case "inventory": { const inventory = migration.inventory(); result = { digest: inventory.digest, shards: inventory.shards.length, facts: inventory.facts.length, issues: inventory.issues, path: resolve(sandRoot, "memory-2.1", "inventory.json") }; break; }
    case "barriers": result = migration.importBarriers(); break;
    case "import": result = migration.importFacts(); break;
    case "validation-ready": result = migration.markValidationReady(); break;
    case "shadow-read": result = migration.enableShadowRead(); break;
    case "cutover": {
      if (!values["approved-by"] || !values["validation-artifact"] || !values["inventory-digest"]) throw new Error("Cutover requires external validation authorization and the inventory digest");
      result = migration.cutover({ approvedBy: values["approved-by"], validationArtifact: values["validation-artifact"], inventoryDigest: values["inventory-digest"] });
      break;
    }
    case "pause": result = migration.pauseCanonicalWrites(); break;
    case "status": result = migration.state(); break;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await runtime.dispose(); }
