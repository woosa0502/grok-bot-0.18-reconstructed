import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { transform } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function loadLegacyParser() {
  const source = await readFile(path.join(repositoryRoot, "source/shared/node/inference-router-local.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const tokens = {
  access_token: "access",
  refresh_token: "refresh",
  id_token: "id",
  account_id: "account",
};

test("legacy Codex auth parser remains available only as a migration source", async () => {
  const { isUsableCodexChatGptAuthDocument } = await loadLegacyParser();
  assert.equal(isUsableCodexChatGptAuthDocument({ auth_mode: "chatgpt", tokens }), true);
  assert.equal(isUsableCodexChatGptAuthDocument({ OPENAI_API_KEY: null, tokens }), true);
  assert.equal(isUsableCodexChatGptAuthDocument({ OPENAI_API_KEY: "sk-example", tokens }), false);
  assert.equal(isUsableCodexChatGptAuthDocument({ auth_mode: "apikey", tokens }), false);
  assert.equal(isUsableCodexChatGptAuthDocument({ tokens: { ...tokens, refresh_token: "" } }), false);
  assert.equal(isUsableCodexChatGptAuthDocument(null), false);
});

test("routed Codex auth, refresh, login, logout, and status belong to Pi ModelRuntime", async () => {
  const provider = await readFile(path.join(repositoryRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  const runtime = await readFile(path.join(repositoryRoot, "source/host/extensions/inference/pi-codex-runtime.ts"), "utf8");
  const store = await readFile(path.join(repositoryRoot, "source/host/extensions/inference/pi-codex-credential-store.ts"), "utf8");
  const cli = await readFile(path.join(repositoryRoot, "scripts/pi-codex-auth.mjs"), "utf8");
  assert.doesNotMatch(provider, /auth\.openai\.com\/oauth\/token|chatgpt\.com\/backend-api\/codex/);
  // A literal specifier (not a variable) so esbuild statically bundles pi-codex-runtime into the
  // packaged host bundle; a variable dynamic import is left external and fails at runtime. (PI-P0-01)
  assert.match(provider, /import\("\.\/pi-codex-runtime\.js"\)/);
  assert.match(runtime, /ModelRuntime\.create\(\{/);
  assert.match(runtime, /credentials,/);
  assert.match(runtime, /models\.login\(CODEX_PROVIDER, "oauth", interaction\)/);
  assert.match(runtime, /models\.logout\(CODEX_PROVIDER/);
  assert.match(runtime, /getProviderAuthStatus\(CODEX_PROVIDER\)/);
  assert.match(store, /implements CredentialStore/);
  assert.match(store, /migrateLegacyCodexCredential/);
  assert.match(cli, /runtime\.login\(PROVIDER, "oauth"/);
  assert.match(cli, /runtime\.logout\(PROVIDER\)/);
});
