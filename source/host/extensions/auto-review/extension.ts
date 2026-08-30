import { join } from "node:path";
import { defineHostExtension } from "../../../internal/host-extensions.js";
import { SAND_AUTO_REVIEW_HOST_GENERATION } from "../../runner/sand-auto-review.js";
import { getSandRootDir } from "../../host-paths.js";
import { SandSettingsStore } from "../../../shared/node/settings/sand-settings-store.js";
import { HostExtensions } from "../extension-ids.generated.js";
import {
  AutoReviewService,
  parseLocalAutoReviewMode,
  type AutoReviewServiceDeps,
} from "./auto-review-service.js";
import { createSandBackendSmartModeClassifierExecutor } from "./sand-backend-smart-mode-classifier-exec.js";
import {
  createLocalSmartModeClassifierExecutor,
  isLocalAutoReviewInferenceProvider,
} from "./local-smart-mode-classifier-exec.js";
import {
  createRoutedProviderClassifierTextRunner,
  warmUpLocalClassifierProvider,
} from "./local-smart-mode-classifier-provider.js";

type AutoReviewAuth = Parameters<typeof createSandBackendSmartModeClassifierExecutor>[0];
type AutoReviewClassifier = ReturnType<typeof createSandBackendSmartModeClassifierExecutor>;
type AutoReviewDependencies = Omit<
  AutoReviewServiceDeps<AutoReviewClassifier, AutoReviewAuth>,
  "hostGeneration" | "localMode" | "now" | "createClassifierExecutor"
> & {
  readonly transcript: AutoReviewServiceDeps<AutoReviewClassifier, AutoReviewAuth>["transcript"] & {
    createAwaitingStateSink(): AutoReviewServiceDeps<AutoReviewClassifier, AutoReviewAuth>["awaitingSink"];
    listAgentIds(): Promise<readonly string[]>;
    expireAllPendingAutoReviewApprovalCards(): Promise<unknown>;
  };
};

export const autoReviewExtension = defineHostExtension<
  AutoReviewService<AutoReviewClassifier, AutoReviewAuth>
>({
  id: HostExtensions.AutoReview,
  dependencies: [
    HostExtensions.Auth,
    HostExtensions.Experiments,
    HostExtensions.Settings,
    HostExtensions.Telemetry,
    HostExtensions.Transcript,
  ],
  start: (context) => {
    const auth = context.deps[HostExtensions.Auth] as AutoReviewAuth;
    const experiments = context.deps[HostExtensions.Experiments] as AutoReviewDependencies["experiments"];
    const settings = context.deps[HostExtensions.Settings] as AutoReviewDependencies["settings"];
    const telemetry = (context.deps[HostExtensions.Telemetry] as {
      logs: AutoReviewDependencies["telemetry"];
    }).logs;
    const transcript = context.deps[HostExtensions.Transcript] as AutoReviewDependencies["transcript"];
    // The Cursor-mode classifier runs ClassifySandAutoReview against the Cursor backend, which
    // does not exist for the local inference providers (Pi/Codex, Claude Code, OpenRouter).
    // Auto-review used to be forced off whenever the provider was not Cursor, so the user's
    // Auto-review toggle and allow/block rules had no effect locally. Local providers now get a
    // classifier served by the same routed provider (local-smart-mode-classifier-exec.ts), so
    // the user's setting is respected as-is: the Settings toggle stays the kill switch (off ⇒
    // no classifier, actions fall to the local tool-permission gate).
    //
    // The Statsig `sand_auto_review` enforce gate is a Cursor rollout lever with no local
    // equivalent (settings-on would otherwise stay in shadow forever: classifier cost, no
    // approval cards). Locally, settings-on means enforce. SAND_AUTO_REVIEW_MODE still
    // overrides every surface for bring-up (off | shadow | enforce).
    const settingsStore = new SandSettingsStore(join(getSandRootDir(), "settings.json"));
    const currentInferenceProvider = () => settingsStore.getInferenceProvider();
    const experimentsForAutoReview: AutoReviewDependencies["experiments"] = {
      checkFeatureGate: (name) =>
        name === "sand_auto_review" && isLocalAutoReviewInferenceProvider(currentInferenceProvider())
          ? true
          : experiments.checkFeatureGate(name),
    };
    const service = new AutoReviewService({
      auth,
      experiments: experimentsForAutoReview,
      settings,
      telemetry,
      awaitingSink: transcript.createAwaitingStateSink(),
      transcript,
      hostGeneration: SAND_AUTO_REVIEW_HOST_GENERATION,
      localMode: parseLocalAutoReviewMode(process.env.SAND_AUTO_REVIEW_MODE)!,
      createClassifierExecutor: (classifierAuth) => {
        const provider = currentInferenceProvider();
        if (!isLocalAutoReviewInferenceProvider(provider)) return createSandBackendSmartModeClassifierExecutor(classifierAuth);
        if (settings.getAutoReviewInstructions().isEnabled) warmUpLocalClassifierProvider(provider);
        return createLocalSmartModeClassifierExecutor({ provider, runText: createRoutedProviderClassifierTextRunner(provider) });
      },
    });
    context.onStop(() => service.stop());
    const startedAtMs = Date.now();
    const sweepBadges = () => service.sweepStaleAwaitingBadges(
      () => transcript.listAgentIds(),
      startedAtMs,
    );
    void transcript.expireAllPendingAutoReviewApprovalCards().then(sweepBadges, sweepBadges);
    return service;
  },
});
