import { dirname, join } from "node:path";
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from "node:fs";
import { createDebouncePolicy, realClock } from "../../internal/scheduling.js";
import { cronTrigger } from "../../shared/automations.js";
import { LEGACY_WORKFLOW_FILENAME, WORKFLOW_FILENAME, automationToWorkflow, clampWorkflowBody, clampWorkflowName, deriveWorkflowNameFromUrl, liveWorkflowSpecFromSource, parseWorkflowFile, serializeWorkflowFile, slugifyWorkflowName, workflowSpecFromMarkdown, type WorkflowRecord, type WorkflowSpec } from "../../shared/workflow-model.js";
import { readWorkflowScopeFields, type WorkflowScopeFields } from "../../shared/workflow-scope.js";
import { AgentWorkflowEnablement } from "../agents/agent-workflow-enablement.js";
import { FileAutomationStore, getAgentAutomationsDir } from "../automations/automation-store.js";
import { getManagedSkillFilePath, getManagedSkillsCachePath, getManagedSkillsDir, readManagedSkillsCache, type ManagedSkill } from "../extensions/managed-setup/managed-skills-cache.js";
import { getPluginSkillsCachePath, getPluginSkillsDir, readPluginSkillsCache, type PluginSkillRecord, type PluginSkillsCache } from "../extensions/mcp/plugin-skills-cache.js";
import { isSafeFolderId } from "../storage/folder-id.js";
import { WatchedDirectory } from "../watched-directory.js";
import { GlobalWorkflowLibrary, type GlobalWorkflowRecord } from "./workflow-library.js";
import { StatKeyedParseCache } from "./stat-keyed-parse-cache.js";

export const LEGACY_WORKFLOWS_DIRNAME = "workflows";
export const MANAGED_SKILLS_CHANGE_DEBOUNCE_MS = 50;
const pluginSkillParseCache = new StatKeyedParseCache(); const managedSkillsIndexCache = new StatKeyedParseCache(); const pluginSkillsIndexCache = new StatKeyedParseCache();

export interface LocalSkillFile { path: string; label: string; fallbackName: string }
export interface WorkflowImportResult { id: string; name: string }
interface PluginSkillFacts extends WorkflowScopeFields { name: string; description: string; body: string; disableModelInvocation: boolean; helperScripts: string[] }

export function readPluginSkillFileFacts(filePath: string): PluginSkillFacts | null { let raw: string; try { raw = readFileSync(filePath, "utf8"); } catch { return null; } const parsed = parseWorkflowFile(raw); if (parsed == null || !parsed.body) return null; let helperScripts: string[] = []; try { helperScripts = readdirSync(dirname(filePath), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== "SKILL.md").map((entry) => entry.name).sort(); } catch {} return { ...readWorkflowScopeFields(parsed), name: parsed.name, description: parsed.description, body: parsed.body, disableModelInvocation: parsed.data["disable-model-invocation"] === true, helperScripts }; }
export function agentHasWorkflows(agentDir: string): boolean { if (new AgentWorkflowEnablement(agentDir).hasExplicitEntries()) return true; const legacyDir = join(agentDir, LEGACY_WORKFLOWS_DIRNAME); let entries; try { entries = readdirSync(legacyDir, { withFileTypes: true }); } catch { return false; } for (const entry of entries) { if (!entry.isDirectory()) continue; try { statSync(join(legacyDir, entry.name, LEGACY_WORKFLOW_FILENAME)); return true; } catch {} } return false; }

export class FileWorkflowStore {
  readonly library: GlobalWorkflowLibrary; readonly enablement: AgentWorkflowEnablement; readonly automations: FileAutomationStore; readonly managedDir: string; readonly managedDirWatcher: WatchedDirectory; readonly pluginSkillsDir: string; readonly pluginSkillsDirWatcher: WatchedDirectory;
  constructor(readonly agentDir: string, globalDir: string, resolveUserTimeZone: () => string | undefined = () => undefined) { const sandRoot = dirname(globalDir), debounce = (name: string) => createDebouncePolicy(realClock, { name, delayMs: MANAGED_SKILLS_CHANGE_DEBOUNCE_MS }); this.library = new GlobalWorkflowLibrary(globalDir); this.managedDir = getManagedSkillsDir(sandRoot); this.managedDirWatcher = new WatchedDirectory(this.managedDir, debounce("sand-managed-skills-change")); this.pluginSkillsDir = getPluginSkillsDir(sandRoot); this.pluginSkillsDirWatcher = new WatchedDirectory(this.pluginSkillsDir, debounce("sand-plugin-skills-change")); this.enablement = new AgentWorkflowEnablement(agentDir); this.automations = new FileAutomationStore(getAgentAutomationsDir(agentDir), resolveUserTimeZone); this.migrateLegacyPerAgentWorkflows(); }
  getLocation(): string { return this.library.getLocation(); }
  setOnChange(onChange?: (() => void) | null): void { this.library.setOnChange(onChange); this.managedDirWatcher.setOnChange(onChange); this.pluginSkillsDirWatcher.setOnChange(onChange); this.automations.setOnChange(onChange); }
  skillToWorkflow(record: GlobalWorkflowRecord): WorkflowRecord { return { ...readWorkflowScopeFields(record), id: record.id, name: record.name, description: record.description, body: record.body, trigger: null, source: "workflow", sourceRef: record.sourceRef, disableModelInvocation: record.disableModelInvocation, pluginId: null, publishedByCurrentUser: false, isEnabledForAgent: this.enablement.isEnabled(record.id), scheduleDescription: null, createdAt: record.createdAt, lastRunAt: null, nextRunAt: null, helperScripts: record.helperScripts, runs: [], filePath: record.filePath }; }
  managedSkillToWorkflow(skill: ManagedSkill, fetchedAt: number): WorkflowRecord { const skillFilePath = getManagedSkillFilePath(this.managedDir, skill.id); let hasSkillFile = false; try { hasSkillFile = statSync(skillFilePath).isFile(); } catch {} return { ...readWorkflowScopeFields(skill), id: skill.id, name: skill.name, description: skill.description, body: skill.body, trigger: null, source: "managed", sourceRef: null, pluginId: null, publishedByCurrentUser: false, isEnabledForAgent: true, scheduleDescription: null, createdAt: fetchedAt, lastRunAt: null, nextRunAt: null, helperScripts: [], runs: [], filePath: hasSkillFile ? skillFilePath : getManagedSkillsCachePath(this.managedDir) }; }
  readManagedSkillsIndex() { return managedSkillsIndexCache.read([getManagedSkillsCachePath(this.managedDir)], () => readManagedSkillsCache(this.managedDir)); }
  readPluginSkillsIndex() { return pluginSkillsIndexCache.read([getPluginSkillsCachePath(this.pluginSkillsDir)], () => readPluginSkillsCache(this.pluginSkillsDir)); }
  managedWorkflows(excludedIds = new Set<string>()): WorkflowRecord[] { const cache = this.readManagedSkillsIndex(); return cache == null ? [] : cache.skills.filter((skill) => !excludedIds.has(skill.id)).map((skill) => this.managedSkillToWorkflow(skill, cache.fetchedAt)); }
  pluginSkillToWorkflow(record: PluginSkillRecord, index: PluginSkillsCache): WorkflowRecord | null { const facts = pluginSkillParseCache.read([record.filePath, dirname(record.filePath)], () => readPluginSkillFileFacts(record.filePath)); if (facts == null) return null; return { ...readWorkflowScopeFields(facts), id: record.id, name: facts.name || record.name, description: facts.description || record.description, body: facts.body, trigger: null, source: "plugin", sourceRef: null, pluginId: record.pluginId, publishedByCurrentUser: record.publisherUserId != null && record.publisherUserId === index.currentUserId, isEnabledForAgent: true, disableModelInvocation: facts.disableModelInvocation, scheduleDescription: null, createdAt: index.fetchedAt, lastRunAt: null, nextRunAt: null, helperScripts: facts.helperScripts, runs: [], filePath: record.filePath }; }
  pluginWorkflows(excludedIds = new Set<string>()): WorkflowRecord[] { const cache = this.readPluginSkillsIndex(); if (cache == null) return []; return cache.skills.flatMap((record) => { if (excludedIds.has(record.id)) return []; const workflow = this.pluginSkillToWorkflow(record, cache); return workflow == null ? [] : [workflow]; }); }
  pluginSkillRecord(id: string): PluginSkillRecord | null { return this.readPluginSkillsIndex()?.skills.find((record) => record.id === id) ?? null; }
  listAll(): WorkflowRecord[] { return this.listAllFrom(false); }
  listAllFrom(definitionsOnly: boolean): WorkflowRecord[] { const records = this.library.list(), userIds = new Set(records.map((record) => record.id)), skills = records.map((record) => this.skillToWorkflow(record)), managed = this.managedWorkflows(userIds), claimed = new Set([...userIds, ...managed.map((workflow) => workflow.id)]), plugins = this.pluginWorkflows(claimed), autos = (definitionsOnly ? this.automations.listDefinitions() : this.automations.list()).map(automationToWorkflow); return [...managed, ...plugins, ...skills, ...autos]; }
  list(): WorkflowRecord[] { return this.listAllFrom(true).filter((workflow) => workflow.isEnabledForAgent || workflow.source === "automation"); }
  get(id: string): WorkflowRecord | null { const record = this.library.get(id); if (record != null) return this.skillToWorkflow(record); const managed = this.managedWorkflows().find((workflow) => workflow.id === id); if (managed != null) return managed; const plugin = this.pluginWorkflows().find((workflow) => workflow.id === id); if (plugin != null) return plugin; const automation = this.automations.get(id); return automation == null ? null : automationToWorkflow(automation); }
  create(spec: WorkflowSpec): WorkflowRecord | null { const name = clampWorkflowName(spec.name); if (!name) return null; if (spec.trigger != null) return this.createAutomation({ ...spec, name }); const body = clampWorkflowBody(spec.body); if (!body) return null; const record = this.library.create({ ...readWorkflowScopeFields(spec), name, description: spec.description, body, trigger: null, sourceRef: spec.sourceRef ?? null }); if (record == null) return null; this.enablement.setEnabled(record.id, true); return this.skillToWorkflow(record); }
  createAutomation(spec: WorkflowSpec): WorkflowRecord | null { if (spec.trigger == null) return null; const automation = this.automations.upsert({ name: spec.name, prompt: spec.body, trigger: cronTrigger(spec.trigger.schedule), isEnabled: spec.trigger.isEnabled }); return automation == null ? null : automationToWorkflow(automation); }
  update(id: string, spec: WorkflowSpec): WorkflowRecord | null { const current = this.get(id), name = clampWorkflowName(spec.name); if (current == null || !name) return null; if (current.source === "automation") { const enabled = spec.trigger?.isEnabled ?? current.trigger?.isEnabled ?? true, schedule = spec.trigger?.schedule ?? current.trigger?.schedule ?? "", existing = this.automations.get(id), trigger = schedule.trim() ? cronTrigger(schedule) : existing?.trigger ?? cronTrigger(""); const automation = this.automations.update(id, { name, prompt: spec.body, trigger, isEnabled: enabled }); return automation == null ? null : automationToWorkflow(automation); } const body = clampWorkflowBody(spec.body); if (!body) return null; if (current.source === "plugin") return current.publishedByCurrentUser ? this.updatePluginSkill(id, { ...readWorkflowScopeFields(spec), name, description: spec.description, body, trigger: null }) : null; const record = this.library.update(id, { ...readWorkflowScopeFields(spec), name, description: spec.description, body, trigger: null, sourceRef: spec.sourceRef === undefined ? current.sourceRef : spec.sourceRef }); return record == null ? null : this.skillToWorkflow(record); }
  updatePluginSkill(id: string, spec: WorkflowSpec): WorkflowRecord | null { const record = this.pluginSkillRecord(id); if (record == null) return null; let existing: Record<string, unknown>; try { existing = parseWorkflowFile(readFileSync(record.filePath, "utf8"))?.data ?? {}; } catch { return null; } this.pluginSkillsDirWatcher.writeFileAtomic(record.filePath, serializeWorkflowFile({ ...spec, trigger: null }, existing)); return this.get(id); }
  setEnabledForAgent(id: string, enabled: boolean): WorkflowRecord | null { const workflow = this.get(id); if (workflow?.source === "managed" || workflow?.source === "plugin") return workflow; if (this.library.get(id) == null) return null; this.enablement.setEnabled(id, enabled); return this.get(id); }
  setTriggerEnabled(id: string, enabled: boolean): WorkflowRecord | null { const automation = this.automations.setEnabled(id, enabled); return automation == null ? null : automationToWorkflow(automation); }
  remove(id: string): boolean { const source = this.get(id)?.source; if (source === "managed" || source === "plugin") return false; if (this.library.get(id) != null) { this.enablement.forget(id); return this.library.remove(id); } return this.automations.remove(id); }
  importMarkdown(markdown: string, fallbackName?: string): WorkflowImportResult | null { const spec = workflowSpecFromMarkdown(markdown, fallbackName); if (spec == null) return null; const record = this.library.create({ ...spec, trigger: null }, parseWorkflowFile(markdown)?.data ?? {}); if (record == null) return null; this.enablement.setEnabled(record.id, true); return { id: record.id, name: record.name }; }
  importLiveSource(source: string, fallbackName?: string): WorkflowImportResult | null { const trimmed = source.trim(), name = clampWorkflowName(fallbackName ?? deriveWorkflowNameFromUrl(trimmed)); if (!trimmed || !name) return null; const record = this.library.create(liveWorkflowSpecFromSource({ name, source: trimmed })); if (record == null) return null; this.enablement.setEnabled(record.id, true); return { id: record.id, name: record.name }; }
  portLocalSkills(homeDir: string, cwd: string): { imported: WorkflowImportResult[]; skipped: Array<{ source: string; reason: string }> } { const imported: WorkflowImportResult[] = [], skipped: Array<{ source: string; reason: string }> = []; for (const source of discoverLocalSkillFiles(homeDir, cwd)) { const result = this.importLiveSource(source.path, source.fallbackName); if (result == null) skipped.push({ source: source.label, reason: "could not link" }); else imported.push(result); } return { imported, skipped }; }
  migrateLegacyPerAgentWorkflows(): void {
    const legacyDir = join(this.agentDir, LEGACY_WORKFLOWS_DIRNAME);
    let entries;
    try { entries = readdirSync(legacyDir, { withFileTypes: true }); } catch { return; }
    try { mkdirSync(this.library.getLocation(), { recursive: true }); } catch { return; }
    const enabledIds: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeFolderId(entry.name)) continue;
      const folder = join(legacyDir, entry.name);
      let skillFilename = WORKFLOW_FILENAME;
      try { if (!statSync(join(folder, skillFilename)).isFile()) continue; }
      catch { skillFilename = LEGACY_WORKFLOW_FILENAME; }
      try { if (!parseWorkflowFile(readFileSync(join(folder, skillFilename), "utf8"))?.body) continue; }
      catch { continue; }
      // Every legacy folder owns its contents, even when another agent used the same id.
      let id = entry.name, suffix = 2;
      const collisionBase = slugifyWorkflowName(entry.name);
      try {
        while (lstatSync(this.library.folder(id), { throwIfNoEntry: false }) != null) id = `${collisionBase}-${suffix++}`;
        mkdirSync(this.library.folder(id));
      } catch { continue; }
      const destination = this.library.folder(id);
      let moved = false;
      try {
        try { renameSync(folder, destination); moved = true; }
        catch { cpSync(folder, destination, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true }); }
        if (skillFilename === LEGACY_WORKFLOW_FILENAME) renameSync(join(destination, skillFilename), this.library.path(id));
        if (this.library.get(id) == null) throw new Error("Migrated skill is unreadable");
      } catch {
        if (moved) {
          // Keep the only copy if rollback itself fails; never discard a moved folder.
          try { renameSync(destination, folder); } catch {}
        } else {
          try { rmSync(destination, { recursive: true, force: true }); } catch {}
        }
        continue;
      }
      enabledIds.push(id);
      // Once verified, the destination must survive even if source cleanup fails partway.
      if (!moved) { try { rmSync(folder, { recursive: true }); } catch {} }
    }
    if (enabledIds.length) this.enablement.enableAll(enabledIds);
    // Skipped, unreadable, or failed entries remain available for recovery and retry.
    try { rmdirSync(legacyDir); } catch {}
  }
}

export function discoverLocalSkillFiles(homeDir: string, cwd: string): LocalSkillFile[] { const sources: LocalSkillFile[] = [], seen = new Set<string>(); const add = (file: string, label: string, fallbackName: string) => { if (seen.has(file)) return; seen.add(file); try { if (statSync(file).isFile()) sources.push({ path: file, label, fallbackName }); } catch {} }; for (const dir of [cwd, homeDir]) { add(join(dir, "CLAUDE.md"), `${dir}/CLAUDE.md`, "Claude memory"); add(join(dir, "AGENTS.md"), `${dir}/AGENTS.md`, "Agents memory"); add(join(dir, ".claude", "CLAUDE.md"), `${dir}/.claude/CLAUDE.md`, "Claude memory"); } const rulesDir = join(cwd, ".cursor", "rules"); let entries: import("node:fs").Dirent[] = []; try { entries = readdirSync(rulesDir, { withFileTypes: true }); } catch {} for (const entry of entries) if (entry.isFile() && /\.(mdc|md)$/i.test(entry.name)) add(join(rulesDir, entry.name), `.cursor/rules/${entry.name}`, entry.name.replace(/\.(mdc|md)$/i, "")); return sources; }
