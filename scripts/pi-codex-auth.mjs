#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";

// One credential source of truth per profile (AUDIT-W14): the default matches the
// path the WSL host runtime reads (<profile>/sand-data/pi-auth.json), so the
// documented `npm run codex:auth:login` → `npm run wsl:start` sequence shares one
// location. Env overrides and the legacy ~/.grokbot path (read-only fallback for
// logins made before unification; the host migrates it on first start) still work.
function profileCredentialPath() {
  if (process.env.SAND_PI_CODEX_AUTH_PATH?.trim()) return path.resolve(process.env.SAND_PI_CODEX_AUTH_PATH.trim());
  if (process.env.SAND_DATA_ROOT?.trim()) return path.join(path.resolve(process.env.SAND_DATA_ROOT.trim()), "pi-auth.json");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const profileDir = process.env.BELMONT_WSL_PROFILE?.trim() || path.join(repoRoot, ".cache", "belmont-wsl-profile");
  return path.join(profileDir, "sand-data", "pi-auth.json");
}

function credentialPath({ forWrite = false } = {}) {
  const profilePath = profileCredentialPath();
  if (forWrite) return profilePath; // login always writes the profile store
  const legacyPath = path.join(homedir(), ".grokbot", "pi-auth.json");
  // status/logout: prefer the profile store; fall back to a pre-unification CLI
  // login only when the profile has no store yet (the host migrates it on start).
  return existsSync(profilePath) || !existsSync(legacyPath) ? profilePath : legacyPath;
}

class JsonCredentialStore {
  #chains = new Map();

  constructor(filePath) {
    this.path = filePath;
  }

  async #readAll() {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  }

  async #writeAll(value) {
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.path);
  }

  #enqueue(providerId, signal, task) {
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

  async read(providerId, options) {
    options?.signal?.throwIfAborted();
    return structuredClone((await this.#readAll())[providerId]);
  }

  async list(options) {
    options?.signal?.throwIfAborted();
    return Object.entries(await this.#readAll()).flatMap(([providerId, credential]) => {
      return credential?.type === "api_key" || credential?.type === "oauth" ? [{ providerId, type: credential.type }] : [];
    });
  }

  modify(providerId, fn, options) {
    return this.#enqueue(providerId, options?.signal, async () => {
      const all = await this.#readAll();
      const current = structuredClone(all[providerId]);
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next !== undefined) {
        all[providerId] = next;
        await this.#writeAll(all);
        return structuredClone(next);
      }
      return current;
    });
  }

  delete(providerId, options) {
    return this.#enqueue(providerId, options?.signal, async () => {
      const all = await this.#readAll();
      delete all[providerId];
      if (Object.keys(all).length === 0) await rm(this.path, { force: true });
      else await this.#writeAll(all);
    });
  }
}

async function createRuntime(storePath) {
  return await ModelRuntime.create({
    credentials: new JsonCredentialStore(storePath ?? credentialPath()),
    modelsPath: null,
    allowModelNetwork: false,
  });
}

async function login(runtime) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const method = process.env.SAND_CODEX_LOGIN_METHOD === "browser" ? "browser" : "device_code";
  try {
    await runtime.login(PROVIDER, "oauth", {
      async prompt(prompt) {
        if (prompt.type === "select") {
          const supported = prompt.options.some(option => option.id === method);
          if (!supported) throw new Error(`Pi Codex login does not offer ${method}`);
          return method;
        }
        return await readline.question(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `);
      },
      notify(event) {
        if (event.type === "auth_url") console.log(`Open: ${event.url}`);
        else if (event.type === "device_code") {
          console.log(`Open: ${event.verificationUri}`);
          console.log(`Code: ${event.userCode}`);
        } else if (event.type === "info" || event.type === "progress") {
          console.log(event.message);
        }
      },
    });
  } finally {
    readline.close();
  }
}

async function main() {
  const command = process.argv[2] ?? "status";
  const runtime = await createRuntime(command === "login" ? credentialPath({ forWrite: true }) : undefined);
  if (command === "status") {
    const status = runtime.getProviderAuthStatus(PROVIDER);
    console.log(JSON.stringify({ provider: PROVIDER, path: credentialPath(), ...status }, null, 2));
    process.exitCode = status.configured ? 0 : 1;
    return;
  }
  if (command === "models") {
    console.log(runtime.getModels(PROVIDER).map(model => model.id).sort().join("\n"));
    return;
  }
  if (command === "login") {
    await login(runtime);
    console.log(`Signed in to ${PROVIDER}.`);
    return;
  }
  if (command === "logout") {
    await runtime.logout(PROVIDER);
    console.log(`Signed out of ${PROVIDER}.`);
    return;
  }
  throw new Error(`Usage: npm run codex:auth:<status|login|logout> or npm run codex:models`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
