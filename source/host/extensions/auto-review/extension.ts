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
    const service = new AutoReviewService({
      auth,
      experiments,
      settings,
      telemetry,
      awaitingSink: transcript.createAwaitingStateSink(),
      transcript,
      hostGeneration: SAND_AUTO_REVIEW_HOST_GENERATION,
      // Smart Mode's risk classifier runs on the Cursor backend. In local (routed,
      // non-cursor) inference mode there is no such backend, so an enforced classifier
      // fail-closes and blocks every shell/browser/computer action. Default the local
      // auto-review override to "off" there so those tools fall through to the local
      // tool-permission gate (the user still approves via "Execution on Local
      // Computer"), matching how the shipped app treats a missing backend classifier.
      // An explicit SAND_AUTO_REVIEW_MODE env still wins for deliberate testing.
      localMode: (parseLocalAutoReviewMode(process.env.SAND_AUTO_REVIEW_MODE)
        ?? (new SandSettingsStore(join(getSandRootDir(), "settings.json")).getInferenceProvider() !== "cursor" ? "off" : undefined))!,
      createClassifierExecutor: createSandBackendSmartModeClassifierExecutor,
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
