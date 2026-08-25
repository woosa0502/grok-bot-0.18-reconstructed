import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function loadModule() {
  const result = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    entryPoints: ["source/shared/attachment-byte-transport.ts"],
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("attachment bytes survive cross-context Base64 transport", async () => {
  const { encodeAttachmentBytesForRpc, decodeAttachmentBytesFromRpc } = await loadModule();
  const foreignBytes = vm.runInNewContext("new Uint8Array([65, 85, 84, 72, 95, 79, 75, 10])");
  const encoded = encodeAttachmentBytesForRpc(foreignBytes);
  assert.equal(encoded, "QVVUSF9PSwo=");
  assert.equal(Buffer.from(decodeAttachmentBytesFromRpc(encoded)).toString("utf8"), "AUTH_OK\n");
});

test("attachment transport recovers contextBridge-style numeric objects and rejects malformed Base64", async () => {
  const { encodeAttachmentBytesForRpc, decodeAttachmentBytesFromRpc } = await loadModule();
  assert.equal(encodeAttachmentBytesForRpc({ 0: 65, 1: 66, byteLength: 2 }), "QUI=");
  assert.equal(decodeAttachmentBytesFromRpc("***"), null);
  assert.equal(encodeAttachmentBytesForRpc({ 0: 300, byteLength: 1 }), null);
});
