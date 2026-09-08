// A6: the box daemon's file tools — Read/Write/LS/Grep/Delete — exercised
// in-process against a real temp workspace, pinning the model-facing error
// taxonomy and the boundary behavior the doc demanded (오류·경계·large output):
// missing files, directories, symlinks, workspace escapes, offset/limit
// truncation flags, the PDF byte branch, grep head limits on oversized
// output, and atomic write round-trips.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "box-file-tools-entry.ts",
      contents: `
        export { BoxExecRuntime } from "./source/box-exec-daemon/server.js";
        export { ReadArgs } from "./source/packages/proto/generated/agent/v1/read_exec_pb.js";
        export { WriteArgs } from "./source/packages/proto/generated/agent/v1/write_exec_pb.js";
        export { LsArgs } from "./source/packages/proto/generated/agent/v1/ls_exec_pb.js";
        export { GrepArgs } from "./source/packages/proto/generated/agent/v1/grep_exec_pb.js";
        export { DeleteArgs } from "./source/packages/proto/generated/agent/v1/delete_exec_pb.js";
        export { ShellArgs } from "./source/packages/proto/generated/agent/v1/shell_exec_pb.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
    banner: { js: 'import { createRequire as __belmontCreateRequire } from "node:module";\nconst require = __belmontCreateRequire(import.meta.url);' },
  });
  const dir = path.join(repoRoot, "node_modules", ".cache", "belmont-tests");
  await mkdir(dir, { recursive: true });
  const bundlePath = path.join(dir, `box-file-tools-${process.pid}.mjs`);
  await import("node:fs/promises").then(({ writeFile: write }) => write(bundlePath, result.outputFiles[0].text));
  try {
    return await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(bundlePath, { force: true });
  }
}

const modulePromise = loadRuntime();

async function buildWorld() {
  const { BoxExecRuntime } = await modulePromise;
  const root = await mkdtemp(path.join(tmpdir(), "belmont-file-tools-"));
  const workspace = path.join(root, "workspace");
  const terminals = path.join(root, "terminals");
  await mkdir(workspace, { recursive: true });
  await mkdir(terminals, { recursive: true });
  const runtime = new BoxExecRuntime(workspace, terminals, { PATH: process.env.PATH ?? "" });
  return { runtime, root, workspace };
}

test("Read: round trip, range flags, and the full error taxonomy", async () => {
  const { ReadArgs, WriteArgs } = await modulePromise;
  const { runtime, root, workspace } = await buildWorld();
  try {
    const write = await runtime.write(new WriteArgs({ path: "/workspace/notes.txt", fileText: "L1\nL2\nL3\nL4\nL5" }));
    assert.equal(write.result.case, "success");

    const full = await runtime.read(new ReadArgs({ path: "/workspace/notes.txt" }));
    assert.equal(full.result.case, "success");
    assert.equal(full.result.value.output.value, "L1\nL2\nL3\nL4\nL5");
    assert.equal(full.result.value.truncated, false);

    const ranged = await runtime.read(new ReadArgs({ path: "/workspace/notes.txt", offset: 1, limit: 2 }));
    assert.equal(ranged.result.value.output.value, "L1\nL2");
    assert.equal(ranged.result.value.truncated, false, "a requested range is not size truncation");
    assert.equal(ranged.result.value.rangeApplied, true);

    const missing = await runtime.read(new ReadArgs({ path: "/workspace/absent.txt" }));
    assert.equal(missing.result.case, "fileNotFound");

    const directory = await runtime.read(new ReadArgs({ path: "/workspace" }));
    assert.equal(directory.result.case, "invalidFile", "a directory is not a regular file");

    await symlink(path.join(root, "outside.txt"), path.join(workspace, "link.txt"));
    const viaSymlink = await runtime.read(new ReadArgs({ path: "/workspace/link.txt" }));
    assert.equal(viaSymlink.result.case, "rejected", "symlink reads are refused");

    const escape = await runtime.read(new ReadArgs({ path: "/workspace/../secrets.txt" }));
    assert.equal(escape.result.case, "rejected", "paths escaping the workspace are refused");
    const absolute = await runtime.read(new ReadArgs({ path: "/etc/hostname" }));
    assert.equal(absolute.result.case, "rejected", "absolute paths outside the roots are refused");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Read: a PDF comes back as bytes for the host-side text extractor", async () => {
  const { ReadArgs } = await modulePromise;
  const { runtime, root, workspace } = await buildWorld();
  try {
    await writeFile(path.join(workspace, "doc.pdf"), Buffer.from("%PDF-1.4 fake body"));
    const result = await runtime.read(new ReadArgs({ path: "/workspace/doc.pdf" }));
    assert.equal(result.result.case, "success");
    assert.equal(result.result.value.output.case, "data", "PDF must take the bytes branch");
    assert.equal(Buffer.from(result.result.value.output.value).subarray(0, 4).toString(), "%PDF");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Grep: caps oversized output at the head limit and flags the truncation", async () => {
  const { GrepArgs } = await modulePromise;
  const { runtime, root, workspace } = await buildWorld();
  try {
    const lines = Array.from({ length: 500 }, (_, i) => `needle line ${i}`).join("\n");
    await writeFile(path.join(workspace, "big.txt"), lines);
    const result = await runtime.grep(new GrepArgs({ pattern: "needle", path: "/workspace" }), new AbortController().signal);
    assert.equal(result.result.case, "success");
    const union = result.result.value.workspaceResults?.workspace?.result;
    assert.equal(union.case, "content");
    const totalMatches = union.value.matches.reduce((n, file) => n + file.matches.length, 0);
    assert.ok(totalMatches <= 200, `default head limit must cap output (got ${totalMatches})`);
    assert.equal(union.value.clientTruncated, true, "the cap must be flagged, not silent");

    const none = await runtime.grep(new GrepArgs({ pattern: "no-such-token-xyz", path: "/workspace" }), new AbortController().signal);
    assert.equal(none.result.case, "success", "no matches is a legitimate empty result, not an error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LS and Delete: boundaries hold and deletions land", async () => {
  const { LsArgs, DeleteArgs, ReadArgs, WriteArgs } = await modulePromise;
  const { runtime, root } = await buildWorld();
  try {
    await runtime.write(new WriteArgs({ path: "/workspace/dir/inner.txt", fileText: "x" }));
    const listing = await runtime.ls(new LsArgs({ path: "/workspace" }));
    assert.equal(listing.result.case, "success");

    const escaped = await runtime.ls(new LsArgs({ path: "/workspace/../../" }));
    assert.equal(escaped.result.case, "rejected");

    const removed = await runtime.delete(new DeleteArgs({ path: "/workspace/dir/inner.txt" }));
    assert.equal(removed.result.case, "success");
    const gone = await runtime.read(new ReadArgs({ path: "/workspace/dir/inner.txt" }));
    assert.equal(gone.result.case, "fileNotFound");

    const outside = await runtime.delete(new DeleteArgs({ path: "/etc/passwd" }));
    assert.equal(outside.result.case, "rejected", "deletes outside the workspace are refused");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Shell: the hard timeout and caller abort both surface honestly", async () => {
  const { ShellArgs } = await modulePromise;
  const { runtime, root } = await buildWorld();
  try {
    const quick = await runtime.shell(new ShellArgs({ command: "echo boundary-ok", workingDirectory: "/workspace", timeout: 5_000, toolCallId: "t-ok" }), new AbortController().signal);
    assert.equal(quick.result.case, "success");
    assert.match(quick.result.value.stdout, /boundary-ok/);

    const timedOut = await runtime.shell(new ShellArgs({ command: "sleep 5", workingDirectory: "/workspace", timeout: 300, toolCallId: "t-slow" }), new AbortController().signal);
    assert.equal(timedOut.result.case, "timeout", "a hung command must come back as an explicit timeout, not hang the call");

    const controller = new AbortController();
    const aborted = runtime.shell(new ShellArgs({ command: "sleep 5", workingDirectory: "/workspace", timeout: 30_000, toolCallId: "t-abort" }), controller.signal);
    setTimeout(() => controller.abort(), 200);
    const result = await aborted;
    assert.notEqual(result.result.case, "success", "an aborted command must not report success");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
