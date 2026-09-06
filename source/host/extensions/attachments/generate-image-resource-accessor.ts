import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { getAgentAssetsDir, getAgentMediaStoreRoots } from "../../attachment-paths.js";
import { containWithin } from "../../../shared/node/paths.js";
import { readExecutorResource, type ReadExecutor } from "../../../packages/agent-exec/read.js";
import { writeExecutorResource, type WriteExecutor } from "../../../packages/agent-exec/write.js";
import type { RemoteExecManager } from "../../../packages/agent-exec/remote.js";
import type { ResourceAccessor } from "../../../packages/agent-exec/resource-provider.js";
import { ReadResult } from "../../../packages/proto/generated/agent/v1/read_exec_pb.js";
import { WriteResult } from "../../../packages/proto/generated/agent/v1/write_exec_pb.js";

export type GenerateImageResourceResult =
  | { readonly result: { readonly case: "success"; readonly value: { readonly path?: string; readonly fileSize?: number; readonly data?: Uint8Array } } }
  | { readonly result: { readonly case: "error"; readonly value: { readonly path?: string; readonly error: string } } };
export interface GenerateImageResourceAccessor extends ResourceAccessor<RemoteExecManager> {
  readonly write: (args: { readonly path: string; readonly fileBytes: Uint8Array }) => Promise<GenerateImageResourceResult>;
  readonly read: (args: { readonly path: string }) => Promise<GenerateImageResourceResult>;
}
export function createSandGenerateImageResourceAccessor(agentDir: string): GenerateImageResourceAccessor {
  const assetsDir = getAgentAssetsDir(agentDir);
  const accessor: GenerateImageResourceAccessor = {
    get(resource) {
      if (resource.symbol === readExecutorResource.symbol) {
        const executor: ReadExecutor = { async execute(ctx, args) {
          ctx.signal.throwIfAborted();
          const result = await accessor.read(args);
          ctx.signal.throwIfAborted();
          if (result.result.case === "error") return new ReadResult({ result: { case: "error", value: { path: args.path, error: result.result.value.error } } });
          const bytes = result.result.value.data ?? new Uint8Array();
          return new ReadResult({ result: { case: "success", value: { path: args.path, fileSize: BigInt(bytes.length), output: { case: "data", value: bytes } } } });
        } };
        return executor as ReturnType<typeof resource.remoteImplementation>;
      }
      if (resource.symbol === writeExecutorResource.symbol) {
        const executor: WriteExecutor = { async execute(ctx, args) {
          ctx.signal.throwIfAborted();
          const result = await accessor.write({ path: args.path, fileBytes: args.fileBytes ?? new Uint8Array() });
          ctx.signal.throwIfAborted();
          if (result.result.case === "error") return new WriteResult({ result: { case: "error", value: { path: args.path, error: result.result.value.error } } });
          return new WriteResult({ result: { case: "success", value: { path: result.result.value.path ?? args.path, fileSize: result.result.value.fileSize ?? 0 } } });
        } };
        return executor as ReturnType<typeof resource.remoteImplementation>;
      }
      throw new TypeError("Unsupported GenerateImage resource.");
    },
    async write(args) {
      const target = await containWithin([assetsDir], args.path);
      if (target == null) return { result: { case: "error", value: { error: "Refused to write the generated image outside the agent's media store." } } };
      const bytes = Buffer.from(args.fileBytes); await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
      return { result: { case: "success", value: { path: target, fileSize: bytes.length } } };
    },
    async read(args) {
      const resolved = await containWithin(getAgentMediaStoreRoots(agentDir), args.path);
      if (resolved == null) return { result: { case: "error", value: { path: args.path, error: "Refused to read a reference image outside the agent's sandboxed media store." } } };
      try {
        const info = await fs.stat(resolved);
        if (!info.isFile() || info.size > 25 * 1024 * 1024) return { result: { case: "error", value: { path: args.path, error: "Reference images must be files of at most 25 MB." } } };
        return { result: { case: "success", value: { data: new Uint8Array(await fs.readFile(resolved)) } } };
      }
      catch (error) { return { result: { case: "error", value: { path: args.path, error: error instanceof Error ? error.message : String(error) } } }; }
    }
  };
  return accessor;
}
