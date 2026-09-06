import { open, realpath } from "node:fs/promises";
import { basename } from "node:path";
import { SelectedDocument, SelectedVideo } from "../packages/proto/generated/agent/v1/selected_context_pb.js";
import { audioMimeFromPath } from "../shared/media/image-mime.js";
import { isPathWithin } from "../shared/node/paths.js";
import { MediaCapabilityError } from "../shared/node/media-provider.js";
import { getSandRootDir, reanchorSandPath } from "./host-paths.js";

/** Normalize the path-only shape emitted by send-message-shaping; authorization happens on hydration. */
export function normalizePathOnlySelectedVideo(value: unknown): SelectedVideo | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.path !== "string" || !candidate.path.trim() || typeof candidate.mimeType !== "string" || !candidate.mimeType.startsWith("video/")) return undefined;
  const data = candidate.dataOrBlobId as { case?: unknown } | undefined;
  if (data?.case !== undefined) return undefined;
  if (candidate.fps !== undefined && (typeof candidate.fps !== "number" || !Number.isFinite(candidate.fps) || candidate.fps < 0.25 || candidate.fps > 20)) throw new MediaCapabilityError("invalid-input", "Video sampling fps must be between 0.25 and 20.");
  return new SelectedVideo({
    path: candidate.path, mimeType: candidate.mimeType,
    filename: typeof candidate.filename === "string" ? candidate.filename : basename(candidate.path),
    ...(typeof candidate.fps === "number" ? { fps: candidate.fps } : {}),
    materializeToFilesystem: candidate.materializeToFilesystem === true,
  });
}

/** Audio files already accepted into Belmont's attachment store, never model-supplied paths. */
export async function loadSelectedAudioDocuments(paths: readonly string[], signal?: AbortSignal, root = getSandRootDir()): Promise<SelectedDocument[]> {
  const documents: SelectedDocument[] = [];
  for (const path of paths) {
    const mimeType = audioMimeFromPath(path);
    if (!mimeType) continue;
    signal?.throwIfAborted();
    if (documents.length >= 4) throw new MediaCapabilityError("unsupported", "Attach at most 4 audio recordings per message.");
    const canonicalRoot = await realpath(root);
    const resolved = await realpath(reanchorSandPath(path));
    if (!isPathWithin(canonicalRoot, resolved)) throw new MediaCapabilityError("invalid-input", "Audio must come from the accepted Belmont attachment store.");
    const file = await open(resolved, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size === 0 || info.size > 100 * 1024 * 1024) throw new MediaCapabilityError("invalid-input", "Audio attachments must be nonempty files smaller than 100 MB.");
      const bytes = await file.readFile(signal ? { signal } : {});
      if (bytes.length > 100 * 1024 * 1024) throw new MediaCapabilityError("invalid-input", "Audio attachment exceeded 100 MB while reading.");
      documents.push(new SelectedDocument({ path: resolved, filename: basename(path), mimeType, dataOrBlobId: { case: "data", value: bytes } }));
    } finally { await file.close(); }
  }
  return documents;
}
