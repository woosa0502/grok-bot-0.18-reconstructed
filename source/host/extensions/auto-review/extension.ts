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
    // The smart-mode / auto-review classifier runs ClassifySandAutoReview against the Cursor
    // backend, which does not exist in local Codex mode. Auto-review defaults to enabled, so
    // without this every shell command would be sent to that missing classifier and rejected
    // ("safety review errored") — the primary Shell tool would never run. Force auto-review off
    // whenever the inference provider is not Cursor, mirroring how the transcript journal is
    // forced off in local mode; local shells then run without classification.
    const localCodexMode = new SandSettingsStore(join(getSandRootDir(), "settings.json")).getInferenceProvider() !== "cursor";
    const settingsForAutoReview: AutoReviewDependencies["settings"] = localCodexMode
      ? { getAutoReviewInstructions: () => ({ ...settings.getAutoReviewInstructions(), isEnabled: false }) }
      : settings;
    const service = new AutoReviewService({
      auth,
      experiments,
      settings: settingsForAutoReview,
      telemetry,
      awaitingSink: transcript.createAwaitingStateSink(),
      transcript,
      hostGeneration: SAND_AUTO_REVIEW_HOST_GENERATION,
      localMode: parseLocalAutoReviewMode(process.env.SAND_AUTO_REVIEW_MODE)!,
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
