import { readFile } from "node:fs/promises";
import { imageMimeFromPath } from "../shared/media/image-mime.js";
export interface SelectedImageInput { data: Uint8Array<ArrayBuffer>; path: string; mimeType: string | undefined }

/**
 * True when the bytes actually start like an image the provider accepts. The
 * image/file channel split is extension-based, so a corrupt or mislabeled
 * ".png" used to ride the image channel into the model request — and because
 * the transcript projection replays prior image parts, ONE bad image made the
 * provider reject EVERY later turn of that conversation ("The image data you
 * provided does not represent a valid image", A10 live 2026-09-01). Callers
 * demote non-sniffing files to the plain file channel instead.
 */
export function sniffsAsImage(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  const n = data.length;
  // Trailer scans tolerate a little trailing junk (some writers pad after the
  // end marker) while still catching truncation, which keeps a valid header.
  const tailHas = (marker: readonly number[], window: number): boolean => {
    const from = Math.max(0, n - window);
    outer: for (let i = n - marker.length; i >= from; i--) {
      for (let j = 0; j < marker.length; j++) if (data[i + j] !== marker[j]) continue outer;
      return true;
    }
    return false;
  };
  // PNG: signature AND the IEND chunk trailer — a truncated PNG keeps a valid
  // header, which is exactly what slipped through a signature-only sniff.
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return n >= 20 && tailHas([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 48);
  }
  // JPEG: SOI..EOI
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return tailHas([0xff, 0xd9], 48);
  }
  // GIF87a / GIF89a: ends with the trailer byte 0x3B
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return tailHas([0x3b], 8);
  }
  // WEBP (RIFF....WEBP): RIFF size must cover the payload (odd sizes get a pad byte)
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    const riffSize = (data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24)) >>> 0;
    return riffSize + 8 <= n && n <= riffSize + 9;
  }
  // BMP: declared file size must not exceed the actual bytes
  if (data[0] === 0x42 && data[1] === 0x4d) {
    const declared = (data[2]! | (data[3]! << 8) | (data[4]! << 16) | (data[5]! << 24)) >>> 0;
    return declared <= n;
  }
  return false;
}

export async function loadSelectedImageInputs(attachmentPaths: readonly string[]): Promise<SelectedImageInput[]> {
  if (attachmentPaths.length === 0) return [];
  const loaded = await Promise.all(attachmentPaths.map(async (path): Promise<SelectedImageInput | null> => {
    try {
      const file = await readFile(path);
      const data = Uint8Array.from(file);
      return { data, path, mimeType: imageMimeFromPath(path) };
    } catch {
      return null;
    }
  }));
  return loaded.filter((image): image is SelectedImageInput => image !== null);
}

/**
 * Splits loaded image-channel inputs into real images and demotions (paths
 * whose bytes are not an image) — the demotions belong on the file channel.
 */
export function partitionSniffedImages(images: readonly SelectedImageInput[]): {
  images: SelectedImageInput[];
  demotedPaths: string[];
} {
  const valid: SelectedImageInput[] = [];
  const demotedPaths: string[] = [];
  for (const image of images) {
    if (sniffsAsImage(image.data)) valid.push(image);
    else demotedPaths.push(image.path);
  }
  return { images: valid, demotedPaths };
}
