import {
  DYNAMIC_CONFIGS,
  EXPERIMENTS,
  FLAGS,
} from "../../shared/node/experiments/experiment-config.gen.js";
import {
  LOCAL_CODEX_AUTH_ID,
  LOCAL_CODEX_DISPLAY_NAME,
  LOCAL_CODEX_EMAIL,
} from "../../shared/node/local-codex-account.js";

export const LOCAL_CODEX_STATUS = Object.freeze({
  kind: "logged-in",
  authId: LOCAL_CODEX_AUTH_ID,
  email: LOCAL_CODEX_EMAIL,
  displayName: LOCAL_CODEX_DISPLAY_NAME,
  isAnysphereUser: false,
} as const);

// Renderer-read gates for surfaces that need a Cursor account or cloud backend.
// The registry defaults already leave them off; pinning them here stops the local
// build from depending on upstream defaults (usage/billing page, teach-by-
// demonstration recording, agent network/org chart, iOS upsell, skill publishing,
// idle auto-update).
export const LOCAL_CODEX_FEATURE_GATE_OVERRIDES: Readonly<Record<string, boolean>> = Object.freeze({
  sand_usage_page: false,
  sand_teach_by_demonstration: false,
  sand_agent_network: false,
  sand_get_grok_bot_ios: false,
  publish_user_skills: false,
  sand_auto_update_when_idle: false,
});

export function createLocalExperimentSnapshot() {
  const featureGates = {
    ...Object.fromEntries(
      Object.entries(FLAGS).map(([name, definition]) => [name, definition.default === true]),
    ),
    ...LOCAL_CODEX_FEATURE_GATE_OVERRIDES,
  };
  const experiments = Object.fromEntries(
    Object.entries(EXPERIMENTS).map(([name, definition]) => [name, { ...definition.fallbackValues }]),
  );
  const dynamicConfigs = Object.fromEntries(
    Object.entries(DYNAMIC_CONFIGS).map(([name, definition]) => [name, { ...definition.fallbackValues }]),
  );
  return Object.freeze({
    isInitialized: true,
    featureGates: Object.freeze(featureGates),
    experiments: Object.freeze(experiments),
    dynamicConfigs: Object.freeze(dynamicConfigs),
  });
}
