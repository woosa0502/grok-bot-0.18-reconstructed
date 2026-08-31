import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function readJsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

function writeJsonFileAtomic(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
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
    return {
      url: value.url,
      ...(value.type === "sse" || value.type === "http" ? { type: value.type } : {}),
      ...(headers === undefined ? {} : { headers }),
    };
  }
  return undefined;
}

export function readLocalMcpConfig(sandRoot: string): McpConfig {
  const parsed = readJsonFile(join(sandRoot, LOCAL_MCP_CONFIG_FILENAME));
  const raw = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    const config = normalizeLocalMcpServerConfig(value);
    if (config !== undefined && name.trim().length > 0) mcpServers[name] = config;
  }
  return { mcpServers };
}

export function writeLocalMcpConfig(sandRoot: string, config: McpConfig): void {
  writeJsonFileAtomic(join(sandRoot, LOCAL_MCP_CONFIG_FILENAME), { mcpServers: config.mcpServers });
}

export function readLocalPluginInstalls(sandRoot: string): LocalPluginInstalls {
  const parsed = readJsonFile(join(sandRoot, LOCAL_PLUGIN_INSTALLS_FILENAME));
  const installs: Record<string, LocalPluginInstallRecord> = {};
  if (isRecord(parsed) && isRecord(parsed.installs)) {
    for (const [pluginId, value] of Object.entries(parsed.installs)) {
      if (!isRecord(value) || !Array.isArray(value.serverNames)) continue;
      installs[pluginId] = {
        serverNames: value.serverNames.map(String),
        variables: stringMap(value.variables) ?? {},
        installedAt: typeof value.installedAt === "number" ? value.installedAt : 0,
      };
    }
  }
  return { installs };
}

export function writeLocalPluginInstalls(sandRoot: string, installs: LocalPluginInstalls): void {
  writeJsonFileAtomic(join(sandRoot, LOCAL_PLUGIN_INSTALLS_FILENAME), installs);
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
  const pluginByServer = new Map<string, string>();
  for (const [pluginId, record] of Object.entries(installs.installs)) for (const name of record.serverNames) pluginByServer.set(name, pluginId);
  return Object.entries(config.mcpServers).map(([name, serverConfig]) => {
    const pluginId = pluginByServer.get(name);
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
  return { url: fill(fragment.url), ...(fragment.type === undefined ? {} : { type: fragment.type }), ...(headers === undefined ? {} : { headers }) };
}

/** Drop env entries whose value is still an unfilled `${KEY}` (optional variables left blank). */
function dropUnfilledEnv(config: LocalMcpServerConfig): LocalMcpServerConfig {
  if (!("command" in config) || config.env === undefined) return config;
  const env = Object.fromEntries(Object.entries(config.env).filter(([, value]) => !/^\$\{[A-Z0-9_]+\}$/.test(value)));
  return { ...config, ...(Object.keys(env).length === 0 ? { env: undefined } : { env }) } as LocalMcpServerConfig;
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
      const installs = readLocalPluginInstalls(sandRoot);
      const previous = installs.installs[entry.pluginId];
      const config = removeServers(readLocalMcpConfig(sandRoot), previous?.serverNames ?? []);
      writeLocalMcpConfig(sandRoot, { mcpServers: { ...config.mcpServers, ...rendered } });
      writeLocalPluginInstalls(sandRoot, { installs: { ...installs.installs, [entry.pluginId]: { serverNames: Object.keys(rendered), variables, installedAt: previous?.installedAt ?? now() } } });
    },
    async uninstallPlugin(args: { pluginId: bigint }) {
      const pluginId = args.pluginId.toString();
      const installs = readLocalPluginInstalls(sandRoot);
      const record = installs.installs[pluginId];
      if (record === undefined) return;
      writeLocalMcpConfig(sandRoot, removeServers(readLocalMcpConfig(sandRoot), record.serverNames));
      const remaining = { ...installs.installs };
      delete remaining[pluginId];
      writeLocalPluginInstalls(sandRoot, { installs: remaining });
    },
    async updatePluginInstall(args: { pluginId: bigint; variables: Readonly<Record<string, string>> }) {
      await this.installPlugin({ pluginId: args.pluginId, variables: args.variables });
    },
  };
}

export type LocalMcpWriter = ReturnType<typeof createLocalMcpWriter>;
