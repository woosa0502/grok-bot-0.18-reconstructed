import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".build"), { recursive: true });
const temporary = await mkdtemp(path.join(root, ".build/session-activation-test-"));
const output = path.join(temporary, "runtime.mjs");
await build({ entryPoints: [path.join(root, "source/host/extensions/transcript/session-runtime.ts")], outfile: output, bundle: true, platform: "node", format: "esm", target: "node26" });
const { SessionRuntime } = await import(pathToFileURL(output).href);
test.after(() => rm(temporary, { recursive: true, force: true }));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const events = [];
  const ids = [];
  const gates = new Map();
  const sessions = new Map(["alpha", "beta", "gamma"].map((id) => [id, {
    id,
    dbPath: `/fixture/${id}/agent.db`,
    db: {
      getTranscriptEntries: () => [{ id: `${id}-entry`, kind: "message", text: id }],
      getTranscriptTail: () => ({ entries: [{ id: `${id}-entry`, kind: "message", text: id }] }),
    },
  }]));
  const tm = {
    disposed: false,
    roster: { emit: (event) => events.push(event), emitAgentUpdate: async () => {}, invalidateActiveOutline() {} },
    automationRuntime: { enqueueAutomationLifecycleMutation: async () => {}, lastKnownAutomations: new Map() },
    runLifecycle: { watchActiveSession() {}, retireSession: async () => {} },
    taskBoundary: { settled: async () => {} },
    sessionStore: {
      openSession: async (id) => { await gates.get(id)?.promise; return sessions.get(id); },
      agentExists: () => true,
      markSessionViewed: async () => {},
      markAgentViewed() {},
      writeActiveAgentId: (id) => ids.push(id),
      readAgentTranscriptTail: (id) => sessions.get(id).db.getTranscriptTail(),
    },
  };
  const runtime = new SessionRuntime(tm);
  runtime.setActiveSession(sessions.get("alpha"));
  runtime.setActiveTranscript("alpha", sessions.get("alpha").db.getTranscriptEntries());
  runtime.loaded = true;
  return { runtime, tm, sessions, gates, events, ids };
}

test("returning to the active bot cancels an earlier cold switch", async () => {
  const f = fixture();
  const gate = deferred();
  f.gates.set("beta", gate);
  const pending = f.runtime.switchAgent("beta");
  await f.runtime.switchAgent("alpha");
  gate.resolve();
  await pending;
  assert.equal(f.runtime.getActiveAgentId(), "alpha");
  assert.equal(f.runtime.inMemoryTranscriptAgentId, "alpha");
  assert.deepEqual(f.events, []);
});

test("the newest explicit switch wins when session opens finish out of order", async () => {
  const f = fixture();
  const gate = deferred();
  f.gates.set("beta", gate);
  const pending = f.runtime.switchAgent("beta");
  await f.runtime.switchAgent("gamma");
  gate.resolve();
  await pending;
  assert.equal(f.runtime.getActiveAgentId(), "gamma");
  assert.deepEqual(f.events.map((event) => event.activeAgentId), ["gamma"]);
});

test("a bounded active-bot open supersedes a pending explicit switch", async () => {
  const f = fixture();
  const gate = deferred();
  f.gates.set("beta", gate);
  const pending = f.runtime.switchAgent("beta");
  await f.runtime.openAgentTail("alpha", 20);
  gate.resolve();
  await pending;
  assert.equal(f.runtime.getActiveAgentId(), "alpha");
});

test("a pending warm activation cannot replace a later bot choice", async () => {
  const f = fixture();
  f.runtime.liveSessions.set("beta", f.sessions.get("beta"));
  const entered = deferred();
  const gate = deferred();
  f.tm.sessionStore.markSessionViewed = async (session) => {
    if (session.id === "beta") { entered.resolve(); await gate.promise; }
  };
  const pending = f.runtime.openAgentTail("beta", 20);
  await entered.promise;
  await f.runtime.switchAgent("alpha");
  gate.resolve();
  await pending;
  assert.equal(f.runtime.getActiveAgentId(), "alpha");
});

test("a normal switch updates session, transcript and snapshot together", async () => {
  const f = fixture();
  const entries = await f.runtime.switchAgent("beta");
  assert.equal(f.runtime.getActiveAgentId(), "beta");
  assert.equal(f.runtime.inMemoryTranscriptAgentId, "beta");
  assert.deepEqual(f.events, [{ type: "snapshot", activeAgentId: "beta", entries }]);
  assert.equal(f.ids.at(-1), "beta");
});

test("a slow initial transcript read cannot overwrite a subsequent switch", async () => {
  const f = fixture();
  const gate = deferred();
  const entered = deferred();
  f.runtime.loaded = false;
  f.tm.sessionStore.getTranscriptEntries = async (session) => {
    entered.resolve();
    await gate.promise;
    return session.db.getTranscriptEntries();
  };
  const pending = f.runtime.ensureLoaded();
  await entered.promise;
  await f.runtime.switchAgent("beta");
  gate.resolve();
  assert.deepEqual(await pending, f.sessions.get("beta").db.getTranscriptEntries());
  assert.equal(f.runtime.inMemoryTranscriptAgentId, "beta");
  assert.deepEqual(f.events.map((event) => event.activeAgentId), ["beta"]);
});

test("a slow default session open cannot overwrite an explicit startup choice", async () => {
  const f = fixture();
  f.runtime.activeSession = undefined;
  f.runtime.liveSessions.clear();
  f.tm.sessionStore.listAgents = async () => [{ id: "alpha" }];
  f.tm.sessionStore.listAgentRecordIds = async () => ["alpha"];
  f.tm.sessionStore.readActiveAgentId = () => "alpha";
  const gate = deferred();
  const entered = deferred();
  f.tm.sessionStore.openSession = async (id) => {
    if (id === "alpha") { entered.resolve(); await gate.promise; }
    return f.sessions.get(id);
  };
  const pending = f.runtime.ensureSession();
  await entered.promise;
  await f.runtime.switchAgent("beta");
  gate.resolve();
  assert.equal((await pending).id, "beta");
  assert.equal(f.runtime.getActiveAgentId(), "beta");
  assert.equal(f.runtime.inMemoryTranscriptAgentId, "beta");
});
