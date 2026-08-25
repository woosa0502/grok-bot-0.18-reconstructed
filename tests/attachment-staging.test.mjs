import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function loadModule() {
  const result = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    entryPoints: ["source/electron-main/attachments/attachments.ts"],
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("attachment staging accepts typed arrays created in another V8 context", async () => {
  const { createAttachmentEdgePort, normalizeAttachmentBytes } = await loadModule();
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), "belmont-attachment-stage-"));
  const foreignBytes = vm.runInNewContext("new Uint8Array([65, 85, 84, 72, 95, 79, 75, 10])");
  const failures = [];
  try {
    assert.equal(foreignBytes instanceof Uint8Array, false);
    assert.equal(ArrayBuffer.isView(foreignBytes), true);
    assert.deepEqual([...normalizeAttachmentBytes(foreignBytes)], [65, 85, 84, 72, 95, 79, 75, 10]);
    const attachments = createAttachmentEdgePort({
      onEdgeFailure: failure => failures.push(failure),
      byteLimitForName: () => 1024,
      getStagingDir: () => stagingDir,
      now: () => 123,
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    });
    const result = await attachments.stageBytes("fixture.txt", foreignBytes);
    assert.deepEqual(result, { ok: true, path: path.join(stagingDir, "123-00000000-0000-4000-8000-000000000000.txt") });
    assert.equal(await readFile(result.path, "utf8"), "AUTH_OK\n");
    assert.deepEqual(failures, []);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
});

test("attachment staging still rejects non-byte objects", async () => {
  const { normalizeAttachmentBytes } = await loadModule();
  assert.equal(normalizeAttachmentBytes({ 0: 65, length: 1 }), null);
  assert.equal(normalizeAttachmentBytes([65]), null);
  assert.equal(normalizeAttachmentBytes("AUTH_OK"), null);
});

test("attachment staging uses the Node random UUID source when no test UUID is injected", async () => {
  const { createAttachmentEdgePort } = await loadModule();
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), "belmont-attachment-stage-default-uuid-"));
  try {
    const attachments = createAttachmentEdgePort({
      onEdgeFailure: () => assert.fail("staging should not report an edge failure"),
      byteLimitForName: () => 1024,
      getStagingDir: () => stagingDir,
      now: () => 456,
    });
    const result = await attachments.stageBytes("fixture.txt", new Uint8Array([65]));
    assert.equal(result.ok, true);
    assert.match(path.basename(result.path), /^456-[0-9a-f-]{36}\.txt$/u);
    assert.equal(await readFile(result.path, "utf8"), "A");
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
});
