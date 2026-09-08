import path from "node:path";
import { usesLocalMediaPreprocessing } from "../../shared/node/local-media-routing.js";

import type { Context } from "../context/core.js";
import { createLogger } from "../context/logger.js";
import { writeExecutorResource } from "../agent-exec/write.js";
import { WriteArgs, type WriteResult } from "../proto/generated/agent/v1/write_exec_pb.js";
import {
  SelectedVideo,
  SelectedVideo_SignedUrl,
  type SelectedVideo as SelectedVideoValue,
} from "../proto/generated/agent/v1/selected_context_pb.js";
import type { PrivacyMode } from "../proto/generated/aiserver/v1/privacy_mode_pb.js";
import {
  hydrateSelectedAttachmentData,
  type AttachmentBlobStore,
} from "./context-processing-hydration.js";
import { getSafeErrorType } from "./context-processing-error-type.js";
import { appendRandomUploadSuffix } from "./context-processing-attachment-format.js";
import {
  isGeminiModelId,
  isSignedUrlStorageAllowed,
  uploadAttachedMediaToSignedUrl,
} from "./attached-media.js";
import type { AttachmentPathRequestContext } from "./context-processing-path-trust.js";

interface VideoWriteExecutor {
  execute(ctx: Context, args: WriteArgs): Promise<WriteResult>;
}

export interface VideoResourceAccessor {
  get(resource: typeof writeExecutorResource): VideoWriteExecutor;
}

export interface AttachedMediaUrlProvider {
  getSignedUrlForAttachedMedia(
    ctx: Context,
    request: {
      readonly conversationId: string;
      readonly key?: string;
      readonly mimeType: string;
      readonly contentLengthBytes?: number;
    },
  ): Promise<{
    readonly key: string;
    readonly putUrl: string;
    readonly getUrl: string;
    readonly expiresAtUnixMs: bigint;
    readonly refreshAfterUnixMs: bigint;
  }>;
}

export interface ProcessSelectedVideoDataArgs {
  readonly ctx: Context;
  readonly blobStore: AttachmentBlobStore<Context>;
  readonly selectedVideo: SelectedVideoValue;
  readonly index: number;
  readonly modelId: string | undefined;
  readonly maxVideoBytes: number;
  readonly requestContext: AttachmentPathRequestContext | undefined;
  readonly resourceAccessor: VideoResourceAccessor | undefined;
  readonly privacyMode?: PrivacyMode;
  readonly attachedMediaUrlProvider?: AttachedMediaUrlProvider;
  readonly conversationId?: string;
}

export interface ProcessedSelectedVideoData {
  readonly processedSelectedVideo: SelectedVideoValue | undefined;
  readonly videoData: Uint8Array | undefined;
  readonly mimeType: string;
  readonly fps: number | undefined;
  readonly filename: string;
  readonly localFilePath?: string;
  readonly materializationError?: string;
  readonly videoUrl?: string;
}

const logger = createLogger("@anysphere/agent/context-processing");

// Extracted from ../packages/agent/dist/context-processing.js as the exact
// selected-video data/blob, signed-URL, and filesystem-materialization branch.
// The parent processSelectedContext dispatcher remains absent by design.
export async function processSelectedVideoData({
  ctx,
  blobStore,
  selectedVideo,
  index,
  modelId,
  maxVideoBytes,
  requestContext,
  resourceAccessor,
  privacyMode,
  attachedMediaUrlProvider,
  conversationId,
}: ProcessSelectedVideoDataArgs): Promise<ProcessedSelectedVideoData> {
  ctx.signal.throwIfAborted();
  const materializeToFilesystem = selectedVideo.materializeToFilesystem === true;
  const localPreprocessing = usesLocalMediaPreprocessing(modelId);
  if (!materializeToFilesystem && !isGeminiModelId(modelId) && !localPreprocessing) {
    throw new Error("Video attachments are only supported for Gemini models");
  }
  const fps = selectedVideo.fps;
  if (fps !== undefined && (!Number.isFinite(fps) || fps < 0.25 || fps > 20)) {
    throw new Error(`Video fps must be between 0.25 and 20, got ${fps}`);
  }
  const mimeType = selectedVideo.mimeType;
  if (!mimeType || !mimeType.startsWith("video/")) {
    throw new Error(`Video attachments require a video/* mime type, got ${mimeType}`);
  }

  const useSignedUrl = !localPreprocessing && !materializeToFilesystem &&
    privacyMode !== undefined &&
    isSignedUrlStorageAllowed(privacyMode) &&
    attachedMediaUrlProvider !== undefined;
  if (useSignedUrl && attachedMediaUrlProvider !== undefined) {
    return processSelectedVideoUsingSignedUrl({
      ctx,
      blobStore,
      selectedVideo,
      maxVideoBytes,
      mimeType,
      fps,
      attachedMediaUrlProvider,
      conversationId,
    });
  }

  const dataCase = selectedVideo.dataOrBlobId?.case;
  if (dataCase !== "data" && dataCase !== "blobId" && dataCase !== "blobIdWithData") {
    if (dataCase === "signedUrl") {
      throw new Error("Attached media signed URLs are not available in this privacy mode");
    }
    throw new Error("Video attachment has no data");
  }
  const hydratedVideo = await hydrateSelectedAttachmentData({
    ctx,
    blobStore,
    attachment: selectedVideo,
    dataOrBlobId: selectedVideo.dataOrBlobId,
    maxBytes: maxVideoBytes,
    missingBlobError: "Video not found in blob store",
    sizeErrorLabel: "Video",
    withBlobId: (blobId: Uint8Array) => new SelectedVideo({
      ...selectedVideo,
      dataOrBlobId: {
        case: "blobId",
        value: blobId,
      },
    }),
  });
  ctx.signal.throwIfAborted();
  const videoData = hydratedVideo.data;
  let processedSelectedVideo = hydratedVideo.processedAttachment;
  let videoFilePath: string | undefined;
  let materializationError: string | undefined;
  const filename = selectedVideo.filename ||
    (selectedVideo.path.length > 0 ? path.basename(selectedVideo.path) : `video-${Date.now()}-${index}`);

  if (materializeToFilesystem && videoData) {
    const videoRootPath = requestContext?.env?.projectFolder ?? requestContext?.env?.workspacePaths?.[0];
    if (!resourceAccessor) {
      materializationError = "Video could not be saved because the filesystem writer is unavailable.";
    } else if (videoRootPath === undefined || videoRootPath.trim().length === 0) {
      materializationError = "Video could not be saved because no workspace folder is available.";
    } else {
      let removeAbortListener: (() => void) | undefined;
      try {
        const safeFilename = appendRandomUploadSuffix(filename, `video-${Date.now()}-${index}`);
        const uploadsDir = path.join(videoRootPath, "uploads");
        const filePath = path.join(uploadsDir, safeFilename);
        const writeExecutor = resourceAccessor.get(writeExecutorResource);
        const writeResult = await new Promise<WriteResult>((resolve, reject) => {
          const onAbort = (): void => reject(ctx.signal.reason);
          ctx.signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => ctx.signal.removeEventListener("abort", onAbort);
          ctx.signal.throwIfAborted();
          Promise.resolve(writeExecutor.execute(ctx, new WriteArgs({
            path: filePath,
            fileBytes: new Uint8Array(videoData),
            returnFileContentAfterWrite: false,
          }))).then(resolve, reject);
        });
        ctx.signal.throwIfAborted();
        if (writeResult?.result?.case === "success") {
          videoFilePath = filePath;
          processedSelectedVideo = new SelectedVideo({
            ...(processedSelectedVideo ?? selectedVideo),
            path: filePath,
          });
        } else {
          materializationError = describeVideoWriteFailure(writeResult?.result?.case);
        }
      } catch (error) {
        ctx.signal.throwIfAborted();
        if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
          throw error;
        }
        logger.warn(ctx, "Failed to write video to filesystem", {
          errorType: getSafeErrorType(error),
        });
        materializationError = "Video could not be saved because the filesystem write failed.";
      } finally {
        removeAbortListener?.();
      }
    }
  } else if (materializeToFilesystem) {
    materializationError = "Video could not be saved because its data is unavailable.";
  }
  return {
    processedSelectedVideo,
    videoData: videoFilePath === undefined ? videoData : undefined,
    mimeType,
    fps,
    filename,
    ...(videoFilePath === undefined ? {} : { localFilePath: videoFilePath }),
    ...(materializationError === undefined ? {} : { materializationError }),
  };
}

function describeVideoWriteFailure(resultCase: WriteResult["result"]["case"]): string {
  switch (resultCase) {
    case "permissionDenied":
      return "Video could not be saved because filesystem permission was denied.";
    case "noSpace":
      return "Video could not be saved because the filesystem has no space available.";
    case "rejected":
      return "Video could not be saved because the filesystem write was rejected.";
    default:
      return "Video could not be saved because the filesystem write did not report success.";
  }
}

async function processSelectedVideoUsingSignedUrl({
  ctx,
  blobStore,
  selectedVideo,
  maxVideoBytes,
  mimeType,
  fps,
  attachedMediaUrlProvider,
  conversationId,
}: {
  readonly ctx: Context;
  readonly blobStore: AttachmentBlobStore<Context>;
  readonly selectedVideo: SelectedVideoValue;
  readonly maxVideoBytes: number;
  readonly mimeType: string;
  readonly fps: number | undefined;
  readonly attachedMediaUrlProvider: AttachedMediaUrlProvider;
  readonly conversationId: string | undefined;
}): Promise<ProcessedSelectedVideoData> {
  const dataOrBlobId = selectedVideo.dataOrBlobId;
  if (dataOrBlobId?.case === "signedUrl") {
    const incomingSignedUrl = dataOrBlobId.value;
    const renewed = await attachedMediaUrlProvider.getSignedUrlForAttachedMedia(ctx, {
      conversationId: incomingSignedUrl.conversationId,
      key: incomingSignedUrl.key,
      mimeType,
    });
    const signedUrl = new SelectedVideo_SignedUrl({
      url: renewed.getUrl,
      key: renewed.key,
      expiresAtUnixMs: renewed.expiresAtUnixMs,
      refreshAfterUnixMs: renewed.refreshAfterUnixMs,
      conversationId: incomingSignedUrl.conversationId,
    });
    return {
      processedSelectedVideo: new SelectedVideo({
        ...selectedVideo,
        dataOrBlobId: { case: "signedUrl", value: signedUrl },
      }),
      videoData: undefined,
      videoUrl: signedUrl.url,
      mimeType,
      fps,
      filename: selectedVideo.filename,
    };
  }

  let videoData: Uint8Array | undefined;
  if (dataOrBlobId?.case === "data") {
    videoData = dataOrBlobId.value;
  } else if (dataOrBlobId?.case === "blobId") {
    videoData = await blobStore.getBlob(ctx, dataOrBlobId.value);
    if (!videoData) {
      throw new Error("Video not found in blob store");
    }
  } else if (dataOrBlobId?.case === "blobIdWithData") {
    videoData = dataOrBlobId.value.data;
  } else {
    throw new Error("Video attachment has no data");
  }

  if (videoData.length > maxVideoBytes) {
    throw new Error(`Video exceeds maximum size of ${maxVideoBytes} bytes (${Math.round(maxVideoBytes / 1024 / 1024)}MB)`);
  }
  const resolvedConversationId = conversationId ?? "";
  const signedUrls = await attachedMediaUrlProvider.getSignedUrlForAttachedMedia(ctx, {
    conversationId: resolvedConversationId,
    mimeType,
    contentLengthBytes: videoData.length,
  });
  await uploadAttachedMediaToSignedUrl({
    putUrl: signedUrls.putUrl,
    data: new Uint8Array(videoData),
    mimeType,
    signal: ctx.signal,
  });
  const signedUrl = new SelectedVideo_SignedUrl({
    url: signedUrls.getUrl,
    key: signedUrls.key,
    expiresAtUnixMs: signedUrls.expiresAtUnixMs,
    refreshAfterUnixMs: signedUrls.refreshAfterUnixMs,
    conversationId: resolvedConversationId,
  });
  return {
    processedSelectedVideo: new SelectedVideo({
      ...selectedVideo,
      dataOrBlobId: { case: "signedUrl", value: signedUrl },
    }),
    videoData: undefined,
    videoUrl: signedUrl.url,
    mimeType,
    fps,
    filename: selectedVideo.filename,
  };
}
