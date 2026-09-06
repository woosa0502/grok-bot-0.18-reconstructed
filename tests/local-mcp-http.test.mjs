import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "data/artifacts/parity-remediation-20260906/mcp-transport");
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(path.join(artifacts, "test-"));
const output = path.join(temporary, "client.mjs");
await build({ stdin: { contents: ["mcp-http-client", "local-mcp-exec", "local-mcp-oauth", "mcp-oauth-loopback", "tools-discovery", "mcp-definition-source"].map(name => `export * from './source/shared/node/mcp/${name}.ts';`).join("\n") + '\nexport { createSandDesktopMcpManager } from "./source/electron-main/mcp/desktop-mcp-manager.ts"; export { createHostMcp } from "./source/host/extensions/mcp/mcp-service.ts"; export { createLocalMcpWriter, localMcpServersFromConfig, readLocalMcpConfig } from "./source/shared/node/mcp/local-mcp-store.ts";', resolveDir: root }, outfile: output, bundle: true, packages: "external", platform: "node", format: "esm" });
const { McpHttpClient, createLocalMcpExec, LocalMcpOAuthProvider, completeLocalMcpOAuth, localMcpAccounts, withLocalMcpAccounts, createSandMcpOAuthLoopback, createMcpToolsDiscovery, SandMcpDefinitionSource, createSandDesktopMcpManager, createHostMcp, createLocalMcpWriter, localMcpServersFromConfig, readLocalMcpConfig } = await import(pathToFileURL(output).href);
after(() => rm(temporary, { recursive: true, force: true }));
const json = (res, code, value, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
const waitFor = async (predicate) => { for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail("condition did not become true"); };

async function mockMcp({ legacy = false, auth = false, stream = false, tls } = {}) {
  const requests = [], authorizations = [], events = new Set(), cancellations = [];
  let base, session = 0, expired = false, token = "test-token", refreshes = 0, liveTools = false, challenge, legacyStream, holdList;
  const echo = res => ({ jsonrpc: "2.0", id: res.id, result: res.result });
  const listener = async (req, res) => {
    const url = new URL(req.url, base);
    let body = ""; for await (const chunk of req) body += chunk;
    let message; try { message = JSON.parse(body); } catch {}
    requests.push({ method: req.method, path: url.pathname, headers: req.headers, message, body });
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["tools"] });
    if (url.pathname === "/.well-known/oauth-authorization-server") return json(res, 200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    if (url.pathname === "/register") return json(res, 201, { ...message, client_id: "mock-public-client" });
    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "test-refresh") { refreshes++; token = "refreshed-token"; return json(res, 200, { token_type: "Bearer", access_token: token, refresh_token: "test-refresh", expires_in: 3600 }); }
      if (form.get("code") !== "valid-code" || (challenge && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== challenge)) return json(res, 400, { error: "invalid_grant" });
      authorizations.push(form);
      return json(res, 200, { token_type: "Bearer", access_token: token, refresh_token: "test-refresh", expires_in: 3600 });
    }
    if (legacy && url.pathname === "/mcp" && req.method === "POST") return json(res, 404, {});
    if (auth && req.headers.authorization !== `Bearer ${token}`) return json(res, 401, {}, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
    if (url.pathname === "/mcp" && req.method === "GET") {
      if (legacy || stream) {
        res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
        events.add(res); req.on("close", () => events.delete(res));
        if (legacy) { legacyStream = res; res.write(`event: endpoint\ndata: /messages?session=legacy\n\n`); }
        return;
      }
      res.writeHead(405).end(); return;
    }
    if (req.method === "DELETE") { res.writeHead(204).end(); return; }
    if (!message) return json(res, 400, {});
    if (message.method === "notifications/cancelled") { cancellations.push(message.params); res.writeHead(202).end(); return; }
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    const respond = (result, sse = false) => {
      const rpc = echo({ ...message, result });
      if (legacy) { legacyStream.write(`event: message\ndata: ${JSON.stringify(rpc)}\n\n`); res.writeHead(202).end(); return; }
      if (sse) { res.writeHead(200, { "content-type": "text/event-stream" }); const frame = `id: event-1\nevent: message\ndata: ${JSON.stringify(rpc)}\n\n`; res.write(frame.slice(0, 33)); res.end(frame.slice(33)); return; }
      json(res, 200, rpc, message.method === "initialize" ? { "mcp-session-id": `session-${session}` } : {});
    };
    if (message.method === "initialize") { session++; return respond({ protocolVersion: message.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "task-owned-mcp", version: "1" }, instructions: "mock instructions" }); }
    if (!legacy && req.headers["mcp-session-id"] !== `session-${session}`) return json(res, 404, {});
    if (message.method === "tools/list") {
      const snapshot = { tools: [{ name: message.params?.cursor ? "add" : "echo", inputSchema: { type: "object" } }, ...(liveTools && !message.params?.cursor ? [{ name: "new-tool", inputSchema: { type: "object" } }] : [])], ...(message.params?.cursor ? {} : { nextCursor: "second" }) };
      if (holdList && !message.params?.cursor) { const held = holdList; holdList = undefined; held.arrive(); await held.gate; }
      return respond(snapshot);
    }
    if (message.method === "tools/call") {
      if (expired) { expired = false; return json(res, 404, {}); }
      if (message.params.name === "apply-then-drop") { req.socket.destroy(); return; }
      if (message.params.name === "hang") { res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); events.add(res); req.on("close", () => events.delete(res)); return; }
      return respond({ content: [{ type: "text", text: JSON.stringify(message.params.arguments) }], structuredContent: message.params.arguments }, message.params.name === "sse-result");
    }
    json(res, 400, {});
  };
  const server = tls ? createHttpsServer(tls, listener) : createServer(listener);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;
  return { base, requests, authorizations, cancellations, pauseNextList() { let arrive, release; const arrived = new Promise(resolve => { arrive = resolve; }); const gate = new Promise(resolve => { release = resolve; }); holdList = { arrive, gate }; return { arrived, release }; }, get sessions() { return session; }, get refreshes() { return refreshes; }, expire() { expired = true; }, rejectToken() { token = "reject-existing-token"; }, setChallenge(value) { challenge = value; }, toolsChanged() { liveTools = true; for (const res of events) res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`); }, async close() { for (const res of events) res.end(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}

test("Streamable HTTP negotiates protocol, session headers, pagination, JSON/SSE results and DELETE", async () => {
  const mock = await mockMcp();
  const client = new McpHttpClient({ url: `${mock.base}/mcp`, headers: { "X-API-Key": "test-key" } });
  try {
    await client.start();
    assert.deepEqual(client.tools.map(tool => tool.name), ["echo", "add"]);
    assert.equal(client.instructions, "mock instructions");
    assert.equal(client.sessionId, "session-1");
    assert.deepEqual((await client.callTool("echo", { text: "안녕" })).structuredContent, { text: "안녕" });
    assert.equal((await client.callTool("sse-result", { x: 3 })).content[0].text, '{"x":3}');
    const call = mock.requests.find(request => request.message?.method === "tools/call");
    const init = mock.requests.find(request => request.message?.method === "initialize");
    assert.equal(call.headers["mcp-protocol-version"], init.message.params.protocolVersion);
    assert.equal(call.headers["mcp-session-id"], "session-1");
    assert.equal(call.headers["x-api-key"], "test-key");
    assert.ok(mock.requests.some(request => request.message?.method === "notifications/initialized"));
  } finally { await client.dispose(); await mock.close(); }
  assert.ok(mock.requests.some(request => request.method === "DELETE"));
});

test("legacy SSE is selected explicitly or after HTTP 404; cancellation and new sessions work", async () => {
  for (const type of ["sse", undefined]) {
    const mock = await mockMcp({ legacy: true });
    const client = new McpHttpClient({ url: `${mock.base}/mcp`, ...(type ? { type } : {}) });
    try { await client.start(); assert.equal((await client.callTool("echo", { legacy: true })).structuredContent.legacy, true); assert.ok(mock.requests.some(request => request.path === "/messages")); }
    finally { await client.dispose(); await mock.close(); }
  }
  const mock = await mockMcp();
  const client = new McpHttpClient({ url: `${mock.base}/mcp` });
  try {
    await client.start(); mock.expire();
    assert.equal((await client.callTool("echo", { resumed: true })).structuredContent.resumed, true);
    assert.equal(mock.sessions, 2);
    const controller = new AbortController();
    const call = client.callTool("hang", {}, controller.signal);
    await waitFor(() => mock.requests.some(request => request.message?.params?.name === "hang"));
    controller.abort(new Error("task cancelled"));
    await assert.rejects(call, /cancelled/);
    await waitFor(() => mock.cancellations.length === 1);
    assert.equal(typeof mock.cancellations[0].requestId, "number");
    const before = mock.requests.length;
    await assert.rejects(client.callTool("echo", {}, AbortSignal.abort(new Error("already cancelled"))), /cancelled/);
    assert.equal(mock.requests.length, before);
  } finally { await client.dispose(); await mock.close(); }
});

test("server tool-list changes refresh the live client cache", async () => {
  const mock = await mockMcp({ stream: true });
  const client = new McpHttpClient({ url: `${mock.base}/mcp` });
  try { await client.start(); await waitFor(() => mock.requests.some(request => request.method === "GET")); mock.toolsChanged(); await waitFor(() => client.tools.some(tool => tool.name === "new-tool")); }
  finally { await client.dispose(); await mock.close(); }
});

test("local HTTP port executes the configured URL and closes on removal, without a Cursor service", async () => {
  const mock = await mockMcp();
  const sandRoot = await mkdtemp(path.join(temporary, "local-"));
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify({ mcpServers: { example: { url: `${mock.base}/mcp` } } }));
  const exec = createLocalMcpExec(sandRoot);
  try {
    const servers = await exec.listTools(["example"]);
    assert.equal(servers[0].status, "connected");
    assert.equal(servers[0].tools.length, 2);
    const result = await exec.executeTool({ serverIdentifier: "example", toolName: "echo", args: { a: 2 }, toolCallId: "test" });
    assert.equal(result.result.case, "success");
    assert.deepEqual(result.result.value.structuredContent.toJson(), { a: 2 });
    await writeFile(path.join(sandRoot, "mcp.json"), '{"mcpServers":{}}');
    assert.deepEqual(await exec.listTools([]), []);
    assert.ok(mock.requests.some(request => request.method === "DELETE"));
  } finally { await exec.dispose(); await mock.close(); }
});

test("OAuth discovery, PKCE callback, one-use state, account isolation and refresh are real", async () => {
  const mock = await mockMcp({ auth: true });
  const sandRoot = await mkdtemp(path.join(temporary, "auth-"));
  const otherRoot = await mkdtemp(path.join(temporary, "other-auth-"));
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify({ mcpServers: { account: { url: `${mock.base}/mcp`, headers: { "X-API-Key": "transport-only" } } } }));
  const exec = createLocalMcpExec(sandRoot);
  const oauth = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`, "work");
  try {
    const status = await exec.checkAuthStatus({ serverId: "account", accountKey: "work", oauthRedirectUri: "http://localhost:8787/callback" });
    assert.equal(status.requiresAuth, true);
    assert.equal(status.hasValidToken, false);
    const url = new URL(status.authUrl);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("resource"), `${mock.base}/mcp`);
    mock.setChallenge(url.searchParams.get("code_challenge"));
    assert.equal((await exec.checkAuthStatus({ serverId: "account", accountKey: "work", oauthRedirectUri: "http://localhost:8787/callback" })).authUrl, status.authUrl, "refresh does not supersede pending browser state");
    await assert.rejects(completeLocalMcpOAuth(otherRoot, { stateId: url.searchParams.get("state"), code: "valid-code" }), /Unknown/);
    await completeLocalMcpOAuth(sandRoot, { stateId: url.searchParams.get("state"), code: "valid-code" });
    await assert.rejects(completeLocalMcpOAuth(sandRoot, { stateId: url.searchParams.get("state"), code: "valid-code" }), /Unknown|consumed/);
    assert.equal(oauth.tokens().access_token, "test-token");
    assert.equal(new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`, "personal").tokens(), undefined);
    assert.equal(new LocalMcpOAuthProvider(sandRoot, `${mock.base}/other`, "work").tokens(), undefined);
    assert.equal((await stat(path.join(sandRoot, "local-mcp-oauth-v1"))).mode & 0o777, 0o700);
    const slots = withLocalMcpAccounts(sandRoot, [{ id: "1", name: "account", serverIdentifier: "account", config: { url: `${mock.base}/mcp` } }])[0].accounts;
    assert.equal(slots[0].serverIdentifier, "account--work");
    assert.equal((await exec.listTools(["account"]))[0].status, "connected");
    const called = await exec.executeTool({ serverIdentifier: "account--work", toolName: "echo", args: { scope: "work" }, toolCallId: "oauth" });
    assert.equal(called.result.case, "success");
    mock.rejectToken();
    const validated = await exec.validateTokens([{ serverUrl: `${mock.base}/mcp`, accountKey: "work" }]);
    assert.equal(validated[0].hasValidToken, true);
    assert.equal(mock.refreshes, 1);
    assert.equal(oauth.tokens().access_token, "refreshed-token");
    assert.equal(mock.requests.filter(request => request.path.startsWith("/.well-known") || ["/register", "/token"].includes(request.path)).some(request => request.headers["x-api-key"]), false, "MCP headers never reach OAuth discovery/token endpoints");
    await exec.renameAccount({ serverId: "account", accountKey: "work", newAccountKey: "renamed" });
    assert.equal(oauth.tokens(), undefined);
    assert.equal(new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`, "renamed").tokens().access_token, "refreshed-token");
    await exec.deleteAccount({ serverId: "account", accountKey: "renamed" });
    assert.deepEqual(localMcpAccounts(sandRoot, `${mock.base}/mcp`), []);
  } finally { await exec.dispose(); await mock.close(); }
});

test("rejected/expired OAuth callbacks never report authenticated", async () => {
  const mock = await mockMcp({ auth: true });
  const sandRoot = await mkdtemp(path.join(temporary, "denied-"));
  const oauth = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
  const client = new McpHttpClient({ url: `${mock.base}/mcp` }, oauth);
  try {
    await assert.rejects(client.start(), /Unauthorized/);
    const stateId = new URL(oauth.authorizationUrl()).searchParams.get("state");
    await assert.rejects(completeLocalMcpOAuth(sandRoot, { stateId, code: "invalid-code" }), /InvalidGrantError/);
    assert.equal(oauth.tokens(), undefined);
    assert.equal(oauth.authorizationUrl(), undefined);
    const expired = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/expired`, "default", "http://localhost:8787/callback", () => 1);
    const expiredState = expired.state(); expired.saveCodeVerifier("v"); expired.redirectToAuthorization(new URL(`${mock.base}/authorize?state=${expiredState}`));
    await assert.rejects(completeLocalMcpOAuth(sandRoot, { stateId: expiredState, code: "valid-code" }), /expired/);
    assert.equal(expired.tokens(), undefined);
  } finally { await client.dispose(); await mock.close(); }
});

test("ambiguous network failure does not replay a potentially applied tool", async () => {
  const mock = await mockMcp();
  const client = new McpHttpClient({ url: `${mock.base}/mcp` });
  try {
    await client.start();
    await assert.rejects(client.callTool("apply-then-drop", {}));
    assert.equal(mock.requests.filter(request => request.message?.params?.name === "apply-then-drop").length, 1);
  } finally { await client.dispose(); await mock.close(); }
});

test("actual loopback callback returns success only after local token exchange", async () => {
  const mock = await mockMcp({ auth: true });
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const redirect = `http://127.0.0.1:${port}/callback`;
  const sandRoot = await mkdtemp(path.join(temporary, "callback-"));
  const provider = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`, "default", redirect, Date.now, { CLIENT_ID: "pre-registered-public-client" });
  const client = new McpHttpClient({ url: `${mock.base}/mcp` }, provider);
  const loopback = createSandMcpOAuthLoopback({ loopbackRedirectUrl: redirect, log() {}, completeOAuth: args => completeLocalMcpOAuth(sandRoot, args) });
  try {
    await assert.rejects(client.start(), /Unauthorized/);
    const url = new URL(provider.authorizationUrl());
    assert.equal(url.searchParams.get("client_id"), "pre-registered-public-client");
    mock.setChallenge(url.searchParams.get("code_challenge"));
    await loopback.registerPendingAuthFromUrl({ authorizationUrl: url.href, serverName: "mock" });
    const bad = await fetch(`${redirect}?state=unknown&code=valid-code`);
    assert.equal(bad.status, 404);
    assert.equal(provider.tokens(), undefined);
    const reply = await fetch(`${redirect}?state=${url.searchParams.get("state")}&code=valid-code`);
    assert.equal(reply.status, 200);
    assert.match(await reply.text(), /connected|success|complete/i);
    assert.equal(provider.tokens().access_token, "test-token");
    assert.equal(mock.requests.some(request => request.path === "/register"), false);
  } finally { await loopback.dispose(); await client.dispose(); await mock.close(); }
});

test("private CA works for both MCP requests and cross-process OAuth token completion", async () => {
  const dir = await mkdtemp(path.join(temporary, "tls-"));
  const key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const mock = await mockMcp({ auth: true, tls: { key: readFileSync(key), cert: readFileSync(cert) } });
  const sandRoot = path.join(dir, "profile"); await mkdir(sandRoot);
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify({ mcpServers: { private: { url: `${mock.base}/mcp`, tls: { caBundle: cert } } } }));
  const oauth = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
  const client = new McpHttpClient({ url: `${mock.base}/mcp`, tls: { caBundle: cert } }, oauth);
  const noTrust = new McpHttpClient({ url: `${mock.base}/mcp` });
  try {
    await assert.rejects(noTrust.start(), /fetch failed/);
    await assert.rejects(client.start(), /Unauthorized/);
    const url = new URL(oauth.authorizationUrl());
    mock.setChallenge(url.searchParams.get("code_challenge"));
    await completeLocalMcpOAuth(sandRoot, { stateId: url.searchParams.get("state"), code: "valid-code" });
    await client.start();
    assert.equal((await client.callTool("echo", { trusted: true })).structuredContent.trusted, true);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  } finally { await client.dispose(); await noTrust.dispose(); await mock.close(); }
});

test("remote tool-list changes invalidate the host discovery cache and context abort reaches the server", async () => {
  const mock = await mockMcp({ stream: true });
  const sandRoot = await mkdtemp(path.join(temporary, "cache-"));
  const config = { mcpServers: { remote: { url: `${mock.base}/mcp` } } };
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify(config));
  const exec = createLocalMcpExec(sandRoot);
  const discovery = createMcpToolsDiscovery({ backendMcpExec: exec, definitionSource: new SandMcpDefinitionSource(false, async () => config), lastAccountDisplayConfig: () => null, settingsStore: () => ({ getMcpDisabledToolsByServerId: () => ({}), getRawMcpCustomInstruction: () => "", getRawMcpCustomInstructionByServerId: () => "" }) });
  try {
    assert.equal((await discovery.getTools()).some(tool => tool.name === "new-tool"), false);
    await waitFor(() => mock.requests.some(request => request.method === "GET"));
    mock.toolsChanged();
    let changed = false;
    for (let attempt = 0; attempt < 100; attempt++) { if ((await discovery.getTools()).some(tool => tool.name === "new-tool")) { changed = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(changed, true);
    const controller = new AbortController();
    const call = discovery.executeTool({ signal: controller.signal }, { providerIdentifier: "remote", name: "hang", toolName: "hang", args: {}, toolCallId: "cancel" }, undefined);
    await waitFor(() => mock.requests.some(request => request.message?.params?.name === "hang"));
    controller.abort(new Error("cancelled from host"));
    assert.equal((await call).result.case, "error");
    await waitFor(() => mock.cancellations.length === 1);
  } finally { discovery.dispose(); await exec.dispose(); await mock.close(); }
});

test("a superseded OAuth callback cannot store tokens or erase the newer pending flow", async () => {
  const mock = await mockMcp({ auth: true });
  const sandRoot = await mkdtemp(path.join(temporary, "superseded-"));
  const oauth = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
  const client = new McpHttpClient({ url: `${mock.base}/mcp` }, oauth);
  try {
    await assert.rejects(client.start(), /Unauthorized/);
    const oldUrl = new URL(oauth.authorizationUrl());
    const state = oldUrl.searchParams.get("state");
    mock.setChallenge(oldUrl.searchParams.get("code_challenge"));
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const delayedFetch = async (input, init) => { if (new URL(String(input)).pathname === "/token") { entered(); await gate; } return fetch(input, init); };
    const completing = completeLocalMcpOAuth(sandRoot, { stateId: state, code: "valid-code" }, delayedFetch);
    await waiting;
    const replacement = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
    const next = replacement.state(); replacement.saveCodeVerifier("new-verifier"); replacement.redirectToAuthorization(new URL(`${mock.base}/authorize?state=${next}`));
    release();
    await assert.rejects(completing, /superseded/);
    assert.equal(replacement.tokens(), undefined);
    assert.equal(new URL(replacement.authorizationUrl()).searchParams.get("state"), next);
    assert.equal(replacement.codeVerifier(), "new-verifier");
  } finally { await client.dispose(); await mock.close(); }
});

test("list_changed during an in-flight tools/list forces a final fresh pass", async () => {
  const mock = await mockMcp({ stream: true });
  const client = new McpHttpClient({ url: `${mock.base}/mcp` });
  try {
    await client.start();
    await waitFor(() => mock.requests.some(request => request.method === "GET"));
    const held = mock.pauseNextList();
    const refresh = client.refreshTools();
    await held.arrived;
    mock.toolsChanged();
    await new Promise(resolve => setTimeout(resolve, 40));
    held.release();
    await refresh;
    await waitFor(() => client.tools.some(tool => tool.name === "new-tool"));
    assert.ok(mock.requests.filter(request => request.message?.method === "tools/list").length >= 6);
  } finally { await client.dispose(); await mock.close(); }
});

test("desktop routed tools reflect remote changes and disabled-tool mutations", async () => {
  const mock = await mockMcp({ stream: true });
  const sandRoot = await mkdtemp(path.join(temporary, "desktop-"));
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify({ mcpServers: { desktop: { url: `${mock.base}/mcp` } } }));
  const prior = { mode: process.env.SAND_LOCAL_CODEX_MODE, root: process.env.SAND_DATA_ROOT };
  process.env.SAND_LOCAL_CODEX_MODE = "1"; process.env.SAND_DATA_ROOT = sandRoot;
  let disabled = {}, manager;
  const settings = { scopeToAccount() {}, migrateMcpCustomInstructionToServerId() {}, getMcpCustomInstructions: () => ({}), getMcpCustomInstructionsByServerId: () => ({}), getMcpDisabledToolsByServerId: () => disabled, setMcpDisabledToolsByServerId: value => { disabled = value; }, getRawMcpCustomInstruction: () => "", getRawMcpCustomInstructionByServerId: () => "" };
  try {
    manager = await createSandDesktopMcpManager({ settingsStore: settings, onAccountScopeApplied() {}, getAccessToken: async () => { throw new Error("unexpected Cursor access"); }, getMachineId: async () => "task-owned-machine", listBoxMcpServers: async () => [], onConnectorAuth() {} });
    assert.equal((await manager.listRoutedTools()).some(tool => tool.name === "new-tool"), false);
    await waitFor(() => mock.requests.some(request => request.method === "GET"));
    mock.toolsChanged();
    let actual;
    for (let attempt = 0; attempt < 100; attempt++) { actual = await manager.listRoutedTools(); if (actual.some(tool => tool.name === "new-tool")) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(actual.some(tool => tool.name === "new-tool"), true);
    const serverId = (await manager.listServers()).servers[0].id;
    await manager.toggleMcpToolDisabled({ serverId, toolName: "echo" });
    assert.equal((await manager.listRoutedTools()).some(tool => tool.name === "echo"), false);
  } finally {
    await manager?.dispose(); await mock.close();
    if (prior.mode === undefined) delete process.env.SAND_LOCAL_CODEX_MODE; else process.env.SAND_LOCAL_CODEX_MODE = prior.mode;
    if (prior.root === undefined) delete process.env.SAND_DATA_ROOT; else process.env.SAND_DATA_ROOT = prior.root;
  }
});

test("concurrent discovery shares one session and immediate disposal prevents a late connection", async () => {
  const mock = await mockMcp();
  const sandRoot = await mkdtemp(path.join(temporary, "concurrent-"));
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify({ mcpServers: { shared: { url: `${mock.base}/mcp` } } }));
  const exec = createLocalMcpExec(sandRoot);
  try {
    const results = await Promise.all(Array.from({ length: 5 }, () => exec.listTools(["shared"])));
    assert.ok(results.every(rows => rows[0].status === "connected"));
    assert.equal(mock.sessions, 1);
    await exec.dispose();
    assert.equal(mock.requests.filter(request => request.method === "DELETE").length, 1);
    const other = createLocalMcpExec(sandRoot);
    const loading = other.listTools(["shared"]);
    await other.dispose();
    const outcome = await loading;
    assert.notEqual(outcome[0].status, "connected");
    assert.equal(mock.sessions, 1);
  } finally { await exec.dispose(); await mock.close(); }
});

test("disposing or changing configuration during discovery cannot retain the old session", async () => {
  const mock = await mockMcp();
  const sandRoot = await mkdtemp(path.join(temporary, "retire-"));
  const file = path.join(sandRoot, "mcp.json");
  await writeFile(file, JSON.stringify({ mcpServers: { target: { url: `${mock.base}/mcp` } } }));
  const exec = createLocalMcpExec(sandRoot);
  const held = mock.pauseNextList();
  try {
    const loading = exec.listTools(["target"]);
    await held.arrived;
    await writeFile(file, '{"mcpServers":{}}');
    held.release();
    assert.notEqual((await loading)[0].status, "connected");
    await exec.dispose();
    assert.equal(mock.requests.filter(request => request.method === "DELETE").length, 1);
  } finally { held.release(); await exec.dispose(); await mock.close(); }
});

test("logout during an OAuth refresh prevents late token resurrection", async () => {
  const mock = await mockMcp({ auth: true });
  const sandRoot = await mkdtemp(path.join(temporary, "refresh-logout-"));
  const oauth = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
  const initial = new McpHttpClient({ url: `${mock.base}/mcp` }, oauth);
  let refreshClient;
  try {
    await assert.rejects(initial.start(), /Unauthorized/);
    const stateId = new URL(oauth.authorizationUrl()).searchParams.get("state");
    await completeLocalMcpOAuth(sandRoot, { stateId, code: "valid-code" });
    mock.rejectToken();
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const delayedFetch = async (input, init) => { if (new URL(String(input)).pathname === "/token") { entered(); await gate; } return fetch(input, init); };
    const refreshProvider = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
    refreshClient = new McpHttpClient({ url: `${mock.base}/mcp` }, refreshProvider, delayedFetch);
    const refreshing = refreshClient.start();
    await waiting;
    const logout = new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`);
    logout.invalidateCredentials("all");
    // Header construction or a status read on the same provider must not change
    // the generation captured by the already-running refresh operation.
    assert.equal(refreshProvider.tokens(), undefined);
    release();
    await assert.rejects(refreshing, /credentials changed/);
    assert.equal(logout.tokens(), undefined);
    assert.equal(logout.authorizationUrl(), undefined);
  } finally { await refreshClient?.dispose(); await initial.dispose(); await mock.close(); }
});

test("account aliases cannot shadow a real configured row with the same name", async () => {
  const first = await mockMcp(), second = await mockMcp();
  const sandRoot = await mkdtemp(path.join(temporary, "identifiers-"));
  await writeFile(path.join(sandRoot, "mcp.json"), JSON.stringify({ mcpServers: { alpha: { url: `${first.base}/mcp` }, "alpha--personal": { url: `${second.base}/mcp` } } }));
  new LocalMcpOAuthProvider(sandRoot, `${first.base}/mcp`, "personal").saveTokens({ access_token: "synthetic", token_type: "Bearer" });
  const exec = createLocalMcpExec(sandRoot);
  try {
    const rows = await exec.listTools(["alpha", "alpha--personal"]);
    const account = rows.find(row => row.rowServerIdentifier === "alpha");
    const exact = rows.find(row => row.rowServerIdentifier === "alpha--personal");
    assert.notEqual(account.serverIdentifier, exact.serverIdentifier);
    assert.equal(exact.serverIdentifier, "alpha--personal");
    assert.match(account.serverIdentifier, /^mcp-local-account:/);
    assert.equal((await exec.executeTool({ serverIdentifier: exact.serverIdentifier, toolName: "echo", args: { row: "exact" }, toolCallId: "exact" })).result.case, "success");
    assert.equal(first.requests.some(request => request.message?.method === "tools/call"), false);
    assert.equal(second.requests.filter(request => request.message?.method === "tools/call").length, 1);
    assert.equal((await exec.executeTool({ serverIdentifier: account.serverIdentifier, toolName: "echo", args: { row: "account" }, toolCallId: "account" })).result.case, "success");
    assert.equal(first.requests.filter(request => request.message?.method === "tools/call").length, 1);
  } finally { await exec.dispose(); await first.close(); await second.close(); }
});

test("host management adds a usable remote server, rejects overwrite, reconnects and removes scoped credentials", async () => {
  const mock = await mockMcp();
  const sandRoot = await mkdtemp(path.join(temporary, "management-"));
  const exec = createLocalMcpExec(sandRoot);
  const host = createHostMcp({ backendMcpExec: exec, accountMcpWriter: createLocalMcpWriter(sandRoot), accountServersProvider: async () => ({ servers: withLocalMcpAccounts(sandRoot, localMcpServersFromConfig(readLocalMcpConfig(sandRoot))), cacheScope: "task-profile" }), getMachineId: async () => "task-machine" });
  try {
    const added = await host.management.add({ name: "added", configJson: JSON.stringify({ url: `${mock.base}/mcp` }) });
    assert.equal(added[0].status, "connected");
    assert.ok((await host.mcp.listTools()).some(tool => tool.providerIdentifier === "added"));
    await assert.rejects(host.management.add({ name: "added", configJson: JSON.stringify({ url: `${mock.base}/other` }) }), /already exists/);
    assert.equal(readLocalMcpConfig(sandRoot).mcpServers.added.url, `${mock.base}/mcp`);
    await host.management.restart();
    assert.equal(mock.sessions, 2);
    new LocalMcpOAuthProvider(sandRoot, `${mock.base}/mcp`, "default").saveTokens({ access_token: "task-token", token_type: "Bearer" });
    const result = await host.management.removeServer(added[0].id);
    assert.equal(result.removed, true);
    assert.deepEqual(readLocalMcpConfig(sandRoot).mcpServers, {});
    assert.deepEqual(localMcpAccounts(sandRoot, `${mock.base}/mcp`), []);
  } finally { await host.dispose(); await mock.close(); }
});
