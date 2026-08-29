import { join } from "node:path";

import type { HostExtensionContext } from "../../../internal/host-extensions.js";
import type { SandAgentModelSelection } from "../../../shared/agents/sand-agent-model.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { getSandRootDir } from "../../host-paths.js";
import { createCodexWebFetchService, createCodexWebSearchService } from "./codex-web-tools.js";
import { createCursorWebFetchService, createCursorWebSearchService } from "./cursor-web-tools.js";
import { createHostInference } from "./inference-service.js";
import type { InferenceExtensionContext } from "./extension.js";

function isLocalCodexMode(): boolean {
  return new SandSettingsStore(join(getSandRootDir(), "settings.json")).getInferenceProvider() !== "cursor";
}

type ProductionContext = HostExtensionContext<unknown> & {
  readonly deps: InferenceExtensionContext["deps"];
};

/** Recreates the artifact's concrete inference construction at host-main.cjs:617672-617732. */
export function createInferenceProductionExtras(
  context: ProductionContext,
): Omit<InferenceExtensionContext, "deps"> {
  const auth = context.deps.auth;
  return {
    createPort(onModelExperimentApplied) {
      return createHostInference({
        auth,
        experiments: context.deps.experiments,
        settings: context.deps.settings,
        onModelExperimentApplied,
      });
    },
    createWebSearch(args) {
      const request = args as { modelId: string; onRequestId?: (requestId: string) => void };
      // Local Codex mode: no Cursor AiService backs search, so use the keyless DuckDuckGo-backed
      // search. The tool must stay bound (the turn requires a web search service), so this never
      // returns undefined.
      if (isLocalCodexMode()) return createCodexWebSearchService();
      return createCursorWebSearchService({
        getAccessToken: auth.getAccessToken,
        getMachineId: auth.getMachineId,
        modelId: request.modelId,
        ...(request.onRequestId == null ? {} : { onRequestId: request.onRequestId }),
      });
    },
    createWebFetch(args) {
      const request = args as { onRequestId?: (requestId: string) => void };
      // Local Codex mode: WebFetch is a self-contained local HTTP fetch (no Cursor backend).
      if (isLocalCodexMode()) return createCodexWebFetchService();
      return createCursorWebFetchService({
        getAccessToken: auth.getAccessToken,
        getMachineId: auth.getMachineId,
        ...(request.onRequestId == null ? {} : { onRequestId: request.onRequestId }),
      });
    },
  };
}

export type InferenceModelSelection = SandAgentModelSelection;
