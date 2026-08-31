import { defineHostExtension } from "../../../internal/host-extensions.js";
import { getSandRootDir } from "../../host-paths.js";
import { resolveMultitaskEnabled } from "../../sand-multitask.js";
import { resolveSpotlightEnabled } from "../../../shared/sand-spotlight.js";
import { envGateOverride, SandExperimentService } from "../../../shared/node/experiments/cursor-experiments.js";
import { HostExtensions } from "../extension-ids.generated.js";
import { isLocalCodexMode } from "../../../shared/node/local-codex-account.js";

interface AuthApi { getAccessToken(options: { backendUrl: string }): Promise<string>; getMachineId(): Promise<string>; peekAccessToken(): string | null; subscribeToRenewal(listener: (event: { outcome: string; isFirstCredential: boolean }) => void): () => void; }

/**
 * "Pin on authenticated bootstrap" waits for a Cursor-backed Statsig bootstrap that
 * never arrives in local Codex mode, so any gate pinned this way (memory dreaming)
 * stayed off forever regardless of overrides. In local mode the pin fires
 * immediately from `evaluateLocalPin` instead.
 */
export function pinGateWithLocalFallback(
  deps: { isLocalMode: boolean; evaluateLocalPin(name: string): boolean; pinOnAuthenticatedBootstrap(name: string, pin: (value: boolean) => void): void },
  name: string,
  pin: (value: boolean) => void,
): void {
  if (deps.isLocalMode) { pin(deps.evaluateLocalPin(name)); return; }
  deps.pinOnAuthenticatedBootstrap(name, pin);
}

/**
 * Local-mode pin evaluation is EXPLICIT-ONLY: a persisted feature-flag override
 * or SAND_FEATURE_GATE_OVERRIDES enables a pinned gate; everything else pins
 * OFF. The cached Statsig bootstrap is deliberately excluded — it is an
 * anonymous-user snapshot, and consulting it flipped unrelated pinned gates
 * (stale-root GC, conversation GC, legacy blob retirement) from "never
 * enabled locally" to "whatever the cache happened to hold", nondeterministic
 * across first/second boot. Bundled defaults are excluded for the same
 * reason: before the local fallback existed NO pinned gate ever fired here,
 * so explicit-or-off preserves that behavior deterministically. The env is
 * read directly (not via canUseFeatureFlagOverrides) so the opt-in/opt-out
 * documented in scripts/lib/wsl-runtime.mjs also works in a packaged build.
 */
export function localGatePinValue(
  deps: { storedOverride: boolean | undefined; env: NodeJS.ProcessEnv },
  name: string,
): boolean {
  if (deps.storedOverride != null) return deps.storedOverride;
  return envGateOverride(name, deps.env) ?? false;
}
interface SettingsApi { subscribeToFeatureFlagOverrides(listener: (overrides: Record<string, boolean>) => void): () => void; }
export const experimentsExtension = defineHostExtension({
  id: HostExtensions.Experiments, dependencies: [HostExtensions.Auth, HostExtensions.Settings],
  start: (context) => {
    const auth = context.deps[HostExtensions.Auth] as AuthApi; const settings = context.deps[HostExtensions.Settings] as SettingsApi;
    const service = new SandExperimentService({ getAccessToken: auth.getAccessToken, getMachineId: auth.getMachineId, getCacheDir: () => getSandRootDir(), isDevBuild: process.env.SAND_PACKAGED !== "1" || process.env.SAND_HOST_DEV_ERROR_DETAIL === "1" });
    service.start(); context.onStop(() => service.dispose()); context.onStop(auth.subscribeToRenewal((event) => { if (event.outcome === "renewed" && (event.isFirstCredential || !service.hasAuthenticatedStatsigBootstrap())) service.handleAuthChange(); }));
    if (auth.peekAccessToken() !== null) service.handleAuthChange(); context.onStop(settings.subscribeToFeatureFlagOverrides((overrides) => service.replaceFeatureFlagOverrides(overrides)));
    return {
      checkFeatureGate: (name: Parameters<typeof service.checkFeatureGate>[0]) => service.checkFeatureGate(name), getFeatureGateProperty: (name: Parameters<typeof service.getFeatureGateProperty>[0]) => service.getFeatureGateProperty(name),
      checkGate: (name: Parameters<typeof service.checkGate>[0], options?: { timeoutMs?: number }) => service.checkGate(name, options), getDynamicConfig: (name: Parameters<typeof service.getDynamicConfig>[0]) => service.getDynamicConfig(name), subscribe: (listener: Parameters<typeof service.subscribe>[0]) => service.subscribe(listener),
      pinGateOnAuthenticatedBootstrap: (name: Parameters<typeof service.pinGateOnAuthenticatedBootstrap>[0], pin: (value: boolean) => void) => pinGateWithLocalFallback({ isLocalMode: isLocalCodexMode(process.env), evaluateLocalPin: (gate) => localGatePinValue({ storedOverride: service.getFeatureFlagOverridesRecord()[gate as typeof name], env: process.env }, gate), pinOnAuthenticatedBootstrap: (gate, listener) => service.pinGateOnAuthenticatedBootstrap(gate as typeof name, listener) }, name, pin), hasHydratedStatsigUserId: () => service.hasHydratedStatsigUserId(), waitForHydratedStatsigUserId: (timeoutMs?: number) => service.waitForHydratedStatsigUserId(timeoutMs),
      hasAuthenticatedStatsigBootstrap: () => service.hasAuthenticatedStatsigBootstrap(), getSandModelExperimentState: () => service.getSandModelExperimentState(), logSandModelExperimentExposure: () => service.logSandModelExperimentExposure(), getConfiguredDefaultModel: () => service.getConfiguredDefaultModel(), getConfiguredAutomationsModel: () => service.getConfiguredAutomationsModel(), getComputerUseModelOverride: () => service.getComputerUseModelOverride(), getBrowserUseModelOverride: () => service.getBrowserUseModelOverride(),
      // Cloud agents are a Cursor-account feature; treat local Codex mode as "disabled by team"
      // so the prompt and toolset stop advertising CloudAgent (see host-runner-composition).
      isCloudAgentsDisabledByTeam: () => isLocalCodexMode(process.env),
      isAgentNetworkEnabled: () => service.checkFeatureGate("sand_agent_network"), isMcpMultiAccountEnabled: () => service.checkFeatureGate("mcp_multi_account"), isSparsePluginClonesEnabled: () => service.checkFeatureGate("enable_sparse_plugin_clones"),
      isMultitaskEnabled: () => resolveMultitaskEnabled(process.env.SAND_MULTITASK, () => service.checkFeatureGate("sand_multitask")), isSendMessageDeliveryOwedEnabled: () => service.checkFeatureGate("sand_send_message_delivery_owed"), isDynamicToolsEnabled: () => service.checkFeatureGate("grok_bot_dynamic_tools"), isBrowserUseSubagentEnabled: () => service.checkFeatureGate("sand_browser_use_subagent"),
      isSpotlightEnabled: () => resolveSpotlightEnabled(process.env.SAND_SPOTLIGHT, () => service.checkFeatureGate("sand_spotlight")), isUnicodeTypingEnabled: () => service.checkFeatureGate("sand_computer_use_unicode_typing"), isUaTokenKillSwitchEnabled: () => service.checkFeatureGate("sand_browser_ua_token_kill_switch")
    };
  }
});
