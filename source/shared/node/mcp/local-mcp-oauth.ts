import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createMcpTlsFetch } from "./mcp-http-fetch.js";
import { readLocalMcpConfig } from "./local-mcp-store.js";
import { MCP_OAUTH_LOOPBACK_CALLBACK_URL } from "./mcp-oauth-loopback.js";

const TTL_MS = 15 * 60_000;
interface Pending { state: string; verifier?: string; authorizationUrl?: string; expiresAt: number; redirectUrl: string }
interface Credentials {
  serverUrl: string;
  accountKey: string;
  generation?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  expiresAt?: number;
  discovery?: OAuthDiscoveryState;
  pending?: Pending;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const read = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } };
const remove = (file: string) => { try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };
function write(file: string, value: unknown): void {
  const temporary = `${file}.${randomBytes(12).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  try { renameSync(temporary, file); } finally { remove(temporary); }
}
export function localMcpAuthDirectory(root: string): string { return join(root, "local-mcp-oauth-v1"); }

/** OS-user-scoped local credential authority. Each resource URL/account has its
 * own atomic 0600 record under a 0700 directory; no Cursor or model auth is read.
 * PKCE and expiring, single-use state are persisted for host -> desktop callbacks. */
export class LocalMcpOAuthProvider implements OAuthClientProvider {
  readonly #directory: string;
  readonly #file: string;
  #completing: Pending | undefined;
  #authorizationState: string | undefined;
  readonly #operation = new AsyncLocalStorage<{ captured: boolean; generation: string | undefined }>();
  #fallbackAuthority = { captured: false, generation: undefined as string | undefined };
  runWithOAuthContext<T>(operation: () => Promise<T>): Promise<T> { return this.#operation.run({ captured: false, generation: undefined }, operation); }
  #authority() { return this.#operation.getStore() ?? this.#fallbackAuthority; }
  #adoptGeneration(generation: string): void { const authority = this.#authority(); authority.captured = true; authority.generation = generation; }
  constructor(readonly root: string, readonly serverUrl: string, readonly accountKey = "default", readonly redirectUrl = MCP_OAUTH_LOOPBACK_CALLBACK_URL, readonly now: () => number = Date.now, readonly configuredAuth?: { readonly CLIENT_ID: string; readonly CLIENT_SECRET?: string; readonly scopes?: readonly string[] }) {
    this.#directory = localMcpAuthDirectory(root);
    this.#file = join(this.#directory, `${digest(JSON.stringify([serverUrl, accountKey]))}.json`);
  }
  #read(): Credentials { return read<Credentials>(this.#file) ?? { serverUrl: this.serverUrl, accountKey: this.accountKey }; }
  #update(change: (record: Credentials) => void): void {
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const record = this.#read();
    change(record);
    write(this.#file, record);
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "Belmont Local MCP", redirect_uris: [this.redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: this.configuredAuth?.CLIENT_SECRET ? "client_secret_post" : "none", ...(this.configuredAuth?.scopes === undefined ? {} : { scope: this.configuredAuth.scopes.join(" ") }) };
  }
  clientInformation() {
    if (this.configuredAuth === undefined) return this.#read().clientInformation;
    const configured = { client_id: this.configuredAuth.CLIENT_ID, ...(this.configuredAuth.CLIENT_SECRET === undefined ? {} : { client_secret: this.configuredAuth.CLIENT_SECRET }) };
    this.saveClientInformation(configured);
    return configured;
  }
  saveClientInformation(value: OAuthClientInformationMixed) { this.#update(record => { record.clientInformation = value; }); }
  tokens() {
    let record = this.#read();
    if (record.tokens !== undefined && record.generation === undefined) {
      this.#update(current => { current.generation ??= randomBytes(16).toString("hex"); });
      record = this.#read();
    }
    const authority = this.#authority();
    if (!authority.captured) { authority.captured = true; authority.generation = record.generation; }
    return record.tokens;
  }
  hasUnexpiredToken(): boolean { const record = this.#read(); return !!record.tokens?.access_token && (record.expiresAt === undefined || record.expiresAt > this.now()); }
  saveTokens(value: OAuthTokens) {
    this.#update(record => {
      if (this.#completing !== undefined && (record.pending?.state !== this.#completing.state || this.#completing.expiresAt <= this.now())) throw new Error("OAuth authorization was superseded or expired");
      if (this.#completing === undefined && this.#authority().captured && record.generation !== this.#authority().generation) throw new Error("OAuth credentials changed while refreshing");
      record.generation = randomBytes(16).toString("hex");
      this.#adoptGeneration(record.generation);
      record.tokens = { ...value, ...(value.refresh_token === undefined && record.tokens?.refresh_token !== undefined ? { refresh_token: record.tokens.refresh_token } : {}) };
      if (value.expires_in === undefined) delete record.expiresAt;
      else record.expiresAt = this.now() + value.expires_in * 1_000;
    });
  }
  state(): string {
    const state = randomBytes(32).toString("base64url");
    this.#authorizationState = state;
    this.#update(record => {
      if (this.#authority().captured && record.generation !== this.#authority().generation) throw new Error("OAuth credentials changed before authorization");
      if (record.pending !== undefined) remove(join(this.#directory, `pending-${digest(record.pending.state)}.json`));
      record.generation = randomBytes(16).toString("hex");
      this.#adoptGeneration(record.generation);
      record.pending = { state, expiresAt: this.now() + TTL_MS, redirectUrl: this.redirectUrl };
    });
    return state;
  }
  saveCodeVerifier(verifier: string) { this.#update(record => { if (record.pending === undefined || record.pending.state !== this.#authorizationState || record.pending.expiresAt <= this.now()) throw new Error("OAuth state missing or superseded"); record.pending.verifier = verifier; }); }
  codeVerifier(): string { const pending = this.#completing ?? this.#read().pending; if (!pending?.verifier || pending.expiresAt <= this.now()) throw new Error("OAuth authorization expired"); return pending.verifier; }
  redirectToAuthorization(url: URL): void {
    const state = url.searchParams.get("state");
    this.#update(record => {
      if (!record.pending || record.pending.state !== state) throw new Error("OAuth state mismatch");
      record.pending.authorizationUrl = url.href;
      write(join(this.#directory, `pending-${digest(state!)}.json`), { serverUrl: this.serverUrl, accountKey: this.accountKey, expiresAt: record.pending.expiresAt, redirectUrl: this.redirectUrl });
    });
  }
  authorizationUrl(): string | undefined { const pending = this.#read().pending; return pending !== undefined && pending.expiresAt > this.now() ? pending.authorizationUrl : undefined; }
  saveDiscoveryState(value: OAuthDiscoveryState) { this.#update(record => { record.discovery = value; }); }
  discoveryState() { return this.#read().discovery; }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (this.#completing !== undefined && this.#read().pending?.state !== this.#completing.state) return;
    this.#update(record => {
      if (this.#completing !== undefined && record.pending?.state !== this.#completing.state) return;
      // A revoked/rotated credential cannot be restored or erased by a refresh
      // that began in another process before that mutation.
      if (this.#completing === undefined && this.#authority().captured && record.generation !== this.#authority().generation) return;
      if (scope === "all" || scope === "tokens") { record.generation = randomBytes(16).toString("hex"); this.#adoptGeneration(record.generation); }
      if (scope === "all" || scope === "client") delete record.clientInformation;
      if (scope === "all" || scope === "tokens") { delete record.tokens; delete record.expiresAt; }
      if (scope === "all" || scope === "discovery") delete record.discovery;
      if (scope === "all" || scope === "verifier") {
        if (record.pending !== undefined) remove(join(this.#directory, `pending-${digest(record.pending.state)}.json`));
        delete record.pending;
      }
    });
  }
  removeAccount(): void { this.invalidateCredentials("all"); remove(this.#file); }
  renameAccount(next: string): void {
    const record = this.#read();
    if (record.pending !== undefined) throw new Error("Finish or cancel sign-in before renaming this account");
    const destination = join(this.#directory, `${digest(JSON.stringify([this.serverUrl, next]))}.json`);
    if (destination === this.#file) return;
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    writeFileSync(destination, JSON.stringify({ ...record, accountKey: next }), { flag: "wx", mode: 0o600 });
    remove(this.#file);
  }
  async complete(state: string, code: string, fetchFn: typeof fetch = fetch): Promise<void> {
    const pending = this.#read().pending;
    if (!code || pending?.state !== state || pending.expiresAt <= this.now()) throw new Error("Unknown or expired OAuth callback");
    // Atomically claim the callback across processes; a second callback cannot
    // exchange the same code. Errors require a new sign-in, never fake success.
    const index = join(this.#directory, `pending-${digest(state)}.json`);
    const claimed = `${index}.${randomBytes(12).toString("hex")}.claimed`;
    try { renameSync(index, claimed); } catch { throw new Error("OAuth callback already consumed"); }
    this.#completing = pending;
    try {
      const boundedFetch: typeof fetch = (input, init) => fetchFn(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
      const result = await auth(this, { serverUrl: this.serverUrl, authorizationCode: code, fetchFn: boundedFetch });
      if (result !== "AUTHORIZED") throw new Error("OAuth token exchange did not authorize");
    } finally { remove(claimed); this.invalidateCredentials("verifier"); this.#completing = undefined; }
  }
}
export async function completeLocalMcpOAuth(root: string, args: { stateId: string; code: string }, fetchFn: typeof fetch = fetch, now = Date.now): Promise<void> {
  const pending = read<{ serverUrl: string; accountKey: string; expiresAt: number; redirectUrl: string }>(join(localMcpAuthDirectory(root), `pending-${digest(args.stateId)}.json`));
  if (pending === undefined || pending.expiresAt <= now()) throw new Error("Unknown or expired OAuth callback");
  const config = Object.values(readLocalMcpConfig(root).mcpServers).find(server => "url" in server && server.url === pending.serverUrl);
  const tls = createMcpTlsFetch(config !== undefined && "url" in config ? config.tls?.caBundle : undefined, fetchFn);
  try { await new LocalMcpOAuthProvider(root, pending.serverUrl, pending.accountKey, pending.redirectUrl, now).complete(args.stateId, args.code, tls.fetch); }
  finally { await tls.dispose(); }
}
export function localMcpAccounts(root: string, serverUrl: string): Array<{ accountKey: string; hasToken: boolean }> {
  let files: string[];
  try { files = readdirSync(localMcpAuthDirectory(root)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return files.filter(file => /^[a-f0-9]{64}\.json$/.test(file)).flatMap(file => {
    const record = read<Credentials>(join(localMcpAuthDirectory(root), file));
    return record?.serverUrl === serverUrl ? [{ accountKey: record.accountKey, hasToken: !!record.tokens?.access_token }] : [];
  });
}
