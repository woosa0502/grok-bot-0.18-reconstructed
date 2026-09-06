import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AccountMcpServer, McpConfig } from "../cursor-backend/account-mcp.js";
import type { McpServerConfig } from "./mcp-display-runtime.js";
import type { SandMarketplacePlugin } from "./mcp-marketplace.js";
import type { PluginVariableField } from "./mcp-plugin-variables.js";

// Local plugin / MCP store (parity A7, "플러그인은 로컬로").
//
// Upstream keeps the user's MCP servers and plugin installs on the Cursor account
// backend; the Plugins page (Marketplace / Yours), the agent's MCP management
// tools and the box runtime all read from there. Without an account, everything
// lives under the sand root instead:
//
//   <sandRoot>/mcp.json             { "mcpServers": { "<name>": { command, args, env, cwd } | { url, type, headers } } }
//   <sandRoot>/plugin-catalog.json  { "plugins": [ LocalPluginCatalogEntry ] }   (optional; defaults below)
//   <sandRoot>/plugin-installs.json { "installs": { "<pluginId>": { serverNames, variables, installedAt } } }
//
// A catalog entry carries the exact mcp.json fragment to merge on install; `${KEY}`
// placeholders in args/env/cwd are filled from the install form (`variableFields`).
// Server ids are stable numeric strings derived from the server name so they pass
// the same id validation the account rows do.

export const LOCAL_MCP_CONFIG_FILENAME = "mcp.json";
export const LOCAL_PLUGIN_CATALOG_FILENAME = "plugin-catalog.json";
export const LOCAL_PLUGIN_INSTALLS_FILENAME = "plugin-installs.json";

export type LocalMcpServerConfig = McpServerConfig;

export interface LocalPluginCatalogEntry {
  readonly pluginId: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly logoUrl?: string;
  readonly homepage?: string;
  readonly connectors?: readonly { name: string; description: string }[];
  readonly skills?: readonly { name: string; description: string; sourceUrl?: string }[];
  readonly variableFields?: readonly PluginVariableField[];
  readonly install: { readonly mcpServers: Readonly<Record<string, LocalMcpServerConfig>> };
}

export interface LocalPluginInstallRecord {
  readonly serverNames: readonly string[];
  /** Fingerprints of the configurations this install wrote, not just claimed names. */
  readonly serverConfigHashes?: Readonly<Record<string, string>>;
  readonly variables: Readonly<Record<string, string>>;
  readonly installedAt: number;
}

export interface LocalPluginInstalls { readonly installs: Readonly<Record<string, LocalPluginInstallRecord>> }

/** Built-in catalog: public stdio MCP servers that run through `npx` on the box. */
export const DEFAULT_LOCAL_PLUGIN_CATALOG: readonly LocalPluginCatalogEntry[] = Object.freeze([
  {
    pluginId: "900001",
    name: "filesystem",
    displayName: "Filesystem",
    description: "Read, search and edit files under a folder you choose (official Model Context Protocol server, runs locally with npx).",
    category: "Files",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    connectors: [{ name: "filesystem", description: "File read/write/search tools scoped to the chosen root folder." }],
    variableFields: [{ key: "ROOT", label: "Root folder", placeholder: "/workspace", isRequired: true, isSecret: false, hint: "Only files under this folder are exposed to the bot." }],
    install: { mcpServers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "${ROOT}"] } } },
  },
  {
    pluginId: "900002",
    name: "memory",
    displayName: "Knowledge graph memory",
    description: "A persistent knowledge-graph memory the bot can read and update across conversations (official MCP server).",
    category: "Memory",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    connectors: [{ name: "memory", description: "Entities, relations and observations stored in a local JSON file." }],
    variableFields: [{ key: "MEMORY_FILE_PATH", label: "Memory file", placeholder: "/workspace/.sand/mcp-memory.json", isRequired: false, isSecret: false }],
    install: { mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: { MEMORY_FILE_PATH: "${MEMORY_FILE_PATH}" } } } },
  },
  {
    pluginId: "900003",
    name: "sequential-thinking",
    displayName: "Sequential thinking",
    description: "Structured step-by-step reasoning tool for complex, multi-stage problems (official MCP server).",
    category: "Reasoning",
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    connectors: [{ name: "sequential-thinking", description: "A single tool that records and revises a chain of thoughts." }],
    install: { mcpServers: { "sequential-thinking": { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] } } },
  },
]);

function readTextFile(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read local MCP store file "${path}"; existing data was preserved.`, { cause: error });
  }
}

function parseJsonFile(text: string | null, path: string): unknown {
  if (text === null) return undefined;
  try { return JSON.parse(text); } catch (error) {
    throw new Error(`Invalid JSON in local MCP store file "${path}"; repair this file before editing plugins. Existing data was preserved.`, { cause: error });
  }
}

function readJsonFile(path: string): unknown { return parseJsonFile(readTextFile(path), path); }

const STORE_FILES = [LOCAL_MCP_CONFIG_FILENAME, LOCAL_PLUGIN_INSTALLS_FILENAME] as const;
type StoreFile = typeof STORE_FILES[number];
type StoreSnapshot = Readonly<Record<StoreFile, string | null>>;
interface StoreTransaction { readonly version: 1; readonly pid: number; readonly before: StoreSnapshot; readonly after: StoreSnapshot }
const STORE_TRANSACTION_FILENAME = ".local-mcp-transaction.json";
const activeTransactions = new Set<string>();
const serializeJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const readStoreSnapshot = (root: string): StoreSnapshot => Object.fromEntries(STORE_FILES.map((file) => [file, readTextFile(join(root, file))])) as unknown as StoreSnapshot;

function writeDurableFile(path: string, text: string): void {
  // Never follow a pre-existing staging symlink or overwrite another artifact.
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); }
  catch (error) { try { removeFileIfPresent(path); } catch { /* keep failed writes for recovery */ } throw error; }
  finally { closeSync(fd); }
}

function syncStoreDirectory(root: string): void {
  // Windows does not permit opening directories this way. Individual file fsync
  // and same-directory rename still apply there.
  if (process.platform === "win32") return;
  const fd = openSync(root, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function removeFileIfPresent(path: string): void {
  try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function parseStoreTransaction(raw: unknown, path: string): StoreTransaction {
  const validSnapshot = (value: unknown): value is StoreSnapshot => isRecord(value)
    && STORE_FILES.every((file) => value[file] === null || typeof value[file] === "string");
  if (!isRecord(raw) || raw.version !== 1 || !Number.isInteger(raw.pid) || (raw.pid as number) < 1 || !validSnapshot(raw.before) || !validSnapshot(raw.after)) {
    throw new Error(`Invalid local MCP transaction journal "${path}"; preserve it and repair the store before retrying.`);
  }
  return raw as unknown as StoreTransaction;
}

function restoreStoreBefore(root: string, transaction: StoreTransaction): void {
  // Never replace a file an external editor changed after our transaction began.
  const current = readStoreSnapshot(root);
  for (const file of STORE_FILES) if (current[file] !== transaction.before[file] && current[file] !== transaction.after[file]) {
    throw new Error(`Local MCP transaction recovery found an external change in "${file}"; the file and recovery journal were preserved.`);
  }
  for (const file of [...STORE_FILES].reverse()) {
    if (current[file] === transaction.before[file]) continue;
    const destination = join(root, file);
    const previous = transaction.before[file];
    if (previous === null) removeFileIfPresent(destination);
    else {
      const rollbackPath = `${destination}.rollback.${randomUUID()}.tmp`;
      writeDurableFile(rollbackPath, previous);
      try { renameSync(rollbackPath, destination); }
      finally { try { removeFileIfPresent(rollbackPath); } catch { /* preserve unexpected filesystem objects */ } }
    }
  }
  syncStoreDirectory(root);
}

function recoverLocalStore(root: string): void {
  const journalPath = join(root, STORE_TRANSACTION_FILENAME);
  const text = readTextFile(journalPath);
  if (text === null) return;
  const transaction = parseStoreTransaction(parseJsonFile(text, journalPath), journalPath);
  if (activeTransactions.has(journalPath)) throw new Error("A local MCP store transaction is already running; retry after it finishes.");
  if (transaction.pid !== process.pid) {
    try { process.kill(transaction.pid, 0); throw new Error("Another process is updating the local MCP store; retry after it finishes."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  // Claim recovery separately, so two readers cannot roll back over a new writer.
  // An interrupted recovery leaves this marker and fails closed for inspection.
  const recoveryPath = `${journalPath}.recovery`;
  const claim = openSync(recoveryPath, "wx", 0o600);
  try {
    writeFileSync(claim, String(process.pid), "utf8");
    const current = readStoreSnapshot(root);
    if (!STORE_FILES.every((file) => current[file] === transaction.after[file])) restoreStoreBefore(root, transaction);
    for (const file of STORE_FILES) {
      const tempPath = `${join(root, file)}.tmp`;
      try { if (readTextFile(tempPath) === transaction.after[file]) removeFileIfPresent(tempPath); }
      catch { /* only remove staging files whose contents match this transaction */ }
    }
    removeFileIfPresent(journalPath);
    syncStoreDirectory(root);
  } finally { closeSync(claim); removeFileIfPresent(recoveryPath); }
}

function commitLocalStore(root: string, before: StoreSnapshot, after: StoreSnapshot): void {
  if (STORE_FILES.every((file) => before[file] === after[file])) return;
  mkdirSync(root, { recursive: true });
  const journalPath = join(root, STORE_TRANSACTION_FILENAME);
  const journalStage = `${journalPath}.${process.pid}.${randomUUID()}.tmp`;
  const transaction: StoreTransaction = { version: 1, pid: process.pid, before, after };
  writeDurableFile(journalStage, serializeJson(transaction));
  try {
    // Hard-link publication is atomic and exclusive: another writer cannot
    // replace this journal while it owns the two-file transaction.
    linkSync(journalStage, journalPath);
  } finally { removeFileIfPresent(journalStage); }
  activeTransactions.add(journalPath);
  const staged: string[] = [];
  let committed = false;
  let replacing = false;
  try {
    syncStoreDirectory(root);
    const current = readStoreSnapshot(root);
    if (!STORE_FILES.every((file) => current[file] === before[file])) throw new Error("Local MCP store changed during editing; retry with the current configuration.");
    // Stage BOTH files before the first replacement. A full disk, directory at
    // a staging path, or permission failure cannot leave a half install.
    for (const file of STORE_FILES) {
      if (after[file] === before[file]) continue;
      if (after[file] === null) throw new Error("A plugin transaction cannot remove a store file.");
      const tempPath = `${join(root, file)}.tmp`;
      writeDurableFile(tempPath, after[file]);
      staged.push(tempPath);
    }
    replacing = true;
    for (const file of STORE_FILES) if (after[file] !== before[file]) renameSync(`${join(root, file)}.tmp`, join(root, file));
    syncStoreDirectory(root);
    committed = true;
    removeFileIfPresent(journalPath);
    syncStoreDirectory(root);
  } catch (error) {
    if (!committed) {
      try { if (replacing) restoreStoreBefore(root, transaction); removeFileIfPresent(journalPath); syncStoreDirectory(root); }
      catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Local MCP transaction failed and recovery is pending in "${journalPath}". Existing snapshots were preserved; fix the filesystem error and retry.`);
      }
    }
    throw error;
  } finally {
    activeTransactions.delete(journalPath);
    for (const path of staged) { try { removeFileIfPresent(path); } catch { /* preserve unexpected filesystem objects */ } }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [[key, String(item)] as const] : []);
  return entries.length === 0 ? {} : Object.fromEntries(entries);
}

export function normalizeLocalMcpServerConfig(value: unknown): LocalMcpServerConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.command === "string" && value.command.length > 0) {
    const env = stringMap(value.env);
    return {
      command: value.command,
      ...(Array.isArray(value.args) ? { args: value.args.map(String) } : {}),
      ...(env === undefined ? {} : { env }),
      ...(typeof value.cwd === "string" && value.cwd.length > 0 ? { cwd: value.cwd } : {}),
    };
  }
  if (typeof value.url === "string" && value.url.length > 0) {
    const headers = stringMap(value.headers);
    const auth = isRecord(value.auth) && typeof value.auth.CLIENT_ID === "string" ? {
      CLIENT_ID: value.auth.CLIENT_ID,
      ...(typeof value.auth.CLIENT_SECRET === "string" ? { CLIENT_SECRET: value.auth.CLIENT_SECRET } : {}),
      ...(Array.isArray(value.auth.scopes) && value.auth.scopes.every((scope) => typeof scope === "string") ? { scopes: value.auth.scopes } : {}),
    } : undefined;
    const tls = isRecord(value.tls) && typeof value.tls.caBundle === "string" ? { caBundle: value.tls.caBundle } : undefined;
    return {
      url: value.url,
      ...(value.type === "sse" || value.type === "http" ? { type: value.type } : {}),
      ...(headers === undefined ? {} : { headers }),
      ...(auth === undefined ? {} : { auth }),
      ...(tls === undefined ? {} : { tls }),
    };
  }
  return undefined;
}

function parseLocalMcpConfig(parsed: unknown, strict = false): McpConfig {
  if (parsed !== undefined && (!isRecord(parsed) || !isRecord(parsed.mcpServers))) throw new Error(`Invalid ${LOCAL_MCP_CONFIG_FILENAME}: expected an mcpServers object; existing data was preserved.`);
  const raw = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    const config = normalizeLocalMcpServerConfig(value);
    if (strict && (config === undefined || name.trim().length === 0)) throw new Error(`Invalid MCP server "${name}" in ${LOCAL_MCP_CONFIG_FILENAME}; existing data was preserved.`);
    if (config !== undefined && name.trim().length > 0) mcpServers[name] = config;
  }
  return { mcpServers };
}

export function readLocalMcpConfig(sandRoot: string): McpConfig {
  recoverLocalStore(sandRoot);
  return parseLocalMcpConfig(readJsonFile(join(sandRoot, LOCAL_MCP_CONFIG_FILENAME)));
}

export function writeLocalMcpConfig(sandRoot: string, config: McpConfig): void {
  mutateLocalStore(sandRoot, () => ({ config }));
}

function parseLocalPluginInstalls(parsed: unknown): LocalPluginInstalls {
  const invalid = () => new Error(`Invalid ${LOCAL_PLUGIN_INSTALLS_FILENAME}: install ownership cannot be read; repair the ledger before editing plugins. Existing data was preserved.`);
  if (parsed !== undefined && (!isRecord(parsed) || !isRecord(parsed.installs))) throw invalid();
  const installs: Record<string, LocalPluginInstallRecord> = {};
  if (isRecord(parsed) && isRecord(parsed.installs)) {
    for (const [pluginId, value] of Object.entries(parsed.installs)) {
      if (!isRecord(value) || !Array.isArray(value.serverNames) || !value.serverNames.every((name) => typeof name === "string" && name.trim().length > 0)) throw invalid();
      if (value.variables !== undefined && (!isRecord(value.variables) || !Object.values(value.variables).every((entry) => ["string", "number", "boolean"].includes(typeof entry)))) throw invalid();
      if (value.installedAt !== undefined && (typeof value.installedAt !== "number" || !Number.isFinite(value.installedAt))) throw invalid();
      if (value.serverConfigHashes !== undefined && (!isRecord(value.serverConfigHashes) || !Object.values(value.serverConfigHashes).every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)))) throw invalid();
      installs[pluginId] = {
        serverNames: value.serverNames.map(String),
        ...(isRecord(value.serverConfigHashes) ? { serverConfigHashes: stringMap(value.serverConfigHashes) ?? {} } : {}),
        variables: stringMap(value.variables) ?? {},
        installedAt: typeof value.installedAt === "number" ? value.installedAt : 0,
      };
    }
  }
  return { installs };
}

export function readLocalPluginInstalls(sandRoot: string): LocalPluginInstalls {
  recoverLocalStore(sandRoot);
  return parseLocalPluginInstalls(readJsonFile(join(sandRoot, LOCAL_PLUGIN_INSTALLS_FILENAME)));
}

export function writeLocalPluginInstalls(sandRoot: string, installs: LocalPluginInstalls): void {
  mutateLocalStore(sandRoot, () => ({ installs }));
}

function mutateLocalStore(sandRoot: string, change: (config: McpConfig, installs: LocalPluginInstalls) => { config?: McpConfig; installs?: LocalPluginInstalls }): void {
  recoverLocalStore(sandRoot);
  const before = readStoreSnapshot(sandRoot);
  const config = parseLocalMcpConfig(parseJsonFile(before[LOCAL_MCP_CONFIG_FILENAME], join(sandRoot, LOCAL_MCP_CONFIG_FILENAME)), true);
  const installs = parseLocalPluginInstalls(parseJsonFile(before[LOCAL_PLUGIN_INSTALLS_FILENAME], join(sandRoot, LOCAL_PLUGIN_INSTALLS_FILENAME)));
  const changed = change(config, installs);
  // Validate the complete next state before publishing a journal or a temp file.
  if (changed.config !== undefined) parseLocalMcpConfig(changed.config, true);
  if (changed.installs !== undefined) parseLocalPluginInstalls(changed.installs);
  commitLocalStore(sandRoot, before, {
    [LOCAL_MCP_CONFIG_FILENAME]: changed.config === undefined ? before[LOCAL_MCP_CONFIG_FILENAME] : serializeJson(changed.config),
    [LOCAL_PLUGIN_INSTALLS_FILENAME]: changed.installs === undefined ? before[LOCAL_PLUGIN_INSTALLS_FILENAME] : serializeJson(changed.installs),
  });
}

function normalizeCatalogEntry(value: unknown): LocalPluginCatalogEntry | undefined {
  if (!isRecord(value)) return undefined;
  const pluginId = typeof value.pluginId === "string" ? value.pluginId.trim() : typeof value.pluginId === "number" ? String(value.pluginId) : "";
  if (!/^\d+$/.test(pluginId) || typeof value.name !== "string" || !isRecord(value.install) || !isRecord(value.install.mcpServers)) return undefined;
  const mcpServers: Record<string, LocalMcpServerConfig> = {};
  for (const [name, config] of Object.entries(value.install.mcpServers)) {
    const normalized = normalizeLocalMcpServerConfig(config);
    if (normalized !== undefined) mcpServers[name] = normalized;
  }
  if (Object.keys(mcpServers).length === 0) return undefined;
  const fields = Array.isArray(value.variableFields)
    ? value.variableFields.flatMap((field): PluginVariableField[] => isRecord(field) && typeof field.key === "string"
      ? [{ key: field.key, label: typeof field.label === "string" ? field.label : field.key, placeholder: typeof field.placeholder === "string" ? field.placeholder : "", isRequired: field.isRequired === true, isSecret: field.isSecret === true, ...(typeof field.hint === "string" ? { hint: field.hint } : {}), ...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}) }]
      : [])
    : [];
  return {
    pluginId,
    name: value.name,
    displayName: typeof value.displayName === "string" ? value.displayName : value.name,
    description: typeof value.description === "string" ? value.description : "",
    category: typeof value.category === "string" ? value.category : "Local",
    ...(typeof value.logoUrl === "string" ? { logoUrl: value.logoUrl } : {}),
    ...(typeof value.homepage === "string" ? { homepage: value.homepage } : {}),
    connectors: Array.isArray(value.connectors) ? value.connectors.flatMap((item) => isRecord(item) && typeof item.name === "string" ? [{ name: item.name, description: typeof item.description === "string" ? item.description : "" }] : []) : [],
    skills: Array.isArray(value.skills)
      ? value.skills.flatMap((item) => isRecord(item) && typeof item.name === "string"
        ? [{ name: item.name, description: typeof item.description === "string" ? item.description : "", ...(typeof item.sourceUrl === "string" ? { sourceUrl: item.sourceUrl } : {}) }]
        : [])
      : [],
    variableFields: fields,
    install: { mcpServers },
  };
}

/** The user's catalog file (if any) followed by the built-in entries it does not override. */
export function readLocalPluginCatalog(sandRoot: string): LocalPluginCatalogEntry[] {
  const parsed = readJsonFile(join(sandRoot, LOCAL_PLUGIN_CATALOG_FILENAME));
  const custom = isRecord(parsed) && Array.isArray(parsed.plugins) ? parsed.plugins.flatMap((entry) => { const normalized = normalizeCatalogEntry(entry); return normalized === undefined ? [] : [normalized]; }) : [];
  const seen = new Set(custom.map((entry) => entry.pluginId));
  return [...custom, ...DEFAULT_LOCAL_PLUGIN_CATALOG.filter((entry) => !seen.has(entry.pluginId))];
}

export function localCatalogEntryToMarketplacePlugin(entry: LocalPluginCatalogEntry): SandMarketplacePlugin {
  return {
    pluginId: entry.pluginId,
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    category: entry.category,
    logoUrl: entry.logoUrl,
    homepage: entry.homepage,
    sourceUrls: [],
    connectors: [...(entry.connectors ?? [])],
    skills: [...(entry.skills ?? [])],
    variableFields: [...(entry.variableFields ?? [])],
    marketplace: { name: "local", displayName: "Local", ownership: "user" },
    publisher: { name: "local", displayName: "This computer", isUserOwned: true },
  };
}

/** Stable numeric id for a local server name (passes the account-row id validation). */
export function localMcpServerId(name: string): string {
  const hex = createHash("sha1").update(`local-mcp:${name}`).digest("hex").slice(0, 12);
  return BigInt(`0x${hex}`).toString();
}

export function localMcpServerIdsByName(config: McpConfig): Record<string, bigint> {
  return Object.fromEntries(Object.keys(config.mcpServers).map((name) => [name, BigInt(localMcpServerId(name))]));
}

export function localMcpServersFromConfig(config: McpConfig, installs: LocalPluginInstalls = { installs: {} }): AccountMcpServer[] {
  return Object.entries(config.mcpServers).map(([name, serverConfig]) => {
    const claimants = Object.entries(installs.installs).filter(([, record]) => record.serverNames.includes(name));
    const claimant = claimants.length === 1 ? claimants[0] : undefined;
    // Legacy records may still label an unambiguous install, but cannot authorize
    // destructive writes. Conflicting claims or an edited config are unowned.
    const pluginId = claimant !== undefined && (claimant[1].serverConfigHashes === undefined || claimant[1].serverConfigHashes[name] === serverConfigHash(serverConfig)) ? claimant[0] : undefined;
    return {
      id: localMcpServerId(name),
      name,
      serverIdentifier: name,
      config: serverConfig,
      isTeamServer: false,
      disabledByTeamAdminPolicy: false,
      ...(pluginId === undefined ? {} : { pluginId }),
    };
  });
}

export function substituteInstallVariables(fragment: LocalMcpServerConfig, variables: Readonly<Record<string, string>>): LocalMcpServerConfig {
  const fill = (text: string) => text.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key: string) => variables[key] ?? match);
  if ("command" in fragment) {
    const env = fragment.env === undefined ? undefined : Object.fromEntries(Object.entries(fragment.env).map(([key, value]) => [key, fill(value)]));
    return {
      command: fill(fragment.command),
      ...(fragment.args === undefined ? {} : { args: fragment.args.map(fill) }),
      ...(env === undefined ? {} : { env }),
      ...(fragment.cwd === undefined ? {} : { cwd: fill(fragment.cwd) }),
    };
  }
  const headers = fragment.headers === undefined ? undefined : Object.fromEntries(Object.entries(fragment.headers).map(([key, value]) => [key, fill(value)]));
  const auth = fragment.auth === undefined ? undefined : {
    CLIENT_ID: fill(fragment.auth.CLIENT_ID),
    ...(fragment.auth.CLIENT_SECRET === undefined ? {} : { CLIENT_SECRET: fill(fragment.auth.CLIENT_SECRET) }),
    ...(fragment.auth.scopes === undefined ? {} : { scopes: fragment.auth.scopes.map(fill) }),
  };
  return { url: fill(fragment.url), ...(fragment.type === undefined ? {} : { type: fragment.type }), ...(headers === undefined ? {} : { headers }), ...(auth === undefined ? {} : { auth }), ...(fragment.tls === undefined ? {} : { tls: { caBundle: fill(fragment.tls.caBundle) } }) };
}

/** Drop env entries whose value is still an unfilled `${KEY}` (optional variables left blank). */
function dropUnfilledEnv(config: LocalMcpServerConfig): LocalMcpServerConfig {
  if (!("command" in config) || config.env === undefined) return config;
  const env = Object.fromEntries(Object.entries(config.env).filter(([, value]) => !/^\$\{[A-Z0-9_]+\}$/.test(value)));
  return { ...config, ...(Object.keys(env).length === 0 ? { env: undefined } : { env }) } as LocalMcpServerConfig;
}

function serverConfigHash(config: AccountMcpServer["config"]): string {
  // Normalize optional fields and object ordering so a harmless JSON rewrite does
  // not detach ownership. Arrays (notably command arguments) retain their order.
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : isRecord(value)
      ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
      : value;
  return createHash("sha256").update(JSON.stringify(canonical(normalizeLocalMcpServerConfig(config)))).digest("hex");
}

function ownsInstalledServer(pluginId: string, name: string, config: McpConfig, installs: LocalPluginInstalls): boolean {
  const record = installs.installs[pluginId];
  const current = config.mcpServers[name];
  return record !== undefined && record.serverNames.includes(name) && current !== undefined
    && record.serverConfigHashes?.[name] === serverConfigHash(current)
    && !Object.entries(installs.installs).some(([otherId, other]) => otherId !== pluginId && other.serverNames.includes(name));
}

export function localEffectivePlugins(sandRoot: string): Array<{ pluginId: string; installMode: "user"; isEnabled: true }> {
  return Object.keys(readLocalPluginInstalls(sandRoot).installs).map((pluginId) => ({ pluginId, installMode: "user" as const, isEnabled: true as const }));
}

/** The account-writer contract (see cursor-backend/account-mcp.ts createAccountMcpWriter) over local files. */
export function createLocalMcpWriter(sandRoot: string, options: { readonly catalog?: () => readonly LocalPluginCatalogEntry[]; readonly now?: () => number } = {}) {
  const catalog = options.catalog ?? (() => readLocalPluginCatalog(sandRoot));
  const now = options.now ?? Date.now;
  const requireEntry = (pluginId: bigint): LocalPluginCatalogEntry => {
    const entry = catalog().find((candidate) => candidate.pluginId === pluginId.toString());
    if (entry === undefined) throw new Error(`Unknown local plugin "${pluginId.toString()}". Add it to ${LOCAL_PLUGIN_CATALOG_FILENAME} or pick one from the Marketplace tab.`);
    return entry;
  };
  const renderServers = (entry: LocalPluginCatalogEntry, variables: Readonly<Record<string, string>>): Record<string, LocalMcpServerConfig> =>
    Object.fromEntries(Object.entries(entry.install.mcpServers).map(([name, fragment]) => [name, dropUnfilledEnv(substituteInstallVariables(fragment, variables))]));
  const removeServers = (config: McpConfig, names: readonly string[]): McpConfig => {
    const mcpServers = { ...config.mcpServers };
    for (const name of names) delete mcpServers[name];
    return { mcpServers };
  };
  return {
    async getConfigForEdit() {
      const config = readLocalMcpConfig(sandRoot);
      return { config, serverIdsByName: localMcpServerIdsByName(config) };
    },
    async setConfig(config: McpConfig, _serverIdsByName: Readonly<Record<string, bigint>>) {
      writeLocalMcpConfig(sandRoot, config);
    },
    async installPlugin(args: { pluginId: bigint; variables?: Readonly<Record<string, string>> }) {
      const entry = requireEntry(args.pluginId);
      const variables = { ...(args.variables ?? {}) };
      const rendered = renderServers(entry, variables);
      mutateLocalStore(sandRoot, (existingConfig, installs) => {
        const previous = installs.installs[entry.pluginId];
        // Validate the complete replacement before writing either file. A server
        // name alone never grants permission to overwrite another plugin or a
        // manually edited server (including ambiguous pre-fingerprint installs).
        for (const name of new Set([...(previous?.serverNames ?? []), ...Object.keys(rendered)])) {
          const otherOwners = Object.entries(installs.installs).filter(([id, record]) => id !== entry.pluginId && record.serverNames.includes(name)).map(([id]) => id);
          if (otherOwners.length > 0 || (existingConfig.mcpServers[name] !== undefined && !ownsInstalledServer(entry.pluginId, name, existingConfig, installs))) {
            const reason = otherOwners.length > 0 ? `claimed by plugin ${otherOwners.join(", ")}` : "manual, modified, or legacy ownership cannot be verified";
            throw new Error(`Cannot install or update local plugin "${entry.pluginId}": MCP server "${name}" already exists (${reason}). Rename the conflicting server or resolve its install record first; no configuration was changed.`);
          }
        }
        const config = removeServers(existingConfig, previous?.serverNames ?? []);
        return {
          config: { mcpServers: { ...config.mcpServers, ...rendered } },
          installs: { installs: { ...installs.installs, [entry.pluginId]: { serverNames: Object.keys(rendered), serverConfigHashes: Object.fromEntries(Object.entries(rendered).map(([name, config]) => [name, serverConfigHash(config)])), variables, installedAt: previous?.installedAt ?? now() } } },
        };
      });
    },
    async uninstallPlugin(args: { pluginId: bigint }) {
      const pluginId = args.pluginId.toString();
      mutateLocalStore(sandRoot, (config, installs) => {
        const record = installs.installs[pluginId];
        if (record === undefined) return {};
        // Forget ambiguous/legacy installs without deleting servers we cannot prove
        // belong to them. The user can still remove those servers explicitly.
        const ownedNames = record.serverNames.filter((name) => ownsInstalledServer(pluginId, name, config, installs));
        const remaining = { ...installs.installs };
        delete remaining[pluginId];
        return { ...(ownedNames.length > 0 ? { config: removeServers(config, ownedNames) } : {}), installs: { installs: remaining } };
      });
    },
    async updatePluginInstall(args: { pluginId: bigint; variables: Readonly<Record<string, string>> }) {
      await this.installPlugin({ pluginId: args.pluginId, variables: args.variables });
    },
  };
}

export type LocalMcpWriter = ReturnType<typeof createLocalMcpWriter>;
