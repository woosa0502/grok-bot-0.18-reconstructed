import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { transform } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function loadModule() {
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

test("Codex auth accepts current and legacy ChatGPT token documents", async () => {
  const { isUsableCodexChatGptAuthDocument } = await loadModule();
  assert.equal(isUsableCodexChatGptAuthDocument({ auth_mode: "chatgpt", tokens }), true);
  assert.equal(isUsableCodexChatGptAuthDocument({ OPENAI_API_KEY: null, tokens }), true);
});

test("Codex auth rejects API-key, foreign-mode, and incomplete documents", async () => {
  const { isUsableCodexChatGptAuthDocument } = await loadModule();
  assert.equal(isUsableCodexChatGptAuthDocument({ OPENAI_API_KEY: "sk-example", tokens }), false);
  assert.equal(isUsableCodexChatGptAuthDocument({ auth_mode: "apikey", tokens }), false);
  assert.equal(isUsableCodexChatGptAuthDocument({ tokens: { ...tokens, refresh_token: "" } }), false);
  assert.equal(isUsableCodexChatGptAuthDocument(null), false);
});
