import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { parseCliArgs, runCli, suspensionResponse } from "../src/run.mjs";

function output() {
  const chunks = [];
  return { write(value) { chunks.push(String(value)); return true; }, text: () => chunks.join("") };
}
async function service(t, behavior = {}) {
  const requests = [];
  const state = { pid: process.pid, port: 0, token: "fixture-token", engine: "1.26.906.1714", startedAt: new Date().toISOString(), instanceId: "fixture-instance" };
  const server = http.createServer(async (req, res) => {
    let data = ""; for await (const chunk of req) data += chunk;
    const body = data ? JSON.parse(data) : undefined;
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body });
    const send = (value, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.headers.authorization !== `Bearer ${state.token}`) return send({ error: "unauthorized" }, 401);
    if (req.url === "/health") return send({ ok: true, ready: true, ...state, ...(behavior.health ?? {}) });
    if (behavior.handle) return behavior.handle({ req, res, body, send, requests });
    if (req.method === "POST" && req.url === "/sessions") return send({ id: "cli-session", status: "queued" }, 201);
    if (req.method === "GET" && req.url === "/sessions/cli-session") return send({ id: "cli-session", status: "done", result: "final answer", activity: ["tool completed"], modelCalls: 1, toolCalls: 1 });
    if (req.url === "/sessions/cli-session/stop") return send({ id: "cli-session", status: "stopped" });
    return send({ error: "not found" }, 404);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); state.port = server.address().port;
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { state, server, requests };
}
function config(state, overrides = {}) {
  const stdout = output(), stderr = output();
  return { env: {}, stdout, stderr, stdin: { isTTY: false }, loadServiceState: () => state, pollIntervalMs: 1, requestTimeoutMs: 1000, createEngine: async () => { throw new Error("shared CLI must not create an engine"); }, ...overrides };
}

test("parser omits all unspecified model fields and preserves legacy keep-chrome default", () => {
  const parsed = parseCliArgs(["look", "around"], {});
  assert.equal(parsed.task, "look around"); assert.equal(parsed.model, undefined);
  assert.equal(parsed.keepChrome, true); assert.equal(parsed.engine, undefined);
  assert.deepEqual(parseCliArgs(["--task", "x", "--thinking", "medium"], {}).model, { thinkingLevel: "medium" });
  assert.deepEqual(parseCliArgs(["--task", "x", "--fast-mode"], {}).model, { fastMode: true });
  assert.deepEqual(parseCliArgs(["--task", "x", "--no-fast-mode"], {}).model, { fastMode: false });
  assert.equal(parseCliArgs(["--task", "x", "--no-keep-chrome"], {}).keepChrome, false);
  assert.deepEqual(parseCliArgs(["--task", "x", "--model", "chosen", "--provider", "chosen-provider"], {}).model, { modelId: "chosen", provider: "chosen-provider" });
});

test("current authenticated service receives /sessions only and saved model is not overridden", async (t) => {
  const shared = await service(t); const options = config(shared.state);
  assert.equal(await runCli(["--task", "look", "--verbose", "--no-keep-chrome"], options), 0);
  const created = shared.requests.find((request) => request.path === "/sessions");
  assert.equal(Object.hasOwn(created.body, "model"), false);
  assert.equal(Object.hasOwn(created.body, "fastMode"), false);
  assert.equal(created.body.autoApprove, false);
  assert.ok(shared.requests.every((request) => request.authorization === "Bearer fixture-token"));
  assert.deepEqual(shared.requests.map((request) => request.path), ["/health", "/sessions", "/sessions/cli-session"]);
  assert.equal(options.stdout.text(), "final answer\n"); assert.match(options.stderr.text(), /tool completed/);
  assert.equal(shared.server.listening, true); assert.ok(!options.stderr.text().includes("fixture-token"));
});

test("partial and explicit fast CLI selections reach the shared owner unchanged", async (t) => {
  const shared = await service(t);
  assert.equal(await runCli(["--task", "x", "--thinking", "low", "--fast-mode", "--mode", "read-only"], config(shared.state)), 0);
  const created = shared.requests.find((request) => request.path === "/sessions");
  assert.deepEqual(created.body.model, { thinkingLevel: "low", fastMode: true }); assert.equal(created.body.mode, "read-only");
});

test("live legacy, mismatched, or unready service never triggers a second engine", async (t) => {
  const shared = await service(t, { health: { instanceId: "other-instance" } });
  const options = config(shared.state);
  assert.equal(await runCli(["--task", "x"], options), 1);
  assert.match(options.stderr.text(), /does not match/);
  assert.deepEqual(shared.requests.map((request) => request.path), ["/health"]);
  const legacy = { ...shared.state }; delete legacy.instanceId;
  const old = config(legacy);
  assert.equal(await runCli(["--task", "x"], old), 1);
  assert.match(old.stderr.text(), /identity is incomplete/);
});

test("missing or dead service uses one core owner, session-only overrides, and awaited cleanup", async () => {
  for (const [args, state, keep] of [[["--task", "x", "--model", "chosen"], null, true], [["--task", "x", "--no-keep-chrome"], { pid: 99111 }, false]]) {
    let settings, body, stopped = false, polls = 0;
    const handle = { id: "owned", toJSON: () => ({ id: "owned", status: polls++ ? "done" : "running", result: "owned result" }), stop: async () => {}, answer: async () => {} };
    const options = config(state, { isProcessAlive: () => false, createEngine: async (received) => {
      settings = received;
      return { startSession(value) { body = value; return handle; }, get: () => handle, stop: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); stopped = true; } };
    } });
    assert.equal(await runCli(args, options), 0);
    assert.equal(settings.transport, "port"); assert.equal(settings.keepChromeOnStop, keep);
    assert.equal(Object.hasOwn(settings, "model"), false); assert.equal(stopped, true);
    if (keep) assert.deepEqual(body.model, { modelId: "chosen" }); else assert.equal(Object.hasOwn(body, "model"), false);
  }
});

test("interactive suspension submits the expected tool call and each actual answer", async (t) => {
  const questions = [{ header: "first", question: "First?" }, { header: "second", question: "Second?", options: [{ label: "choice" }] }];
  const shared = await service(t, { handle: ({ req, send }) => {
    if (req.url === "/sessions") return send({ id: "cli-session", status: "suspended", suspension: { kind: "ask-user-question", toolCallId: "tool-7", request: { questions } } });
    return send({ id: "cli-session", status: "done", result: "answered" });
  } });
  const answers = ["alpha", "beta"], prompts = [];
  const options = config(shared.state, { question: async (prompt) => { prompts.push(prompt); return answers.shift(); } });
  assert.equal(await runCli(["--task", "x"], options), 0);
  const answered = shared.requests.find((request) => request.path.endsWith("/answer"));
  assert.deepEqual(answered.body, { expectedToolCallId: "tool-7", response: { answers: [{ header: "first", answer: "alpha" }, { header: "second", answer: "beta" }] } });
  assert.equal(prompts.length, 2); assert.match(prompts[1], /choice/);
  assert.deepEqual(await suspensionResponse({ kind: "approval" }, { question: async () => "n" }), { verdict: "deny", always: false });
});

test("automatic approval is delegated once to core, without duplicate CLI answers", async (t) => {
  const shared = await service(t, { handle: ({ req, send }) => {
    if (req.url === "/sessions") return send({ id: "cli-session", status: "suspended", suspension: { kind: "approval", toolCallId: "tool-8" } });
    return send({ id: "cli-session", status: "done", result: "auto answered" });
  } });
  assert.equal(await runCli(["--task", "x", "--auto-approve"], config(shared.state)), 0);
  assert.equal(shared.requests.find((request) => request.path === "/sessions").body.autoApprove, true);
  assert.ok(!shared.requests.some((request) => request.path.endsWith("/answer")));
});

test("Ctrl-C during accepted create waits for its ID then stops only that session", async (t) => {
  const abort = new AbortController();
  const shared = await service(t, { handle: ({ req, send }) => {
    if (req.url === "/sessions") {
      setTimeout(() => abort.abort(Object.assign(new Error("interrupt"), { exitCode: 130 })), 5);
      return setTimeout(() => send({ id: "cli-session", status: "running" }, 201), 40);
    }
    return send({ id: "cli-session", status: "stopped" });
  } });
  assert.equal(await runCli(["--task", "x"], config(shared.state, { signal: abort.signal })), 130);
  assert.deepEqual(shared.requests.map((request) => request.path), ["/health", "/sessions", "/sessions/cli-session/stop"]);
  assert.equal(shared.server.listening, true);
});

test("invalid poll identity cannot redirect cleanup to another shared session", async (t) => {
  const shared = await service(t, { handle: ({ req, send }) => {
    if (req.url === "/sessions") return send({ id: "cli-session", status: "running" });
    if (req.url.endsWith("/stop")) return send({ id: "cli-session", status: "stopped" });
    return send({ id: "someone-else", status: "running" });
  } });
  assert.equal(await runCli(["--task", "x"], config(shared.state)), 1);
  assert.ok(shared.requests.some((request) => request.path === "/sessions/cli-session/stop"));
  assert.ok(!shared.requests.some((request) => request.path.includes("someone-else")));
});

test("terminal errors and cleanup errors report nonzero; help and usage perform no startup", async (t) => {
  const shared = await service(t, { handle: ({ send }) => send({ id: "cli-session", status: "error", error: "run failed", result: "partial output" }) });
  const options = config(shared.state);
  assert.equal(await runCli(["--task", "x"], options), 1); assert.match(options.stdout.text(), /partial output/);
  const noStartup = config(null, { loadServiceState: () => { throw new Error("must not read state"); } });
  assert.equal(await runCli(["--help"], noStartup), 0);
  assert.equal(await runCli([], noStartup), 2);
  const cleanup = config(null, { createEngine: async () => ({ startSession: () => ({ id: "owned", toJSON: () => ({ id: "owned", status: "done" }) }), stop: async () => { throw new Error("cleanup failed"); } }) });
  assert.equal(await runCli(["--task", "x"], cleanup), 1); assert.match(cleanup.stderr.text(), /engine cleanup failed/);
});
