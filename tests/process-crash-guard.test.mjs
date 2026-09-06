// The host keeps running through unhandled rejections and logs them; a rejection whose reason is
// a plain object used to log as "Error: [object Object]" (16 of them on 2026-09-05) — useless for
// finding the source. toError now keeps the payload readable.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const result = await build({ absWorkingDir: repoRoot, bundle: true, entryPoints: [entry], format: "esm", platform: "node", target: "node22", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("toError keeps Error instances and stringifies primitives", async () => {
  const { toError } = await load("source/host/process-crash-guard.ts");
  const error = new Error("boom");
  assert.equal(toError(error), error);
  assert.equal(toError("text").message, "text");
  assert.equal(toError(42).message, "42");
  assert.equal(toError(undefined).message, "undefined");
  assert.equal(toError(null).message, "null");
});

test("toError shows the payload of object rejections instead of [object Object]", async () => {
  const { toError } = await load("source/host/process-crash-guard.ts");
  assert.equal(toError({ code: 7, detail: "rate limited" }).message, '{"code":7,"detail":"rate limited"}');
  assert.equal(toError({ message: "socket closed", code: "ECONNRESET" }).message, 'socket closed {"message":"socket closed","code":"ECONNRESET"}');
  const circular = { name: "loop" };
  circular.self = circular;
  assert.equal(toError(circular).message, "[object Object]", "unserializable objects fall back without throwing");
  assert.equal(toError({}).message, "[object Object]");
  const huge = { text: "x".repeat(5000) };
  assert.equal(toError(huge).message.length, 2000);
});

test("handleProcessCrash logs and forwards the converted error", async () => {
  const { handleProcessCrash } = await load("source/host/process-crash-guard.ts");
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  const forwarded = [];
  try {
    handleProcessCrash({ scope: "sand-host", onError: (error, kind) => forwarded.push([error.message, kind]) }, "unhandledRejection", { reason: "abort" });
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "[sand-host] unhandledRejection (kept alive):");
  assert.equal(logged[0][1].message, '{"reason":"abort"}');
  assert.deepEqual(forwarded, [['{"reason":"abort"}', "unhandledRejection"]]);
});
