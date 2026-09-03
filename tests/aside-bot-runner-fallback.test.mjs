// The browser roster bot retries a fresh task once with the strong model when the cheap default model fails.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function loadRunnerModule() {
  const result = await build({ absWorkingDir: repoRoot, bundle: true, entryPoints: ["source/host/extensions/browse-runtime/aside-bot-runner.ts"], format: "esm", platform: "node", target: "node22", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("a failed first session is retried once with gpt-5.5 and the retry's answer is delivered", async () => {
  const sandRoot = mkdtempSync(path.join(os.tmpdir(), "belmont-aside-bot-"));
  const agentId = "11111111-2222-4333-8444-555555555555";
  mkdirSync(path.join(sandRoot, "agents", agentId), { recursive: true });
  writeFileSync(path.join(sandRoot, "agents", agentId, "profile.json"), JSON.stringify({ runtime: "aside-browse" }));
  process.env.SAND_DATA_ROOT = sandRoot;
  try {
    const { wrapRunnerForAsideBot, isAsideBotAgent } = await loadRunnerModule();
    assert.equal(isAsideBotAgent(agentId), true);
    const created = [];
    const client = {
      create: async (body) => { created.push(body); return { id: `s${created.length}`, status: "queued" }; },
      get: async (id) => (id === "s1" ? { status: "error", error: "model exploded", activity: [], toolCalls: 0 } : { status: "done", result: "완료: 3개", activity: [], toolCalls: 2 }),
      answer: async () => { throw new Error("unexpected"); }, continue: async () => { throw new Error("unexpected"); }, stop: async () => ({}),
    };
    const sent = [];
    const runner = { run: async () => { throw new Error("must not delegate"); }, interrupt() {}, getObservedToolCallCount: () => 0, getActivitySnapshot: () => [] };
    const wrapped = wrapRunnerForAsideBot(runner, agentId, { client: () => client, emitUpdate: (u) => sent.push(u), log: () => {} });
    const result = await wrapped.run("네이버에서 날씨 찾아줘");
    assert.equal(created.length, 2);
    assert.equal(created[0].model, undefined);
    assert.deepEqual({ model: created[1].model, thinking: created[1].thinking }, { model: "gpt-5.5", thinking: "high" });
    assert.equal(result.text, "완료: 3개");
    const texts = sent.map((u) => u.message?.content ?? "");
    assert.ok(texts.some((t) => t.includes("다시 시도")), "user is told about the retry");
    assert.equal(texts.at(-1), "완료: 3개");
  } finally {
    delete process.env.SAND_DATA_ROOT;
    rmSync(sandRoot, { recursive: true, force: true });
  }
});
