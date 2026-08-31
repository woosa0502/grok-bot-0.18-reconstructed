// browser_cdp forwards only read-only page-inspection commands. The driver
// drives a browser holding the user's live logged-in sessions, so the previous
// prefix denylist (Browser./Target./Storage./SystemInfo./Security./Input./
// Tethering./Cast. plus a few cookie methods) left Runtime.evaluate,
// Page.addScriptToEvaluateOnNewDocument, Fetch.*, Network.getResponseBody and
// Debugger.* reachable — each of which is equivalent to acting as the user.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

async function loadDriverExports() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "browser-cdp-entry.ts",
      contents: `
        export {
          SAND_BROWSER_DRIVER_SOURCE,
          SAND_BROWSER_MODEL_CDP_ALLOWLIST,
        } from "./source/host/runner/tools/sand-browser-driver-source.js";
      `,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    supported: { using: false },
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

/**
 * Imports the in-box driver's op table. The driver is a self-executing script
 * that reads process.argv, so the trailing watchdog timer and IIFE are dropped
 * and OPS is exported instead; everything above that point is pure declaration.
 */
async function loadDriverOps(driverSource) {
  const cut = driverSource.indexOf("const watchdog = setTimeout(");
  assert.ok(cut > 0, "driver source should still end with the watchdog and argv IIFE");
  const moduleText = `${driverSource.slice(0, cut)}\nexport { OPS };\n`;
  const encoded = Buffer.from(moduleText).toString("base64");
  const module = await import(`data:text/javascript;base64,${encoded}`);
  return module.OPS;
}

const PERCEPTION_METHODS = [
  "Accessibility.getFullAXTree",
  "DOMSnapshot.captureSnapshot",
  "DOM.resolveNode",
  "Page.getLayoutMetrics",
];

// Each of these passed the old prefix denylist.
const ACTING_AS_THE_USER = [
  "Runtime.evaluate",
  "Runtime.callFunctionOn",
  "Page.addScriptToEvaluateOnNewDocument",
  "Page.navigate",
  "Fetch.enable",
  "Fetch.fulfillRequest",
  "Network.getResponseBody",
  "Network.setExtraHTTPHeaders",
  "Debugger.enable",
  "DOM.setOuterHTML",
  "IndexedDB.requestData",
  "Emulation.setGeolocationOverride",
];

test("the allowlist admits perception commands and no execution commands", async () => {
  const { SAND_BROWSER_MODEL_CDP_ALLOWLIST: allowlist } = await loadDriverExports();
  for (const method of PERCEPTION_METHODS) {
    assert.ok(allowlist.includes(method), `${method} should stay available for page inspection`);
  }
  for (const method of ACTING_AS_THE_USER) {
    assert.ok(!allowlist.includes(method), `${method} must never be reachable through browser_cdp`);
  }
});

test("the driver rejects every non-allowlisted method before it touches the page", async () => {
  const { SAND_BROWSER_DRIVER_SOURCE, SAND_BROWSER_MODEL_CDP_ALLOWLIST } = await loadDriverExports();
  const ops = await loadDriverOps(SAND_BROWSER_DRIVER_SOURCE);

  for (const method of ACTING_AS_THE_USER) {
    // context/state are null: a rejection that reaches the browser at all would
    // throw a different error, so this also pins the check ahead of resolvePage.
    await assert.rejects(
      ops.cdp({ request: { method }, context: null, state: null }),
      (error) => {
        assert.match(error.message, /is not available/);
        assert.ok(error.message.includes(JSON.stringify(method)));
        return true;
      },
      `${method} should be refused`,
    );
  }

  // A missing or non-string method is not silently treated as allowed.
  for (const request of [{}, { method: "" }, { method: 42 }, { method: null }]) {
    await assert.rejects(ops.cdp({ request, context: null, state: null }), /is not available/);
  }

  // An allowlisted method gets past the guard and fails later, on the page.
  await assert.rejects(
    ops.cdp({
      request: { method: SAND_BROWSER_MODEL_CDP_ALLOWLIST[0] },
      context: null,
      state: null,
    }),
    (error) => {
      assert.doesNotMatch(error.message, /is not available/);
      return true;
    },
  );
});

test("the in-box allowlist cannot drift from the exported one", async () => {
  const { SAND_BROWSER_DRIVER_SOURCE, SAND_BROWSER_MODEL_CDP_ALLOWLIST } = await loadDriverExports();
  assert.ok(
    SAND_BROWSER_DRIVER_SOURCE.includes(`const MODEL_CDP_ALLOWLIST = ${JSON.stringify(SAND_BROWSER_MODEL_CDP_ALLOWLIST)};`),
    "the uploaded driver must interpolate the exported allowlist rather than restate it",
  );
  const source = read("source/host/runner/tools/sand-browser-driver-source.ts");
  assert.ok(!source.includes("deniedPrefixes"), "the prefix denylist should be gone, not merely bypassed");
});

test("browser_cdp's description tells the model exactly which methods it may send", async () => {
  const { SAND_BROWSER_MODEL_CDP_ALLOWLIST: allowlist } = await loadDriverExports();
  const tools = read("source/host/runner/tools/sand-browser-tools.ts");
  const spec = tools.split("\n").find((line) => line.includes(`name: "browser_cdp"`));
  assert.ok(spec !== undefined, "browser_cdp should still be registered");
  for (const method of allowlist) {
    assert.ok(spec.includes(method), `the description should name ${method}`);
  }
  for (const method of ACTING_AS_THE_USER) {
    assert.ok(!spec.includes(method), `the description should not advertise ${method}`);
  }
});
