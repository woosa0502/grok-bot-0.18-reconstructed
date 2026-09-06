import { MediaCapabilityError } from "./media-capability-error.js";
import { validateMediaImage } from "./media-image-validation.js";
export { MediaCapabilityError } from "./media-capability-error.js";

export type MediaEnvironment = Readonly<Record<string, string | undefined>>;
export interface MediaProviderOptions {
  readonly env?: MediaEnvironment;
  readonly fetch?: typeof fetch;
}
export interface ImageProviderOptions extends MediaProviderOptions {
  readonly referenceImages?: readonly { readonly data: string; readonly mimeType: string }[];
  readonly aspectRatio?: string;
}
export interface AudioProviderOptions extends MediaProviderOptions {
  readonly language?: string;
}

export function mediaProviderConfiguration(kind: "image" | "transcription", env: MediaEnvironment = process.env) {
  const variable = kind === "image" ? "SAND_IMAGE_PROVIDER" : "SAND_TRANSCRIPTION_PROVIDER";
  if (env[variable]?.trim() !== "openai") {
    throw new MediaCapabilityError("not-configured", `${kind === "image" ? "Image generation" : "Audio transcription"} is not configured. Set ${variable}=openai and SAND_MEDIA_OPENAI_API_KEY (or OPENAI_API_KEY) in the app environment. This uses the OpenAI API, separately from Codex sign-in.`);
  }
  const apiKey = env.SAND_MEDIA_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new MediaCapabilityError("not-configured", "The configured OpenAI media provider needs SAND_MEDIA_OPENAI_API_KEY or OPENAI_API_KEY in the app environment.");
  const model = kind === "image" ? env.SAND_IMAGE_MODEL?.trim() || "gpt-image-2"
    : env.SAND_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe";
  if (kind === "image" && !/^gpt-image-[\w.-]+$/.test(model) && model !== "chatgpt-image-latest") throw new MediaCapabilityError("unsupported", "SAND_IMAGE_MODEL must be a GPT Image model supporting base64 image output.");
  return { apiKey, model };
}

export function isMediaProviderConfigured(kind: "image" | "transcription", env: MediaEnvironment = process.env): boolean {
  try { mediaProviderConfiguration(kind, env); return true; } catch { return false; }
}

async function boundedJson(response: Response, limit: number): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    // Provider bodies can echo submitted content. Keep failures useful without exposing it.
    throw new MediaCapabilityError("provider-error", `OpenAI media request failed (HTTP ${response.status}). Check the configured key, model access, and API quota.`);
  }
  const reader = response.body?.getReader();
  if (reader == null) throw new MediaCapabilityError("provider-error", "OpenAI media returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new MediaCapabilityError("provider-error", "OpenAI media response exceeded the supported size.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed === "object" && parsed != null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new MediaCapabilityError("provider-error", "OpenAI media returned invalid JSON.");
}

export function decodeMediaBase64(value: string, maxBytes: number): Buffer {
  if (value.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new MediaCapabilityError("invalid-input", "The attachment is not valid base64 or exceeds the supported size.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new MediaCapabilityError("invalid-input", "The attachment is empty, invalid, or exceeds the supported size.");
  }
  return bytes;
}

export async function generateConfiguredImage(description: string, options: ImageProviderOptions = {}, signal?: AbortSignal): Promise<{ imageData: string; mimeType: string }> {
  signal?.throwIfAborted();
  if (!description.trim() || description.length > 16_000) throw new MediaCapabilityError("invalid-input", "Describe the image in 1 to 16000 characters.");
  const config = mediaProviderConfiguration("image", options.env);
  const sizes: Record<string, string> = { "1:1": "1024x1024", "4:3": "1536x1152", "3:4": "1152x1536", "16:9": "1536x864", "9:16": "864x1536" };
  const ratio = options.aspectRatio ?? "1:1";
  const size = sizes[ratio];
  if (!size) throw new MediaCapabilityError("unsupported", "Supported image aspect ratios are 1:1, 4:3, 3:4, 16:9, and 9:16.");
  if (ratio !== "1:1" && !/^gpt-image-2(?:-|$)/.test(config.model)) throw new MediaCapabilityError("unsupported", "Exact non-square aspect ratios require SAND_IMAGE_MODEL=gpt-image-2 or a gpt-image-2 snapshot. The selected model only supports the square contract in this adapter.");
  const requestSignal = AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]);
  const references = options.referenceImages ?? [];
  if (references.length > 4) throw new MediaCapabilityError("invalid-input", "Image generation supports at most 4 reference images.");
  let body: string | FormData;
  if (references.length) {
    body = new FormData();
    body.set("model", config.model);
    body.set("prompt", description.trim());
    body.set("n", "1");
    body.set("size", size);
    body.set("output_format", "png");
    let totalBytes = 0;
    for (const [index, image] of references.entries()) {
      const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[image.mimeType];
      if (!extension) throw new MediaCapabilityError("invalid-input", "Reference images must be PNG, JPEG, or WebP.");
      const source = /^data:([^;]+);base64,(.*)$/s.exec(image.data);
      if (source && source[1] !== image.mimeType) throw new MediaCapabilityError("invalid-input", "Reference image data and MIME type disagree.");
      const bytes = decodeMediaBase64(source?.[2] ?? image.data, 25 * 1024 * 1024);
      totalBytes += bytes.length;
      if (totalBytes > 25 * 1024 * 1024) throw new MediaCapabilityError("invalid-input", "Reference images exceed the combined 25 MB limit.");
      await validateMediaImage(bytes, image.mimeType, options.env, requestSignal);
      body.append("image[]", new Blob([Uint8Array.from(bytes)], { type: image.mimeType }), `reference-${index}.${extension}`);
    }
  } else body = JSON.stringify({ model: config.model, prompt: description.trim(), n: 1, size, output_format: "png" });
  const response = await (options.fetch ?? fetch)(`https://api.openai.com/v1/images/${references.length ? "edits" : "generations"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) },
    body,
    signal: requestSignal,
  });
  const payload = await boundedJson(response, 36 * 1024 * 1024);
  const first = Array.isArray(payload.data) ? payload.data[0] as { b64_json?: unknown } | undefined : undefined;
  if (typeof first?.b64_json !== "string") throw new MediaCapabilityError("provider-error", "OpenAI image generation returned no base64 image.");
  const bytes = decodeMediaBase64(first.b64_json, 25 * 1024 * 1024);
  try {
    const image = await validateMediaImage(bytes, "image/png", options.env, requestSignal);
    const [width, height] = ratio.split(":").map(Number);
    if (image.width * height! !== image.height * width!) throw new MediaCapabilityError("provider-error", "The generated image does not match the requested aspect ratio.");
  }
  catch (error) {
    requestSignal.throwIfAborted();
    if (error instanceof MediaCapabilityError && error.code === "provider-error") throw error;
    throw new MediaCapabilityError("provider-error", "OpenAI image generation did not return a decodable PNG image.");
  }
  return { imageData: first.b64_json, mimeType: "image/png" };
}

export async function transcribeConfiguredAudio(bytes: Uint8Array, options: AudioProviderOptions = {}, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const config = mediaProviderConfiguration("transcription", options.env);
  if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) throw new MediaCapabilityError("invalid-input", "Transcription audio must be between 1 byte and 25 MB.");
  // The ingestion layer normalizes validated audio to PCM WAV before this API boundary.
  const wav = Buffer.from(bytes);
  let pcm = false, samples = false;
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) !== wav.length - 8) throw new MediaCapabilityError("invalid-input", "Transcription expects a complete normalized WAV recording.");
  for (let offset = 12; offset < wav.length;) {
    if (offset + 8 > wav.length) throw new MediaCapabilityError("invalid-input", "The WAV recording has a truncated chunk.");
    const kind = wav.toString("ascii", offset, offset + 4), length = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > wav.length) throw new MediaCapabilityError("invalid-input", "The WAV recording is truncated.");
    if (kind === "fmt ") {
      if (length < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt32LE(start + 4) !== 16000 || wav.readUInt16LE(start + 14) !== 16) throw new MediaCapabilityError("invalid-input", "Transcription expects mono 16 kHz PCM WAV.");
      pcm = true;
    }
    if (kind === "data") {
      if (length === 0 || length % 2 !== 0 || length > 600 * 16000 * 2) throw new MediaCapabilityError("invalid-input", "The WAV recording must contain at most 600 seconds of PCM samples.");
      samples = true;
    }
    offset = start + length + (length % 2);
  }
  if (!pcm || !samples) throw new MediaCapabilityError("invalid-input", "The WAV recording has no PCM audio samples.");
  const form = new FormData();
  form.set("model", config.model);
  form.set("response_format", "json");
  if (options.language) {
    const language = options.language.toLowerCase().split("-")[0] ?? "";
    if (!/^[a-z]{2}$/.test(language)) throw new MediaCapabilityError("invalid-input", "Transcription language must be an ISO language code such as ko or en.");
    form.set("language", language);
  }
  form.set("file", new Blob([Uint8Array.from(bytes)], { type: "audio/wav" }), "attachment.wav");
  const response = await (options.fetch ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${config.apiKey}` }, body: form,
    signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]),
  });
  const payload = await boundedJson(response, 2 * 1024 * 1024);
  if (typeof payload.text !== "string") throw new MediaCapabilityError("provider-error", "OpenAI transcription returned no text field.");
  return payload.text;
}
