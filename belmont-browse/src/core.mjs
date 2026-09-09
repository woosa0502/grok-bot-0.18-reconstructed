// belmont-browse: reusable engine + session handles for the serve/MCP adapters (our code).
import path from "node:path";
import { createPrivateKey } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ensureChrome } from "./chrome.mjs";
import { startPipedChrome } from "./cdp-relay.mjs";
import { ensureInstallationKeys, startDaemonServer } from "./daemon-server.mjs";
import { MiniCdp } from "./cdp-mini.mjs";
import { FakeExtension } from "./bridge-shim.mjs";
import { syncCodexCredential } from "./credentials.mjs";
import { installLinuxInstallation } from "./linux-installation.mjs";
import { createNativeMemoryRuntime, installNativeMemoryTransport } from "./memory-native-runtime.mjs";
import { createEngineCleanup } from "./engine-cleanup.mjs";
import { DEFAULT_MODEL, ENGINES, KNOWLEDGE_DIR, resolveModelSelection, prepareAsideHome, loadDaemon, ensureLocalAccount, installDaemonHooks, initializeLocalLifecycle, createBrowseSession, describeSuspension, autoResponseFor } from "./session.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE_ID = "belmont-local";
const BOUNDARY_RE = /<subagent-boundary>[\s\S]*?<\/subagent-boundary>\s*/;

export async function createBrowseEngine({ engine = "907", transport = "pipe", cdpPort = 9333, relayPort = 9341, display = process.env.BELMONT_BROWSE_DISPLAY || ":99", model, stateDir = process.env.BELMONT_BROWSE_STATE_DIR || path.join(ROOT, ".state"), keepChromeOnStop = false, maxConcurrent = 1, onShutdown, log = console.error } = {}) {
  if (!ENGINES[engine]) throw new Error(`unknown engine ${engine}`);
  if (keepChromeOnStop && transport !== "port") throw new Error("Keeping Chrome requires port transport");
  const cleanup = createEngineCleanup();
  const realExtension = !!process.env.BELMONT_BROWSE_EXTENSION || process.env.BELMONT_BROWSE_NATIVE_COMPONENTS === "1";
  const nativeComponentVersion = process.env.BELMONT_BROWSE_NATIVE_COMPONENTS === "1" ? ENGINES[engine].version : undefined;
  let apiReady = false;
  let engineReady = false;
  let shutdownRequested = false;
  let workloads;
  const stop = () => {
    apiReady = false;
    engineReady = false;
    workloads?.beginShutdown();
    return cleanup.close();
  };
  const requestShutdown = () => {
    shutdownRequested = true;
    if (engineReady) return onShutdown ? onShutdown() : stop();
  };
  try {
  const profileDir = path.join(stateDir, "chrome-profile");
  const asideHome = path.resolve(stateDir, ENGINES[engine].home);
  const keys = ensureInstallationKeys(stateDir);
  process.env.BELMONT_INSTALL_SIG_PUB = keys.publicRawBase64;
  installLinuxInstallation({ stateDir, legacyStorageDir: path.join(asideHome, "secure-storage") });
  const memoryTransport = installNativeMemoryTransport();
  cleanup.add("memory authentication", () => memoryTransport.close());
  // "pipe": Chrome is our child with --remote-debugging-pipe and NO debugging port; every CDP client
  // (Aside's CdpClient, our MiniCdp) goes through the token-gated loopback relay. "port": legacy shared Chrome on cdpPort.
  // The fork's asideAccount.signDaemonAuthChallenge / secure CDP / profile-binding all sign with the same
  // installation key the daemon trusts (BELMONT_INSTALL_SIG_PUB); hand it over as a PKCS#8 DER file.
  if (realExtension && !process.env.ASIDE_INSTALLATION_KEY) {
    process.env.ASIDE_INSTALLATION_KEY = writeInstallationKeyDer(stateDir);
  }
  const chrome = transport === "pipe"
    ? await startPipedChrome({ profileDir, display, port: relayPort, log, nativeComponentVersion, asideHome })
    : await ensureChrome({ port: cdpPort, display, profileDir, log, nativeComponentVersion, asideHome });
  cleanup.add("browser transport", () => keepChromeOnStop ? chrome.detach?.() : chrome.stop?.());
  const cdpUrl = transport === "pipe" ? chrome.wsUrl : `http://127.0.0.1:${cdpPort}`;
  const home = prepareAsideHome({ asideHome, cdpUrl, model });
  log(`[creds] ${syncCodexCredential(home.credentialsPath)}`);
  const A = await loadDaemon(engine);
  // REPL/browser tools use the daemon singleton, independently of MiniCdp.
  // Stop it after its producers drain and before the owned browser exits.
  cleanup.add("daemon CDP client", () => A.globalCdpClient?.close());
  workloads = A.__workloads;
  workloads?.start();
  // LIFO: cached model transports close after their producers and account memory.
  cleanup.add("model session resources", () => workloads?.closeSessionResources());
  if (A.__linux?.getInstallationStatus && A.__linux?.initInstallation && A.__linux?.unlock) {
    const installation = await A.__linux.getInstallationStatus();
    if (!installation.installed) await A.__linux.initInstallation();
    await A.__linux.unlock();
  }
  cleanup.add("bootstrap memory", async () => {
    const results = await Promise.allSettled(A.AccountRegistry.getAll().accounts.map((account) => Promise.resolve().then(() => A.MemoryManager.closeForAccount?.(account.id))));
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Account memory cleanup failed");
  });
  const account = await ensureLocalAccount(A, log);
  const selectedModel = A.settings(account.id).get("defaultModel") ?? home.defaultModel ?? DEFAULT_MODEL;
  const memory = createNativeMemoryRuntime({
    accountId: account.id,
    accountRoot: A.getAccountRoot(account.id),
    memoryManager: A.MemoryManager.forAccount(account.id),
    closeNative: (id) => A.MemoryManager.closeForAccount(id),
    allowedRoots: [KNOWLEDGE_DIR],
    log,
  });
  const hooks = installDaemonHooks({ log, memorySearch: memory });
  cleanup.add("daemon hooks", () => hooks.close());
  // Session disposal can itself enqueue memory bookkeeping. Drain it before
  // closing the memory manager used by those callbacks.
  cleanup.add("background workloads", () => workloads?.drain());
  const lifecycle = await initializeLocalLifecycle(A, { accountId: account.id, log });
  cleanup.add("account lifecycle", () => lifecycle.close());
  // The original API must admit the extension handshake after account bootstrap.
  // The public browse adapter itself is not published until that handshake finishes.
  apiReady = true;
  // The daemon's own API server on 21420: the original Aside Browsing Agent extension (loaded into Chrome via
  // BELMONT_BROWSE_EXTENSION) authenticates with the P-256 installation key we generate and then uses the
  // daemon's tRPC/WebSocket routes for its side panel, new tab, mini popup and tab previews.
  if (process.env.BELMONT_BROWSE_DAEMON_SERVER !== "0") {
    try {
      const daemonServer = await startDaemonServer(A.__server, { port: Number(process.env.BELMONT_BROWSE_DAEMON_PORT || 21420), isReady: () => apiReady, requestShutdown, log });
      cleanup.add("daemon API", () => daemonServer.close());
    } catch (e) { throw new Error(`Aside shared daemon server could not start: ${e.message}`, { cause: e }); }
  }
  const cdp = new MiniCdp(cdpUrl);
  cleanup.add("CDP client", () => cdp.close());
  // Real Aside extension inside the fork (BELMONT_BROWSE_EXTENSION): it registers itself on the daemon's
  // extension bridge with the browser profile's aside.profile_id; sessions must be bound to that profile so the
  // daemon routes Aside.* commands to it. Otherwise the FakeExtension answers those commands over plain CDP.
  const ext = realExtension
    ? await attachRealExtension({ bridge: A.globalExtensionBridge, cdp, accountId: account.id, log, nativeComponentVersion })
    : await new FakeExtension({ bridge: A.globalExtensionBridge, cdp, accountId: account.id, profileId: PROFILE_ID, log: () => {} }).attach();
  cleanup.add("extension binding", () => ext.detach?.());
  const profileId = ext.profileId ?? PROFILE_ID;
  await initializeLocalLifecycle(A, { accountId: account.id, startBackground: true, log });
  // Aside's semantic memory (Moss) loads its model and builds the account index on first use. The runtime's own
  // warm() performs that first use now, in the background, so readiness is observed at startup and the bot's
  // first memory_search is not the slow one. A failed warm-up only logs; every later search retries the original.
  if (process.env.BELMONT_BROWSE_MEMORY_WARMUP !== "0") {
    void memory.warm().then((capability) => {
      const failure = capability.semantic?.failure?.kind;
      log(`[memory] semantic search ${capability.mode === "native" ? "ready" : `not ready (${capability.mode}${failure ? `: ${failure}` : ""})`}`);
    }).catch((error) => log(`[memory] semantic warm-up failed: ${error.message}`));
  }
  log(`[engine] Aside ${ENGINES[engine].version} ready; account ${account.id}; window ${ext.windowId}; profile ${profileId}${ext.real ? " (real extension)" : ""}`);
  const controller = createSessionController({ A, account, profileId, ext, model: selectedModel, maxConcurrent,
    cwd: path.join(stateDir, "work"), log,
    onTurnEnd: () => syncCodexCredential(home.credentialsPath),
  });
  cleanup.add("browse sessions", () => controller.close());
  // Stage: the fork lives on the bot's virtual desktop, but the Aside agent works in background "Agent Tabs", so
  // the desktop showed a blank foreground tab the whole time. While a run is active, bring the page target that
  // changed most recently (navigation, title) to the front so the screen follows the agent. Off: BELMONT_BROWSE_STAGE=0.
  const stage = { last: null, shown: null, timer: null, urls: new Map(), hydrating: false, stopDiscovery: null };
  const stageEnabled = process.env.BELMONT_BROWSE_STAGE !== "0";
  const stageWorthy = (info) => info?.type === "page" && /^https?:/.test(info.url ?? "");
  if (stageEnabled) {
    cdp.on((msg) => {
      if (msg.method !== "Target.targetInfoChanged" && msg.method !== "Target.targetCreated") return;
      const info = msg.params?.targetInfo;
      if (!stageWorthy(info)) return;
      // Only a NEW tab or a tab whose URL actually changed while a run is active counts as "what the agent is
      // doing"; title-only updates and tabs restored at startup (before any run) must not steal the front.
      const previous = stage.urls.get(info.targetId);
      stage.urls.set(info.targetId, info.url);
      if (stage.hydrating || controller.stats().running === 0) return;
      if (msg.method === "Target.targetInfoChanged" && previous === info.url) return;
      stage.last = { targetId: info.targetId, url: info.url, at: Date.now() };
    });
    cdp.on((msg) => { if (msg.method === "Target.targetDestroyed") stage.urls.delete(msg.params?.targetId); });
    const restoreDiscovery = async () => {
      stage.hydrating = true;
      stage.urls.clear();
      stage.last = null;
      stage.shown = null;
      try { await cdp.send("Target.setDiscoverTargets", { discover: true }); }
      catch (error) { log(`[stage] discover failed: ${error.message}`); }
      finally { stage.hydrating = false; }
    };
    stage.stopDiscovery = cdp.onConnect(restoreDiscovery);
    await restoreDiscovery();
    stage.timer = setInterval(async () => {
      if (controller.stats().running === 0 || stage.last === null || stage.shown === stage.last) return;
      const next = stage.last;
      try { await cdp.send("Target.activateTarget", { targetId: next.targetId }); stage.shown = next; }
      catch { stage.shown = next; /* closed or not activatable */ }
    }, 1000);
    stage.timer.unref?.();
  }
  cleanup.add("stage observation", () => { stage.stopDiscovery?.(); if (stage.timer) clearInterval(stage.timer); });
  engineReady = true;
  if (shutdownRequested) queueMicrotask(() => Promise.resolve(requestShutdown()).catch((error) => log(`[engine] shutdown failed: ${error.message}`)));
  return {
    A, account, ext, cdp, home, chrome, engine, transport, lifecycle, hooks, model: selectedModel, version: ENGINES[engine].version,
    ...controller,
    stats: () => ({ ...controller.stats(), ready: engineReady, memory: memory.capabilities(), bridge: ext.stats.commands, transport, ...(chrome.relay ? { relayClients: chrome.relay.clientCount(), cdpMessages: chrome.relay.stats.sent } : {}) }),
    stop,
  };
  } catch (error) {
    apiReady = false;
    workloads?.beginShutdown();
    try { await error.lifecycle?.close?.(); } catch (cause) { log(`[engine] failed startup lifecycle cleanup: ${cause.message}`); }
    try { await cleanup.close(); } catch (cause) { throw new AggregateError([error, cause], "Aside startup failed and cleanup reported errors"); }
    throw error;
  }
}

/** Session scheduling separated from process/bootstrap I/O for isolated behavior tests. */
export function createSessionController({ A, account, profileId, ext, model = DEFAULT_MODEL, maxConcurrent = 1, cwd, createRecord = createBrowseSession, onTurnEnd = () => {}, log = () => {}, suspensionIntervalMs = 300 }) {
  const server = A.GlobalAgentSessionServer;
  if (!server || ["getAgent", "startRun", "waitForIdle", "getLoadedAgent", "steer", "abort"].some((name) => typeof server[name] !== "function")) {
    throw sessionError("ENGINE_CONTRACT_MISSING", "Aside bundle must expose the shared GlobalAgentSessionServer", 503);
  }
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("maxConcurrent must be a positive integer");
  const sessions = new Map();
  const queue = [];
  const active = new Set();
  let running = 0;
  let closed = false;
  const requireText = (value) => {
    const text = String(value ?? "").trim();
    if (!text) throw sessionError("INVALID_TEXT", "text is required", 400);
    return text;
  };
  const userMessage = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  const suspensionView = (s) => ({ kind: s.kind, toolCallId: s.toolCallId, request: s.request, description: describeSuspension(s) });
  const unresolved = (s) => s && !s.response && !s.error;
  const isStreaming = (id) => !!server.getLoadedAgent(account.id, id)?.agent?.state?.isStreaming;

  function pump() {
    if (closed) return;
    while (running < maxConcurrent && queue.length) {
      const item = queue.shift();
      if (item.handle.status !== "queued") continue;
      active.add(item.handle);
      running += 1;
      item.handle.runPromise = runHandle(item.handle, item).finally(() => {
        active.delete(item.handle);
        running -= 1;
        pump();
      });
    }
  }

  function expectedSuspension(h, expectedToolCallId) {
    if (typeof expectedToolCallId !== "string" || !expectedToolCallId.trim()) throw sessionError("INVALID_RESPONSE", "expectedToolCallId is required", 400);
    const pending = A.SessionStore.get(account.id, h.id)?.suspension;
    if (!unresolved(pending) || h.suspension?.toolCallId !== expectedToolCallId || pending.toolCallId !== expectedToolCallId) {
      throw sessionError("STALE_SUSPENSION", "the displayed suspension has changed; review the current request before answering");
    }
    return pending;
  }

  async function runHandle(h, { promptText, resumeResponse, expectedToolCallId, adopt = false }) {
    if (h.status === "stopped") return;
    if (adopt) h.executionStarted = true;
    h.status = "running";
    h.startedAt ??= Date.now();
    let unsubscribe;
    let timer;
    try {
      const record = A.SessionStore.get(account.id, h.asideSessionId);
      if (!record) throw sessionError("SESSION_NOT_FOUND", "Aside session not found", 404);
      // The UI, tRPC and Belmont all use this one owner. Never create a parallel AgentSession.
      const bound = record.browserBinding;
      if (!adopt && (!bound?.profileId || bound.profileId !== profileId || bound.windowId !== ext.windowId)) {
        const binding = { profileId, windowId: ext.windowId, ...(bound?.anchorTargetId ? { anchorTargetId: bound.anchorTargetId } : {}) };
        A.SessionStore.update(account.id, record.id, { browserBinding: binding });
        server.refreshLoadedSessionBrowserBinding?.(account.id, record.id, binding);
      }
      const agentSession = await server.getAgent(account.id, record.id);
      h.agentSession = agentSession;
      if (h.status === "stopped") return; // Stop may arrive while loading the shared owner.
      let current = "";
      unsubscribe = agentSession.agent.subscribe((ev) => {
        if (ev.type === "message_update") {
          const delta = ev.assistantMessageEvent ?? ev.event ?? {};
          if (delta.type === "text_delta" && delta.delta) current += delta.delta;
        } else if (ev.type === "message_end" && ev.message?.role === "assistant") {
          h.modelCalls += 1;
          const usage = ev.message.usage;
          if (usage) for (const key of ["input", "output", "cacheRead"]) h.usage[key] += usage[key] ?? 0;
          const text = current.trim() || messageText(ev.message).trim();
          if (text) h.result = text;
          current = "";
        } else if (ev.type === "tool_execution_start") {
          h.toolCalls += 1;
          pushActivity(h, `${ev.toolName} ${short(ev.args, 160)}`);
        } else if (ev.type === "tool_execution_end") {
          const content = ev.result?.content;
          const text = Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text).join(" ") : String(content ?? "");
          pushActivity(h, `${ev.isError ? "ERROR " : ""}${ev.toolName} -> ${short(text, 160)}`);
        }
      });
      const seen = new Set();
      const inspectSuspension = () => {
        if (h.status === "stopped") return;
        const s = A.SessionStore.get(account.id, h.id)?.suspension;
        if (unresolved(s)) {
          h.suspension = suspensionView(s);
          h.status = "suspended";
          if (!seen.has(s.toolCallId)) {
            seen.add(s.toolCallId);
            pushActivity(h, `SUSPENDED ${h.suspension.description}`);
            if (h.autoApprove) void h.answer(autoResponseFor(s), s.toolCallId).catch((error) => { h.error = error.message; });
          }
        } else if (h.status === "suspended") { h.suspension = null; h.status = "running"; }
      };
      timer = setInterval(inspectSuspension, suspensionIntervalMs);
      timer.unref?.();
      if (resumeResponse !== undefined) {
        expectedSuspension(h, expectedToolCallId);
        h.executionStarted = true;
        await A.resolveSuspension({ accountId: account.id, sessionId: h.id, toolCallId: expectedToolCallId, response: resumeResponse });
        h.suspension = null;
      } else if (!adopt) {
        // Lifetime evidence latch: native start can execute work before rejecting. Never clear on retry/continue.
        h.executionStarted = true;
        await server.startRun(account.id, record.id, (s) => h.status === "stopped" ? Promise.resolve() : s.prompt(userMessage(promptText)));
      }
      inspectSuspension();
      await server.waitForIdle(account.id, record.id);
      if (h.status !== "stopped") {
        const store = A.SessionStore.get(account.id, record.id);
        if (store?.status === "suspended" && unresolved(store.suspension)) {
          h.status = "suspended";
          h.suspension = suspensionView(store.suspension);
          h.recovery = { mode: "awaiting-answer-reentry", previousStatus: "suspended", resumed: false };
        } else {
          h.status = store?.status === "errored" ? "error" : store?.status === "aborted" ? "stopped" : ["running", "suspended"].includes(store?.status) ? "interrupted" : "done";
          h.suspension = null;
          if (h.status === "interrupted") {
            A.SessionStore.update(account.id, h.id, { status: "interrupted" });
            h.errorCode = "SESSION_INTERRUPTED";
            h.recovery = { mode: "explicit-continuation-required", previousStatus: store.status, resumed: false };
          }
          if (h.status === "error") h.error ??= "agent run errored";
        }
      }
    } catch (error) {
      if (h.status !== "stopped") h.status = "error";
      h.error = error instanceof Error ? error.message : String(error);
      h.errorCode = error?.code ?? "AGENT_RUN_FAILED";
    } finally {
      if (timer) clearInterval(timer);
      try { unsubscribe?.(); } catch (error) { log(`[engine] unsubscribe: ${error.message}`); }
      h.agentSession = null;
      h.endedAt = Date.now();
      try { await onTurnEnd(); } catch (error) { log(`[engine] turn cleanup: ${error.message}`); }
      // The server retains the owner/REPL across turns and applies its own bounded idle eviction.
    }
  }

  function startSession({ task, model: requestedModel, thinking, mode = "guard", autoApprove = false }) {
    if (closed) throw sessionError("ENGINE_CLOSED", "engine is closed", 503);
    const text = requireText(String(task ?? "").replace(BOUNDARY_RE, ""));
    const currentDefault = A.settings?.(account.id)?.get("defaultModel") ?? model;
    const requested = typeof requestedModel === "string" ? { modelId: requestedModel } : requestedModel;
    const selection = resolveModelSelection(currentDefault, { ...requested, ...(thinking !== undefined ? { thinkingLevel: thinking } : {}) });
    const record = createRecord(A, { accountId: account.id, cwd, title: text.slice(0, 80), permissionMode: mode, model: selection, profileId, windowId: ext.windowId });
    const h = bareHandle({ id: record.id, task: text, mode, model: selection, autoApprove });
    sessions.set(h.id, h);
    queue.push({ handle: h, promptText: text });
    pump();
    return h;
  }

  function bareHandle({ id, task, mode, model: selection, autoApprove = false }) {
    const h = {
      id, task, mode, autoApprove, status: "queued", createdAt: Date.now(), startedAt: null, endedAt: null, turns: 0,
      model: selection, activity: [], toolCalls: 0, modelCalls: 0, usage: { input: 0, output: 0, cacheRead: 0 },
      result: null, error: null, errorCode: null, suspension: null, recovery: null, executionStarted: false,
      asideSessionId: id, agentSession: null, runPromise: null,
      async answer(response, expectedToolCallId) {
        if (h.status !== "suspended" || !h.suspension) throw sessionError("NO_PENDING_SUSPENSION", "no pending suspension");
        const pending = expectedSuspension(h, expectedToolCallId);
        if (!response || typeof response !== "object" || Array.isArray(response)) throw sessionError("INVALID_RESPONSE", "suspension response must be an object", 400);
        try { response = A.suspensionResponseSchemas?.[pending.kind]?.parse(response) ?? response; }
        catch (error) { throw sessionError("INVALID_RESPONSE", error.message, 400); }
        if (active.has(h) || A.liveSuspensionRegistry?.has(`${id}:${pending.toolCallId}`)) {
          h.executionStarted = true;
          await A.resolveSuspension({ accountId: account.id, sessionId: id, toolCallId: expectedToolCallId, response });
          h.suspension = null;
          h.status = "running";
        } else {
          // Explicit answer opts into native transcript reentry; startup itself never reruns tools.
          if (typeof A.resolveSuspension !== "function") throw sessionError("RECOVERY_UNSUPPORTED", "engine cannot resume a persisted suspension");
          h.status = "queued";
          queue.push({ handle: h, resumeResponse: response, expectedToolCallId });
          pump();
        }
        pushActivity(h, `RESUMED ${short(response, 120)}`);
      },
      async steer(value) {
        const text = requireText(value);
        if (h.status === "queued") {
          const item = queue.find((item) => item.handle === h);
          if (!item || item.resumeResponse !== undefined) throw sessionError("SESSION_BUSY", "session is starting; retry steering");
          item.promptText += `\n\nAdditional user instruction before execution:\n${text}`;
        } else {
          if (h.status === "suspended") throw sessionError("SESSION_SUSPENDED", "answer the pending suspension first");
          if (h.status !== "running" || !isStreaming(id)) throw sessionError("SESSION_NOT_RUNNING", "session is not streaming; continue or retry once it starts");
          h.executionStarted = true;
          await server.steer(account.id, id, userMessage(text));
        }
        pushActivity(h, `STEER ${short(text, 120)}`);
      },
      continue(value) {
        const text = requireText(value);
        if (closed) throw sessionError("ENGINE_CLOSED", "engine is closed", 503);
        if (h.status === "suspended") throw sessionError("SESSION_SUSPENDED", "answer the pending suspension first");
        if (active.has(h) || h.status === "running" || h.status === "queued" || isStreaming(id)) throw sessionError("SESSION_BUSY", "session is still running; use steer");
        const pending = A.SessionStore.get(account.id, id)?.suspension;
        if (unresolved(pending)) throw sessionError("SESSION_SUSPENDED", "answer or stop the pending suspension first");
        h.status = "queued";
        h.endedAt = null;
        h.error = null;
        h.errorCode = null;
        h.result = null;
        h.turns += 1;
        h.recovery = null;
        pushActivity(h, `CONTINUE ${short(text, 120)}`);
        queue.push({ handle: h, promptText: text });
        pump();
      },
      async stop() {
        if (!active.has(h) && !["queued", "running", "suspended"].includes(h.status)) return;
        const wasQueued = h.status === "queued";
        for (let index = queue.length - 1; index >= 0; index -= 1) if (queue[index].handle === h) queue.splice(index, 1);
        h.status = "stopped";
        h.suspension = null;
        h.endedAt = Date.now();
        try {
          await server.abort(account.id, id);
          // Native abortStoredSession ignores never-started idle records. Persist queued cancellation ourselves.
          if (wasQueued) A.SessionStore.update(account.id, id, { status: "aborted" });
        } catch (error) {
          h.status = "error";
          h.error = error.message;
          h.errorCode = "STOP_FAILED";
          throw sessionError("STOP_FAILED", error.message, 500);
        }
      },
      toJSON() {
        const { agentSession, runPromise, answer, steer, stop, toJSON, continue: continueFn, ...rest } = h;
        return rest;
      },
    };
    return h;
  }

  function reconcile(h) {
    const record = A.SessionStore.get(account.id, h.id);
    if (!record) return;
    if (record.status === "running" || record.status === "suspended") {
      const idleSuspension = record.status === "suspended" && unresolved(record.suspension)
        && !isStreaming(h.id) && !A.liveSuspensionRegistry?.has(`${h.id}:${record.suspension.toolCallId}`);
      if (server.getLoadedAgent(account.id, h.id) && !idleSuspension) {
        // A loaded owner can be prewarmed and idle. A persisted unanswered question is not a running job.
        // For a starting run, however, wait for the shared owner's native promise before classifying it stale.
        active.add(h);
        running += 1;
        h.runPromise = runHandle(h, { adopt: true }).finally(() => { active.delete(h); running -= 1; pump(); });
      } else if (record.status === "suspended" && unresolved(record.suspension)) {
        h.status = "suspended";
        h.suspension = suspensionView(record.suspension);
        h.recovery = { mode: "awaiting-answer-reentry", previousStatus: record.status, resumed: false };
      } else {
        A.SessionStore.update(account.id, h.id, { status: "interrupted" });
        h.status = "interrupted";
        h.error = "Previous execution is no longer active; explicitly continue to start a new turn.";
        h.errorCode = "SESSION_INTERRUPTED";
        h.recovery = { mode: "explicit-continuation-required", previousStatus: record.status, resumed: false };
      }
    }
  }

  function hydrate(id) {
    const record = A.SessionStore.get(account.id, id);
    if (!record) return null;
    const h = bareHandle({ id, task: record.title ?? "", mode: record.permissionMode, model: record.model ?? model });
    // Hydration cannot prove an old task never acted, even if its current record says idle/error.
    h.executionStarted = true;
    h.createdAt = +new Date(record.createdAt ?? h.createdAt);
    h.status = record.status === "errored" ? "error" : record.status === "interrupted" ? "interrupted" : record.status === "aborted" ? "stopped" : "done";
    if (h.status === "interrupted") {
      h.errorCode = "SESSION_INTERRUPTED";
      h.recovery = { mode: "explicit-continuation-required", previousStatus: "running", resumed: false };
    }
    // Promise-shaped message readers are observed asynchronously; their rejection is never unhandled.
    const restoreResult = (raw) => {
      if (active.has(h) || h.status === "queued") return;
      const messages = Array.isArray(raw) ? raw : Array.isArray(raw?.messages) ? raw.messages : [];
      const last = [...messages].reverse().find((message) => message.role === "assistant");
      if (last) h.result = messageText(last).trim() || null;
    };
    const raw = A.SessionStore.listMessagesForAgentContext?.(account.id, id);
    if (raw?.then) void Promise.resolve(raw).then(restoreResult).catch((error) => log(`[engine] history recovery: ${error.message}`));
    else restoreResult(raw);
    sessions.set(id, h);
    return h;
  }

  function listAsideSessions(limit = 20) {
    const raw = A.SessionStore.list?.(account.id, { limit }) ?? A.SessionStore.listPreviewItems?.(account.id, { limit }) ?? [];
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    return rows.map((row) => {
      const session = row.session ?? row;
      return { id: session.id, title: session.title ?? "", status: session.status ?? null, unread: !!session.unread, createdAt: +new Date(session.createdAt ?? 0), updatedAt: +new Date(session.updatedAt ?? session.createdAt ?? 0), projectId: session.projectId ?? null };
    }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  async function asideMessages(id, since = 0) {
    const raw = await A.SessionStore.listAllMessages(account.id, id);
    const messages = Array.isArray(raw) ? raw : Array.isArray(raw?.messages) ? raw.messages : [];
    return messages.filter((message) => (message.role === "user" || message.role === "assistant") && +new Date(message.timestamp ?? 0) > since)
      .map((message) => ({ role: message.role, text: messageText(message), timestamp: +new Date(message.timestamp ?? 0), id: message.id ?? null }))
      .filter((message) => message.text.trim().length > 0);
  }

  return {
    startSession, listAsideSessions, asideMessages,
    get: (id) => { const h = sessions.get(id) ?? hydrate(id); if (h && !active.has(h) && h.status !== "queued") reconcile(h); return h; },
    list: () => [...sessions.values()].map((h) => h.toJSON()),
    stats: () => ({ running, queued: queue.length, total: sessions.size }),
    close: async () => { closed = true; await Promise.all([...sessions.values()].map((h) => h.stop())); await Promise.all([...sessions.values()].map((h) => h.runPromise)); },
  };
}

export function sessionError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

/** Writes .state/aside-installation-key.der from installation-keys.json (privateJwk) and returns its path. */
function writeInstallationKeyDer(stateDir) {
  const keys = ensureInstallationKeys(stateDir);
  const file = path.join(stateDir, "aside-installation-key.der");
  const der = createPrivateKey({ key: keys.privateJwk, format: "jwk" }).export({ format: "der", type: "pkcs8" });
  writeFileSync(file, der, { mode: 0o600 });
  return file;
}

/** Waits for the real extension to register on the daemon's bridge and resolves the browser window id over CDP. */
export async function attachRealExtension({ bridge, cdp, accountId, log, nativeComponentVersion, timeoutMs = 90_000 }) {
  await cdp.connect();
  const deadline = Date.now() + timeoutMs;
  let entry = null;
  let nativeIdentity = null;
  while (Date.now() < deadline) {
    const candidates = [...bridge.connections.values()].filter((c) => c.accountId === accountId && c.ws?.readyState === 1);
    for (const candidate of candidates) {
      if (nativeComponentVersion) {
        try {
          nativeIdentity = await verifyNativeComponentVersions({ cdp, accountId, profileId: candidate.profileId, expectedVersion: nativeComponentVersion });
        } catch (error) {
          if (error?.code === "ASIDE_NATIVE_PROFILE_NOT_READY") continue;
          throw error;
        }
      }
      if (candidate.ws?.readyState !== 1) continue;
      entry = candidate;
      break;
    }
    if (entry) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!entry) throw new Error("the Aside extension did not register on the daemon bridge (is BELMONT_BROWSE_EXTENSION loaded in the fork?)");
  let windowId = null;
  const pages = await cdp.pageTargets();
  for (const p of pages) {
    try { ({ windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: p.targetId })); break; } catch { /* next */ }
  }
  log(`[engine] real extension registered: connection ${entry.connectionId}, profile ${entry.profileId}${nativeIdentity ? `, native profile ${nativeIdentity.nativeProfileId}` : ""}`);
  return { real: true, profileId: entry.profileId, ...(nativeIdentity ? { nativeProfileId: nativeIdentity.nativeProfileId } : {}), windowId: windowId ?? 1, stats: { commands: 0 }, entry };
}

/** Reject an incompatible existing browser instead of silently attaching it. */
export async function verifyNativeComponentVersions({ cdp, accountId, profileId, expectedVersion }) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  const workers = targetInfos.filter((target) => target.type === "service_worker"
    && target.url === "chrome-extension://fjdhphbdlfjogobdofoaagnlnkoibdge/background.js");
  for (const worker of workers) {
    const response = await cdp.withTarget(worker.targetId, (send) => send("Runtime.evaluate", {
      expression: `(async () => ({
        profile: await chrome.asideAccount.getProfileContext(),
        bridgeProfileId: (await chrome.storage.local.get("extensionBridgeProfileId")).extensionBridgeProfileId,
        agentVersion: chrome.runtime.getManifest().version,
        passwordManager: await chrome.management.get("clcdgiameigmljcbkkcbjiljinmfkncl")
      }))()`,
      awaitPromise: true,
      returnByValue: true,
    }));
    if (response.exceptionDetails) throw new Error("Could not verify the native Aside component pair");
    const value = response.result?.value;
    const nativeProfileId = value?.profile?.profileId;
    const bridgeProfileId = value?.bridgeProfileId || nativeProfileId;
    if (typeof nativeProfileId !== "string" || !nativeProfileId
      || value.profile.boundAccountId !== accountId || bridgeProfileId !== profileId) continue;
    if (value.agentVersion !== expectedVersion || value.passwordManager?.version !== expectedVersion
      || value.passwordManager?.enabled !== true) {
      throw new Error(`Aside component/engine mismatch: engine ${expectedVersion}, agent ${value.agentVersion}, password manager ${value.passwordManager?.version}. Restart with the matching prepared native component pair.`);
    }
    return { version: expectedVersion, profileId, accountId, nativeProfileId };
  }
  throw Object.assign(new Error("Could not verify native Aside component versions for the bound profile"), {
    code: "ASIDE_NATIVE_PROFILE_NOT_READY",
  });
}

/** Text of a stored Aside message (user/assistant/system rows) for the bot transcript mirror. */
function messageText(m) {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
  return "";
}

function pushActivity(h, line) {
  h.activity.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (h.activity.length > 200) h.activity.splice(0, h.activity.length - 200);
}
function short(v, n) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : s ?? "";
}
