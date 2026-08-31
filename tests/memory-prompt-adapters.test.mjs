// Prompt-facing user/project memory adapters (AUDIT-1): shards written by
// update_state are read back with provenance and project grouping.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModules() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "memory-adapters-entry.ts",
      contents: `
        export { createPromptUserMemory, createPromptProjectMemory } from "./source/host/extensions/memory/extension.js";
        export { FileMemoryStore, getUserMemoryShardDir, getProjectMemoryShardDir } from "./source/host/extensions/memory/memory-service.js";
        export { createRealDebouncePolicy } from "./source/internal/scheduling.js";
      `,
    },
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("user memory adapter merges shards from every agent and tags provenance", async () => {
  const { createPromptUserMemory, FileMemoryStore, getUserMemoryShardDir, createRealDebouncePolicy } = await loadModules();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-memory-"));
  try {
    const debounce = createRealDebouncePolicy({ name: "test", delayMs: 0 });
    new FileMemoryStore(getUserMemoryShardDir(root, "agent-a"), debounce).addMemory("User prefers Korean replies", 1_000, "profile");
    new FileMemoryStore(getUserMemoryShardDir(root, "agent-b"), debounce).addMemory("Weekly report goes out Friday", 2_000, "log");
    const names = { "agent-a": "Alpha", "agent-b": "Beta" };
    const userMemory = createPromptUserMemory(root, debounce, { agentId: "agent-a", resolveAgentName: (id) => names[id] ?? null });
    const recall = userMemory.recall({ profileLimit: 50, recentLimit: 15 });
    assert.deepEqual(recall.profile.map((m) => [m.content, m.via]), [["User prefers Korean replies", "Alpha"]]);
    assert.deepEqual(recall.recent.map((m) => [m.content, m.via]), [["Weekly report goes out Friday", "Beta"]]);
    assert.equal(userMemory.getOwnShardLocation(), getUserMemoryShardDir(root, "agent-a"));
    assert.equal(userMemory.getLocation(), path.join(root, "user-memory"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project memory adapter builds one block per joined project and caps injected blocks", async () => {
  const { createPromptProjectMemory, FileMemoryStore, getProjectMemoryShardDir, createRealDebouncePolicy } = await loadModules();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-memory-"));
  try {
    const debounce = createRealDebouncePolicy({ name: "test", delayMs: 0 });
    const agentDir = path.join(root, "agents", "agent-a");
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "projects.json"), JSON.stringify({ projects: ["belmont", "quiet-project"] }));
    new FileMemoryStore(getProjectMemoryShardDir(root, "belmont", "agent-b"), debounce).addMemory("Belmont uses Node 26", 3_000, "profile");
    const projectMemory = createPromptProjectMemory(root, debounce, { agentDir, agentId: "agent-a", resolveAgentName: (id) => (id === "agent-b" ? "Beta" : null) });
    const recall = projectMemory.recall({ profileLimit: 25, recentLimit: 10 }, 1);
    assert.equal(recall.injected.length, 1);
    assert.equal(recall.injected[0].slug, "belmont");
    assert.deepEqual(recall.injected[0].recall.profile.map((m) => [m.content, m.via]), [["Belmont uses Node 26", "Beta"]]);
    assert.equal(recall.injected[0].ownShardDir, getProjectMemoryShardDir(root, "belmont", "agent-a"));
    assert.deepEqual(recall.alsoMemberOf, [{ slug: "quiet-project", name: "quiet-project" }]);
    assert.equal(projectMemory.getLocation(), path.join(root, "projects"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory E2E (AUDIT-F5): a fact written by one process instance is recalled by a fresh one, and removal sticks", async () => {
  const { createPromptUserMemory, FileMemoryStore, getUserMemoryShardDir, createRealDebouncePolicy } = await loadModules();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-memory-e2e-"));
  try {
    const debounce = createRealDebouncePolicy({ name: "test", delayMs: 0 });
    // "Process 1": the agent stores a durable preference (the same write path
    // update_state's memory target uses).
    const writer = new FileMemoryStore(getUserMemoryShardDir(root, "belmont"), debounce);
    writer.addMemory("External uploads always need prior approval", 1_000, "profile");
    // "Process 2" (fresh instances over the same files — a restart): recall
    // through the prompt adapter must surface the fact.
    const reader = createPromptUserMemory(root, createRealDebouncePolicy({ name: "test2", delayMs: 0 }), { agentId: "belmont", resolveAgentName: () => "Belmont" });
    const recall = reader.recall({ profileLimit: 50, recentLimit: 15 });
    assert.ok(recall.profile.some((memory) => memory.content === "External uploads always need prior approval"), "restart-surviving recall");
    // Correction: removing the fact in a third instance is durable too.
    const editor = new FileMemoryStore(getUserMemoryShardDir(root, "belmont"), createRealDebouncePolicy({ name: "test3", delayMs: 0 }));
    const stored = editor.listMemories().find((memory) => memory.content === "External uploads always need prior approval");
    assert.ok(stored != null);
    editor.removeMemory(stored.id);
    const reader2 = createPromptUserMemory(root, createRealDebouncePolicy({ name: "test4", delayMs: 0 }), { agentId: "belmont", resolveAgentName: () => "Belmont" });
    assert.ok(!reader2.recall({ profileLimit: 50, recentLimit: 15 }).profile.some((memory) => memory.content.includes("External uploads")), "removal survives a fresh instance");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
