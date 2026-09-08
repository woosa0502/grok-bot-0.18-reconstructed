import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
let apiPromise;
async function api() {
  return await (apiPromise ??= (async () => {
    const bundle = await build({
      stdin: {
        contents: `
          export { writeSelectedImageToProjectAssets } from "./source/packages/agent/context-processing-image-file.ts";
          export { processSelectedVideoData } from "./source/packages/agent/context-processing-video-data.ts";
          export { processSelectedContext } from "./source/packages/agent/context-processing.ts";
          export { createContext } from "./source/packages/context/core.ts";
          export { SelectedContext, SelectedImage, SelectedVideo } from "./source/packages/proto/generated/agent/v1/selected_context_pb.ts";
          export { WriteResult } from "./source/packages/proto/generated/agent/v1/write_exec_pb.ts";
        `,
        resolveDir: root, loader: "ts",
      },
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false, target: "node26",
    });
    const module = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${bundle.outputFiles[0].text}\n})`)(createRequire(path.join(root, "package.json")), module, module.exports);
    return module.exports;
  })());
}

function fixture(m, execute, options = {}) {
  const bytes = new Uint8Array([1, 3, 5, 7]);
  const ctx = options.ctx ?? m.createContext();
  const project = options.project ?? path.join(tmpdir(), "media-materialization-fixture");
  const requestContext = { env: { projectFolder: project, workspacePaths: [project] } };
  const blobs = new Map();
  const put = async (_ctx, id, data) => { blobs.set(Buffer.from(id).toString("hex"), Uint8Array.from(data)); };
  const blobStore = { setBlob: put, setBlobLocallyOnly: put, getBlob: async (_ctx, id) => blobs.get(Buffer.from(id).toString("hex")) };
  const resourceAccessor = execute ? { get: () => ({ execute }) } : undefined;
  const image = new m.SelectedImage({ path: "/external/photo.png", mimeType: "image/png", dataOrBlobId: { case: "data", value: bytes } });
  const video = new m.SelectedVideo({ filename: "clip.mp4", mimeType: "video/mp4", materializeToFilesystem: true, dataOrBlobId: { case: "data", value: bytes } });
  const imageArgs = { ctx, imageData: bytes, selectedImage: image, resolvedMimeType: "image/png", index: 0, enableImageFiles: true, requestContext, resourceAccessor };
  const videoArgs = { ctx, blobStore, selectedVideo: video, index: 0, modelId: "claude-sonnet", maxVideoBytes: 100, requestContext, resourceAccessor };
  const config = { enableTerminalFiles: false, enableAgentNotes: false, enableImageFiles: true, enableLongCodeSelectionSpillToFile: false, formattingOptions: {}, webScraperService: { getContentInWebsiteFast: async () => null }, documentationHydrationService: {} };
  const dispatch = (selected, overrides = {}) => m.processSelectedContext(ctx, new m.SelectedContext(selected), blobStore, config, overrides.requestContext ?? requestContext, resourceAccessor, 0, "claude-sonnet", "Review attached media", 0, 1);
  return { bytes, ctx, blobStore, image, video, imageArgs, videoArgs, dispatch };
}

const writeResult = (m, kind = "success") => new m.WriteResult({ result: kind ? { case: kind, value: {} } : { case: undefined } });

test("image materialization waits for typed write success before exposing a path", async () => {
  const m = await api();
  const deferred = Promise.withResolvers();
  const f = fixture(m, async () => deferred.promise);
  let settled = false;
  const pending = m.writeSelectedImageToProjectAssets(f.imageArgs).finally(() => { settled = true; });
  await setImmediate();
  assert.equal(settled, false);
  deferred.resolve(writeResult(m));
  assert.match(await pending, /assets[/\\].+\.png$/);
});

test("same-basename images retain distinct bytes on the real filesystem", async (t) => {
  const m = await api();
  const project = await mkdtemp(path.join(tmpdir(), "belmont-media-assets-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const f = fixture(m, async (_ctx, args) => {
    await mkdir(path.dirname(args.path), { recursive: true });
    await writeFile(args.path, args.fileBytes);
    return writeResult(m);
  }, { project });
  const firstBytes = new Uint8Array([2, 4, 6]);
  const secondBytes = new Uint8Array([8, 10, 12]);
  const [first, second] = await Promise.all([
    m.writeSelectedImageToProjectAssets({ ...f.imageArgs, imageData: firstBytes, selectedImage: { path: "/camera-a/photo.png" } }),
    m.writeSelectedImageToProjectAssets({ ...f.imageArgs, imageData: secondBytes, selectedImage: { path: "/camera-b/photo.png" } }),
  ]);
  assert.notEqual(first, second);
  assert.deepEqual(new Uint8Array(await readFile(first)), firstBytes);
  assert.deepEqual(new Uint8Array(await readFile(second)), secondBytes);
});

test("typed write failures and rejected writes preserve image content and give honest context", async (t) => {
  const m = await api();
  for (const kind of ["noSpace", "permissionDenied", "error", "rejected", undefined, "throw"]) {
    await t.test(kind ?? "unset", async () => {
      const f = fixture(m, async () => { if (kind === "throw") throw new Error("synthetic write failure"); return writeResult(m, kind ?? ""); });
      const result = await f.dispatch({ selectedImages: [f.image] });
      assert.deepEqual(result.imageFilePaths, []);
      assert.equal(result.selectedImages.length, 1);
      assert.deepEqual(await f.blobStore.getBlob(f.ctx, result.selectedImages[0].dataOrBlobId.value), f.bytes);
      assert.deepEqual(result.userContent.find(part => part.type === "image").image, f.bytes);
      assert.match(result.userContent.filter(part => part.type === "text").map(part => part.text).join("\n"), /could not be saved/);
    });
  }
});

test("typed write failures retain video bytes and never claim a saved video", async (t) => {
  const m = await api();
  for (const kind of ["noSpace", "permissionDenied", "error", "rejected", undefined, "throw"]) {
    await t.test(kind ?? "unset", async () => {
      const f = fixture(m, async () => { if (kind === "throw") throw new Error("synthetic write failure"); return writeResult(m, kind ?? ""); });
      const leaf = await m.processSelectedVideoData(f.videoArgs);
      assert.equal(leaf.localFilePath, undefined);
      assert.deepEqual(leaf.videoData, f.bytes);
      assert.equal(leaf.processedSelectedVideo.dataOrBlobId.case, "blobId");
      assert.ok(leaf.materializationError);
      const result = await f.dispatch({ selectedVideos: [f.video] });
      assert.deepEqual(result.videoFilePaths, []);
      assert.equal(result.selectedVideos.length, 1);
      assert.deepEqual(await f.blobStore.getBlob(f.ctx, result.selectedVideos[0].dataOrBlobId.value), f.bytes);
      assert.ok(result.userContent.every(part => part.type === "text"));
      const text = result.userContent.map(part => part.text).join("\n");
      assert.match(text, /could not be saved/);
      assert.doesNotMatch(text, /have been attached by the user and saved/);
    });
  }
});

test("missing materialization resources retain attachments with an explicit failure", async () => {
  const m = await api();
  const f = fixture(m);
  const video = await m.processSelectedVideoData(f.videoArgs);
  assert.equal(video.localFilePath, undefined);
  assert.deepEqual(video.videoData, f.bytes);
  assert.ok(video.materializationError);
  const noWorkspace = fixture(m, async () => { throw new Error("must not write without workspace"); });
  const unrooted = await m.processSelectedVideoData({ ...noWorkspace.videoArgs, requestContext: undefined });
  assert.ok(unrooted.materializationError);
  assert.deepEqual(unrooted.videoData, f.bytes);
  const result = await f.dispatch({ selectedImages: [f.image], selectedVideos: [f.video] });
  assert.equal(result.selectedImages.length, 1);
  assert.equal(result.selectedVideos.length, 1);
  assert.deepEqual(result.imageFilePaths, []);
  assert.deepEqual(result.videoFilePaths, []);
  assert.equal(result.userContent.filter(part => part.text?.includes("could not be saved")).length, 2);
});

test("successful video materialization exposes the completed path", async () => {
  const m = await api();
  const writes = [];
  const f = fixture(m, async (_ctx, args) => { writes.push(args.path); return writeResult(m); });
  const result = await f.dispatch({ selectedVideos: [f.video] });
  assert.deepEqual(result.videoFilePaths, writes);
  assert.equal(result.selectedVideos.length, 1);
  assert.equal(result.selectedVideos[0].path, writes[0]);
  assert.match(result.userContent.map(part => part.text ?? "").join("\n"), /saved to your filesystem/);
});

test("cancellation interrupts pending image and video writes without leaving abort listeners", async (t) => {
  const m = await api();
  for (const kind of ["image", "video"]) {
    await t.test(kind, async () => {
      const [ctx, cancel] = m.createContext().withCancel();
      const started = Promise.withResolvers();
      const deferred = Promise.withResolvers();
      const f = fixture(m, async () => { started.resolve(); return deferred.promise; }, { ctx });
      const before = getEventListeners(ctx.signal, "abort").length;
      const pending = kind === "image" ? m.writeSelectedImageToProjectAssets(f.imageArgs) : m.processSelectedVideoData(f.videoArgs);
      await started.promise;
      const reason = new Error("user stopped media processing");
      const rejected = assert.rejects(pending, error => error === reason);
      cancel(reason);
      await rejected;
      assert.equal(getEventListeners(ctx.signal, "abort").length, before);
      deferred.resolve(writeResult(m));
    });
  }
});

test("dispatcher propagates write cancellation instead of degrading it to a failure note", async (t) => {
  const m = await api();
  for (const kind of ["image", "video"]) {
    await t.test(kind, async () => {
      for (const reason of [new DOMException("executor stopped", "AbortError"), { name: "AbortError", message: "executor stopped" }]) {
        const f = fixture(m, async () => { throw reason; });
        await assert.rejects(f.dispatch(kind === "image" ? { selectedImages: [f.image] } : { selectedVideos: [f.video] }), error => error === reason);
      }
    });
  }
});
