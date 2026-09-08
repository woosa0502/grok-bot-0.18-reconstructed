import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = path.join(repoRoot, "node_modules/.cache/belmont-tests");
await mkdir(bundleDirectory, { recursive: true });
const bundlePath = path.join(bundleDirectory, `shell-timing-${process.pid}.mjs`);
await build({
  stdin: {
    resolveDir: repoRoot,
    loader: "ts",
    contents: `
      export { getParametersSchemaDsv3 } from "./source/packages/agent/tools/core/shell/prompts/dsv3.ts";
      export { ShellArgs } from "./source/packages/proto/generated/agent/v1/shell_exec_pb.ts";
    `,
  },
  outfile: bundlePath, bundle: true, format: "esm", platform: "node", packages: "external", target: "node26", logLevel: "error",
});
const { getParametersSchemaDsv3, ShellArgs } = await import(pathToFileURL(bundlePath));
after(() => rm(bundlePath, { force: true }));

for (const { version, options, field } of [
  { version: "dsv3-1205", options: {}, field: "timeout" },
  { version: "cursor-0226", options: {}, field: "timeout" },
  { version: "dsv3-1205", options: { enableBlockUntilMs: true }, field: "block_until_ms" },
  { version: "dsv3-1205", options: { enableBlockUntilMs: true, requireBlockUntilMs: true }, field: "block_until_ms" },
  { version: "cursor-0226", options: { enableBlockUntilMs: true }, field: "block_until_ms" },
]) {
  test(`${version} ${field} ${options.requireBlockUntilMs ? "required" : "optional"}: accepts only wire-safe timing`, () => {
    const schema = getParametersSchemaDsv3(false, version, options);
    for (const invalid of [-1, -0.5, 0.5, 2_147_483_648, Number.POSITIVE_INFINITY, Number.NaN, "-1", "0.5", "2147483648", "Infinity", ""]) {
      const parsed = schema.safeParse({ command: "fixture", [field]: invalid });
      assert.equal(parsed.success, false, `must reject ${String(invalid)}`);
      assert.ok(parsed.error.issues.some(issue => issue.path[0] === field));
    }
    for (const valid of [0, 1, 30_000, 2_147_483_647, "0", "30000", " 1 "]) {
      const parsed = schema.parse({ command: "fixture", [field]: valid });
      assert.equal(parsed[field], Number(valid));
      const args = new ShellArgs({ command: parsed.command, timeout: parsed[field] });
      assert.equal(ShellArgs.fromBinary(args.toBinary()).timeout, Number(valid));
    }
    assert.equal(schema.safeParse({ command: "fixture" }).success, options.requireBlockUntilMs !== true);
  });
}
