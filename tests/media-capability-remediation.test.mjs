import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import test from "node:test";
import { build, transform } from "esbuild";
import { parse } from "acorn";

const root = path.resolve(import.meta.dirname, "..");
const exec = promisify(execFile);
const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPjPwMDAxMDAwMDAAAALHwEDmIWXfgAAAABJRU5ErkJggg==";
const fakeEnv = { SAND_TRANSCRIPTION_PROVIDER: "openai", SAND_IMAGE_PROVIDER: "openai", SAND_MEDIA_OPENAI_API_KEY: "fake-test-key" };
let apiPromise;
async function api() {
  return await (apiPromise ??= (async () => {
    const result = await build({
      stdin: { contents: `
        export * from "./source/shared/node/media-provider.ts";
        export * from "./source/shared/node/audio-transcription.ts";
        export * from "./source/shared/node/local-media-routing.ts";
        export * from "./source/host/extensions/inference/media-preprocessing.ts";
        export * from "./source/host/extensions/inference/pi-codex-projection.ts";
        export * from "./source/host/selected-media-inputs.ts";
        export { buildSelectedVideos } from "./source/host/extensions/transcript/send-message-shaping.ts";
        export { createPromptCollectorGlue } from "./source/host/runner/prompt-collector-glue.ts";
        export { processSelectedContext } from "./source/packages/agent/context-processing.ts";
        export { processSelectedVideoData } from "./source/packages/agent/context-processing-video-data.ts";
        export { SelectedContext, SelectedVideo } from "./source/packages/proto/generated/agent/v1/selected_context_pb.ts";
        export { createContext } from "./source/packages/context/core.ts";
        export { createSandGenerateImageService } from "./source/host/extensions/attachments/generate-image-service.ts";
        export { SandTranscriptionManager } from "./source/electron-main/account/cursor-transcribe.ts";
        export { createTranscriptionManagerEnsure } from "./source/electron-main/account/cursor-auth-wiring.ts";
        export { createProductionAvatarImagesAdapter } from "./source/electron-main/adapters/avatar-images.ts";
        export { createSandGenerateImageResourceAccessor } from "./source/host/extensions/attachments/generate-image-resource-accessor.ts";
        export { readExecutorResource } from "./source/packages/agent-exec/read.ts";
        export { writeExecutorResource } from "./source/packages/agent-exec/write.ts";
        export { ReadArgs, ReadResult } from "./source/packages/proto/generated/agent/v1/read_exec_pb.ts";
        export { WriteArgs, WriteResult } from "./source/packages/proto/generated/agent/v1/write_exec_pb.ts";
      `, resolveDir: root, loader: "ts" },
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false, target: "node26",
    });
    const module = { exports: {} };
    const wrapper = vm.runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { filename: path.join(root, "media-test.cjs"), importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
    wrapper(createRequire(path.join(root, "package.json")), module, module.exports);
    return module.exports;
  })());
}

async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "belmont-media-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function syntheticVideo(t, audio = true) {
  const dir = await temporary(t);
  const file = path.join(dir, "fixture.mp4");
  await exec("ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=red:s=96x64:r=4", ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000"] : []), "-t", "2", "-c:v", "mpeg4", "-threads", "1", ...(audio ? ["-c:a", "aac"] : []), "-y", file], { timeout: 15_000 });
  return await readFile(file);
}

async function syntheticWav(t) {
  const dir = await temporary(t);
  const file = path.join(dir, "fixture.wav");
  await exec("ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "0.25", "-threads", "1", "-y", file], { timeout: 15_000 });
  return await readFile(file);
}

async function actualTurnOptions(normalizePathOnlySelectedVideo) {
  const source = await readFile(path.join(root, "source/host/host-runner-composition.ts"), "utf8");
  const { code } = await transform(source, { loader: "ts", format: "esm", target: "node26" });
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  const names = ["isGeneratedSelectedVideo", "toGeneratedTurnPromptOptions"];
  const functions = names.map(name => ast.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === name));
  assert.ok(functions.every(Boolean), "the actual host projection functions remain present");
  return new Function("normalizePathOnlySelectedVideo", `${functions.map(fn => code.slice(fn.start, fn.end)).join("\n")}\nreturn toGeneratedTurnPromptOptions;`)(normalizePathOnlySelectedVideo);
}

test("unconfigured media makes no requests and raw attachments cannot disappear in projection", async () => {
  const m = await api();
  let calls = 0;
  const fetch = async () => { calls++; throw new Error("unexpected network"); };
  await assert.rejects(m.generateConfiguredImage("owl", { env: { OPENAI_API_KEY: "present-but-not-opted-in" }, fetch }), { code: "not-configured" });
  const pre = m.createMediaPreprocessor({ env: {}, fetch });
  const result = await pre([{ role: "user", content: [{ type: "file", mimeType: "audio/wav", data: new Uint8Array([1]) }] }]);
  assert.match(result[0].content[0].text, /not-configured/);
  assert.equal(calls, 0);
  const projected = m.messagesToPi([{ role: "user", content: [{ type: "audio", data: "not-bytes" }, { type: "file", mimeType: "application/pdf", data: "opaque" }] }]);
  assert.equal(projected[0].content.length, 2);
  assert.match(projected[0].content[0].text, /not processed/);
});

test("configured avatar generation uses actual Images API schema and rejects invalid responses", async () => {
  const m = await api();
  let calls = 0;
  const generated = await m.generateConfiguredImage("  owl avatar  ", { env: fakeEnv, fetch: async (url, request) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(request.headers.Authorization, "Bearer fake-test-key");
    assert.deepEqual(JSON.parse(request.body), { model: "gpt-image-2", prompt: "owl avatar", n: 1, size: "1024x1024", output_format: "png" });
    assert.equal(request.signal.aborted, false);
    return Response.json({ data: [{ b64_json: png }] });
  } });
  assert.deepEqual(generated, { imageData: png, mimeType: "image/png" });
  assert.equal(calls, 1);
  await assert.rejects(m.generateConfiguredImage("owl", { env: fakeEnv, fetch: async () => Response.json({ data: [{ b64_json: Buffer.from("not PNG").toString("base64") }] }) }), /PNG/);
  await assert.rejects(m.generateConfiguredImage("owl", { env: fakeEnv, fetch: async () => new Response("private-prompt-and-key", { status: 401 }) }), error => /401/.test(error.message) && !error.message.includes("private-prompt"));
});

test("audio API sends multipart WAV and surfaces provider response failures", async (t) => {
  const m = await api();
  const wav = await syntheticWav(t);
  const text = await m.transcribeConfiguredAudio(wav, { env: fakeEnv, fetch: async (url, request) => {
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(request.body.get("model"), "gpt-4o-mini-transcribe");
    assert.equal(request.body.get("response_format"), "json");
    assert.equal(request.body.get("file").name, "attachment.wav");
    assert.deepEqual(Buffer.from(await request.body.get("file").arrayBuffer()), wav);
    return Response.json({ text: "synthetic provider transcript" });
  } });
  assert.equal(text, "synthetic provider transcript");
  await assert.rejects(m.transcribeConfiguredAudio(wav, { env: fakeEnv, fetch: async () => Response.json({ text: null }) }), /text field/);
});

test("host GenerateImage routes reference images to actual edit schema and persists provider bytes", async () => {
  const m = await api();
  let saved;
  const generate = m.createSandGenerateImageService({ getAccessToken: async () => { throw new Error("must not use Cursor token"); }, getMachineId: async () => "test" }, {
    mediaProvider: { env: { ...fakeEnv, SAND_LOCAL_CODEX_MODE: "1" }, fetch: async (url, request) => {
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.equal(request.body.get("prompt"), "owl variation");
      assert.equal(request.body.get("output_format"), "png");
      assert.equal(request.body.get("image[]").type, "image/png");
      assert.deepEqual(Buffer.from(await request.body.get("image[]").arrayBuffer()), Buffer.from(png, "base64"));
      assert.equal(request.headers["Content-Type"], undefined, "fetch must set the multipart boundary");
      return Response.json({ data: [{ b64_json: png }] });
    } },
    persistImage: async (bytes, mime) => { saved = { bytes, mime }; return { absolutePath: "/synthetic/output.png" }; },
  });
  const result = await generate({}, "owl variation", undefined, [{ data: png, mimeType: "image/png" }]);
  assert.equal(result.filePath, "/synthetic/output.png");
  assert.equal(saved.mime, "image/png");
  assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(png, "base64"));
});

test("the actual local avatar adapter uses the configured provider and rejects undecodable images", async () => {
  const m = await api();
  const nativeImage = bytes => ({ isEmpty: () => !m.base64LooksLikeImage(Buffer.from(bytes).toString("base64")), getSize: () => ({ width: 2, height: 2 }), resize() { return this; }, toPNG: () => Buffer.from(png, "base64") });
  let returnedImage = png;
  const adapter = m.createProductionAvatarImagesAdapter({
    electron: { BrowserWindow: class {}, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, nativeImage: { createFromPath: () => nativeImage(Buffer.alloc(0)), createFromBuffer: nativeImage } },
    mediaProvider: { fetch: async () => Response.json({ data: [{ b64_json: returnedImage }] }) },
  });
  const edge = adapter.create({ env: { ...fakeEnv, SAND_LOCAL_CODEX_MODE: "1" }, getMainWindow: () => null, requireAccount: () => { throw new Error("must not use Cursor account"); }, readTelemetry: () => undefined });
  assert.equal(await edge.generateImage("owl"), `data:image/png;base64,${png}`);
  returnedImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  await assert.rejects(edge.generateImage("owl"), /decodable PNG|could not be decoded/);
});

test("actual microphone manager transcribes local recordings without Cursor and preserves unconfigured errors", async (t) => {
  const m = await api();
  const wav = await syntheticWav(t);
  const auth = { getCursorAccessToken: async () => { throw new Error("must not use Cursor token"); }, getMachineId: async () => "synthetic" };
  const manager = new m.SandTranscriptionManager({ ...auth, mediaProvider: { env: { ...fakeEnv, SAND_LOCAL_CODEX_MODE: "1" }, fetch: async (_url, request) => {
    assert.equal(request.body.get("file").type, "audio/wav");
    assert.equal(request.body.get("language"), "ko");
    return Response.json({ text: "synthetic microphone transcript" });
  } } });
  const result = await manager.transcribe({ audio: wav, mimeType: "audio/wav", language: "ko-KR" });
  assert.equal(result.text, "synthetic microphone transcript");
  assert.ok(result.transcriptionTimeMs >= 0);
  const unconfigured = new m.SandTranscriptionManager({ ...auth, mediaProvider: { env: { SAND_LOCAL_CODEX_MODE: "1" } } });
  await assert.rejects(unconfigured.transcribe({ audio: wav, mimeType: "audio/wav" }), { code: "not-configured" });
});

test("invalid image pixels and WAV headers are rejected before upload or persistence", async () => {
  const m = await api();
  let calls = 0, persisted = false;
  const invalidPng = "iVBORw0KGgoAAAAASUVORK5CYII=";
  const fetch = async () => { calls++; return Response.json({ data: [{ b64_json: invalidPng }] }); };
  await assert.rejects(m.generateConfiguredImage("reference", { env: fakeEnv, referenceImages: [{ data: invalidPng, mimeType: "image/png" }], fetch }), /cannot be decoded/);
  assert.equal(calls, 0);
  const generator = m.createSandGenerateImageService({ getAccessToken: async () => "unused", getMachineId: async () => "unused" }, { mediaProvider: { env: { ...fakeEnv, SAND_LOCAL_CODEX_MODE: "1" }, fetch }, persistImage: async () => { persisted = true; return { absolutePath: "/bad.png" }; } });
  await assert.rejects(generator({}, "invalid output"), /decodable PNG/);
  assert.equal(persisted, false);
  calls = 0;
  await assert.rejects(m.transcribeConfiguredAudio(Buffer.from("RIFF1234WAVE"), { env: fakeEnv, fetch }), /complete normalized WAV/);
  assert.equal(calls, 0);
});

test("configured image aspect ratios are sent and output mismatches are refused", async (t) => {
  const m = await api();
  const dir = await temporary(t);
  const file = path.join(dir, "wide.png");
  await exec("ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=red:s=160x90", "-frames:v", "1", "-threads", "1", "-y", file]);
  const wide = (await readFile(file)).toString("base64");
  const result = await m.generateConfiguredImage("wide", { env: fakeEnv, aspectRatio: "16:9", fetch: async (_url, request) => { assert.equal(JSON.parse(request.body).size, "1536x864"); return Response.json({ data: [{ b64_json: wide }] }); } });
  assert.equal(result.imageData, wide);
  await assert.rejects(m.generateConfiguredImage("wide", { env: fakeEnv, aspectRatio: "16:9", fetch: async () => Response.json({ data: [{ b64_json: png }] }) }), /aspect ratio/);
  await assert.rejects(m.generateConfiguredImage("wide", { env: { ...fakeEnv, SAND_IMAGE_MODEL: "gpt-image-1" }, aspectRatio: "16:9", fetch: async () => { throw new Error("must not upload"); } }), /require SAND_IMAGE_MODEL/);
});

test("GenerateImage resource ABI reads real protobuf bytes and contains its writes", async (t) => {
  const m = await api();
  const dir = await temporary(t);
  const accessor = m.createSandGenerateImageResourceAccessor(dir);
  const ctx = m.createContext();
  const output = path.join(dir, "assets", "generated.png");
  const written = await accessor.get(m.writeExecutorResource).execute(ctx, new m.WriteArgs({ path: output, fileBytes: Buffer.from(png, "base64") }));
  assert.ok(written instanceof m.WriteResult);
  assert.equal(written.result.case, "success");
  const read = await accessor.get(m.readExecutorResource).execute(ctx, new m.ReadArgs({ path: output }));
  assert.ok(read instanceof m.ReadResult);
  assert.equal(read.result.value.output.case, "data");
  assert.deepEqual(Buffer.from(read.result.value.output.value), Buffer.from(png, "base64"));
  const outside = await accessor.get(m.writeExecutorResource).execute(ctx, new m.WriteArgs({ path: path.join(dir, "..", "escape.png"), fileBytes: Buffer.from(png, "base64") }));
  assert.equal(outside.result.case, "error");
});

test("the microphone factory defers Cursor auth until the nonlocal backend needs it", async () => {
  const m = await api();
  let authCalls = 0;
  const ensure = m.createTranscriptionManagerEnsure({
    ensureCursorAuthService: async () => { authCalls++; return { getValidAccessToken: async () => "synthetic-cursor-token" }; },
    getMachineId: async () => "synthetic",
    createClient: credentials => ({ transcribeAudio: async () => {
      assert.equal(await credentials.getCursorAccessToken(), "synthetic-cursor-token");
      return { text: "nonlocal transcript", transcriptionTimeMs: 1n };
    } }),
  });
  const manager = await ensure();
  assert.equal(authCalls, 0);
  assert.equal(await ensure(), manager);
  const result = await manager.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/wav" });
  assert.equal(result.text, "nonlocal transcript");
  assert.equal(authCalls, 1);
});

test("MediaRecorder-style WebM without duration metadata is decoded before transcription", async () => {
  const m = await api();
  const result = await exec("ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "0.25", "-c:a", "libopus", "-threads", "1", "-f", "webm", "pipe:1"], { timeout: 15_000, encoding: "buffer" });
  const text = await m.transcribeAudioInput(result.stdout, "audio/webm;codecs=opus", { env: fakeEnv, fetch: async (_url, request) => {
    const bytes = Buffer.from(await request.body.get("file").arrayBuffer());
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    return Response.json({ text: "synthetic streamed recording" });
  } });
  assert.equal(text, "synthetic streamed recording");
  const pre = m.createMediaPreprocessor({ env: fakeEnv, fetch: async () => Response.json({ text: "synthetic streamed recording" }) });
  const processed = await pre([{ role: "user", content: [{ type: "file", mimeType: "audio/webm", data: result.stdout }] }]);
  assert.match(processed[0].content[0].text, /synthetic streamed recording/);
});

test("video is decoded into actual frames and transcript, cached without repeat provider calls, then cleaned", async (t) => {
  const m = await api();
  const bytes = await syntheticVideo(t);
  const temp = await temporary(t);
  let calls = 0;
  const pre = m.createMediaPreprocessor({ env: fakeEnv, temporaryRoot: temp, fetch: async () => { calls++; return Response.json({ text: "fake provider hears the synthetic tone" }); } });
  const original = [{ role: "user", content: [{ type: "file", mimeType: "video/mp4", data: bytes }] }];
  const result = await pre(original);
  const content = m.messagesToPi(result)[0].content;
  assert.equal(content.filter(part => part.type === "image").length, 1);
  assert.equal(m.base64LooksLikeImage(content.find(part => part.type === "image").data), true);
  assert.match(content.map(part => part.text ?? "").join("\n"), /sparse visual sampling/);
  assert.match(content.map(part => part.text ?? "").join("\n"), /synthetic tone/);
  assert.deepEqual(await readdir(temp), []);
  assert.deepEqual(await pre(original), result);
  assert.equal(calls, 1);
  assert.equal(original[0].content[0].type, "file");
});

test("silent video needs no transcription key; unavailable video audio remains explicit", async (t) => {
  const m = await api();
  const pre = m.createMediaPreprocessor({ env: {}, fetch: async () => { throw new Error("unexpected network"); } });
  const silent = await pre([{ role: "user", content: [{ type: "image", mimeType: "video/mp4", image: `data:video/mp4;base64,${(await syntheticVideo(t, false)).toString("base64")}` }] }]);
  assert.equal(silent[0].content.filter(part => part.type === "image").length, 1);
  assert.match(silent[0].content.at(-1).text, /no audio stream/);
  const audible = await pre([{ role: "user", content: [{ type: "file", mimeType: "video/mp4", data: await syntheticVideo(t) }] }]);
  assert.match(audible[0].content.at(-1).text, /audio track.*not-configured/);
});

test("decoder cancellation removes its temporary files and prevents provider calls", async (t) => {
  const m = await api();
  const temp = await temporary(t);
  const slowProbe = path.join(temp, "slow-probe");
  await writeFile(slowProbe, `#!${process.execPath}\nsetTimeout(() => {}, 30000);\n`);
  await chmod(slowProbe, 0o700);
  const pre = m.createMediaPreprocessor({ env: { ...fakeEnv, SAND_FFPROBE_PATH: slowProbe }, temporaryRoot: temp, fetch: async () => { throw new Error("unexpected provider call"); } });
  const controller = new AbortController();
  const bytes = await syntheticVideo(t);
  const pending = pre([{ role: "user", content: [{ type: "file", mimeType: "video/mp4", data: bytes }] }], true, controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, { name: "AbortError" }); } finally { clearTimeout(timer); }
  assert.deepEqual(await readdir(temp), ["slow-probe"]);
});

test("invalid, remote, mismatched and model-incompatible media give explicit limitations", async (t) => {
  const m = await api();
  const pre = m.createMediaPreprocessor({ env: fakeEnv, fetch: async () => { throw new Error("unexpected network"); } });
  const message = content => [{ role: "user", content }];
  const rejected = await pre(message([
    { type: "file", mimeType: "video/mp4", data: "https://example.com/private.mp4" },
    { type: "file", mimeType: "video/mp4", data: "data:audio/wav;base64,UklGRg==" },
    { type: "file", mimeType: "video/mp4", data: Buffer.from("not a container") },
  ]));
  assert.equal(rejected[0].content.length, 3);
  for (const part of rejected[0].content) assert.match(part.text, /not understood.*invalid-input/);
  const unsupported = await pre(message([{ type: "file", mimeType: "video/mp4", data: await syntheticVideo(t) }]), false);
  assert.match(unsupported[0].content[0].text, /does not accept images/);
});

test("a cold media history prioritizes recent requests within the total decoding budget", async (t) => {
  const m = await api();
  const video = await syntheticVideo(t, false);
  const messages = Array.from({ length: 6 }, (_, index) => ({ role: "user", content: [{ type: "file", mimeType: "video/mp4", data: Buffer.concat([video, Buffer.from([index])]) }] }));
  const pre = m.createMediaPreprocessor({ env: {} });
  const result = await pre(messages);
  assert.match(result[0].content[0].text, /At most 4 uncached/);
  assert.match(result[1].content[0].text, /At most 4 uncached/);
  for (const message of result.slice(2)) assert.ok(message.content.some(part => part.type === "image"));
});

test("accepted host audio and video reach actual canonical context and Pi preprocessing", async (t) => {
  const m = await api();
  const temp = await temporary(t);
  const oldRoot = process.env.SAND_DATA_ROOT;
  const oldMode = process.env.SAND_LOCAL_CODEX_MODE;
  process.env.SAND_DATA_ROOT = temp;
  process.env.SAND_LOCAL_CODEX_MODE = "1";
  t.after(() => { if (oldRoot === undefined) delete process.env.SAND_DATA_ROOT; else process.env.SAND_DATA_ROOT = oldRoot; if (oldMode === undefined) delete process.env.SAND_LOCAL_CODEX_MODE; else process.env.SAND_LOCAL_CODEX_MODE = oldMode; });
  const wav = await syntheticWav(t);
  const audioPath = path.join(temp, "voice.wav");
  await writeFile(audioPath, wav);
  const video = await syntheticVideo(t, false);
  const videoPath = path.join(temp, "video.mp4");
  await writeFile(videoPath, video);
  const turnOptions = await actualTurnOptions(m.normalizePathOnlySelectedVideo);
  const selectedVideos = turnOptions({ selectedVideos: m.buildSelectedVideos([videoPath]) }).selectedVideos;
  assert.equal(selectedVideos[0].dataOrBlobId.case, undefined);
  let reads = 0;
  const ctx = m.createContext();
  const glue = m.createPromptCollectorGlue({ ctx, readVideoAttachmentBytes: async path => { assert.equal(path, videoPath); reads++; return video; } });
  const assembled = await glue.assembleGeneratedTurnAction({ runCtx: ctx, trimmedPrompt: "Review these", options: { selectedVideos, attachedFilePaths: [audioPath] }, compactionEpoch: () => 0 });
  const selected = assembled.action.action.value.userMessage.selectedContext;
  assert.equal(selected.selectedVideos[0].dataOrBlobId.case, "data");
  assert.equal(selected.selectedDocuments[0].mimeType, "audio/wav");
  assert.equal(reads, 1);
  const blobData = new Map();
  const store = { getBlob: async (_ctx, id) => blobData.get(Buffer.from(id).toString("hex")), setBlob: async (_ctx, id, bytes) => { blobData.set(Buffer.from(id).toString("hex"), bytes); }, setBlobLocallyOnly: async () => {} };
  const config = { enableTerminalFiles: false, enableAgentNotes: false, enableImageFiles: false, enableLongCodeSelectionSpillToFile: false, formattingOptions: {}, webScraperService: { getContentInWebsiteFast: async () => null }, documentationHydrationService: {} };
  const canonical = await m.processSelectedContext(ctx, selected, store, config, undefined, undefined, 0, "gpt-5.5", "Review these", 0, 1);
  assert.equal(canonical.userContent.filter(part => part.type === "file").length, 2);
  const pre = m.createMediaPreprocessor({ env: fakeEnv, fetch: async () => Response.json({ text: "synthetic canonical transcript" }) });
  const projected = m.messagesToPi(await pre([{ role: "user", content: canonical.userContent }]))[0].content;
  assert.ok(projected.some(part => part.type === "image"));
  assert.ok(projected.some(part => part.text?.includes("synthetic canonical transcript")));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(m.loadSelectedAudioDocuments([audioPath], controller.signal, temp), { name: "AbortError" });
  const outside = await temporary(t);
  const outsideAudio = path.join(outside, "outside.wav"); await writeFile(outsideAudio, wav);
  const link = path.join(temp, "link.wav"); await symlink(outsideAudio, link);
  await assert.rejects(m.loadSelectedAudioDocuments([link], undefined, temp), /accepted Belmont attachment store/);
});

test("Gemini retains native video projection and other backends are not blindly enabled", async () => {
  const m = await api();
  assert.equal(m.usesLocalMediaPreprocessing("gemini-2.5-pro", { SAND_LOCAL_CODEX_MODE: "1" }), false);
  assert.equal(m.usesLocalMediaPreprocessing("gpt-5.5", { SAND_LOCAL_CODEX_MODE: "1" }), true);
  assert.equal(m.usesLocalMediaPreprocessing("gpt-5.5", {}), false);
  await assert.rejects(m.processSelectedVideoData({ ctx: m.createContext(), selectedVideo: new m.SelectedVideo({ mimeType: "video/mp4" }), modelId: "claude-sonnet", maxVideoBytes: 100 }), /only supported for Gemini/);
});
