import { defineHostExtension } from "../../../internal/host-extensions.js";
import { subscribeTranscriptMutations } from "../../transcript-mutation-events.js";
import type { RunnerUpdate } from "../../runner/sand-agent-runner.js";
import { forgetAsideBotLink, isAsideBotAgent, wrapRunnerForAsideBot } from "./aside-bot-runner.js";
import type { SubagentSession } from "../../runner/subagent-runtime.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { BrowseClient, type BrowseClientMemoryHooks } from "./browse-client.js";
import { createBrowseMemoryHooks, type BrowseMemoryFacade } from "./browse-memory.js";
import { BrowseSubagentSession, type BrowseLinkRegistry } from "./browse-subagent-session.js";
import { ASIDE_BROWSE_ENABLED, createAsideBrowseSubagentConfig, isAsideBrowseSubagentType } from "./subagent-config.js";

export interface BrowseRuntimeExtensionApi {
  isEnabled(): boolean;
  isAsideBrowseSubagentType(name: string | undefined): boolean;
  createSubagentConfig(): ReturnType<typeof createAsideBrowseSubagentConfig>;
  createSubagentSession(agentId: string, options?: { memoryAgentId?: string; conversationId?: string }): SubagentSession;
  /** Returns the runner unchanged unless the bot's profile opts into runtime "aside-browse". */
  wrapRunner<T extends object>(runner: T, options: { getAgentId?: () => string; getConversationId?: () => string; emitUpdate?: (update: RunnerUpdate) => void }): T;
}

/** Offers a browser worker whose brain is an Aside session (belmont-browse, local-only) as a Task subagent type. */
export const browseRuntimeExtension = defineHostExtension<BrowseRuntimeExtensionApi, { log(message: string): void }>({
  id: HostExtensions.BrowseRuntime,
  dependencies: [HostExtensions.Transcript, HostExtensions.Memory],
  start(context) {
    const log = (message: string) => context.host.log(message);
    const transcript = context.deps[HostExtensions.Transcript] as { sendToAgent?: (fromAgentId: string, toAgentId: string, text: string, images: unknown, priority: boolean) => unknown } | undefined;
    const links: BrowseLinkRegistry = new Map();
    const memory = context.deps[HostExtensions.Memory] as BrowseMemoryFacade | undefined;
    const resolveClient = (identity?: { agentId: string; conversationId: () => string }, sharedHooks?: BrowseClientMemoryHooks): BrowseClient => {
      const hooks = sharedHooks ?? (memory && typeof memory.isCanonical === "function" && identity ? createBrowseMemoryHooks(memory, identity, log) : undefined);
      const client = BrowseClient.fromEnvironment(hooks);
      if (client === null) throw new Error("belmont-browse service is not running (no serve.json); start belmont-browse/src/serve.mjs");
      return client;
    };
    if (ASIDE_BROWSE_ENABLED) log(`[browse-runtime] aside-browse subagent type enabled (${BrowseClient.fromEnvironment() === null ? "service not running yet" : "service found"})`);
    context.onStop(subscribeTranscriptMutations((mutation) => {
      if (mutation.kind === "conversation-cleared" && typeof mutation.agentId === "string" && isAsideBotAgent(mutation.agentId)) forgetAsideBotLink(mutation.agentId);
    }));
    return {
      isEnabled: () => ASIDE_BROWSE_ENABLED,
      isAsideBrowseSubagentType,
      createSubagentConfig: createAsideBrowseSubagentConfig,
      createSubagentSession: (agentId: string, options?: { memoryAgentId?: string; conversationId?: string }) => new BrowseSubagentSession(resolveClient({ agentId: options?.memoryAgentId ?? agentId, conversationId: () => options?.conversationId ?? agentId }), agentId, links, log),
      wrapRunner: (runner, options) => {
        const agentId = options.getAgentId?.() ?? options.getConversationId?.();
        if (!ASIDE_BROWSE_ENABLED || agentId === undefined || !isAsideBotAgent(agentId)) return runner;
        log(`[browse-runtime] bot ${agentId}: turns served by the Aside browse service`);
        // The runner itself owns emitUpdate (it forwards to the transcript transport); the raw
        // options object handed to buildRunner does not carry it.
        const emitUpdate = (update: RunnerUpdate) => {
          const target = runner as { emitUpdate?: (update: RunnerUpdate) => void };
          if (typeof target.emitUpdate === "function") target.emitUpdate(update);
          else if (typeof options.emitUpdate === "function") options.emitUpdate(update);
          else throw new TypeError("no emitUpdate available for the browse runtime");
        };
        const sendToAgent = transcript?.sendToAgent === undefined ? undefined : (toAgentId: string, text: string) => transcript.sendToAgent!(agentId, toAgentId, text, [], false);
        // Keep delivery dedup and host identity bound for this runner's lifetime.
        const identity = { agentId, conversationId: () => options.getConversationId?.() ?? agentId };
        const hooks = memory && typeof memory.isCanonical === "function" ? createBrowseMemoryHooks(memory, identity, log) : undefined;
        const resolveScopedClient = () => resolveClient(identity, hooks);
        return wrapRunnerForAsideBot(runner, agentId, { client: resolveScopedClient, emitUpdate, log, ...(sendToAgent === undefined ? {} : { sendToAgent }) });
      },
    };
  },
});
