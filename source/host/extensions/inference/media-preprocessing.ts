import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { decodeMediaBase64, MediaCapabilityError, mediaProviderConfiguration, transcribeConfiguredAudio, type MediaEnvironment, type MediaProviderOptions } from "../../../shared/node/media-provider.js";
import { transcribeAudioInput } from "../../../shared/node/audio-transcription.js";
import { sniffsAsImage } from "../../selected-image-inputs.js";
import type { PiProviderMessage } from "./pi-codex-projection.js";

type Part = Record<string, unknown>;
type ProjectedPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const exec = promisify(execFile);
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 600;
const MAX_FRAMES = 8;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function record(value: unknown): Part | undefined {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Part : undefined;
}

export function mediaAttachmentKind(part: Part): "audio" | "video" | undefined {
  if (part.type === "audio" || part.type === "video") return part.type;
  const mime = typeof (part.mimeType ?? part.mediaType) === "string" ? String(part.mimeType ?? part.mediaType).toLowerCase() : "";
  if ((part.type === "file" || part.type === "image") && mime.startsWith("audio/")) return "audio";
  if ((part.type === "file" || part.type === "image") && mime.startsWith("video/")) return "video";
  return undefined;
}

function inputBytes(part: Part, kind: "audio" | "video"): Buffer {
  const source = part.data ?? part[kind] ?? part.image;
  const mime = String(part.mimeType ?? part.mediaType ?? "").toLowerCase().split(";")[0];
  if (mime && !mime.startsWith(`${kind}/`)) throw new MediaCapabilityError("invalid-input", `The ${kind} attachment has a conflicting media type.`);
  let bytes: Buffer;
  if (typeof source === "string") {
    const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(source);
    if (dataUrl && (!dataUrl[1]?.startsWith(`${kind}/`) || (mime && dataUrl[1] !== mime))) throw new MediaCapabilityError("invalid-input", "Attachment data URL and media type disagree.");
    // No arbitrary local paths or remote URLs: callers must supply authorized attachment bytes.
    bytes = decodeMediaBase64(dataUrl?.[2] ?? source, MAX_INPUT_BYTES);
  } else if (ArrayBuffer.isView(source)) {
    if (source.byteLength > MAX_INPUT_BYTES) throw new MediaCapabilityError("invalid-input", "Media attachments are limited to 100 MB.");
    bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  } else if (Object.prototype.toString.call(source) === "[object ArrayBuffer]") {
    bytes = Buffer.from(source as ArrayBuffer);
  } else {
    const serialized = record(source);
    if (serialized?.type !== "Buffer" || !Array.isArray(serialized.data) || serialized.data.length > MAX_INPUT_BYTES || !serialized.data.every(item => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new MediaCapabilityError("invalid-input", "Media attachment bytes are unavailable. Attach the file itself; remote URLs and local paths are not fetched by media preprocessing.");
    }
    bytes = Buffer.from(serialized.data);
  }
  if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) throw new MediaCapabilityError("invalid-input", "Media attachments must be between 1 byte and 100 MB.");
  // Accept standalone media containers only, never playlists that reference other files/URLs.
  const header = bytes.toString("ascii", 0, 12);
  const container = header.startsWith("RIFF") || header.startsWith("OggS") || header.startsWith("fLaC")
    || header.startsWith("ID3") || header.slice(4, 8) === "ftyp"
    || bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
  if (!container) throw new MediaCapabilityError("invalid-input", "Unsupported or invalid media container. Use MP4, WebM, WAV, MP3, Ogg, or FLAC.");
  return bytes;
}

export interface MediaPreprocessorOptions extends MediaProviderOptions {
  readonly temporaryRoot?: string;
}

async function command(binary: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  try {
    const result = await exec(binary, [...args], {
      timeout: 60_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    return result.stdout;
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MediaCapabilityError("not-configured", "Media preprocessing needs ffmpeg and ffprobe. Install them or set SAND_FFMPEG_PATH and SAND_FFPROBE_PATH in the app environment.");
    throw new MediaCapabilityError("processing-error", "The media decoder could not process the attachment within its time and output limits.");
  }
}

function failureNote(kind: string, error: unknown): ProjectedPart {
  const reason = error instanceof MediaCapabilityError ? `${error.code}: ${error.message}` : "processing-error: media preprocessing failed.";
  return { type: "text", text: `[Attached ${kind} was not understood: ${reason} Do not claim to have heard or watched this content.]` };
}

/** Isolated temporary files, bounded sampling and cache; no model calls without explicit provider configuration. */
export function createMediaPreprocessor(options: MediaPreprocessorOptions = {}) {
  const cache = new Map<string, { parts: ProjectedPart[]; size: number }>();
  let cacheSize = 0;
  const remember = (key: string, parts: ProjectedPart[]) => {
    const size = Buffer.byteLength(JSON.stringify(parts));
    if (size > MAX_CACHE_BYTES) return;
    while (cache.size >= 32 || cacheSize + size > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cacheSize -= cache.get(oldest)!.size;
      cache.delete(oldest);
    }
    cache.set(key, { parts: structuredClone(parts), size });
    cacheSize += size;
  };
  async function preprocess(part: Part, kind: "audio" | "video", supportsImages: boolean, budget: { remaining: number }, signal?: AbortSignal): Promise<ProjectedPart[]> {
    signal?.throwIfAborted();
    const env: MediaEnvironment = options.env ?? process.env;
    let transcription: ReturnType<typeof mediaProviderConfiguration> | undefined;
    let transcriptionError: unknown;
    try { transcription = mediaProviderConfiguration("transcription", env); } catch (error) { transcriptionError = error; }
    if (kind === "audio" && !transcription) return [failureNote(kind, transcriptionError)];
    if (kind === "video" && !supportsImages) return [failureNote(kind, new MediaCapabilityError("unsupported", "The selected model does not accept images from video frames."))];
    const bytes = inputBytes(part, kind);
    const key = createHash("sha256").update(bytes).update(JSON.stringify([kind, transcription?.model, transcription?.apiKey, env.SAND_FFMPEG_PATH, env.SAND_FFPROBE_PATH])).digest("hex");
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return structuredClone(cached.parts);
    }
    if (budget.remaining-- <= 0) throw new MediaCapabilityError("unsupported", "At most 4 uncached media attachments per request are processed, prioritizing the most recent messages.");
    if (kind === "audio") {
      const transcript = await transcribeAudioInput(bytes, String(part.mimeType ?? part.mediaType ?? "audio/wav"), options, signal);
      const parts: ProjectedPart[] = [{ type: "text", text: `[Audio transcript; automatic transcription can contain mistakes]\n${transcript.trim() || "[No speech transcribed]"}` }];
      signal?.throwIfAborted();
      remember(key, parts);
      return parts;
    }
    const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "belmont-media-"));
    const parts: ProjectedPart[] = [];
    let complete = true;
    try {
      const input = join(directory, "attachment");
      await writeFile(input, bytes, { mode: 0o600, ...(signal ? { signal } : {}) });
      const rawProbe = await command(env.SAND_FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type", "-of", "json", input], signal);
      let probe: { format?: { duration?: string }; streams?: { codec_type?: string }[] };
      try { probe = JSON.parse(rawProbe); } catch { throw new MediaCapabilityError("processing-error", "Media inspection returned invalid metadata."); }
      const duration = Number(probe.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) throw new MediaCapabilityError("unsupported", "Media must have a known duration between 0 and 600 seconds. Split longer recordings before attaching them.");
      if (!probe.streams?.some(stream => stream.codec_type === kind)) throw new MediaCapabilityError("invalid-input", `The attachment does not contain a ${kind} stream.`);
      const ffmpeg = env.SAND_FFMPEG_PATH?.trim() || "ffmpeg";
      if (kind === "video") {
        const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration / 5)));
        parts.push({ type: "text", text: `[Video: ${duration.toFixed(2)} seconds. ${count} sampled frames follow; this is sparse visual sampling, not continuous video understanding. Events between frames may be missed.]` });
        for (let index = 0; index < count; index++) {
          const timestamp = duration * (index + 0.5) / count;
          const file = join(directory, `frame-${index}.jpg`);
          await command(ffmpeg, ["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-ss", timestamp.toFixed(3), "-i", input, "-map", "0:v:0", "-frames:v", "1", "-threads", "1", "-vf", "scale=768:768:force_original_aspect_ratio=decrease", "-q:v", "3", "-y", file], signal);
          if ((await stat(file)).size > 2 * 1024 * 1024) throw new MediaCapabilityError("processing-error", "A decoded video frame exceeded 2 MB.");
          const image = await readFile(file, signal ? { signal } : {});
          if (!sniffsAsImage(image)) throw new MediaCapabilityError("processing-error", "Video decoding returned an invalid frame.");
          parts.push({ type: "text", text: `[Video frame at ${timestamp.toFixed(2)} seconds]` }, { type: "image", data: image.toString("base64"), mimeType: "image/jpeg" });
        }
      }
      if (probe.streams.some(stream => stream.codec_type === "audio")) {
        if (!transcription) {
          complete = false;
          parts.push(failureNote("audio track", transcriptionError));
        } else {
          try {
            const file = join(directory, "audio.wav");
            await command(ffmpeg, ["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-t", String(MAX_DURATION_SECONDS), "-threads", "1", "-c:a", "pcm_s16le", "-y", file], signal);
            if ((await stat(file)).size > 25 * 1024 * 1024) throw new MediaCapabilityError("processing-error", "Decoded audio exceeded the transcription limit.");
            const audio = await readFile(file, signal ? { signal } : {});
            const transcript = await transcribeConfiguredAudio(audio, options, signal);
            parts.push({ type: "text", text: `[Audio transcript; automatic transcription can contain mistakes]\n${transcript.trim() || "[No speech transcribed]"}` });
          } catch (error) {
            signal?.throwIfAborted();
            complete = false;
            parts.push(failureNote("audio track", error));
          }
        }
      } else if (kind === "video") parts.push({ type: "text", text: "[Video contains no audio stream.]" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    signal?.throwIfAborted();
    if (complete) remember(key, parts);
    return parts;
  }

  async function content(input: readonly unknown[], supportsImages: boolean, budget: { remaining: number }, signal?: AbortSignal): Promise<unknown[]> {
    const output: unknown[] = [];
    for (const raw of input) {
      signal?.throwIfAborted();
      const part = record(raw);
      const kind = part ? mediaAttachmentKind(part) : undefined;
      if (kind && part) {
        try {
          output.push(...await preprocess(part, kind, supportsImages, budget, signal));
        } catch (error) {
          signal?.throwIfAborted();
          output.push(failureNote(kind, error));
        }
      } else if (part && (part.type === "tool-result" || part.type === "toolResult")) {
        const next = { ...part };
        for (const key of ["experimental_content", "content", "result"]) {
          if (Array.isArray(part[key])) next[key] = await content(part[key], supportsImages, budget, signal);
        }
        output.push(next);
      } else output.push(raw);
    }
    return output;
  }
  return async (messages: readonly PiProviderMessage[], supportsImages = true, signal?: AbortSignal): Promise<PiProviderMessage[]> => {
    const projected: PiProviderMessage[] = [];
    const budget = { remaining: 4 };
    const boundedSignal = AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]);
    // On a cold start, process recent attachments first instead of spending the entire budget on history.
    for (const message of [...messages].reverse()) {
      projected.push({ ...message, content: typeof message.content === "string" ? message.content : await content(message.content, supportsImages, budget, boundedSignal) });
    }
    return projected.reverse();
  };
}
