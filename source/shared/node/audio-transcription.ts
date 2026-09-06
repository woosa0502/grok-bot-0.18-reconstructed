import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MediaCapabilityError, mediaProviderConfiguration, transcribeConfiguredAudio, type AudioProviderOptions } from "./media-provider.js";

const exec = promisify(execFile);

/** Mic recordings are commonly WebM/Opus; normalize real decoded audio before the API call. */
export async function transcribeAudioInput(audio: Uint8Array, mimeType: string, options: AudioProviderOptions = {}, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  mediaProviderConfiguration("transcription", options.env);
  if (audio.length === 0 || audio.length > 100 * 1024 * 1024) throw new MediaCapabilityError("invalid-input", "Audio must be between 1 byte and 100 MB.");
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/webm", "audio/ogg", "audio/flac", "audio/aac", "video/webm"]).has(mime)) throw new MediaCapabilityError("invalid-input", "Unsupported recording type. Use WebM, WAV, MP3, MP4, Ogg, FLAC, or AAC audio.");
  const bytes = Buffer.from(audio);
  const header = bytes.toString("ascii", 0, 12);
  if (!header.startsWith("RIFF") && !header.startsWith("OggS") && !header.startsWith("fLaC") && !header.startsWith("ID3") && header.slice(4, 8) !== "ftyp" && !bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && !(bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) throw new MediaCapabilityError("invalid-input", "The recording is not a supported standalone audio container.");
  const dir = await mkdtemp(join(tmpdir(), "belmont-microphone-"));
  const env = options.env ?? process.env;
  const command = async (binary: string, args: string[]) => {
    try {
      return (await exec(binary, args, { timeout: 60_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true, ...(signal ? { signal } : {}) })).stdout;
    } catch (error) {
      signal?.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MediaCapabilityError("not-configured", "Audio decoding needs ffmpeg and ffprobe; configure SAND_FFMPEG_PATH and SAND_FFPROBE_PATH if they are outside PATH.");
      throw new MediaCapabilityError("processing-error", "The recording could not be decoded within its processing limits.");
    }
  };
  try {
    const input = join(dir, "recording");
    await writeFile(input, bytes, { mode: 0o600, ...(signal ? { signal } : {}) });
    const raw = await command(env.SAND_FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type", "-of", "json", input]);
    let probe: { format?: { duration?: string }; streams?: { codec_type?: string }[] };
    try { probe = JSON.parse(raw); } catch { throw new MediaCapabilityError("processing-error", "Audio inspection returned invalid metadata."); }
    const duration = Number(probe.format?.duration);
    if ((Number.isFinite(duration) && (duration <= 0 || duration > 600)) || !probe.streams?.some(stream => stream.codec_type === "audio")) throw new MediaCapabilityError("unsupported", "The recording must contain audio lasting at most 600 seconds.");
    const output = join(dir, "audio.wav");
    // MediaRecorder WebM often has no duration metadata. Decode one second beyond the
    // limit and inspect the WAV duration, so long recordings are rejected, never silently clipped.
    await command(env.SAND_FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-t", "601", "-threads", "1", "-c:a", "pcm_s16le", "-y", output]);
    if ((await stat(output)).size > 25 * 1024 * 1024) throw new MediaCapabilityError("invalid-input", "The decoded recording exceeds 25 MB.");
    const decodedDuration = Number((await command(env.SAND_FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output])).trim());
    if (!Number.isFinite(decodedDuration) || decodedDuration <= 0 || decodedDuration > 600) throw new MediaCapabilityError("unsupported", "The decoded recording must last at most 600 seconds.");
    return await transcribeConfiguredAudio(await readFile(output, signal ? { signal } : {}), options, signal);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
