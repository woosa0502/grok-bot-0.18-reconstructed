import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_SAND_THEME_PREFERENCE, isSandThemePreference, type SandThemePreference } from "../../desktop.js";
import { SAND_DISABLED_NOTIFICATION_CONFIG } from "../../host-settings.js";
import { SAND_DEFAULT_LOCAL_TOOL_PERMISSION, isSandLocalToolPermission, resolveSandLocalToolPermission, type SandLocalToolPermission } from "../../local-tool-permission.js";
import { clampMcpCustomInstruction, getDefaultMcpCustomInstruction } from "../../mcp-custom-instructions.js";
import { DEFAULT_SAND_AUTO_REVIEW_INSTRUCTIONS, normalizeSandAutoReviewInstructions, type SandAutoReviewInstructions } from "../../sand-auto-review-instructions.js";
import { SidebarSections, type SidebarSection } from "../../sidebar-sections.js";
import { coerceToEnabledTrack, isSandUpdateTrack, type SandUpdateTrack } from "../../update-track.js";
import { isSandAgentModelSelection, type SandAgentModelSelection } from "../../agents/sand-agent-model.js";

/**
 * Per-agent tool policy (managed-team least privilege): tools named in
 * denyTools are not offered to that agent's turns. "SendMessage" is never
 * denied (a mute bot is a footgun, not a policy).
 */
export interface SandAgentToolPolicy { readonly denyTools: readonly string[] }
export function isSandAgentToolPolicy(value: unknown): value is SandAgentToolPolicy {
  return typeof value === "object" && value != null && !Array.isArray(value)
    && Array.isArray((value as { denyTools?: unknown }).denyTools)
    && ((value as { denyTools: unknown[] }).denyTools).every((name) => typeof name === "string" && name.length > 0);
}
import { emptySandInferenceRouterUsage, isSandInferenceProvider, type SandInferenceProvider, type SandInferenceRouterUsage } from "../../inference-router.js";
import { DEFAULT_SAND_BOX_RUNTIME, isSandBoxRuntime, type SandBoxRuntime } from "../../box-runtime.js";

export const SETTINGS_VERSION = 1;
export const SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID = "downgrade-persisted-max-fast";
export const SAND_SETTINGS_MIGRATION_IDS = [SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID] as const;

type StringMap = Record<string, string>;
type StringListMap = Record<string, string[]>;
export interface SandStoredSettings {
  version: 1; mcpBoxServers: string[]; autoUpdateWhenIdleOptIn: boolean; egressTunnelEnabled: boolean; webauthnProxyEnabled: boolean;
  mcpCustomInstructions: StringMap; mcpCustomInstructionsByServerId: StringMap; mcpDisabledToolsByServerId: StringListMap;
  conciergeConsent: "unset" | "allowed" | "denied"; settingsMigrations: string[];
  hasSeenOnboarding?: boolean; hasSeenOnboardingAccountScope?: string; updateTrackOverride?: SandUpdateTrack; themePreference?: SandThemePreference;
  agentDefaultModel?: SandAgentModelSelection; computerUseModel?: SandAgentModelSelection; subagentDefaultModel?: SandAgentModelSelection; agentModelsBySubagentType?: Record<string, SandAgentModelSelection>; agentModelsByAgentId?: Record<string, SandAgentModelSelection>; agentToolPolicyByAgentId?: Record<string, SandAgentToolPolicy>; notifications?: Record<string, unknown>;
  userTimeZone?: string; userTimeZoneOverride?: string; userLanguage?: string; autoReviewInstructions?: SandAutoReviewInstructions;
  localToolPermission?: SandLocalToolPermission; localToolPermissionCeiling?: SandLocalToolPermission;
  inferenceProvider?: SandInferenceProvider; inferenceRouterUsage?: SandInferenceRouterUsage;
  boxRuntime?: SandBoxRuntime;
  mcpCustomInstructionsAccountScope?: string; pinnedAgentIds?: string[]; sidebarSections?: SidebarSection[];
}

export function emptySettings(): SandStoredSettings {
  return { version: SETTINGS_VERSION, mcpBoxServers: [], autoUpdateWhenIdleOptIn: false, egressTunnelEnabled: false, webauthnProxyEnabled: true, mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {}, mcpDisabledToolsByServerId: {}, conciergeConsent: "unset", settingsMigrations: [...SAND_SETTINGS_MIGRATION_IDS] };
}

function stringMap(value: unknown): StringMap { const result: StringMap = {}; if (typeof value !== "object" || value == null || Array.isArray(value)) return result; for (const [key, item] of Object.entries(value)) if (typeof item === "string") result[key] = item; return result; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function normalizeCustomInstructions(raw: StringMap): StringMap { const normalized: StringMap = {}; for (const [name, value] of Object.entries(raw)) { const clamped = clampMcpCustomInstruction(value); if (clamped.trim().length > 0) normalized[name] = clamped; else if (getDefaultMcpCustomInstruction(name).length > 0) normalized[name] = ""; } return normalized; }
function normalizeCustomInstructionsByServerId(raw: StringMap): StringMap { const normalized: StringMap = {}; for (const [id, value] of Object.entries(raw)) if (/^[1-9]\d*$/.test(id)) normalized[id] = clampMcpCustomInstruction(value); return normalized; }
function normalizeDisabledToolsByServerId(raw: unknown): StringListMap { const normalized: StringListMap = {}; if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return normalized; for (const [id, value] of Object.entries(raw)) { if (!/^[1-9]\d*$/.test(id)) continue; const tools = [...new Set(stringArray(value).filter((name) => name.length > 0))]; if (tools.length > 0) normalized[id] = tools; } return normalized; }
function downgradePersistedFast(model: SandAgentModelSelection): SandAgentModelSelection { return { modelId: model.modelId, maxMode: true, parameters: model.parameters.map((parameter) => ({ id: parameter.id, value: parameter.id === "fast" ? "false" : parameter.value })) }; }

function parseSettings(value: unknown): SandStoredSettings | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>; if (raw.version !== SETTINGS_VERSION) return null;
  const base = emptySettings();
  const result: SandStoredSettings = {
    ...base,
    mcpBoxServers: [...new Set(stringArray(raw.mcpBoxServers).filter((name) => name.length > 0))],
    autoUpdateWhenIdleOptIn: raw.autoUpdateWhenIdleOptIn === true,
    egressTunnelEnabled: raw.egressTunnelEnabled === true,
    webauthnProxyEnabled: raw.webauthnProxyEnabled !== false,
    mcpCustomInstructions: normalizeCustomInstructions(stringMap(raw.mcpCustomInstructions)),
    mcpCustomInstructionsByServerId: normalizeCustomInstructionsByServerId(stringMap(raw.mcpCustomInstructionsByServerId)),
    mcpDisabledToolsByServerId: normalizeDisabledToolsByServerId(raw.mcpDisabledToolsByServerId),
    conciergeConsent: raw.conciergeConsent === "allowed" || raw.conciergeConsent === "denied" ? raw.conciergeConsent : "unset",
    settingsMigrations: stringArray(raw.settingsMigrations)
  };
  if (typeof raw.hasSeenOnboarding === "boolean") result.hasSeenOnboarding = raw.hasSeenOnboarding;
  if (typeof raw.hasSeenOnboardingAccountScope === "string" && raw.hasSeenOnboardingAccountScope.length > 0) result.hasSeenOnboardingAccountScope = raw.hasSeenOnboardingAccountScope;
  if (isSandUpdateTrack(raw.updateTrackOverride)) result.updateTrackOverride = raw.updateTrackOverride;
  if (isSandThemePreference(raw.themePreference)) result.themePreference = raw.themePreference;
  if (isSandAgentModelSelection(raw.agentDefaultModel)) result.agentDefaultModel = raw.agentDefaultModel;
  if (isSandAgentModelSelection(raw.computerUseModel)) result.computerUseModel = raw.computerUseModel;
  if (isSandAgentModelSelection(raw.subagentDefaultModel)) result.subagentDefaultModel = raw.subagentDefaultModel;
  if (typeof raw.agentModelsBySubagentType === "object" && raw.agentModelsBySubagentType != null && !Array.isArray(raw.agentModelsBySubagentType)) {
    const byType: Record<string, SandAgentModelSelection> = {};
    for (const [type, selection] of Object.entries(raw.agentModelsBySubagentType as Record<string, unknown>)) if (type.length > 0 && isSandAgentModelSelection(selection)) byType[type] = selection;
    if (Object.keys(byType).length > 0) result.agentModelsBySubagentType = byType;
  }
  // Per persistent-agent model/reasoning selection (AUDIT-W1): keyed by agent id,
  // consulted ahead of agentDefaultModel for top-level runners.
  if (typeof raw.agentModelsByAgentId === "object" && raw.agentModelsByAgentId != null && !Array.isArray(raw.agentModelsByAgentId)) {
    const byAgent: Record<string, SandAgentModelSelection> = {};
    for (const [agentId, selection] of Object.entries(raw.agentModelsByAgentId as Record<string, unknown>)) if (agentId.length > 0 && isSandAgentModelSelection(selection)) byAgent[agentId] = selection;
    if (Object.keys(byAgent).length > 0) result.agentModelsByAgentId = byAgent;
  }
  if (typeof raw.agentToolPolicyByAgentId === "object" && raw.agentToolPolicyByAgentId != null && !Array.isArray(raw.agentToolPolicyByAgentId)) {
    const policyByAgent: Record<string, SandAgentToolPolicy> = {};
    for (const [agentId, policy] of Object.entries(raw.agentToolPolicyByAgentId as Record<string, unknown>)) if (agentId.length > 0 && isSandAgentToolPolicy(policy)) policyByAgent[agentId] = { denyTools: (policy as SandAgentToolPolicy).denyTools.filter((name) => name !== "SendMessage") };
    if (Object.keys(policyByAgent).length > 0) result.agentToolPolicyByAgentId = policyByAgent;
  }
  if (typeof raw.notifications === "object" && raw.notifications != null && !Array.isArray(raw.notifications)) result.notifications = raw.notifications as Record<string, unknown>;
  for (const key of ["userTimeZone", "userTimeZoneOverride", "userLanguage", "mcpCustomInstructionsAccountScope"] as const) if (typeof raw[key] === "string" && raw[key].length > 0) result[key] = raw[key];
  if (typeof raw.autoReviewInstructions === "object" && raw.autoReviewInstructions != null) result.autoReviewInstructions = normalizeSandAutoReviewInstructions(raw.autoReviewInstructions as Record<string, unknown>);
  if (isSandLocalToolPermission(raw.localToolPermission)) result.localToolPermission = raw.localToolPermission;
  if (isSandLocalToolPermission(raw.localToolPermissionCeiling)) result.localToolPermissionCeiling = raw.localToolPermissionCeiling;
  if (isSandInferenceProvider(raw.inferenceProvider)) result.inferenceProvider = raw.inferenceProvider;
  if (isSandBoxRuntime(raw.boxRuntime)) result.boxRuntime = raw.boxRuntime;
  if (typeof raw.inferenceRouterUsage === "object" && raw.inferenceRouterUsage != null && !Array.isArray(raw.inferenceRouterUsage)) {
    const usage = emptySandInferenceRouterUsage();
    const rawProviders = (raw.inferenceRouterUsage as { providers?: unknown }).providers;
    if (typeof rawProviders === "object" && rawProviders != null && !Array.isArray(rawProviders)) {
      for (const provider of Object.keys(usage.providers) as SandInferenceProvider[]) {
        const item = (rawProviders as Record<string, unknown>)[provider];
        if (typeof item !== "object" || item == null || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const count = (key: string): number => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0 ? record[key] as number : 0;
        usage.providers[provider] = { requests: count("requests"), inputTokens: count("inputTokens"), outputTokens: count("outputTokens"), cacheReadTokens: count("cacheReadTokens"), cacheWriteTokens: count("cacheWriteTokens"), lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : null };
      }
    }
    result.inferenceRouterUsage = usage;
  }
  if (Array.isArray(raw.pinnedAgentIds)) result.pinnedAgentIds = [...new Set(stringArray(raw.pinnedAgentIds).filter((id) => id.length > 0))];
  if (Array.isArray(raw.sidebarSections)) result.sidebarSections = SidebarSections.carryFolds({ sections: raw.sidebarSections.filter((entry): entry is SidebarSection => typeof entry === "object" && entry != null && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { name?: unknown }).name === "string" && Array.isArray((entry as { agentIds?: unknown }).agentIds)) });
  return result;
}

export class SandSettingsStore {
  constructor(readonly settingsPath: string) {}
  load(): SandStoredSettings {
    if (!existsSync(this.settingsPath)) return emptySettings();
    let raw: string;
    try { raw = readFileSync(this.settingsPath, "utf8"); } catch { return emptySettings(); }
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(raw); }
    catch (error) { return this.quarantineUnreadable(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    const parsed = parseSettings(parsedJson);
    if (parsed == null) return this.quarantineUnreadable("not a settings object of the supported version");
    return this.applyPendingMigrations(parsed);
  }
  /** An unreadable settings file is moved aside and reported, never silently replaced by defaults: the user's
   * choices stay recoverable from the quarantined copy and the loss is visible in the host log. */
  private quarantineUnreadable(reason: string): SandStoredSettings {
    const quarantined = `${this.settingsPath}.corrupt-${Date.now()}`;
    try { renameSync(this.settingsPath, quarantined); } catch { /* leave the unreadable file in place if it cannot be moved */ }
    console.error(`[settings] ${this.settingsPath} is unreadable (${reason}); moved to ${quarantined} and continuing with defaults`);
    return emptySettings();
  }
  private applyPendingMigrations(settings: SandStoredSettings): SandStoredSettings {
    if (settings.settingsMigrations.includes(SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID)) return settings;
    const migrated = { ...settings, settingsMigrations: [...settings.settingsMigrations, SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID], ...(settings.agentDefaultModel === undefined ? {} : { agentDefaultModel: downgradePersistedFast(settings.agentDefaultModel) }) };
    try { this.persist(migrated); } catch {}
    return migrated;
  }
  persist(settings: SandStoredSettings): void { mkdirSync(dirname(this.settingsPath), { recursive: true }); const temp = `${this.settingsPath}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(settings, null, 2), "utf8"); renameSync(temp, this.settingsPath); }
  private update(mutator: (settings: SandStoredSettings) => SandStoredSettings): void { this.persist(mutator(this.load())); }
  getHasSeenOnboarding(): boolean | undefined { return this.load().hasSeenOnboarding; }
  setHasSeenOnboarding(value: boolean): void { this.update((current) => { const { hasSeenOnboardingAccountScope: _old, ...rest } = current; return { ...rest, hasSeenOnboarding: value, ...(rest.mcpCustomInstructionsAccountScope === undefined ? {} : { hasSeenOnboardingAccountScope: rest.mcpCustomInstructionsAccountScope }) }; }); }
  clearHasSeenOnboarding(): void { this.update((current) => { const { hasSeenOnboarding: _seen, hasSeenOnboardingAccountScope: _owner, ...rest } = current; return rest; }); }
  getAutoUpdateWhenIdleOptIn(): boolean { return this.load().autoUpdateWhenIdleOptIn; }
  setAutoUpdateWhenIdleOptIn(value: boolean): void { this.update((s) => ({ ...s, autoUpdateWhenIdleOptIn: value })); }
  getThemePreference(): SandThemePreference { return this.load().themePreference ?? DEFAULT_SAND_THEME_PREFERENCE; }
  setThemePreference(value: SandThemePreference): void { this.update((s) => ({ ...s, themePreference: value })); }
  getBoxRuntime(): SandBoxRuntime { return this.load().boxRuntime ?? DEFAULT_SAND_BOX_RUNTIME; }
  setBoxRuntime(value: SandBoxRuntime): void { this.update((s) => ({ ...s, boxRuntime: value })); }
  getEgressTunnelEnabled(): boolean { return this.load().egressTunnelEnabled; }
  setEgressTunnelEnabled(value: boolean): void { this.update((s) => ({ ...s, egressTunnelEnabled: value })); }
  getWebauthnProxyEnabled(): boolean { return this.load().webauthnProxyEnabled; }
  setWebauthnProxyEnabled(value: boolean): void { this.update((s) => ({ ...s, webauthnProxyEnabled: value })); }
  getAgentDefaultModel(): SandAgentModelSelection | undefined { const model = this.load().agentDefaultModel; return model === undefined ? undefined : { ...model, maxMode: true }; }
  setAgentDefaultModel(model: SandAgentModelSelection | undefined): void { this.update((s) => { const { agentDefaultModel: _old, ...rest } = s; return model === undefined ? rest : { ...rest, agentDefaultModel: { modelId: model.modelId, maxMode: true, parameters: model.parameters.map((p) => ({ ...p })) } }; }); }
  getComputerUseModel(): SandAgentModelSelection | undefined { return this.load().computerUseModel; }
  getSubagentDefaultModel(): SandAgentModelSelection | undefined { return this.load().subagentDefaultModel; }
  getAgentModelForSubagentType(subagentType: string): SandAgentModelSelection | undefined { return this.load().agentModelsBySubagentType?.[subagentType]; }
  getAgentModelForAgentId(agentId: string): SandAgentModelSelection | undefined { return this.load().agentModelsByAgentId?.[agentId]; }
  getAgentModelsByAgentId(): Record<string, SandAgentModelSelection> { return { ...(this.load().agentModelsByAgentId ?? {}) }; }
  /** The language the user wants replies in (a phone-side preference rendered into every bot's prompt). */
  getUserLanguage(): string | undefined { return this.load().userLanguage; }
  setUserLanguage(value: string | undefined): void { this.update((s) => { const { userLanguage: _old, ...rest } = s; const trimmed = value?.trim(); return trimmed === undefined || trimmed.length === 0 ? rest : { ...rest, userLanguage: trimmed.slice(0, 40) }; }); }
  getAgentToolPolicy(agentId: string): SandAgentToolPolicy | undefined { return this.load().agentToolPolicyByAgentId?.[agentId]; }
  setAgentToolPolicy(agentId: string, policy: SandAgentToolPolicy | undefined): void {
    this.update((s) => {
      const map = { ...(s.agentToolPolicyByAgentId ?? {}) };
      if (policy === undefined || policy.denyTools.length === 0) delete map[agentId];
      else map[agentId] = { denyTools: policy.denyTools.filter((name) => name !== "SendMessage") };
      const { agentToolPolicyByAgentId: _old, ...rest } = s;
      return Object.keys(map).length === 0 ? rest : { ...rest, agentToolPolicyByAgentId: map };
    });
  }
  setAgentModelForAgentId(agentId: string, model: SandAgentModelSelection | undefined): void {
    this.update((s) => {
      const map = { ...(s.agentModelsByAgentId ?? {}) };
      if (model === undefined) delete map[agentId];
      else map[agentId] = { modelId: model.modelId, maxMode: model.maxMode, parameters: model.parameters.map((p) => ({ ...p })) };
      const { agentModelsByAgentId: _old, ...rest } = s;
      return Object.keys(map).length === 0 ? rest : { ...rest, agentModelsByAgentId: map };
    });
  }
  setSubagentDefaultModel(model: SandAgentModelSelection | undefined): void { this.update((s) => { const { subagentDefaultModel: _old, ...rest } = s; return model === undefined ? rest : { ...rest, subagentDefaultModel: { modelId: model.modelId, maxMode: model.maxMode, parameters: model.parameters.map((p) => ({ ...p })) } }; }); }
  setComputerUseModel(model: SandAgentModelSelection | undefined): void { this.update((s) => { const { computerUseModel: _old, ...rest } = s; return model === undefined ? rest : { ...rest, computerUseModel: { modelId: model.modelId, maxMode: model.maxMode, parameters: model.parameters.map((p) => ({ ...p })) } }; }); }
  getUpdateTrackOverride(): SandUpdateTrack | null { const stored = this.load().updateTrackOverride ?? null; if (stored == null) return null; const coerced = coerceToEnabledTrack(stored); if (coerced !== stored) { try { this.setUpdateTrackOverride(coerced); } catch {} } return coerced; }
  setUpdateTrackOverride(track: SandUpdateTrack | null): void { this.update((s) => { const { updateTrackOverride: _old, ...rest } = s; return track == null ? rest : { ...rest, updateTrackOverride: track }; }); }
  getMcpCustomInstructions(): StringMap { return this.load().mcpCustomInstructions; }
  setMcpCustomInstructions(value: StringMap): void { this.update((s) => ({ ...s, mcpCustomInstructions: normalizeCustomInstructions(value) })); }
  getMcpCustomInstructionsByServerId(): StringMap { return this.load().mcpCustomInstructionsByServerId; }
  setMcpCustomInstructionsByServerId(value: StringMap): void { this.update((s) => ({ ...s, mcpCustomInstructionsByServerId: normalizeCustomInstructionsByServerId(value) })); }
  getMcpCustomInstructionsAccountScope(): string | undefined { return this.load().mcpCustomInstructionsAccountScope; }
  getMcpDisabledToolsByServerId(): StringListMap { return this.load().mcpDisabledToolsByServerId; }
  setMcpDisabledToolsByServerId(value: StringListMap): void { this.update((s) => ({ ...s, mcpDisabledToolsByServerId: normalizeDisabledToolsByServerId(value) })); }
  scopeToAccount(accountScope: string): void { this.update((current) => { const seen = current.hasSeenOnboarding === undefined || (current.hasSeenOnboardingAccountScope !== undefined && current.hasSeenOnboardingAccountScope !== accountScope) ? {} : { hasSeenOnboarding: current.hasSeenOnboarding, hasSeenOnboardingAccountScope: accountScope }; const { hasSeenOnboarding: _seen, hasSeenOnboardingAccountScope: _owner, ...withoutSeen } = current; if (current.mcpCustomInstructionsAccountScope === undefined || current.mcpCustomInstructionsAccountScope === accountScope) return { ...withoutSeen, ...seen, mcpCustomInstructionsAccountScope: accountScope }; const { autoReviewInstructions: _a, agentDefaultModel: _m, computerUseModel: _c, localToolPermission: _p, localToolPermissionCeiling: _pc, ...rest } = withoutSeen; return { ...rest, ...seen, mcpCustomInstructionsAccountScope: accountScope, mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {}, mcpDisabledToolsByServerId: {} }; }); }
  clearAccountScope(): void { this.update((current) => { const { mcpCustomInstructionsAccountScope: _scope, autoReviewInstructions: _a, agentDefaultModel: _m, computerUseModel: _c, localToolPermission: _p, localToolPermissionCeiling: _pc, ...rest } = current; return { ...rest, mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {}, mcpDisabledToolsByServerId: {} }; }); }
  getUserTimeZone(): string | undefined { const s = this.load(); return s.userTimeZoneOverride ?? s.userTimeZone; }
  getDetectedUserTimeZone(): string | undefined { return this.load().userTimeZone; }
  getUserTimeZoneOverride(): string | undefined { return this.load().userTimeZoneOverride; }
  setUserTimeZone(value?: string): void { this.update((s) => { const { userTimeZone: _old, ...rest } = s; const trimmed = value?.trim(); return trimmed == null || trimmed.length === 0 ? rest : { ...rest, userTimeZone: trimmed }; }); }
  setUserTimeZoneOverride(value?: string): void { this.update((s) => { const { userTimeZoneOverride: _old, ...rest } = s; const trimmed = value?.trim(); return trimmed == null || trimmed.length === 0 ? rest : { ...rest, userTimeZoneOverride: trimmed }; }); }
  getMcpBoxServers(): string[] { return this.load().mcpBoxServers; }
  setMcpBoxServers(names: readonly string[]): void { this.update((s) => ({ ...s, mcpBoxServers: [...new Set(names)] })); }
  getRawMcpCustomInstruction(name: string): string | undefined { return this.load().mcpCustomInstructions[name]; }
  getRawMcpCustomInstructionByServerId(id: string): string | undefined { return this.load().mcpCustomInstructionsByServerId[id]; }
  setMcpCustomInstructionByServerId(args: { serverId: string; displayName: string; value: string; mirrorLegacyName: boolean }): void { this.update((s) => { const byId = { ...s.mcpCustomInstructionsByServerId, [args.serverId]: clampMcpCustomInstruction(args.value) }; const legacy = { ...s.mcpCustomInstructions }; if (args.mirrorLegacyName) { const value = clampMcpCustomInstruction(args.value); if (value.trim().length > 0 || getDefaultMcpCustomInstruction(args.displayName).length > 0) legacy[args.displayName] = value; else delete legacy[args.displayName]; } else delete legacy[args.displayName]; return { ...s, mcpCustomInstructionsByServerId: byId, mcpCustomInstructions: legacy }; }); }
  migrateMcpCustomInstructionToServerId(args: { serverId: string; displayName: string }): void { const current = this.load(); if (current.mcpCustomInstructionsByServerId[args.serverId] !== undefined) return; const legacy = current.mcpCustomInstructions[args.displayName]; if (legacy === undefined) return; this.persist({ ...current, mcpCustomInstructionsByServerId: { ...current.mcpCustomInstructionsByServerId, [args.serverId]: legacy } }); }
  deleteMcpCustomInstructionByServerId(args: { serverId: string; displayName: string; deleteLegacyName: boolean }): void { this.update((s) => { const byId = { ...s.mcpCustomInstructionsByServerId }; delete byId[args.serverId]; const legacy = { ...s.mcpCustomInstructions }; if (args.deleteLegacyName) delete legacy[args.displayName]; return { ...s, mcpCustomInstructionsByServerId: byId, mcpCustomInstructions: legacy }; }); }
  setMcpCustomInstruction(name: string, value: string): void { this.update((s) => { const next = { ...s.mcpCustomInstructions }; const clamped = clampMcpCustomInstruction(value); if (clamped.trim().length === 0) { if (getDefaultMcpCustomInstruction(name).length > 0) next[name] = ""; else delete next[name]; } else next[name] = clamped; return { ...s, mcpCustomInstructions: next }; }); }
  deleteMcpCustomInstruction(name: string): void { const current = this.load(); if (!(name in current.mcpCustomInstructions)) return; const next = { ...current.mcpCustomInstructions }; delete next[name]; this.persist({ ...current, mcpCustomInstructions: next }); }
  getNotificationConfig() { const current = this.load(); if (current.notifications?.isEnabled !== false || Object.keys(current.notifications).length !== 1) this.persist({ ...current, notifications: { isEnabled: false } }); return SAND_DISABLED_NOTIFICATION_CONFIG; }
  setNotificationConfig(_input: unknown): void { this.update((s) => ({ ...s, notifications: { isEnabled: false } })); }
  getAutoReviewInstructions(): SandAutoReviewInstructions { return this.load().autoReviewInstructions ?? DEFAULT_SAND_AUTO_REVIEW_INSTRUCTIONS; }
  setAutoReviewInstructions(value: SandAutoReviewInstructions): void { const normalized = normalizeSandAutoReviewInstructions(value); this.update((s) => { const { autoReviewInstructions: _old, ...rest } = s; return normalized.isEnabled && normalized.allowInstructions.length === 0 && normalized.blockInstructions.length === 0 ? rest : { ...rest, autoReviewInstructions: normalized }; }); }
  getLocalToolPermission(): SandLocalToolPermission { const s = this.load(); return resolveSandLocalToolPermission(s.localToolPermission ?? SAND_DEFAULT_LOCAL_TOOL_PERMISSION, s.localToolPermissionCeiling); }
  getLocalToolPermissionChoice(): SandLocalToolPermission { return this.load().localToolPermission ?? SAND_DEFAULT_LOCAL_TOOL_PERMISSION; }
  getLocalToolPermissionCeiling(): SandLocalToolPermission | undefined { return this.load().localToolPermissionCeiling; }
  setLocalToolPermission(value: SandLocalToolPermission): void { this.update((s) => ({ ...s, localToolPermission: value })); }
  getInferenceProvider(): SandInferenceProvider { return this.load().inferenceProvider ?? "cursor"; }
  setInferenceProvider(value: SandInferenceProvider): void { this.update((s) => ({ ...s, inferenceProvider: value })); }
  getInferenceRouterUsage(): SandInferenceRouterUsage { return this.load().inferenceRouterUsage ?? emptySandInferenceRouterUsage(); }
  recordInferenceUsage(provider: SandInferenceProvider, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): void {
    const safe = (value: number | undefined): number => Number.isFinite(value) && value! >= 0 ? Math.round(value!) : 0;
    this.update((settings) => {
      const current = settings.inferenceRouterUsage ?? emptySandInferenceRouterUsage();
      const previous = current.providers[provider];
      return { ...settings, inferenceRouterUsage: { schemaVersion: 1, providers: { ...current.providers, [provider]: { requests: previous.requests + 1, inputTokens: previous.inputTokens + safe(usage.inputTokens), outputTokens: previous.outputTokens + safe(usage.outputTokens), cacheReadTokens: previous.cacheReadTokens + safe(usage.cacheReadTokens), cacheWriteTokens: previous.cacheWriteTokens + safe(usage.cacheWriteTokens), lastUsedAt: new Date().toISOString() } } } };
    });
  }
  setLocalToolPermissionCeiling(value?: SandLocalToolPermission): void { this.update((s) => { const { localToolPermissionCeiling: _old, ...rest } = s; return value === undefined ? rest : { ...rest, localToolPermissionCeiling: value }; }); }
  getPinnedAgentIds(): string[] | undefined { return this.load().pinnedAgentIds; }
  setPinnedAgentIds(ids: readonly string[]): void { this.update((s) => ({ ...s, pinnedAgentIds: [...new Set(ids)] })); }
  static storable(args: { sections: readonly SidebarSection[]; stored?: readonly SidebarSection[] }): SidebarSection[] { return SidebarSections.carryFolds(args).map((s) => ({ id: s.id, name: s.name, agentIds: [...s.agentIds], isCollapsed: s.isCollapsed ?? false })); }
  getSidebarSections(): SidebarSection[] | undefined { const stored = this.load().sidebarSections; return stored === undefined ? undefined : SidebarSections.carryFolds({ sections: stored }); }
  setSidebarSections(sections: readonly SidebarSection[]): void { this.update((s) => ({ ...s, sidebarSections: SandSettingsStore.storable(s.sidebarSections === undefined ? { sections } : { sections, stored: s.sidebarSections }) })); }
}
