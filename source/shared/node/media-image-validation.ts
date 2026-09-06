import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MediaCapabilityError } from "./media-capability-error.js";

const exec = promisify(execFile);
const MAX_PIXELS = 16 * 1024 * 1024;

/** Decode actual pixels; a valid signature and IEND marker alone do not make a valid image. */
export async function validateMediaImage(bytes: Buffer, mime: string, env: Readonly<Record<string, string | undefined>> = process.env, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  signal?.throwIfAborted();
  const dimensions = (width: number, height: number) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new Error("unsupported image dimensions");
  };
  try {
    let size: { width: number; height: number };
    if (mime === "image/png") {
      if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("PNG missing header");
      dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
      const { default: png } = await import("@jimp/js-png");
      const image = png().decode(bytes, { checkCRC: true });
      dimensions(image.width, image.height);
      if (image.data.length !== image.width * image.height * 4) throw new Error("PNG missing pixels");
      size = { width: image.width, height: image.height };
    } else if (mime === "image/jpeg") {
      const { default: jpeg } = await import("@jimp/js-jpeg");
      const image = jpeg().decode(bytes, { maxResolutionInMP: 16, maxMemoryUsageInMB: 128, tolerantDecoding: false });
      dimensions(image.width, image.height);
      if (image.data.length !== image.width * image.height * 4) throw new Error("JPEG missing pixels");
      size = { width: image.width, height: image.height };
    } else if (mime === "image/webp") {
      if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error("WebP missing header");
      const dir = await mkdtemp(join(tmpdir(), "belmont-image-check-"));
      try {
        const file = join(dir, "reference.webp");
        await writeFile(file, bytes, { mode: 0o600, ...(signal ? { signal } : {}) });
        const options = { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" as const, windowsHide: true, ...(signal ? { signal } : {}) };
        const probe = await exec(env.SAND_FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=width,height", "-of", "json", file], options);
        const metadata = JSON.parse(probe.stdout) as { streams?: { width: number; height: number }[] };
        if (!metadata.streams?.[0]) throw new Error("WebP missing image stream");
        dimensions(metadata.streams[0].width, metadata.streams[0].height);
        size = { width: metadata.streams[0].width, height: metadata.streams[0].height };
        await exec(env.SAND_FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-xerror", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", file, "-map", "0:v:0", "-frames:v", "1", "-threads", "1", "-f", "null", "-"], options);
      } finally { await rm(dir, { recursive: true, force: true }); }
    } else throw new Error("unsupported image type");
    signal?.throwIfAborted();
    return size;
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new MediaCapabilityError("not-configured", "WebP validation requires ffmpeg and ffprobe. Use PNG/JPEG or configure the decoder paths.");
    throw new MediaCapabilityError("invalid-input", "The image cannot be decoded or exceeds the 16 megapixel processing limit.");
  }
}
