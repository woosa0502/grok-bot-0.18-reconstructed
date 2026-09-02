import { defineHostExtension } from "../../../internal/host-extensions.js";
import type { SubagentSession } from "../../runner/subagent-runtime.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { BrowseClient } from "./browse-client.js";
import { BrowseSubagentSession } from "./browse-subagent-session.js";
import { ASIDE_BROWSE_ENABLED, createAsideBrowseSubagentConfig, isAsideBrowseSubagentType } from "./subagent-config.js";

export interface BrowseRuntimeExtensionApi {
  isEnabled(): boolean;
  isAsideBrowseSubagentType(name: string | undefined): boolean;
  createSubagentConfig(): ReturnType<typeof createAsideBrowseSubagentConfig>;
  createSubagentSession(agentId: string): SubagentSession;
}

/** Offers a browser worker whose brain is an Aside session (belmont-browse, local-only) as a Task subagent type. */
export const browseRuntimeExtension = defineHostExtension<BrowseRuntimeExtensionApi, { log(message: string): void }>({
  id: HostExtensions.BrowseRuntime,
  dependencies: [],
  start(context) {
    const log = (message: string) => context.host.log(message);
    const resolveClient = (): BrowseClient => {
      const client = BrowseClient.fromEnvironment();
      if (client === null) throw new Error("belmont-browse service is not running (no serve.json); start belmont-browse/src/serve.mjs");
      return client;
    };
    if (ASIDE_BROWSE_ENABLED) log(`[browse-runtime] aside-browse subagent type enabled (${BrowseClient.fromEnvironment() === null ? "service not running yet" : "service found"})`);
    return {
      isEnabled: () => ASIDE_BROWSE_ENABLED,
      isAsideBrowseSubagentType,
      createSubagentConfig: createAsideBrowseSubagentConfig,
      createSubagentSession: (agentId: string) => new BrowseSubagentSession(resolveClient(), agentId, log),
    };
  },
});
