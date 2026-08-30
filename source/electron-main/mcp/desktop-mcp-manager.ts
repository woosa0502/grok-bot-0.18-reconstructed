import { DashboardService } from "../../packages/proto/generated/aiserver/v1/dashboard_connect.js";
import { McpError, McpResult } from "../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { reportDesktopEdgeFailure } from "../desktop-edge-failures.js";
import { createSandCursorBackendClient, getSandInferenceBackendUrl } from "../../shared/node/cursor-backend/cursor-inference.js";
import {
  createAccountMcpWriter,
  backfillUserPluginInstalls,
  fetchAccountMcpServers,
  fetchEffectiveUserPlugins,
  type AccountMcpClient,
  type AccountMcpDependencies,
} from "../../shared/node/cursor-backend/account-mcp.js";
import {
  createDashboardSandBackendMcpExec,
  type DashboardMcpExecClient,
} from "../../shared/node/cursor-backend/backend-mcp-exec.js";
import { pinMcpDiagnosticsReporter } from "../../shared/node/mcp/mcp-diagnostics.js";
import { getSandRootDir } from "../../host/host-paths.js";
import { isLocalCodexMode, localCodexAccountCacheScope } from "../../shared/node/local-codex-account.js";
import { createLocalMcpWriter, localCatalogEntryToMarketplacePlugin, localEffectivePlugins, localMcpServersFromConfig, readLocalMcpConfig, readLocalPluginCatalog, readLocalPluginInstalls } from "../../shared/node/mcp/local-mcp-store.js";
import { SandMcpManager } from "../../shared/node/mcp/mcp-manager.js";
import { createMcpToolsDiscovery } from "../../shared/node/mcp/tools-discovery.js";

export interface DesktopMcpManagerFacade {
  listServers(): Promise<unknown>;
  listEffectivePlugins(): Promise<unknown>;
  getCatalog(getAccessToken: unknown): Promise<unknown>;
  resolvePluginLogo(url: string): Promise<unknown>;
  installEntry(request: unknown, getAccessToken: unknown): Promise<unknown>;
  updatePluginInstall(request: unknown, getAccessToken: unknown): Promise<unknown>;
  removeServer(serverId: string): Promise<unknown>;
  uninstallPlugin(pluginId: string): Promise<unknown>;
  authenticateServer(serverId: string, accountKey: string, trigger?: string): Promise<unknown>;
  renameAccount(args: { serverId: string; accountKey: string; newAccountKey: string }): Promise<unknown>;
  removeAccount(args: { serverId: string; accountKey: string }): Promise<unknown>;
  setServerCustomInstructions(request: unknown): Promise<unknown>;
  listServerTools(serverId: string): Promise<unknown>;
  listRoutedTools(): Promise<unknown>;
  executeRoutedTool(request: {
    readonly providerIdentifier: string;
    readonly name: string;
    readonly toolName: string;
    readonly args: unknown;
    readonly toolCallId: string;
    readonly agentId?: string;
  }): Promise<unknown>;
  toggleMcpToolDisabled(request: unknown): Promise<unknown>;
  setAuthCompletionObserver(observer: (completion: unknown) => void): void;
  dispose(): Promise<void> | void;
}

export interface DesktopMcpManagerOptions {
  readonly settingsStore: unknown;
  readonly onAccountScopeApplied: () => void;
  readonly getAccessToken: (args: { backendUrl: string }) => Promise<string>;
  readonly getMachineId: () => string | Promise<string>;
  readonly listBoxMcpServers: (serverIdentifiers: unknown) => Promise<readonly Record<string, unknown>[]>;
  readonly onConnectorAuth: (report: unknown) => void;
  readonly onMcpDiagnostic?: (failure: { readonly leg: string; readonly errorClass: string }) => void;
}

function generatedAccountClient(credentials: Pick<AccountMcpDependencies, "getAccessToken" | "getMachineId">): AccountMcpClient {
  return createSandCursorBackendClient(DashboardService, {
    getAccessToken: async (options) => await credentials.getAccessToken({ backendUrl: options?.backendUrl }),
    getMachineId: credentials.getMachineId,
  }) as unknown as AccountMcpClient;
}

function generatedBackendClient(credentials: Pick<AccountMcpDependencies, "getAccessToken" | "getMachineId">): DashboardMcpExecClient {
  return createSandCursorBackendClient(DashboardService, {
    getAccessToken: async (options) => await credentials.getAccessToken({ backendUrl: options?.backendUrl }),
    getMachineId: credentials.getMachineId,
  }) as unknown as DashboardMcpExecClient;
}

/** Artifact anchor: electron-main/main.cjs:497780, `async function createSandDesktopMcpManager(options)`. */
export async function createSandDesktopMcpManager(options: DesktopMcpManagerOptions): Promise<DesktopMcpManagerFacade> {
  pinMcpDiagnosticsReporter(options.onMcpDiagnostic ?? null);
  const accountMcpDeps: AccountMcpDependencies = {
    getAccessToken: async (request) => await options.getAccessToken({ backendUrl: request?.backendUrl ?? getSandInferenceBackendUrl() }),
    getMachineId: async () => await options.getMachineId(),
    getBackendUrl: getSandInferenceBackendUrl,
    createClient: generatedAccountClient,
  };
  const backendMcpExec = createDashboardSandBackendMcpExec({
    getAccessToken: accountMcpDeps.getAccessToken,
    getMachineId: accountMcpDeps.getMachineId,
    createClient: generatedBackendClient,
  });
  // Local Codex mode: the Plugins page (Marketplace / Yours) and every mutation are
  // served from local files under the sand root (mcp.json, plugin-catalog.json,
  // plugin-installs.json — shared/node/mcp/local-mcp-store.ts) instead of the Cursor
  // account backend, which needs an access token this build never has.
  const localMode = isLocalCodexMode(process.env);
  const localSandRoot = localMode ? getSandRootDir() : undefined;
  const manager = new SandMcpManager({
    settingsStore: options.settingsStore,
    onAccountScopeApplied: options.onAccountScopeApplied,
    ...(localSandRoot === undefined
      ? {
          accountServersProvider: () => fetchAccountMcpServers(accountMcpDeps),
          accountMcpWriter: createAccountMcpWriter(accountMcpDeps),
          effectivePluginsProvider: () => fetchEffectiveUserPlugins(accountMcpDeps),
        }
      : {
          accountServersProvider: async () => ({
            servers: localMcpServersFromConfig(readLocalMcpConfig(localSandRoot), readLocalPluginInstalls(localSandRoot)),
            cacheScope: localCodexAccountCacheScope(),
          }),
          accountMcpWriter: createLocalMcpWriter(localSandRoot),
          effectivePluginsProvider: async () => localEffectivePlugins(localSandRoot),
          catalog: {
            bestEffortToken: async () => null,
            fetchMarketplace: async () => ({ plugins: readLocalPluginCatalog(localSandRoot).map(localCatalogEntryToMarketplacePlugin), includesPrivateMarketplaces: false }),
            resolveLogo: async () => null,
          },
        }),
    getMachineId: accountMcpDeps.getMachineId,
    backendMcpExec,
    onConnectorAuth: options.onConnectorAuth,
  });
  const discovery = createMcpToolsDiscovery({
    definitionSource: manager.definitionSourceView(),
    lastAccountDisplayConfig: () => manager.lastAccountDisplayConfigView(),
    settingsStore: () => manager.settingsStoreView(),
    backendMcpExec,
  }, {
    boxMcpExec: {
      loadServers: async () => {},
      listTools: async (serverIdentifiers: unknown) => (await options.listBoxMcpServers(serverIdentifiers)).map((server) => ({ ...server, tools: [] })),
      executeTool: async (args: { readonly name: string }) => new McpResult({
        result: {
          case: "error",
          value: new McpError({ error: `MCP tools run on Grok Bot's computer, not the desktop app (tool "${args.name}").` }),
        },
      }),
    },
  });
  manager.setBoxRuntime(discovery);
  let routedToolsSnapshot: unknown[] = [];
  let routedToolsWarm: Promise<unknown[]> | null = null;
  const warmRoutedTools = (): Promise<unknown[]> => routedToolsWarm ??= discovery.getTools().then((tools: unknown[]) => (routedToolsSnapshot = tools), (error: unknown) => {
    routedToolsWarm = null;
    throw error;
  });
  void warmRoutedTools().catch((error: unknown) => reportDesktopEdgeFailure("mcp-manager", "routed-tools-warm", error));
  let hasKickedInstallBackfill = false;
  const kickInstallBackfillOnce = (): void => {
    if (hasKickedInstallBackfill || localMode) return;
    hasKickedInstallBackfill = true;
    void backfillUserPluginInstalls(accountMcpDeps).catch((error: unknown) => reportDesktopEdgeFailure("mcp-manager", "install-backfill", error));
  };
  return {
    listServers: () => {
      kickInstallBackfillOnce();
      return manager.listServers();
    },
    listEffectivePlugins: () => manager.listEffectivePlugins(),
    getCatalog: (getAccessToken) => manager.getCatalog(getAccessToken),
    resolvePluginLogo: (url) => manager.resolvePluginLogo(url),
    installEntry: (request, getAccessToken) => manager.installEntry(request, getAccessToken),
    updatePluginInstall: (request, getAccessToken) => manager.updatePluginInstall(request, getAccessToken),
    removeServer: (serverId) => manager.removeServer(serverId),
    uninstallPlugin: (pluginId) => manager.uninstallPlugin(pluginId),
    // Local stdio servers have no OAuth connector step; report "not-configured" so the
    // Connect button degrades instead of opening a Cursor-backend auth flow.
    authenticateServer: async (serverId, accountKey, trigger) => localMode
      ? { status: "not-configured", serverName: (await manager.listServers() as { servers?: readonly { id: string; name: string }[] }).servers?.find((server) => server.id === serverId)?.name }
      : manager.authenticateServer(serverId, accountKey, null, false, trigger ?? null),
    renameAccount: (args) => manager.renameAccount(args.serverId, args.accountKey, args.newAccountKey),
    removeAccount: (args) => manager.removeAccount(args.serverId, args.accountKey),
    setServerCustomInstructions: (request) => manager.setServerCustomInstructions(request),
    listServerTools: (serverId) => manager.listServerTools(serverId),
    listRoutedTools: async () => routedToolsSnapshot.length > 0 ? routedToolsSnapshot : await warmRoutedTools(),
    executeRoutedTool: (request) => discovery.executeTool(
      undefined,
      {
        providerIdentifier: request.providerIdentifier,
        name: request.name,
        toolName: request.toolName,
        args: request.args,
        toolCallId: request.toolCallId,
      },
      request.agentId == null ? undefined : { agentId: request.agentId },
    ),
    toggleMcpToolDisabled: (request) => manager.toggleMcpToolDisabled(request),
    setAuthCompletionObserver: (observer) => manager.setAuthCompletionObserver(observer),
    dispose: () => manager.dispose(),
  };
}
