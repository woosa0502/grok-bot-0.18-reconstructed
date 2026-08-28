import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { transform } from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function loadStore() {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/pi-codex-credential-store.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function jwt(payload) {
  return `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("Belmont Pi CredentialStore persists, lists, serializes, and deletes credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-pi-credentials-"));
  try {
    const module = await loadStore();
    const file = path.join(root, "pi-auth.json");
    const store = new module.BelmontPiCredentialStore(file);
    await Promise.all([
      store.modify("openai-codex", async () => ({ type: "api_key", key: "first" })),
      store.modify("openai-codex", async current => ({ type: "api_key", key: `${current?.key ?? "missing"}:second` })),
    ]);
    assert.deepEqual(await store.read("openai-codex"), { type: "api_key", key: "first:second" });
    assert.deepEqual(await store.list(), [{ providerId: "openai-codex", type: "api_key" }]);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8"))["openai-codex"], { type: "api_key", key: "first:second" });
    await store.delete("openai-codex");
    assert.equal(await store.read("openai-codex"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy private Codex ChatGPT login migrates into the Pi provider credential", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-pi-migration-"));
  try {
    const module = await loadStore();
    const legacy = path.join(root, "legacy-auth.json");
    const target = path.join(root, "pi-auth.json");
    const expires = Math.floor(Date.now() / 1000) + 3_600;
    await writeFile(legacy, JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: jwt({ exp: expires }),
        refresh_token: "refresh",
        account_id: "account",
      },
    }), { mode: 0o600 });
    await chmod(legacy, 0o600);
    const store = new module.BelmontPiCredentialStore(target);
    assert.equal(await module.migrateLegacyCodexCredential(store, legacy), true);
    assert.deepEqual(await store.read("openai-codex"), {
      type: "oauth",
      access: jwt({ exp: expires }),
      refresh: "refresh",
      expires: expires * 1_000,
      accountId: "account",
    });
    assert.equal(await module.migrateLegacyCodexCredential(store, legacy), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy world-readable credentials are never imported", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "belmont-pi-public-"));
  try {
    const module = await loadStore();
    const legacy = path.join(root, "legacy-auth.json");
    await writeFile(legacy, JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: jwt({ exp: 1 }), refresh_token: "refresh", account_id: "account" },
    }), { mode: 0o644 });
    await chmod(legacy, 0o644);
    const store = new module.BelmontPiCredentialStore(path.join(root, "pi-auth.json"));
    assert.equal(await module.migrateLegacyCodexCredential(store, legacy), false);
    assert.equal(await store.read("openai-codex"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
