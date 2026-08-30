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
