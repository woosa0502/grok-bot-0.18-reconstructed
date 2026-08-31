import { readdirSync } from "node:fs";
import type { DebouncePolicy } from "../../../internal/scheduling.js";
import { mergeUserMemoryShards, selectProjectMemoryBlocks, type ProjectMemoryBlock } from "../../runner/sand-memory.js";
import { AgentProjectMembership } from "./project-membership.js";
import { createSandAgentState, type AgentStateDeps } from "./agent-state.js";
import { FileMemoryStore, getProjectMemoryShardDir, getProjectMemoryShardsDir, getProjectsRootDir, MemoryService, UserMemoryStore } from "./memory-service.js";

// Prompt-facing adapters over the user-scope and project-scope memory shards.
// update_state already WRITES these shards (agent-state.ts); until now nothing read
// them back into the system prompt (AUDIT-1). The shapes match
// SystemPromptAssemblyDependencies.userMemory / projectMemory.
export interface PromptUserMemoryOptions { readonly agentId: string; readonly resolveAgentName: (agentId: string) => string | null }
export interface PromptProjectMemoryOptions extends PromptUserMemoryOptions { readonly agentDir: string }
export function createPromptUserMemory(sandRoot: string, debounce: DebouncePolicy, options: PromptUserMemoryOptions) {
  const store = new UserMemoryStore(sandRoot, options.agentId, (id) => options.resolveAgentName(id) ?? id, debounce);
  const tag = <T extends { agentName: string }>(record: T) => ({ ...record, via: record.agentName });
  return {
    recall: (limits: { profileLimit: number; recentLimit: number }) => {
      const recalled = store.recall({ profile: limits.profileLimit, recent: limits.recentLimit });
      return { profile: recalled.profile.map(tag), recent: recalled.recent.map(tag) };
    },
    getLocation: () => store.getLocation(),
    getOwnShardLocation: () => store.getOwnShardLocation(),
  };
}
export function createPromptProjectMemory(sandRoot: string, debounce: DebouncePolicy, options: PromptProjectMemoryOptions) {
  const membership = new AgentProjectMembership(options.agentDir);
  const resolve = (id: string) => options.resolveAgentName(id) ?? id;
  return {
    recall: (limits: { profileLimit: number; recentLimit: number }, cap: number) => {
      const blocks: ProjectMemoryBlock[] = [...membership.read()].map((slug) => {
        let ids: string[] = [];
        try { ids = readdirSync(getProjectMemoryShardsDir(sandRoot, slug)); } catch { /* no shards yet */ }
        const shards = ids.map((id) => ({ via: resolve(id), recall: new FileMemoryStore(getProjectMemoryShardDir(sandRoot, slug, id), debounce).recall(limits.recentLimit) }));
        return { slug, name: slug, ownShardDir: getProjectMemoryShardDir(sandRoot, slug, options.agentId), recall: mergeUserMemoryShards(shards, limits) };
      });
      return selectProjectMemoryBlocks(blocks, cap);
    },
    getLocation: () => getProjectsRootDir(sandRoot),
  };
}
export interface MemoryExtensionContext {
  sandRoot:string;agentsRootDir:string;debounce:DebouncePolicy;
  deps:{experiments:{pinGateOnAuthenticatedBootstrap(name:string,listener:(enabled:boolean)=>void):void};inference:{port:{createSession(onRequestId:(requestId:string)=>void,options:{modelId:string;isSummarizationSession:boolean;skipLabeling:boolean}):{getExecutor():import("../../../packages/chat-inference/base.js").PromptExecutor<Record<string,any>>};createSummarizationSession?(onRequestId:(requestId:string)=>void,options:{modelId:string;skipLabeling:boolean}):{getExecutor():import("../../../packages/chat-inference/base.js").PromptExecutor<Record<string,any>>}}};telemetry:{logs:{reportMemorySynthesis(event:unknown):void}}};
  createSynthesis(service:MemoryService):{start():void;dispose():void;recordTurn?(agentId:string,exchange:unknown):void};
  onStop(fn:()=>void):void;
}
export const memoryExtension={id:"memory",dependencies:["experiments","inference","telemetry"]as const,start(context:MemoryExtensionContext){const service=new MemoryService({sandRoot:context.sandRoot,agentsRootDir:context.agentsRootDir,debounce:context.debounce});context.deps.experiments.pinGateOnAuthenticatedBootstrap("sand_memory_dreaming",(enabled)=>{if(!enabled){context.deps.telemetry.logs.reportMemorySynthesis({outcome:"skipped_gate"});return}service.enableMemorySynthesis(context.createSynthesis(service))});context.onStop(()=>service.dispose());return Object.assign(service,{createAgentState:(options:Omit<AgentStateDeps,"sandRoot"|"membership">&{agentDir:string})=>createSandAgentState({...options,sandRoot:context.sandRoot,membership:new AgentProjectMembership(options.agentDir)}),createUserMemory:(options:PromptUserMemoryOptions)=>createPromptUserMemory(context.sandRoot,context.debounce,options),createProjectMemory:(options:PromptProjectMemoryOptions)=>createPromptProjectMemory(context.sandRoot,context.debounce,options)})}};
