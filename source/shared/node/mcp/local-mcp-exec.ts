import { createHash } from "node:crypto";
import { Struct, type JsonValue } from "@bufbuild/protobuf";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpError, McpImageContent, McpResult, McpSuccess, McpTextContent, McpToolResultContentItem } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { provisionalMcpAccountServerIdentifier } from "../../mcp.js";
import type { AccountMcpServer } from "../cursor-backend/account-mcp.js";
import type { McpRemoteConfig } from "../cursor-backend/account-mcp.js";
import { localMcpServerId, readLocalMcpConfig } from "./local-mcp-store.js";
import { McpHttpClient } from "./mcp-http-client.js";
import { completeLocalMcpOAuth, LocalMcpOAuthProvider, localMcpAccounts } from "./local-mcp-oauth.js";
import { MCP_OAUTH_LOOPBACK_CALLBACK_URL } from "./mcp-oauth-loopback.js";

function localAccountIdentifiers(root: string, servers: ReturnType<typeof readLocalMcpConfig>["mcpServers"]) {
  const rows = Object.entries(servers).filter((entry): entry is [string, McpRemoteConfig] => "url" in entry[1]);
  const targets = rows.flatMap(([name, server]) => {
    const accounts = localMcpAccounts(root, server.url);
    return (accounts.length === 0 ? [{ accountKey: "default", hasToken: false }] : accounts).map(account => ({ name, server, ...account }));
  });
  const occupied = new Set(Object.keys(servers));
  const counts = new Map<string, number>();
  for (const target of targets) {
    const candidate = provisionalMcpAccountServerIdentifier(target.name, target.accountKey);
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  return targets.map(target => {
    let identifier = provisionalMcpAccountServerIdentifier(target.name, target.accountKey);
    if (target.accountKey !== "default" && (occupied.has(identifier) || (counts.get(identifier) ?? 0) > 1)) {
      identifier = `mcp-local-account:${createHash("sha256").update(JSON.stringify([target.name, target.accountKey])).digest("hex")}`;
      while (occupied.has(identifier)) identifier += ":";
    }
    occupied.add(identifier);
    return { ...target, identifier };
  });
}
export function withLocalMcpAccounts(root: string, servers: AccountMcpServer[]): AccountMcpServer[] {
  const identifiers = localAccountIdentifiers(root, readLocalMcpConfig(root).mcpServers);
  return servers.map(server => {
    if (!("url" in server.config)) return server;
    const accounts = localMcpAccounts(root, server.config.url);
    return accounts.length === 0 ? server : { ...server, accounts: accounts.map(account => ({ ...account, serverIdentifier: identifiers.find(target => target.name === (server.serverIdentifier ?? server.name) && target.accountKey === account.accountKey)!.identifier })) };
  });
}
const errorResult = (error: unknown) => new McpResult({ result: { case: "error", value: new McpError({ error: error instanceof Error ? error.message : String(error) }) } });

/** Implements the existing backend MCP port on this installation. Only remote
 * user-configured URLs execute here; stdio and hosted Cursor mode keep their ports. */
export function createLocalMcpExec(root: string, fetchFn: typeof fetch = fetch) {
  const toolsChanged = new Set<() => void>();
  let disposed = false;
  type Entry = { client: McpHttpClient; name: string; accountKey: string; key: string; ready: Promise<void>; failed: boolean };
  const clients = new Map<string, Entry>();
  const config = () => readLocalMcpConfig(root).mcpServers;
  const resolveId = (id: string | number) => Object.entries(config()).find(([name]) => name === String(id) || localMcpServerId(name) === String(id));
  const resolveIdentifier = (identifier: string) => {
    const servers = config();
    // Exact configured names always win over legacy account aliases.
    const exact = servers[identifier];
    if (exact !== undefined && "url" in exact) return { name: identifier, server: exact, accountKey: "default" };
    const target = localAccountIdentifiers(root, servers).find(target => target.identifier === identifier);
    if (target !== undefined) return target;
    throw new Error("MCP server or account is not configured locally");
  };
  const provider = (url: string, key: string, redirect?: string, configuredAuth?: McpRemoteConfig["auth"]) => new LocalMcpOAuthProvider(root, url, key, redirect ?? MCP_OAUTH_LOOPBACK_CALLBACK_URL, Date.now, configuredAuth);
  const connection = async (identifier: string) => {
    if (disposed) throw new Error("Local MCP executor disposed");
    const resolved = resolveIdentifier(identifier);
    const key = JSON.stringify([resolved.server, resolved.accountKey]);
    const tuple = JSON.stringify([resolved.name, resolved.accountKey]);
    let entry = clients.get(tuple);
    if (entry?.key !== key || entry.failed) {
      const previous = entry;
      const created: Entry = {
        key, name: resolved.name, accountKey: resolved.accountKey,
        client: new McpHttpClient(resolved.server, provider(resolved.server.url, resolved.accountKey, undefined, resolved.server.auth), fetchFn, () => { for (const listener of toolsChanged) listener(); }),
        ready: Promise.resolve(),
        failed: false,
      };
      // Publish before any await: simultaneous discovery/execution must share
      // one initialize, and dispose must be able to find pending connections.
      clients.set(tuple, created);
      created.ready = Promise.resolve().then(async () => {
        await previous?.client.dispose();
        if (disposed || clients.get(tuple) !== created) throw new Error("Local MCP connection superseded");
        if (provider(resolved.server.url, resolved.accountKey).authorizationUrl()) throw new UnauthorizedError("MCP sign-in is pending");
        await created.client.start();
        const current = resolveIdentifier(identifier);
        if (disposed || clients.get(tuple) !== created || JSON.stringify([current.server, current.accountKey]) !== key) throw new Error("Local MCP connection superseded");
      }).catch(async error => {
        created.failed = true;
        await created.client.dispose();
        throw error;
      });
      entry = created;
    }
    await entry.ready;
    if (disposed || clients.get(tuple) !== entry) throw new Error("Local MCP connection disposed");
    return entry.client;
  };
  const drop = async () => {
    const previous = [...clients.values()]; clients.clear();
    await Promise.all(previous.map(async entry => { await entry.client.dispose(); await entry.ready.catch(() => {}); }));
  };
  return {
    supportsLocalServerIds: true,
    subscribeToolsChanged(listener: () => void) { toolsChanged.add(listener); return () => toolsChanged.delete(listener); },
    hasServerIdentifier(identifier: string): boolean { try { resolveIdentifier(identifier); return true; } catch { return false; } },
    async listTools(serverIdentifiers: readonly string[]) {
      const rows = new Set<string>();
      for (const identifier of serverIdentifiers) { try { rows.add(resolveIdentifier(identifier).name); } catch {} }
      const result = [];
      for (const row of rows) {
        const server = config()[row];
        if (server === undefined || !("url" in server)) continue;
        for (const { accountKey, identifier } of localAccountIdentifiers(root, config()).filter(target => target.name === row)) {
          try {
            const client = await connection(identifier);
            result.push({ serverIdentifier: identifier, rowServerIdentifier: row, accountLabel: accountKey, status: "connected", tools: client.tools.map(tool => ({ name: tool.name, toolName: tool.name, providerIdentifier: identifier, description: tool.description ?? "", inputSchema: tool.inputSchema })) });
          } catch (error) {
            result.push({ serverIdentifier: identifier, rowServerIdentifier: row, accountLabel: accountKey, status: error instanceof UnauthorizedError ? "needsAuth" : "error", tools: [], statusDetail: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      // Removal/config changes close retained event streams on the next refresh.
      for (const [tuple, entry] of clients) {
        const server = config()[entry.name];
        const accountExists = entry.accountKey === "default" || (server !== undefined && "url" in server && localMcpAccounts(root, server.url).some(account => account.accountKey === entry.accountKey));
        if (server === undefined || !("url" in server) || !accountExists || JSON.stringify([server, entry.accountKey]) !== entry.key) { clients.delete(tuple); await entry.client.dispose(); }
      }
      return result;
    },
    async executeTool(args: { serverIdentifier: string; toolName: string; args: unknown; toolCallId: string; agentId?: string; signal?: AbortSignal }): Promise<McpResult> {
      try {
        const client = await connection(args.serverIdentifier);
        const input = args.args instanceof Struct ? args.args.toJson() : args.args;
        if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("MCP tool arguments must be an object");
        const result = await client.callTool(args.toolName, input as Record<string, unknown>, args.signal);
        const content = result.content.map(item => item.type === "image"
          ? new McpToolResultContentItem({ content: { case: "image", value: new McpImageContent({ data: Uint8Array.from(Buffer.from(item.data, "base64")), mimeType: item.mimeType }) } })
          : new McpToolResultContentItem({ content: { case: "text", value: new McpTextContent({ text: item.type === "text" ? item.text : item.type === "resource" && "text" in item.resource ? item.resource.text : JSON.stringify(item) }) } }));
        return new McpResult({ result: { case: "success", value: new McpSuccess({ content, isError: result.isError ?? false, ...(result.structuredContent === undefined ? {} : { structuredContent: Struct.fromJson(result.structuredContent as JsonValue) }) }) } });
      } catch (error) { return errorResult(error); }
    },
    async checkAuthStatus(args: { serverId: string | number; accountKey: string; oauthRedirectUri: string; forceReauth?: boolean }) {
      const entry = resolveId(args.serverId);
      if (entry === undefined || !("url" in entry[1])) throw new Error("Remote MCP server is not configured locally");
      const [, server] = entry;
      if (!("url" in server)) throw new Error("Stdio MCP does not use OAuth");
      const oauth = provider(server.url, args.accountKey, args.oauthRedirectUri, server.auth);
      if (args.forceReauth) { oauth.invalidateCredentials("all"); await drop(); }
      // Reuse a pending flow; polling/discovery must not invalidate a browser tab's state.
      if (oauth.authorizationUrl()) return { isAvailable: false, requiresAuth: true, hasValidToken: false, authUrl: oauth.authorizationUrl()!, error: "" };
      const client = new McpHttpClient(server, oauth, fetchFn);
      try { await client.start(); return { isAvailable: true, requiresAuth: false, hasValidToken: oauth.hasUnexpiredToken(), authUrl: "", error: "" }; }
      catch (error) { return { isAvailable: false, requiresAuth: error instanceof UnauthorizedError, hasValidToken: false, authUrl: oauth.authorizationUrl() ?? "", error: error instanceof Error ? error.message : String(error) }; }
      finally { await client.dispose(); }
    },
    async completeOAuth(args: { stateId: string; code: string }) { await completeLocalMcpOAuth(root, args, fetchFn); await drop(); },
    async validateTokens(targets: readonly { serverUrl: string; accountKey: string }[]) {
      return Promise.all(targets.map(async target => {
        const entry = Object.entries(config()).find(([, server]) => "url" in server && server.url === target.serverUrl);
        if (!entry || !("url" in entry[1]) || !provider(target.serverUrl, target.accountKey).tokens()) return { ...target, hasValidToken: false };
        const client = new McpHttpClient(entry[1], provider(target.serverUrl, target.accountKey, undefined, entry[1].auth), fetchFn);
        try { await client.start(); return { ...target, hasValidToken: true }; }
        catch { return { ...target, hasValidToken: false }; }
        finally { await client.dispose(); }
      }));
    },
    restart: drop,
    async forgetServer(serverUrl: string) {
      if (Object.values(config()).some(server => "url" in server && server.url === serverUrl)) return;
      for (const account of localMcpAccounts(root, serverUrl)) provider(serverUrl, account.accountKey).removeAccount();
      for (const [tuple, entry] of clients) if (entry.client.config.url === serverUrl) { clients.delete(tuple); await entry.client.dispose(); await entry.ready.catch(() => {}); }
    },
    async logoutAccount(args: { serverUrl: string; accountKey: string }) { provider(args.serverUrl, args.accountKey).invalidateCredentials("all"); await drop(); },
    async renameAccount(args: { serverId: string | number; accountKey: string; newAccountKey: string }) {
      const entry = resolveId(args.serverId);
      if (entry === undefined || !("url" in entry[1])) throw new Error("MCP server not configured locally");
      provider(entry[1].url, args.accountKey).renameAccount(args.newAccountKey);
      await drop();
    },
    async deleteAccount(args: { serverId: string | number; accountKey: string }) {
      const entry = resolveId(args.serverId);
      if (entry !== undefined && "url" in entry[1]) provider(entry[1].url, args.accountKey).removeAccount();
      await drop();
    },
    async dispose() { disposed = true; toolsChanged.clear(); await drop(); },
  };
}
