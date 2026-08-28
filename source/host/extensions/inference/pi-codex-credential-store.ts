import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai";

type StoredCredentials = Record<string, Credential>;
type Loose = Record<string, unknown>;

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;

function record(value: unknown): Loose | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Loose : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function cloneCredential<T extends Credential | undefined>(value: T): T {
  return value == null ? value : structuredClone(value);
}

function isCredential(value: unknown): value is Credential {
  const candidate = record(value);
  if (candidate?.type === "api_key") {
    if (candidate.key !== undefined && typeof candidate.key !== "string") return false;
    const env = candidate.env;
    return env === undefined || (record(env) != null && Object.values(env as Loose).every(item => typeof item === "string"));
  }
  return candidate?.type === "oauth"
    && typeof candidate.access === "string"
    && candidate.access.length > 0
    && typeof candidate.refresh === "string"
    && candidate.refresh.length > 0
    && typeof candidate.expires === "number"
    && Number.isFinite(candidate.expires);
}

function parseStore(value: unknown): StoredCredentials {
  const root = record(value);
  if (root == null) return {};
  const entries: StoredCredentials = {};
  for (const [providerId, credential] of Object.entries(root)) {
    if (providerId.length > 0 && isCredential(credential)) entries[providerId] = credential;
  }
  return entries;
}

function errorCode(error: unknown): string | undefined {
  return record(error)?.code as string | undefined;
}

function jwtExpiry(token: string): number {
  try {
    const payload = record(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")));
    return typeof payload?.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1_000 : 0;
  } catch {
    return 0;
  }
}

async function acquireFileLock(path: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  while (true) {
    signal?.throwIfAborted();
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return async () => await rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info != null && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await sleep(LOCK_RETRY_MS, signal);
    }
  }
}

export class BelmontPiCredentialStore implements CredentialStore {
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(readonly path: string) {}

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return cloneCredential((await this.#readAll())[providerId]);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const credentials = await this.#readAll();
    return Object.entries(credentials).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.#enqueue(providerId, options?.signal, async () => {
      const release = await acquireFileLock(this.path, options?.signal);
      try {
        const credentials = await this.#readAll();
        const current = cloneCredential(credentials[providerId]);
        const requested = await fn(current);
        options?.signal?.throwIfAborted();
        if (requested !== undefined) {
          if (!isCredential(requested)) throw new TypeError(`Invalid Pi credential for ${providerId}`);
          credentials[providerId] = cloneCredential(requested);
          await this.#writeAll(credentials);
          return cloneCredential(requested);
        }
        return current;
      } finally {
        await release();
      }
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.#enqueue(providerId, options?.signal, async () => {
      const release = await acquireFileLock(this.path, options?.signal);
      try {
        const credentials = await this.#readAll();
        if (credentials[providerId] === undefined) return;
        delete credentials[providerId];
        await this.#writeAll(credentials);
      } finally {
        await release();
      }
    });
  }

  async #readAll(): Promise<StoredCredentials> {
    try {
      return parseStore(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return {};
      throw error;
    }
  }

  async #writeAll(credentials: StoredCredentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, this.path);
  }

  #enqueue<T>(providerId: string, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(providerId) ?? Promise.resolve();
    const operation = (async () => {
      await previous.catch(() => {});
      signal?.throwIfAborted();
      return await task();
    })();
    const tail = operation.catch(() => {});
    this.#chains.set(providerId, tail);
    void tail.then(() => {
      if (this.#chains.get(providerId) === tail) this.#chains.delete(providerId);
    });
    return operation;
  }
}

export function defaultLegacyCodexAuthPath(): string {
  return join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "auth.json");
}

export async function migrateLegacyCodexCredential(
  store: BelmontPiCredentialStore,
  legacyPath = defaultLegacyCodexAuthPath(),
  providerId = "openai-codex",
): Promise<boolean> {
  if (await store.read(providerId) !== undefined) return false;
  let parsed: Loose;
  try {
    const info = await lstat(legacyPath);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) return false;
    parsed = record(JSON.parse(await readFile(legacyPath, "utf8"))) ?? {};
  } catch {
    return false;
  }
  if (typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.length > 0) return false;
  if (parsed.auth_mode !== undefined && parsed.auth_mode !== "chatgpt") return false;
  const tokens = record(parsed.tokens);
  const access = tokens?.access_token;
  const refresh = tokens?.refresh_token;
  const accountId = tokens?.account_id;
  if (typeof access !== "string" || typeof refresh !== "string" || typeof accountId !== "string") return false;
  const credential: OAuthCredential = {
    type: "oauth",
    access,
    refresh,
    expires: jwtExpiry(access),
    accountId,
  };
  await store.modify(providerId, async current => current ?? credential);
  return true;
}
