import { SAND_DEFAULT_MODEL_ID } from "../../../shared/agents/agent-model.js";
import { createCursorGenerateImageService } from "../../../shared/node/cursor-backend/cursor-generate-image.js";
import { isLocalCodexMode } from "../../../shared/node/local-codex-account.js";
import { generateConfiguredImage, MediaCapabilityError, type MediaProviderOptions } from "../../../shared/node/media-provider.js";
import { sniffsAsImage } from "../../selected-image-inputs.js";

export class SandGenerateImagePersistError extends Error {}
export interface GenerateImageAuth { readonly getAccessToken: () => Promise<string>; readonly getMachineId: () => Promise<string> }
export interface GeneratedImage { readonly imageData: string; readonly mimeType: string }
export interface PersistedImage { readonly absolutePath: string }
export function createSandGenerateImageService<Context>(auth: GenerateImageAuth, options: {
  readonly persistImage: (bytes: Uint8Array, mimeType: string) => Promise<PersistedImage | null>;
  readonly onRequestId?: (id: string) => void;
  readonly mediaProvider?: MediaProviderOptions;
}) {
  const generateImage = createCursorGenerateImageService({
    getAccessToken: auth.getAccessToken,
    getMachineId: auth.getMachineId,
    modelId: process.env.SAND_AGENT_MODEL ?? SAND_DEFAULT_MODEL_ID,
    maxMode: true,
    ...(options.onRequestId === undefined ? {} : { onRequestId: options.onRequestId }),
  });
  return async (ctx: Context, description: string, filename?: string, references?: readonly unknown[], aspectRatio?: string) => {
    const referenceImages = (references ?? []).map((value) => {
      if (typeof value !== "object" || value == null || !("data" in value) || !("mimeType" in value) || typeof value.data !== "string" || typeof value.mimeType !== "string") throw new MediaCapabilityError("invalid-input", "Reference images need actual image bytes and a MIME type.");
      return { data: value.data, mimeType: value.mimeType };
    });
    const generated = isLocalCodexMode(options.mediaProvider?.env ?? process.env)
      ? await generateConfiguredImage(description, { ...options.mediaProvider, referenceImages, ...(aspectRatio ? { aspectRatio } : {}) }, (ctx as { signal?: AbortSignal } | undefined)?.signal)
      : await generateImage(ctx, description, referenceImages);
    const bytes = Buffer.from(generated.imageData, "base64");
    if (!sniffsAsImage(bytes)) throw new SandGenerateImagePersistError("The image provider returned invalid image bytes.");
    const persisted = await options.persistImage(bytes, generated.mimeType);
    if (persisted == null) throw new SandGenerateImagePersistError("Failed to save the generated image into the agent's media store.");
    const requestedName = filename?.trim() ? basename(filename.replaceAll("\\", "/")) : undefined;
    const outputName = requestedName && requestedName !== "." && requestedName !== ".."
      ? `${requestedName.slice(0, requestedName.length - extname(requestedName).length)}.png`
      : undefined;
    return { filePath: outputName ?? persisted.absolutePath, imageData: generated.imageData };
  };
}
import { basename, extname } from "node:path";
