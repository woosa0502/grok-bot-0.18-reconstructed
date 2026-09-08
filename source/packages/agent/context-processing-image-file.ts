import path from "node:path";
import { createHash } from "node:crypto";

import type { Context } from "../context/core.js";
import { WriteArgs, type WriteResult } from "../proto/generated/agent/v1/write_exec_pb.js";
import { writeExecutorResource } from "../agent-exec/write.js";
import { sanitizeFilename } from "../utils/path-matchers.js";

interface ImageWriteExecutor {
  execute(ctx: Context, args: WriteArgs): Promise<WriteResult>;
}

export interface ImageResourceAccessor {
  get(resource: typeof writeExecutorResource): ImageWriteExecutor;
}

export interface SelectedImageFilePathInput {
  readonly ctx: Context;
  readonly imageData: Uint8Array | undefined;
  readonly selectedImage: {
    readonly path?: string | undefined;
    readonly uuid?: string | undefined;
  };
  readonly resolvedMimeType: string;
  readonly index: number;
  readonly enableImageFiles: boolean;
  readonly requestContext: {
    readonly env?: {
      readonly projectFolder?: string | undefined;
      readonly workspacePaths: readonly string[];
    } | undefined;
  } | undefined;
  readonly resourceAccessor: ImageResourceAccessor | undefined;
}

/** Return a filesystem path only when its image write has completed successfully. */
export async function writeSelectedImageToProjectAssets({
  ctx,
  imageData,
  selectedImage,
  resolvedMimeType,
  index,
  enableImageFiles,
  requestContext,
  resourceAccessor,
}: SelectedImageFilePathInput): Promise<string | undefined> {
  ctx.signal.throwIfAborted();
  if (!imageData || !enableImageFiles || !resourceAccessor || !requestContext?.env?.projectFolder) return undefined;
  const mimeType = resolvedMimeType;
  const originalPath = selectedImage.path;
  const extensionFromPath = originalPath !== undefined
    ? path.extname(originalPath).replace(/^\./, "").toLowerCase()
    : undefined;
  let extension = "png";
  if (extensionFromPath && extensionFromPath !== "") {
    extension = extensionFromPath === "jpeg" ? "jpg" : extensionFromPath;
  } else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    extension = "jpg";
  } else if (mimeType.includes("gif")) {
    extension = "gif";
  } else if (mimeType.includes("webp")) {
    extension = "webp";
  }
  const originalFilename = originalPath !== undefined ? path.basename(originalPath) : undefined;
  const baseFilename = originalFilename !== undefined && originalFilename !== ""
    ? path.basename(originalFilename, path.extname(originalFilename))
    : selectedImage.uuid || `image-${Date.now()}-${index}`;
  const safeBaseFilename = sanitizeFilename(baseFilename) || `image-${Date.now()}-${index}`;
  const contentId = createHash("sha256").update(imageData).digest("hex");
  const fileName = `${safeBaseFilename.slice(0, 32)}-${contentId}.${extension}`;
  const workspaceRoot = requestContext.env.workspacePaths[0];
  if (workspaceRoot !== undefined && originalPath !== undefined && originalPath !== "") {
    const normalizedOriginalPath = path.normalize(originalPath);
    const normalizedWorkspaceRoot = path.normalize(workspaceRoot);
    const relativePath = path.relative(normalizedWorkspaceRoot, normalizedOriginalPath);
    if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return normalizedOriginalPath;
    }
  }
  const assetsDir = path.join(requestContext.env.projectFolder, "assets");
  const filePath = path.join(assetsDir, fileName);
  const writeExecutor = resourceAccessor.get(writeExecutorResource);
  ctx.signal.throwIfAborted();
  const pending = writeExecutor.execute(ctx, new WriteArgs({
    path: filePath,
    fileBytes: new Uint8Array(imageData),
    returnFileContentAfterWrite: false,
  }));
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(ctx.signal.reason);
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        if (ctx.signal.aborted) onAbort();
      }),
    ]);
    ctx.signal.throwIfAborted();
    if (result?.result?.case !== "success") {
      throw new Error(`Image attachment was not saved (${result?.result?.case ?? "unknown write result"}).`);
    }
    return filePath;
  } finally {
    if (onAbort) ctx.signal.removeEventListener("abort", onAbort);
  }
}
