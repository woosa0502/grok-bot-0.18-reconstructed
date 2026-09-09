// Golden E2E E07/E09/E10/E11/E12 for the browser runtime: user cancellation is confirmed, mirrored messages
// survive a crash between emit and persist without loss, approvals do not survive a restart with a stale
// identity, three concurrent bots are isolated when one is cancelled, and a browser crash leaves an explicit
// continuation instead of a replay. Fakes stand in for the Aside service and the daemon engine only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createSessionController } from "../belmont-browse/src/core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({ absWorkingDir: repoRoot, stdin: { contents: ["aside-bot-runner", "browse-client", "browse-suspension"].map((name) => `export * from './source/host/extensions/browse-runtime/${name}.ts';`).join("\n"), resolveDir: repoRoot }, bundle: true, format: "esm", platform: "node", target: "node22", write: false });
const { wrapRunnerForAsideBot, BrowseServiceError, encodeAsideSuspensionAnswer } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const view = (id, status = "done", extra = {}) => ({ id, status, result: "finished", error: null, activity: [], toolCalls: 0, modelCalls: 0, suspension: null, ...extra });
const questions = [{ header: "계정", question: "어느 계정인가요?", options: [{ label: "회사" }, { label: "개인" }] }];
const suspended = (id, toolCallId) => view(id, "suspended", { suspension: { kind: "approval", toolCallId, description: "제출 승인", request: { action: "submit" } } });

function botHarness(t, links, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "golden-browse-"));
  const prior = process.env.SAND_DATA_ROOT; process.env.SAND_DATA_ROOT = root;
  t.after(() => { if (prior === undefined) delete process.env.SAND_DATA_ROOT; else process.env.SAND_DATA_ROOT = prior; rmSync(root, { recursive: true, force: true }); });
  const calls = [];
  const behavior = { create: async () => view("new", "queued"), get: async (id) => view(id), continue: async (id) => view(id, "running"), steer: async (id) => view(id, "running"), answer: async (id) => view(id, "running"), stop: async (id) => view(id, "stopped"), asideSessions: async () => [], asideMessages: async () => [], ...overrides };
  const client = Object.fromEntries(Object.keys(behavior).map((name) => [name, async (...args) => { calls.push({ name, args }); return behavior[name](...args); }]));
  const bots = {};
  for (const [agentId, link] of Object.entries(links)) {
    const dir = path.join(root, "agents", agentId); mkdirSync(dir, { recursive: true });
    if (link) writeFileSync(path.join(dir, "browse-runtime.json"), JSON.stringify(link));
    const sent = [];
    const make = (emit = (event) => sent.push(event.message)) => wrapRunnerForAsideBot({ run: async () => assert.fail("unexpected delegation") }, agentId, { client: () => client, emitUpdate: emit, log: () => {} });
    bots[agentId] = { runner: make(), make, sent, readLink: () => existsSync(path.join(dir, "browse-runtime.json")) ? JSON.parse(readFileSync(path.join(dir, "browse-runtime.json"), "utf8")) : null };
  }
  return { bots, calls, behavior, named: (name) => calls.filter((c) => c.name === name) };
}

function engineHarness({ abort = "resolve", storeAfterRun = "done" } = {}) {
  const records = new Map(); const calls = []; let emit = null; let finish = null;
  const server = {
    getAgent: async () => ({ agent: { subscribe: (cb) => { emit = cb; return () => { emit = null; }; }, state: { isStreaming: false } } }),
    startRun: async (accountId, id, cb) => { calls.push(["startRun", id]); records.get(id).status = "running"; await cb({ prompt: async (m) => { calls.push(["prompt", typeof m === "string" ? m : JSON.stringify(m).slice(0, 60)]); } }); },
    waitForIdle: () => new Promise((resolve) => { finish = () => { resolve(); }; }),
    getLoadedAgent: () => null, steer: async () => {},
    abort: async (accountId, id) => { calls.push(["abort", id]); if (abort === "reject") throw new Error("abort transport failed"); records.get(id).status = "aborted"; finish?.(); },
  };
  const A = { settings: () => ({ get: () => ({ provider: "openai-codex", modelId: "m", thinkingLevel: "high", fastMode: false }) }), SessionStore: { get: (accountId, id) => records.has(id) ? { ...records.get(id) } : undefined, update: (accountId, id, patch) => { const r = records.get(id); if (r) Object.assign(r, patch); } }, GlobalAgentSessionServer: server, resolveSuspension: async () => {} };
  const engine = createSessionController({ A, account: { id: 0 }, profileId: "fixture", ext: { windowId: 1 }, model: A.settings().get(), createRecord: (unused, row) => { const record = { ...row, id: `s${records.size}`, status: "queued" }; records.set(record.id, record); return record; } });
  return { engine, records, calls, emitTool: (name) => { if (emit === null) return false; emit({ type: "tool_execution_start", toolName: name, args: "{}" }); return true; }, endRun: (status) => { for (const r of records.values()) if (r.status === "running") r.status = status ?? storeAfterRun; finish?.(); } };
}
const until = async (predicate, ms = 2000, describe = () => "") => { const deadline = Date.now() + ms; while (!predicate()) { if (Date.now() > deadline) throw new Error(`condition not met: ${describe()}`); await tick(); } };

test("E07: a confirmed stop ends the session and later tool activity from the engine is no longer attributed to it", async () => {
  const f = engineHarness();
  const h = f.engine.startSession({ task: "go" });
  await until(() => f.calls.some((c) => c[0] === "prompt"));
  assert.equal(f.emitTool("navigate"), true);
  assert.equal(h.toolCalls, 1);
  await h.stop();
  assert.equal(h.status, "stopped");
  assert.deepEqual(f.calls.filter((c) => c[0] === "abort"), [["abort", "s0"]], "the stop was sent to the engine once");
  await h.runPromise;
  assert.equal(f.emitTool("click"), false, "after the confirmed stop the session no longer listens to engine activity");
  assert.equal(h.toolCalls, 1, "no tool activity is attributed after the confirmed stop");
  await f.engine.close();
});

test("E07: a stop the engine cannot confirm is reported as STOP_FAILED, never as stopped", async () => {
  const f = engineHarness({ abort: "reject" });
  const h = f.engine.startSession({ task: "go" });
  await until(() => f.calls.some((c) => c[0] === "prompt"));
  await assert.rejects(h.stop(), /abort transport failed/);
  assert.equal(h.status, "error");
  assert.equal(h.errorCode, "STOP_FAILED");
  f.endRun("aborted");
  await h.runPromise.catch(() => undefined);
  await f.engine.close();
});

test("E12: a browser crash mid-run becomes an explicit continuation; the old prompt is never replayed by itself", async () => {
  const f = engineHarness({ storeAfterRun: "running" });
  const h = f.engine.startSession({ task: "fill the form" });
  await until(() => f.calls.some((c) => c[0] === "prompt"));
  f.endRun("running"); // the daemon stopped reporting (CDP closed) while the store still says running
  await h.runPromise;
  assert.equal(h.status, "interrupted");
  assert.equal(h.errorCode, "SESSION_INTERRUPTED");
  assert.deepEqual(h.recovery, { mode: "explicit-continuation-required", previousStatus: "running", resumed: false });
  assert.equal(f.records.get("s0").status, "interrupted");
  assert.equal(f.calls.filter((c) => c[0] === "startRun").length, 1, "no automatic replay");
  await h.continue("resume from where it stopped");
  await until(() => f.calls.filter((c) => c[0] === "startRun").length === 2, 2000, () => `status=${h.status} error=${h.error} calls=${JSON.stringify(f.calls)}`);
  await until(() => f.calls.filter((c) => c[0] === "prompt").length === 2, 2000, () => `status=${h.status} calls=${JSON.stringify(f.calls)}`);
  f.endRun("done");
  await until(() => h.status === "done", 2000, () => `status=${h.status} error=${h.error} records=${JSON.stringify([...f.records.values()])}`);
  assert.deepEqual(f.calls.filter((c) => c[0] === "prompt").length, 2, "continuation sends the new instruction, not the crashed one again");
  await f.engine.close();
});

test("E09: a crash between emitting a mirrored message and persisting it loses nothing and repeats nothing", async (t) => {
  const messages = [{ role: "user", timestamp: 100, text: "first", id: "m1" }, { role: "user", timestamp: 101, text: "second", id: "m2" }];
  const f = botHarness(t, { bot: { browseId: "bound", pendingKind: null, lastSeenTs: 0, mirrorFloorTs: 0, seenMessageKeys: [] } }, { asideMessages: async () => messages });
  const bot = f.bots.bot;
  let delivered = [];
  const crashing = bot.make((event) => { if (event.message.content.endsWith("second")) throw new Error("process died after emitting"); delivered.push(event.message.content); });
  await assert.rejects(crashing.run("nudge", { hidden: true }), /process died/);
  assert.deepEqual(bot.readLink().seenMessageKeys, ["id:m1"], "only the delivered message is marked seen before the crash");
  // "Restart": a fresh runner instance over the same durable link.
  const restarted = bot.make((event) => { delivered.push(event.message.content); });
  await restarted.run("nudge", { hidden: true });
  await restarted.run("nudge", { hidden: true });
  assert.deepEqual(delivered, ["[Aside에서 입력] first", "[Aside에서 입력] second"]);
  assert.deepEqual(bot.readLink().seenMessageKeys, ["id:m1", "id:m2"]);
});

test("E10: after a restart, an approval reply carrying a stale tool-call identity is refused and the current card is re-shown", async (t) => {
  const current = "tool-2";
  let answered = false;
  const f = botHarness(t, { bot: { browseId: "bound", pendingKind: "approval", pendingToolCallId: "tool-1", pendingDescription: "제출 승인" } }, { get: async (id) => answered ? view(id) : suspended(id, current), answer: async (id) => { answered = true; return view(id, "running"); } });
  const bot = f.bots.bot;
  // Restart: a new runner instance reads the persisted pending card (tool-1) but the service now shows tool-2.
  const restarted = bot.make();
  const stale = await restarted.run(encodeAsideSuspensionAnswer({ toolCallId: "tool-1" }, "allow"));
  assert.equal(stale.awaitingUserSelection, true);
  assert.equal(f.named("answer").length, 0, "the stale approval is not submitted");
  assert.equal(bot.readLink().pendingToolCallId, "tool-2", "the current identity is persisted");
  assert.ok(bot.sent.some((m) => m.type === "widget" && m.widget.asideSuspension.toolCallId === "tool-2"), "the current card is shown");
  const fresh = await restarted.run(encodeAsideSuspensionAnswer({ toolCallId: "tool-2" }, "allow"));
  assert.equal(f.named("answer").length, 1);
  assert.deepEqual(f.named("answer")[0].args.slice(0, 1), ["bound"]);
  assert.equal(f.named("answer")[0].args[2], "tool-2");
  assert.notEqual(fresh.awaitingUserSelection, true);
});

test("E11: three bots run side by side; cancelling one stops only its own session and leaves the others' state untouched", async (t) => {
  let stopOk = true;
  const f = botHarness(t, {
    alpha: { browseId: "a", pendingKind: null, lastSeenTs: 0, mirrorFloorTs: 0, seenMessageKeys: [] },
    beta: { browseId: "b", pendingKind: "approval", pendingToolCallId: "tb", pendingDescription: "beta 승인" },
    gamma: { browseId: "c", pendingKind: null, lastSeenTs: 0, mirrorFloorTs: 0, seenMessageKeys: [] },
  }, { asideMessages: async (id) => id === "c" ? [{ role: "assistant", timestamp: 50, text: "gamma progress", id: "g1" }] : [], get: async (id) => id === "b" ? view(id, "running") : view(id), stop: async (id) => { if (!stopOk) throw new BrowseServiceError("stop failed", 500, "STOP_FAILED"); return view(id, "stopped"); } });
  const alphaBefore = JSON.stringify(f.bots.alpha.readLink());
  const gammaMirror = f.bots.gamma.runner.run("nudge", { hidden: true });
  f.bots.beta.runner.interrupt("user stopped");
  await tick(); await tick();
  await gammaMirror;
  assert.deepEqual(f.named("stop").map((c) => c.args), [["b"]], "only beta's session was stopped");
  assert.equal(f.bots.beta.readLink().pendingKind, null);
  assert.equal(f.bots.beta.readLink().cancelRequested, undefined, "beta's stop was confirmed");
  assert.equal(JSON.stringify(f.bots.alpha.readLink()), alphaBefore, "alpha's link is byte-identical");
  assert.deepEqual(f.bots.gamma.sent.map((m) => m.content), ["gamma progress"], "gamma kept mirroring during beta's cancellation");
  assert.deepEqual(f.bots.gamma.readLink().seenMessageKeys, ["id:g1"]);
  assert.equal(f.bots.alpha.sent.length, 0);
  // A failing stop on beta still does not leak into alpha/gamma.
  stopOk = false;
  f.bots.beta.readLink(); f.bots.beta.runner.interrupt("user stopped");
  await tick(); await tick(); await tick();
  assert.ok(f.bots.beta.readLink().cancelRequested, "beta keeps its durable cancel intent");
  assert.equal(JSON.stringify(f.bots.alpha.readLink()), alphaBefore);
  assert.equal(f.bots.gamma.readLink().cancelRequested, undefined);
});
