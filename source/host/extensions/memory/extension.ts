import { readdirSync } from "node:fs";
import type { DebouncePolicy } from "../../../internal/scheduling.js";
import { mergeUserMemoryShards, selectProjectMemoryBlocks, type ProjectMemoryBlock } from "../../runner/sand-memory.js";
import { AgentProjectMembership } from "./project-membership.js";
import { createSandAgentState, type AgentStateDeps } from "./agent-state.js";
import { FileMemoryStore, getProjectMemoryShardDir, getProjectMemoryShardsDir, getProjectsRootDir, MemoryService, UserMemoryStore } from "./memory-service.js";
import { legacyMemoryView } from "./memory-store-adapter.js";

// Prompt-facing adapters over the user-scope and project-scope memory shards.
// update_state already WRITES these shards (agent-state.ts); until now nothing read
// them back into the system prompt (AUDIT-1). The shapes match
// SystemPromptAssemblyDependencies.userMemory / projectMemory.
export interface PromptUserMemoryOptions { readonly agentId: string; readonly resolveAgentName: (agentId: string) => string | null }
export interface PromptProjectMemoryOptions extends PromptUserMemoryOptions { readonly agentDir: string }
export function createPromptUserMemory(sandRoot: string, debounce: DebouncePolicy, options: PromptUserMemoryOptions, service?: MemoryService) {
  const store = new UserMemoryStore(sandRoot, options.agentId, (id) => options.resolveAgentName(id) ?? id, debounce);
  const tag = <T extends { agentName: string }>(record: T) => ({ ...record, via: record.agentName });
  return {
    recall: (limits: { profileLimit: number; recentLimit: number }) => {
      if (service?.isCanonical() && service.learning) {
        const shards = service.learning.userShards().map(({ agentId, memoryDir }) => {
          const memories = service.learning!.list(memoryDir).map(legacyMemoryView);
          return { via: options.resolveAgentName(agentId) ?? agentId, recall: { profile: memories.filter((m) => m.kind === "profile"), recent: memories.filter((m) => m.kind === "log") } };
        });
        return mergeUserMemoryShards(shards, limits);
      }
      const recalled = store.recall({ profile: limits.profileLimit, recent: limits.recentLimit });
      return { profile: recalled.profile.map(tag), recent: recalled.recent.map(tag) };
    },
    getLocation: () => service?.isCanonical() ? null : store.getLocation(),
    getOwnShardLocation: () => service?.isCanonical() ? null : store.getOwnShardLocation(),
  };
}
export function createPromptProjectMemory(sandRoot: string, debounce: DebouncePolicy, options: PromptProjectMemoryOptions, service?: MemoryService) {
  const membership = new AgentProjectMembership(options.agentDir);
  const resolve = (id: string) => options.resolveAgentName(id) ?? id;
  return {
    recall: (limits: { profileLimit: number; recentLimit: number }, cap: number) => {
      const blocks: ProjectMemoryBlock[] = [...membership.read()].map((slug) => {
        if (service?.isCanonical() && service.learning) {
          const shards = service.learning.projectShards(options.agentId).filter((s) => s.project === slug).map(({ agentId, memoryDir }) => {
            const memories = service.learning!.list(memoryDir).map(legacyMemoryView);
            return { via: resolve(agentId), recall: { profile: memories.filter((m) => m.kind === "profile"), recent: memories.filter((m) => m.kind === "log") } };
          });
          return { slug, name: slug, recall: mergeUserMemoryShards(shards, limits) };
        }
        let ids: string[] = [];
        try { ids = readdirSync(getProjectMemoryShardsDir(sandRoot, slug)); } catch { /* no shards yet */ }
        const shards = ids.map((id) => ({ via: resolve(id), recall: new FileMemoryStore(getProjectMemoryShardDir(sandRoot, slug, id), debounce).recall(limits.recentLimit) }));
        return { slug, name: slug, ownShardDir: getProjectMemoryShardDir(sandRoot, slug, options.agentId), recall: mergeUserMemoryShards(shards, limits) };
      });
      return selectProjectMemoryBlocks(blocks, cap);
    },
    getLocation: () => service?.isCanonical() ? null : getProjectsRootDir(sandRoot),
  };
}
export interface MemoryExtensionContext {
  sandRoot:string;agentsRootDir:string;debounce:DebouncePolicy;
  deps:{auth?:{getAuthenticatedPrincipalId():string|null};experiments:{pinGateOnAuthenticatedBootstrap(name:string,listener:(enabled:boolean)=>void):void};inference:{port:{createSession(onRequestId:(requestId:string)=>void,options:{modelId:string;isSummarizationSession:boolean;skipLabeling:boolean}):{getExecutor():import("../../../packages/chat-inference/base.js").PromptExecutor<Record<string,any>>};createSummarizationSession?(onRequestId:(requestId:string)=>void,options:{modelId:string;skipLabeling:boolean}):{getExecutor():import("../../../packages/chat-inference/base.js").PromptExecutor<Record<string,any>>}}};telemetry:{logs:{reportMemorySynthesis(event:unknown):void}}};
  createSynthesis(service:MemoryService):{start():void;dispose():void;recordTurn?(agentId:string,exchange:unknown):void};
  onStop(fn:()=>void|Promise<void>):void;
}
export const memoryExtension = {
  id: "memory", dependencies: ["auth", "experiments", "inference", "telemetry"] as const,
  start(context: MemoryExtensionContext) {
    const service = new MemoryService({ sandRoot: context.sandRoot, agentsRootDir: context.agentsRootDir, debounce: context.debounce,
      getPrincipalId: () => context.deps.auth?.getAuthenticatedPrincipalId() ?? null });
    context.deps.experiments.pinGateOnAuthenticatedBootstrap("sand_memory_dreaming", (enabled) => {
      if (!enabled) { context.deps.telemetry.logs.reportMemorySynthesis({ outcome: "skipped_gate" }); return; }
      service.enableMemorySynthesis(context.createSynthesis(service));
    });
    context.onStop(() => service.dispose());
    return Object.assign(service, {
      createAgentState: (options: Omit<AgentStateDeps, "sandRoot" | "membership"> & { agentDir: string }) => createSandAgentState({
        ...options, sandRoot: context.sandRoot, membership: new AgentProjectMembership(options.agentDir),
        createMemoryShard: (memoryDir) => service.createShardStore(memoryDir, options.agentId),
      }),
      createUserMemory: (options: PromptUserMemoryOptions) => createPromptUserMemory(context.sandRoot, context.debounce, options, service),
      createProjectMemory: (options: PromptProjectMemoryOptions) => createPromptProjectMemory(context.sandRoot, context.debounce, options, service),
    });
  },
};
