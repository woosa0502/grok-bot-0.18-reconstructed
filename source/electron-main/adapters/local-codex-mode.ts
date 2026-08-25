import {
  DYNAMIC_CONFIGS,
  EXPERIMENTS,
  FLAGS,
} from "../../shared/node/experiments/experiment-config.gen.js";

export const LOCAL_CODEX_STATUS = Object.freeze({
  kind: "logged-in",
  authId: "local-codex",
  email: "local@codex",
  displayName: "Belmont Local",
  isAnysphereUser: false,
} as const);

export function createLocalExperimentSnapshot() {
  const featureGates = Object.fromEntries(
    Object.entries(FLAGS).map(([name, definition]) => [name, definition.default === true]),
  );
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
