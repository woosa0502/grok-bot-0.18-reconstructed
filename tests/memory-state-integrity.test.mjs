import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = Date.parse("2026-09-08T00:00:00Z");
const debounce = { name: "memory-integrity", wrap: (fn) => Object.assign(fn, { dispose() {} }) };
const manualTrigger = { wrap: () => Object.assign(() => {}, { dispose() {} }) };
const loaded = build({
  stdin: {
    resolveDir: repoRoot,
    loader: "ts",
    contents: `
      export * from "./source/host/extensions/memory/memory-service.js";
      export { MemorySynthesisService } from "./source/host/extensions/memory/memory-synthesis-service.js";
      export { createSandAgentState } from "./source/host/extensions/memory/agent-state.js";
      export { createPromptUserMemory } from "./source/host/extensions/memory/extension.js";
      export { applyExtractedMemories, getEpisodeInterval, MEMORY_EPISODE_PREFIX } from "./source/host/runner/sand-memory.js";
      export { runTurnMemory } from "./source/host/runner/turn-memory.js";
      export { createRealRetryPolicy, createDeadlinePolicy, realClock } from "./source/internal/scheduling.js";
    `,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
}).then((result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "belmont-memory-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, ...await loaded };
}

function seed(memoryDir, profile = [], log = []) {
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(path.join(memoryDir, "profile.md"), `# About the user\n\n${profile.map(([date, content]) => `- (${date}) ${content}\n`).join("")}`);
  for (const [date, content] of log) {
    mkdirSync(path.join(memoryDir, "log"), { recursive: true });
    const file = path.join(memoryDir, "log", `${date.slice(0, 7)}.md`);
    const previous = existsSync(file) ? readFileSync(file, "utf8") : "# Memory log\n\n";
    writeFileSync(file, `${previous}- (${date}) ${content}\n`);
  }
}

function files(root) {
  if (!existsSync(root)) return {};
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(root, file), readFileSync(file, "utf8")];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function permutations(items) {
  return items.length === 0 ? [[]] : items.flatMap((item, index) => permutations(items.filter((_, other) => index !== other)).map((rest) => [item, ...rest]));
}

test("synthesis merge removes original targets before creating a fact with a reused id", async (t) => {
  const { root, FileMemoryStore, memoryIdFor } = await fixture(t);
  const changes = [
    { action: "create", content: "Consolidated preference", kind: "profile" },
    { action: "remove", id: memoryIdFor("Old preference") },
    { action: "remove", id: memoryIdFor("Consolidated preference") },
  ];
  let expectedFiles;
  for (const [index, batch] of permutations(changes).entries()) {
    const dir = path.join(root, String(index));
    seed(dir, [["2025-01-01", "Old preference"]], [["2025-02-01", "Consolidated preference"], ["2025-03-01", "Unrelated event"]]);
    const store = new FileMemoryStore(dir, debounce);
    assert.equal(store.applySynthesis(store.prepareSynthesis(), batch, now), "committed");
    assert.deepEqual(store.prepareSynthesis().memories.map(({ content, kind, origin }) => ({ content, kind, origin })), [
      { content: "Consolidated preference", kind: "profile", origin: "synthesis" },
      { content: "Unrelated event", kind: "log", origin: "legacy" },
    ]);
    expectedFiles ??= files(dir);
    assert.deepEqual(files(dir), expectedFiles, `permutation ${index} must have the same persisted state`);
  }
});

test("synthesis update chains preserve every result regardless of update order", async (t) => {
  const { root, FileMemoryStore, memoryIdFor } = await fixture(t);
  const changes = [
    { action: "update", id: memoryIdFor("Fact A"), content: "Fact B", kind: "profile" },
    { action: "update", id: memoryIdFor("Fact B"), content: "Fact C", kind: "log" },
  ];
  let expectedFiles;
  for (const [index, batch] of permutations(changes).entries()) {
    const dir = path.join(root, String(index));
    seed(dir, [["2025-01-01", "Fact A"], ["2025-01-01", "Fact B"]]);
    const store = new FileMemoryStore(dir, debounce);
    assert.equal(store.applySynthesis(store.prepareSynthesis(), batch, now), "committed");
    assert.deepEqual(store.listMemories().map(({ content, kind }) => [content, kind]), [["Fact B", "profile"], ["Fact C", "log"]]);
    expectedFiles ??= files(dir);
    assert.deepEqual(files(dir), expectedFiles);
  }
});

test("synthesis rejects invalid, protected, repeated, and stale targets without partial writes", async (t) => {
  const { root, FileMemoryStore, memoryIdFor } = await fixture(t);
  seed(root, [["2025-01-01", "Original fact"]]);
  const store = new FileMemoryStore(root, debounce);
  store.addMemory("Explicit instruction", now, "profile", "explicit");
  const originalId = memoryIdFor("Original fact");
  for (const tail of [
    [{ action: "remove", id: "missing-id" }],
    [{ action: "remove", id: memoryIdFor("Explicit instruction") }],
    [{ action: "remove", id: originalId }, { action: "update", id: originalId, content: "Replacement", kind: "profile" }],
    [{ action: "update", id: originalId, content: "   ", kind: "profile" }],
  ]) {
    const before = files(root);
    assert.equal(store.applySynthesis(store.prepareSynthesis(), [{ action: "create", content: "Must not appear", kind: "profile" }, ...tail], now), "invalid");
    assert.deepEqual(files(root), before);
  }
  const stale = store.prepareSynthesis();
  store.addMemory("Intervening addition", now, "log");
  const before = files(root);
  assert.equal(store.applySynthesis(stale, [{ action: "remove", id: originalId }], now), "stale");
  assert.deepEqual(files(root), before);
});

test("explicit writes made before synthesis is enabled keep protection after reopening", async (t) => {
  const { root, MemoryService, FileMemoryStore } = await fixture(t);
  const options = { agentsRootDir: path.join(root, "agents"), debounce };
  const service = new MemoryService(options);
  t.after(() => service.dispose());
  const added = service.add({ agentId: "writer", content: "Keep my Korean response preference", kind: "profile" });
  assert.ok(added);
  const store = new FileMemoryStore(service.storeForAgent("writer").getLocation(), debounce);
  assert.equal(store.prepareSynthesis().memories[0].origin, "explicit");
  service.enableMemorySynthesis({ start() {}, dispose() {} });
  const snapshot = store.prepareSynthesis();
  assert.equal(store.applySynthesis(snapshot, [{ action: "remove", id: added.id }], now), "invalid");
  assert.equal(store.listMemories()[0].content, added.content);
});

test("update_state marks agent, user, and project writes explicit without a dreaming bridge", async (t) => {
  const { root, FileMemoryStore, createSandAgentState, getUserMemoryShardDir, getProjectMemoryShardDir } = await fixture(t);
  const agentDir = path.join(root, "agents", "writer");
  const store = new FileMemoryStore(path.join(agentDir, "memory"), debounce);
  mkdirSync(path.join(root, "projects", "demo"), { recursive: true });
  const state = createSandAgentState({
    agentId: "writer", agentDir, sandRoot: root, memory: store,
    membership: { read: () => new Set(["demo"]) }, now: () => now,
  });
  for (const scope of ["agent", "user", "project"]) {
    assert.equal((await state.writeMemory({ content: `Explicit ${scope} instruction`, tier: "profile", scope, project: "demo" })).ok, true);
    const dir = scope === "agent" ? store.getLocation() : scope === "user" ? getUserMemoryShardDir(root, "writer") : getProjectMemoryShardDir(root, "demo", "writer");
    const reader = new FileMemoryStore(dir, debounce);
    const snapshot = reader.prepareSynthesis();
    assert.equal(snapshot.memories[0].origin, "explicit", scope);
    assert.equal(reader.applySynthesis(snapshot, [{ action: "remove", id: snapshot.memories[0].id }], now), "invalid", scope);
  }
});

test("legacy automatic extraction stays mutable while duplicate explicit writes become protected", async (t) => {
  const { root, MemoryService, applyExtractedMemories } = await fixture(t);
  const service = new MemoryService({ agentsRootDir: path.join(root, "agents"), debounce });
  t.after(() => service.dispose());
  const store = service.storeForAgent("writer");
  applyExtractedMemories(store, { additions: [{ content: "Automatic baseline", kind: "profile" }, { content: "User later confirms this", kind: "profile" }], removals: [] }, now, []);
  assert.ok(store.prepareSynthesis().memories.every((item) => item.origin === "legacy"));
  assert.equal(service.add({ agentId: "writer", content: "User later confirms this", kind: "profile" }), null);
  service.enableMemorySynthesis({ start() {}, dispose() {} });
  const snapshot = store.prepareSynthesis();
  const automatic = snapshot.memories.find((item) => item.content === "Automatic baseline");
  assert.equal(automatic.origin, "legacy");
  assert.equal(snapshot.memories.find((item) => item.content === "User later confirms this").origin, "explicit");
  assert.equal(store.applySynthesis(snapshot, [{ action: "remove", id: automatic.id }], now), "committed");
  store.addMemory("Existing direct store convention", now, "log");
  assert.equal(store.prepareSynthesis().memories.find((item) => item.content === "Existing direct store convention").origin, "explicit");
});

for (const enableDuringExtraction of [false, true]) {
  test(`turn extraction preserves explicit memories and automatic provenance (enable while pending: ${enableDuringExtraction})`, async (t) => {
    const { root, MemoryService, runTurnMemory } = await fixture(t);
    const service = new MemoryService({ agentsRootDir: path.join(root, "agents"), debounce });
    t.after(() => service.dispose());
    const explicit = service.add({ agentId: "writer", content: "Keep my concise response preference", kind: "profile" });
    const store = service.storeForAgent("writer");
    store.addMemory("Old automatically extracted fact", now, "profile");
    const started = Promise.withResolvers(), release = Promise.withResolvers();
    const prompts = [];
    const executor = {
      appendMessages(messages) { prompts.push(...messages); },
      stream() {
        return { fullStream: (async function* () {
          started.resolve();
          await release.promise;
          yield { type: "text-delta", textDelta: `remove: ${explicit.content}\nremove: Old automatically extracted fact\nprofile: New automatically extracted fact` };
        })() };
      },
    };
    const running = runTurnMemory(store, null, { getExecutor: () => executor }, {}, now, { user: "My situation has changed", agent: "Understood" });
    await started.promise;
    assert.ok(prompts.some(({ content }) => content.includes(explicit.content)), "the automatic removal candidate was visible to extraction");
    if (enableDuringExtraction) service.enableMemorySynthesis({ start() {}, dispose() {} });
    release.resolve();
    await running;
    const memories = store.prepareSynthesis().memories;
    assert.equal(memories.find((item) => item.id === explicit.id)?.origin, "explicit");
    assert.equal(memories.find((item) => item.content === "New automatically extracted fact")?.origin, "legacy");
    assert.equal(memories.some((item) => item.content === "Old automatically extracted fact"), false, "automatic facts remain removable");
    assert.equal(store.removeMemoryByContent(explicit.content), true, "public user forget still removes an explicit fact");
    assert.equal(store.removeMemoryByContent(explicit.content), false);
  });
}

test("episode summaries retain automatic provenance if synthesis activates while the summary is pending", async (t) => {
  const { root, MemoryService, runTurnMemory, getEpisodeInterval, MEMORY_EPISODE_PREFIX } = await fixture(t);
  const service = new MemoryService({ agentsRootDir: path.join(root, "agents"), debounce });
  t.after(() => service.dispose());
  const store = service.storeForAgent("writer");
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const turns = Array.from({ length: getEpisodeInterval() - 1 }, () => ({ ts: now, user: "Earlier turn", agent: "Earlier reply" }));
  let calls = 0;
  const executor = {
    appendMessages() {},
    stream() {
      const extraction = calls++ === 0;
      return { fullStream: (async function* () {
        if (!extraction) { started.resolve(); await release.promise; }
        yield { type: "text-delta", textDelta: extraction ? "NONE" : "The user made progress on the project" };
      })() };
    },
  };
  const running = runTurnMemory(store, {
    recordEpisodeTurn(turn) { turns.push(turn); },
    getPendingEpisodeTurns: () => turns,
    clearPendingEpisodeTurns() { turns.length = 0; },
  }, { getExecutor: () => executor }, {}, now, { user: "A project update", agent: "Understood" });
  await started.promise;
  service.enableMemorySynthesis({ start() {}, dispose() {} });
  release.resolve();
  await running;
  const memories = store.prepareSynthesis().memories;
  assert.equal(calls, 2);
  assert.deepEqual(memories.map(({ content, kind, origin }) => ({ content, kind, origin })), [{ content: `${MEMORY_EPISODE_PREFIX}The user made progress on the project`, kind: "log", origin: "legacy" }]);
  assert.equal(turns.length, 0);
});

test("removing or clearing explicit facts while synthesis is disabled preserves tombstones", async (t) => {
  const { root, MemoryService, memoryIdFor } = await fixture(t);
  for (const action of ["remove", "clear"]) {
    const service = new MemoryService({ agentsRootDir: path.join(root, action), debounce });
    t.after(() => service.dispose());
    service.add({ agentId: "writer", content: "Forgotten explicit preference", kind: "profile" });
    const store = service.storeForAgent("writer");
    if (action === "remove") service.remove({ agentId: "writer", id: memoryIdFor("Forgotten explicit preference") });
    else service.clear({ agentId: "writer" });
    assert.equal(existsSync(path.join(store.explicitDir, `${memoryIdFor("Forgotten explicit preference")}.memory`)), false);
    assert.equal(store.applySynthesis(store.prepareSynthesis(), [{ action: "create", content: "Forgotten explicit preference", kind: "profile" }], now), "committed");
    assert.deepEqual(store.listMemories(), []);
    service.add({ agentId: "writer", content: "Forgotten explicit preference", kind: "profile" });
    assert.equal(store.prepareSynthesis().memories[0].origin, "explicit");
    assert.deepEqual(readdirSync(store.tombstoneDir), []);
  }
});

test("shared recall ranks all shards before its profile cap and preserves newer provenance", async (t) => {
  const { root, UserMemoryStore, getUserMemoryShardDir, createPromptUserMemory } = await fixture(t);
  seed(getUserMemoryShardDir(root, "a-old"), Array.from({ length: 65 }, (_, index) => ["2020-01-01", `Old preference ${index}`]));
  seed(getUserMemoryShardDir(root, "z-new"), [["2026-09-08", "Current response preference"]]);
  const names = { "a-old": "Old assistant", "z-new": "New assistant" };
  const store = new UserMemoryStore(root, "z-new", (id) => names[id], debounce);
  const limited = store.recall({ profile: 50, recent: 20 });
  assert.equal(limited.profile.length, 50);
  assert.deepEqual([limited.profile[0].content, limited.profile[0].agentId, limited.profile[0].agentName], ["Current response preference", "z-new", "New assistant"]);
  assert.equal(store.recall({ profile: 70, recent: 0 }).profile.length, 66, "per-shard prompt limits must not truncate the global candidate pool");
  const prompt = createPromptUserMemory(root, debounce, { agentId: "z-new", resolveAgentName: (id) => names[id] }).recall({ profileLimit: 1, recentLimit: 0 });
  assert.deepEqual([prompt.profile[0].content, prompt.profile[0].via], ["Current response preference", "New assistant"]);
});

test("shared recall deduplicates normalized facts before caps for profile and recent memories", async (t) => {
  const { root, UserMemoryStore, getUserMemoryShardDir } = await fixture(t);
  const duplicates = [["2026-09-01", "Shared fact"], ["2026-09-02", "shared fact"], ["2026-08-01", "Another useful fact"]];
  seed(getUserMemoryShardDir(root, "a"), duplicates, duplicates);
  seed(getUserMemoryShardDir(root, "z"), [["2026-09-08", "SHARED FACT"]], [["2026-09-08", "SHARED FACT"]]);
  const store = new UserMemoryStore(root, "a", (id) => `Assistant ${id}`, debounce);
  const result = store.recall({ profile: 2, recent: 2 });
  for (const records of [result.profile, result.recent]) {
    assert.deepEqual(records.map(({ content, agentId }) => [content, agentId]), [["SHARED FACT", "z"], ["Another useful fact", "a"]]);
  }
  assert.deepEqual(store.recall({ profile: -1, recent: -1 }), { profile: [], recent: [] });
});

for (const mode of ["commit", "temporal-no-work"]) {
  test(`disposal after successful synthesis completion prevents late ${mode} writes and reports`, async (t) => {
    const { root, FileMemoryStore, MemorySynthesisService, createRealRetryPolicy, createDeadlinePolicy, realClock } = await fixture(t);
    const store = new FileMemoryStore(path.join(root, "memory"), debounce);
    if (mode === "temporal-no-work") seed(store.getLocation(), [["2025-01-01", "Existing durable fact"]]);
    const before = files(store.getLocation()), reports = [], stages = [];
    const retry = createRealRetryPolicy({ name: "integrity-retry", maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 });
    let service;
    service = new MemorySynthesisService({
      now: () => now,
      debounce: manualTrigger,
      getTarget: () => store,
      listTargets: () => mode === "temporal-no-work" ? [{ agentId: "writer", target: store }] : [],
      deadline: createDeadlinePolicy(realClock, { name: "integrity-deadline", timeoutMs: 1_000 }),
      retry: {
        async runWithRetry(work, signal) {
          const result = await retry.runWithRetry(work, signal);
          // Settle the actual retry/deadline path, then dispose before the
          // service resumes with the completed result. No time-based race.
          service.dispose();
          return result;
        },
      },
      createExecutor(stage) {
        stages.push(stage);
        return {
          appendMessages() {},
          stream() {
            return { fullStream: (async function* () {
              const result = stage === "verification" ? { approved: true } : { changes: mode === "commit" ? [{ action: "create", content: "The user lives in Seoul", kind: "profile", sourceEvidenceIds: ["evidence"] }] : [] };
              yield { type: "text-delta", textDelta: JSON.stringify(result) };
            })() };
          },
        };
      },
      report: (report) => reports.push(report),
    });
    t.after(() => service.dispose());
    service.start();
    if (mode === "commit") service.recordTurn("writer", { id: "evidence", occurredAt: now, user: "I live in Seoul", assistant: "Understood" });
    assert.deepEqual(await service.runNow(), ["no-work"]);
    assert.deepEqual(stages, mode === "commit" ? ["synthesis", "verification"] : ["synthesis"]);
    assert.deepEqual(files(store.getLocation()), before);
    assert.deepEqual(reports, []);
  });
}
