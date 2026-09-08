import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = path.join(repoRoot, "node_modules/.cache/belmont-tests");
await mkdir(bundleDirectory, { recursive: true });
const bundlePath = path.join(bundleDirectory, `file-mutation-transactions-${process.pid}.mjs`);
await build({
  stdin: {
    resolveDir: repoRoot,
    loader: "ts",
    contents: `
      export { createContext } from "./source/packages/context/core.ts";
      export { createEditTool } from "./source/packages/agent/tools/core/edit/edit.ts";
      export { createWriteTool } from "./source/packages/agent/tools/core/edit/write.ts";
      export { createDeleteTool } from "./source/packages/agent/tools/core/delete/delete.ts";
      export { readExecutorResource } from "./source/packages/agent-exec/read.ts";
      export { writeExecutorResource } from "./source/packages/agent-exec/write.ts";
      export { deleteExecutorResource } from "./source/packages/agent-exec/delete.ts";
      export { ReadResult, ReadSuccess } from "./source/packages/proto/generated/agent/v1/read_exec_pb.ts";
      export { WriteResult, WriteSuccess } from "./source/packages/proto/generated/agent/v1/write_exec_pb.ts";
      export { DeleteResult, DeleteSuccess } from "./source/packages/proto/generated/agent/v1/delete_exec_pb.ts";
    `,
  },
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  packages: "external",
  logLevel: "error",
});
const M = await import(pathToFileURL(bundlePath));
after(() => rm(bundlePath, { force: true }));
const interaction = { executeToolCall: (ctx, _call, _id, execute) => execute(ctx) };
const stream = async function* (args) { yield JSON.stringify(args); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, initial = "first=old\nsecond=old\n") {
  const directory = await mkdtemp(path.join(tmpdir(), "belmont-mutation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.txt");
  await writeFile(file, initial);
  const events = [];
  let beforeReadReturn = async () => { await tick(); };
  const accessor = { get(key) {
    if (key === M.readExecutorResource) return { execute: async (_ctx, args) => {
      events.push(`read:${args.toolCallId}`);
      const content = await readFile(file, "utf8");
      await beforeReadReturn(args);
      return new M.ReadResult({ result: { case: "success", value: new M.ReadSuccess({ path: args.path, output: { case: "content", value: content } }) } });
    } };
    if (key === M.writeExecutorResource) return { execute: async (_ctx, args) => {
      events.push(`write:${args.toolCallId}`);
      await writeFile(file, args.fileText);
      return new M.WriteResult({ result: { case: "success", value: new M.WriteSuccess({ path: args.path }) } });
    } };
    if (key === M.deleteExecutorResource) return { execute: async (_ctx, args) => {
      events.push(`delete:${args.toolCallId}`);
      await rm(file);
      return new M.DeleteResult({ result: { case: "success", value: new M.DeleteSuccess({ path: args.path }) } });
    } };
    throw new Error("Optional diagnostic resource is absent");
  } };
  const ctx = M.createContext();
  const edit = M.createEditTool(accessor);
  const write = M.createWriteTool(accessor);
  const deleteTool = M.createDeleteTool(accessor);
  const call = (tool, args, id, callCtx = ctx) => tool.execute(callCtx, interaction, stream(args), { toolCallId: id });
  return { ctx, file, events, edit, write, deleteTool, call, setReadHook: hook => { beforeReadReturn = hook; } };
}

test("simultaneous disjoint replacements preserve both edits including path aliases", async t => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.call(f.edit, { path: "state.txt", old_string: "first=old", new_string: "first=new" }, "first"),
    f.call(f.edit, { path: f.file, old_string: "second=old", new_string: "second=new" }, "second"),
  ]);
  assert.deepEqual(results.map(result => result.result.case), ["success", "success"]);
  assert.equal(await readFile(f.file, "utf8"), "first=new\nsecond=new\n");
  assert.deepEqual(f.events, ["read:first", "write:first", "read:second", "write:second"]);
});

test("write and delete wait for an edit transaction rather than being overwritten", async t => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  f.setReadHook(async () => { entered.resolve(); await release.promise; });
  const edit = f.call(f.edit, { path: "state.txt", old_string: "first=old", new_string: "first=new" }, "edit");
  await entered.promise;
  const write = f.call(f.write, { path: f.file, contents: "replacement" }, "overwrite");
  const remove = f.call(f.deleteTool, { path: "./state.txt" }, "remove");
  await tick();
  assert.deepEqual(f.events, ["read:edit"]);
  release.resolve();
  assert.deepEqual((await Promise.all([edit, write, remove])).map(result => result.result.case), ["success", "success", "success"]);
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
  assert.deepEqual(f.events, ["read:edit", "write:edit", "write:overwrite", "delete:remove"]);
});

test("queued cancellation performs no write and does not block a later mutation", async t => {
  const f = await fixture(t);
  const entered = deferred();
  const release = deferred();
  f.setReadHook(async () => { entered.resolve(); await release.promise; });
  const edit = f.call(f.edit, { path: "state.txt", old_string: "first=old", new_string: "first=new" }, "edit");
  await entered.promise;
  const [canceledCtx, cancel] = f.ctx.withCancel();
  const canceled = f.call(f.write, { path: "state.txt", contents: "must not be written" }, "canceled", canceledCtx);
  const rejected = assert.rejects(canceled, /Aborted/);
  await tick();
  cancel();
  await rejected;
  const final = f.call(f.write, { path: "state.txt", contents: "final" }, "final");
  release.resolve();
  await Promise.all([edit, final]);
  assert.equal(await readFile(f.file, "utf8"), "final");
  assert.equal(f.events.includes("write:canceled"), false);
});

test("cancellation while reading aborts the edit before its write and releases the lock", async t => {
  const f = await fixture(t);
  const [ctx, cancel] = f.ctx.withCancel();
  f.setReadHook(async () => { cancel(); });
  await assert.rejects(f.call(f.edit, { path: "state.txt", old_string: "first=old", new_string: "first=new" }, "canceled", ctx), /Aborted/);
  assert.equal(await readFile(f.file, "utf8"), "first=old\nsecond=old\n");
  await f.call(f.write, { path: "state.txt", contents: "after cancellation" }, "next");
  assert.deepEqual(f.events, ["read:canceled", "write:next"]);
});

test("a rejected edit releases the mutation lock", async t => {
  const f = await fixture(t);
  const missing = await f.call(f.edit, { path: "state.txt", old_string: "absent", new_string: "new" }, "missing");
  assert.equal(missing.result.case, "error");
  await f.call(f.write, { path: "state.txt", contents: "after rejection" }, "next");
  assert.equal(await readFile(f.file, "utf8"), "after rejection");
});
