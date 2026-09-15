import { randomUUID } from "node:crypto";
import { runRoutedProviderText } from "../inference/provider-session.js";
import type {
  LocalAutoReviewInferenceProvider,
  LocalSmartModeClassifierTextRunner,
} from "./local-smart-mode-classifier-exec.js";

/**
 * Binds the local auto-review classifier to the routed inference provider (Pi/Codex, Claude
 * Code, OpenRouter). Split from the classifier itself so the classifier module carries no
 * provider SDK imports.
 */
export function createRoutedProviderClassifierTextRunner(provider: LocalAutoReviewInferenceProvider): LocalSmartModeClassifierTextRunner {
  return async (request) => await runRoutedProviderText(provider, [{ role: "user", content: request.userPrompt }], {
    signal: request.signal,
    systemPrompt: request.systemPrompt,
    ...(request.modelId === undefined ? {} : { modelId: request.modelId }),
    ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
    // Auxiliary metering: the smart-mode auto-review classifier runs per tool call and can be
    // costly (Luna at max by default). The classifier's text-runner interface (Context-based)
    // does not carry the reviewed bot's id, so this is lumped under actor "(auxiliary)" rather
    // than per-bot; that still surfaces total classifier spend for tuning. See report tool.
    metering: {
      actorId: "(auxiliary)",
      ownerAgentId: null,
      conversationId: "(auxiliary)",
      hostRequestId: "",
      turnRunId: randomUUID(),
      purpose: "auxiliary" as const,
    },
  });
}

/**
 * Pre-loads the Pi runtime (ESM import + credential store) so the first classification of a
 * session does not spend its 10s budget on the cold start.
 */
export function warmUpLocalClassifierProvider(provider: LocalAutoReviewInferenceProvider): void {
  if (provider !== "codex") return;
  // Literal specifier so esbuild bundles the runtime; loaded lazily to keep extension start cheap.
  void import("../inference/pi-codex-runtime.js")
    .then(module => module.getPiCodexAuthStatus())
    .catch(() => undefined);
}
