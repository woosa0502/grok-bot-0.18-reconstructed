import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: [
      'export { SessionRuntime } from "./source/host/extensions/transcript/session-runtime.ts";',
      'export { SendPipeline } from "./source/host/extensions/transcript/send-pipeline.ts";',
      'export { PromptAcceptanceLedger } from "./source/host/extensions/transcript/prompt-acceptance-ledger.ts";',
      'export { getTranscript, setTranscript } from "./source/host/extensions/transcript/transcript-store.ts";',
    ].join("\n"),
    resolveDir: resolve(import.meta.dirname, ".."),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { SessionRuntime, SendPipeline, PromptAcceptanceLedger, getTranscript, setTranscript } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

function fixture() {
  const seed = { id: "seed", kind: "message", role: "assistant", content: "existing history" };
  setTranscript([seed]);
  let writable = false;
  const saved = new Map([[seed.id, seed]]);
  const events = [];
  const dbCalls = [];
  const turns = [];
  const session = {
    id: "personal-durability-test",
    dbPath: "/nonexistent-personal-durability-test/agent.db",
    db: {
      appendTranscriptEntry(entry) {
        dbCalls.push({ id: entry.id, alreadyInMemory: getTranscript().includes(entry) });
        if (!writable || saved.has(entry.id)) return false;
        saved.set(entry.id, entry);
        return true;
      },
      deleteTranscriptEntry(id) { return saved.delete(id); },
      getTranscriptEntries: () => [...saved.values()],
      setIntroductionPending() {},
      getAwaitingUserResponse: () => null,
    },
  };
  const tm = {
    execution: { canExecute: true },
    acceptanceLedger: new PromptAcceptanceLedger(null),
    roster: { emit: (event) => events.push(event), emitAgentUpdate: async () => {}, lastKnownAgentNames: new Map() },
    sessionStore: { markSessionActivity() {} },
    runLifecycle: {
      runningAgentIds: () => new Set(), beginSessionRun() {}, endSessionRun() {},
      enqueueExclusiveRun(_id, task) { return Promise.resolve().then(task); },
    },
    groupChat: {
      pinMemberSessionForGroupTurn: async () => session,
      isGroupSession: () => false, isRemoteRoomSession: () => false,
    },
    trayErrors: { clearForAgent() {} },
    telemetry: { reportUserMessageReceived() {}, reportTurnInterrupt() {} },
    turnRuntime: { buildReplyContext() {}, runTurn: async (...args) => { turns.push(args); } },
    ackObligations: {
      recordAckObligationSend() {}, armSendGuard: () => ({ disarm() {} }),
      confirmAckObligationAfterInterrupt() {}, mintAckRunToken() {},
    },
    runnerRegistry: { getRunner: () => ({ interrupt: () => false }), activeGroupMemberRunners: new Map() },
    workflowCommands: {
      expandWorkflowReferences: (_session, prompt) => prompt,
      withMentionedAgentsContext: (_session, _prompt, expanded) => expanded,
    },
  };
  const runtime = new SessionRuntime(tm);
  runtime.activeSession = session;
  runtime.inMemoryTranscriptAgentId = session.id;
  runtime.loaded = true;
  tm.sessions = runtime;
  tm.appendEntry = (...args) => runtime.appendEntry(...args);
  const pipeline = new SendPipeline(tm);
  return { runtime, pipeline, tm, session, saved, seed, events, dbCalls, turns, allowWrites: () => { writable = true; } };
}

test("persist-first false result leaves no memory echo, event, or deleted existing row", () => {
  const f = fixture();
  const outcomes = [];
  const entry = { id: "seed", kind: "message", role: "user", content: "colliding new message" };
  assert.throws(() => f.runtime.appendEntry(entry, {
    persistBeforeEmit: true,
    onPersistOutcome: (durable) => outcomes.push(durable),
  }), { name: "SandSendNotPersistedError" });
  assert.deepEqual(outcomes, [false]);
  assert.deepEqual(getTranscript(), [f.seed]);
  assert.deepEqual([...f.saved.values()], [f.seed]);
  assert.deepEqual(f.events, []);
});

test("persist-first successful append saves before memory and honors deferred emission", () => {
  const f = fixture();
  f.allowWrites();
  const entry = { id: "user-1", kind: "message", role: "user", content: "saved message" };
  f.runtime.appendEntry(entry, { persistBeforeEmit: true, deferEmit: true });
  assert.deepEqual(f.dbCalls, [{ id: "user-1", alreadyInMemory: false }]);
  assert.deepEqual(getTranscript(), [f.seed, entry]);
  assert.equal(f.saved.get(entry.id), entry);
  assert.deepEqual(f.events, []);
});

test("ordinary append retains its existing memory and emit before persistence order", () => {
  const f = fixture();
  const entry = { id: "normal-1", kind: "message", role: "assistant", content: "normal append" };
  assert.equal(f.runtime.appendEntry(entry), entry);
  assert.deepEqual(f.dbCalls, [{ id: "normal-1", alreadyInMemory: true }]);
  assert.deepEqual(getTranscript(), [f.seed, entry]);
  assert.deepEqual(f.events, [{ type: "appended", entry }]);
});

test("failed addressed send does not accept or dispatch and the same nonce retries exactly once", async () => {
  const f = fixture();
  const options = { agentId: f.session.id, clientNonce: "personal-durability-nonce", directAddressedAcceptance: true, awaitTurn: true };
  await assert.rejects(f.pipeline.sendPrompt("please retain this", options), { name: "SandSendNotPersistedError" });
  assert.deepEqual(getTranscript(), [f.seed]);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.turns, []);
  assert.equal(f.tm.acceptanceLedger.lookup({ accountSlot: "host", clientNonce: options.clientNonce }).outcome, "not-found");
  f.allowWrites();
  await f.pipeline.sendPrompt("please retain this", options);
  assert.equal(f.turns.length, 1);
  assert.equal(f.events.filter((event) => event.type === "appended").length, 1);
  assert.equal(getTranscript().filter((entry) => entry.clientNonce === options.clientNonce).length, 1);
  assert.equal([...f.saved.values()].filter((entry) => entry.clientNonce === options.clientNonce).length, 1);
  assert.equal(f.tm.acceptanceLedger.lookup({ accountSlot: "host", clientNonce: options.clientNonce }).record.status, "accepted");
  await f.pipeline.sendPrompt("please retain this", options);
  assert.equal(f.turns.length, 1);
  assert.equal(getTranscript().length, 2);
});
