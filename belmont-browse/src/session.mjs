// belmont-browse: create an Aside account/session on the recovered daemon internals (our code).
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, symlinkSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createMemorySearch } from "./memory-search.mjs";
import { BubblewrapBackend } from "./bwrap-backend.mjs";
import { createLocalWebSearch } from "./web-search.mjs";
import { canonicalMemoryRequested, assertCanonicalMemoryGuard } from "./memory-belmont-runtime.mjs";

/** Belmont-owned knowledge store: site playbooks, browser-bot rules, lessons. Survives engine upgrades; readable by Belmont bots. */
export const KNOWLEDGE_DIR = process.env.BELMONT_KNOWLEDGE_DIR || path.resolve(import.meta.dirname, "../../.cache/belmont-wsl-profile/sand-data/knowledge");

/** Copies rules/aside-agents.md → AGENTS.md (one-way: the knowledge store is the source of truth). */
export function syncKnowledgeIntoAccount(accountRoot, log = () => {}) {
  const rules = path.join(KNOWLEDGE_DIR, "rules", "aside-agents.md");
  if (existsSync(rules)) { copyFileSync(rules, path.join(accountRoot, "AGENTS.md")); log(`[knowledge] AGENTS.md <- ${rules}`); }
  const sitesLink = path.join(accountRoot, "memory", "sites");
  if (!existsSync(sitesLink)) { mkdirSync(path.dirname(sitesLink), { recursive: true }); try { symlinkSync(path.join(KNOWLEDGE_DIR, "sites"), sitesLink); } catch {} }
}

/** A canonical read root is needed because the daemon resolves the live memory symlink. */
export function syncKnowledgeReadPermission(A, accountId, accountRoot, log = () => {}) {
  const sitesLink = path.join(accountRoot, "memory", "sites");
  let sitesRoot;
  try {
    if (!lstatSync(sitesLink).isSymbolicLink()) return false;
    sitesRoot = realpathSync(path.join(KNOWLEDGE_DIR, "sites"));
    if (realpathSync(sitesLink) !== sitesRoot || !statSync(sitesRoot).isDirectory()) return false;
  } catch {
    return false; // Missing, broken, or unrelated links must not create permissions.
  }
  const store = A.settings(accountId);
  const needsRoot = (permission) => permission?.files?.outsideRead !== "deny" &&
    !(permission?.files?.readableRoots ?? []).includes(sitesRoot);
  if (!needsRoot(store.get("permission"))) return false;
  let added = false;
  // SettingsStore's callback runs under its file lock against the current settings.
  store.set("permission", (permission) => {
    if (!needsRoot(permission)) return permission;
    added = true;
    return {
      ...permission,
      files: {
        ...permission?.files,
        readableRoots: [...(permission?.files?.readableRoots ?? []), sitesRoot],
      },
    };
  });
  if (added) log(`[knowledge] readable sites root: ${sitesRoot}`);
  return added;
}

export const DEFAULT_MODEL = { provider: "openai-codex", modelId: "gpt-5.5", thinkingLevel: "high", fastMode: false };

/** Resolve CLI/task partial selections without discarding a saved provider or mode. */
export function resolveModelSelection(savedModel, override) {
  const base = savedModel ?? DEFAULT_MODEL;
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(base) || (override !== undefined && !isObject(override))) {
    throw new TypeError("Model selection must be an object");
  }
  const fields = { provider: "string", modelId: "string", thinkingLevel: "string", fastMode: "boolean" };
  const next = { ...base };
  for (const [name, value] of Object.entries(override ?? {})) {
    if (value === undefined) continue;
    if (!Object.hasOwn(fields, name)) throw new TypeError(`Unknown model selection field: ${name}`);
    next[name] = value;
  }
  for (const [name, expected] of Object.entries(fields)) {
    const value = next[name];
    if (value === undefined && (name === "thinkingLevel" || name === "fastMode")) continue;
    if (typeof value !== expected || (expected === "string" && !value.trim())) {
      throw new TypeError(`Model ${name} must be ${expected === "string" ? "a nonempty string" : "a boolean"}`);
    }
  }
  return next;
}

// Must run BEFORE the daemon bundle is imported: the bundle reads env at module init.
export const ENGINES = {
  "824": { bundle: "../vendor/aside-824/apps/daemon/build/daemon.mjs", home: "aside-home", version: "1.26.824.2151" },
  "902": { bundle: "../vendor/aside-902/apps/daemon/build/daemon.mjs", home: "aside-home-902", version: "1.26.902.1713" },
  "906": { bundle: "../vendor/aside-906/apps/daemon/build/daemon.mjs", home: "aside-home-906", version: "1.26.906.1714" },
  "907": { bundle: "../vendor/aside-907/apps/daemon/build/daemon.mjs", home: "aside-home-907", version: "1.26.907.1712" },
  "909": { bundle: "../vendor/aside-909/apps/daemon/build/daemon.mjs", home: "aside-home-909", version: "1.26.909.1820" },
};

export function prepareAsideHome({ asideHome, cdpUrl, model }) {
  process.env.ASIDE_HOME = asideHome;
  process.env.BELMONT_CDP_URL = cdpUrl;
  // Preserve explicit endpoint overrides and the original public API default.
  // Pointing ASIDE_API_URL at a closed local port also disabled the public model
  // catalog and every authenticated account workflow in the original daemon.
  process.env.DAEMON_URL ??= `http://127.0.0.1:${process.env.BELMONT_BROWSE_DAEMON_PORT || "21420"}`;
  const accountRoot = path.join(asideHome, "u", "0");
  mkdirSync(accountRoot, { recursive: true });
  const settingsPath = path.join(accountRoot, "settings.json");
  const current = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  const defaultModel = resolveModelSelection(current.defaultModel, model);
  const next = {
    ...current,
    defaultModel,
    analytics: current.analytics ?? { enabled: false },
    routineSuggestions: current.routineSuggestions ?? current.routineSuggestion ?? { enabled: false },
  };
  // Earlier Belmont versions wrote a singular key the original SettingsStore never read.
  // Migrate its value only when the canonical setting is missing.
  delete next.routineSuggestion;
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  }
  return { accountRoot, settingsPath, defaultModel, credentialsPath: path.join(accountRoot, "credentials.json") };
}

export async function loadDaemon(engine = "824") {
  const spec = ENGINES[engine];
  if (!spec) throw new Error(`unknown engine ${engine}; use ${Object.keys(ENGINES).join("|")}`);
  const bundle = canonicalMemoryRequested() ? spec.bundle.replace(/daemon\.mjs$/, "daemon.memory-2.1.mjs") : spec.bundle;
  if (canonicalMemoryRequested() && !existsSync(new URL(bundle, import.meta.url))) throw new Error(`BELMONT_MEMORY_GUARD_REQUIRED: prepare the derived daemon with BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE=${engine} npm run bootstrap:aside before enabling Belmont memory authority`);
  const mod = await import(bundle);
  const A = mod.__belmont;
  // HTTP/WebSocket server pieces (tools/patch-daemon-linux.py) for src/daemon-server.mjs.
  A.__server = mod.__belmontServer ?? null;
  A.__linux = mod.__belmontLinuxInternals ?? null;
  A.__lifecycles = mod.__belmontLifecycles ?? null;
  A.__workloads = mod.__belmontWorkloads ?? null;
  A.__canonicalMemoryGuard = mod.__belmontCanonicalMemoryGuard ?? null;
  // A legacy daemon must never accept a canonical-authority session. The new
  // generator is applied to recovered inputs by the separate build workflow.
  assertCanonicalMemoryGuard(A);
  for (const name of ["init_directory", "init_accounts", "init_store$3", "init_store$1", "init_cdp", "init_extension_bridge", "init_browser", "init_tool_states", "init_session_notifications", "init_suspension", "init_skills$5", "init_agent_session", "init_agent_session_server", "init_lifecycles", "init_scheduler", "init_start_context_awareness", "init_start_comprehension"]) {
    A[name]?.();
  }
  return A;
}

export async function ensureLocalAccount(A, log = () => {}) {
  const account = A.AccountRegistry.getAccount(0) ?? A.AccountRegistry.getAll().accounts[0];
  if (!account) throw new Error("Aside local account was not created by the registry");
  // Original local bootstrap steps, with network-only account sync kept separate.
  await A.tryMigrateStateDb(account.id);
  const root = A.getAccountRoot(account.id);
  A.initAccountDirectory(root);
  try { await A.syncAccountBuiltinSkills?.([root]); } catch (e) { log(`[bootstrap] builtin skill sync failed: ${e.message}`); }
  if (!canonicalMemoryRequested()) await A.MemoryManager?.init?.(account.id);
  const restorePasswordSession = A.loadPwmSessionFromKeychain ?? A.__linux?.loadPwmSessionFromKeychain;
  if (typeof restorePasswordSession === "function") {
    try { await restorePasswordSession(account.id); }
    catch { log("[bootstrap] password manager session restore failed; vault will remain locked"); }
  } else {
    log("[bootstrap] password manager session restore is unsupported by this bundle");
  }
  syncKnowledgeIntoAccount(root, log);
  syncKnowledgeReadPermission(A, account.id, root, log);
  return account;
}

const localLifecycleStates = new WeakMap();

/** Start the local parts of bootstrap, without account/cloud/password/channel bootstrap or tool replay. */
export async function initializeLocalLifecycle(A, { accountId, startBackground = false, log = () => {} }) {
  let state = localLifecycleStates.get(A);
  if (!state) {
    state = { accounts: new Map(), initializingAccounts: new Map(), background: null, errors: {}, cleanups: new Map(), startPromise: null, closePromise: null, closed: false };
    localLifecycleStates.set(A, state);
  }
  if (state.closed) throw new Error("Aside local lifecycle is closed");
  const close = () => {
    if (state.closePromise) return state.closePromise;
    state.closed = true;
    state.closePromise = Promise.resolve().then(async () => {
      const failures = [];
      // Signal every worker before waiting on any one drain, so another timer
      // cannot launch fresh work while comprehension or observation is closing.
      const stopping = [];
      const stoppedCleanups = new Map();
      const stopAvailable = () => {
        for (const [name, cleanup] of [...state.cleanups].reverse()) {
          const seen = stoppedCleanups.get(name) ?? new Set();
          if (seen.has(cleanup)) continue;
          seen.add(cleanup);
          stoppedCleanups.set(name, seen);
          stopping.push((async () => {
            try { await cleanup(); if (state.background[name] !== "stop-failed") state.background[name] = "stopped"; }
            catch (error) { state.background[name] = "stop-failed"; state.errors[name] = error.message; failures.push(error); }
          })());
        }
      };
      stopAvailable();
      await Promise.allSettled([...state.initializingAccounts.values()]);
      await state.startPromise?.catch(() => {});
      // A starter without a named stop hook may return its cleanup after close began.
      stopAvailable();
      await Promise.all(stopping);
      for (const [name, status] of Object.entries(state.background ?? {})) {
        if (status !== "started-unmanaged") continue;
        state.background[name] = "stop-unsupported";
        failures.push(new Error(`${name} has no cleanup contract in this bundle`));
      }
      // Full-engine ownership includes sessions opened directly by the original UI.
      try { await A.GlobalAgentSessionServer?.disposeAll?.(); }
      catch (error) { state.errors.agentSessions = error.message; failures.push(error); }
      // The engine closes memory hooks after this producer/agent drain. Those
      // hooks own pending memory queries and the original account manager.
      if (failures.length) throw new AggregateError(failures, "Aside local lifecycle cleanup failed");
      localLifecycleStates.delete(A);
    });
    return state.closePromise;
  };
  const lifecycle = {
    get recovered() { return state.accounts.get(accountId); },
    get background() { return state.background; },
    errors: state.errors,
    close,
  };
  if (!state.initializingAccounts.has(accountId)) {
    state.initializingAccounts.set(accountId, Promise.resolve().then(async () => {
      const recovered = [];
      const rows = A.SessionStore.listFull?.(accountId, { statuses: ["running", "suspended"], parent: "all", ephemeral: "include" }) ?? [];
      // The original startup recovery (recoverSuspensionsOnStartup -> recoverSession) re-enters a suspended
      // tool call whose answer or error is already stored, resets a suspended session without suspension
      // data to idle, and leaves unanswered questions in place. That is the original's own code path, so
      // it is called as-is when the bundle exports it; only sessions it does not cover (running ones, or
      // any suspended session on a bundle without the export) are marked for explicit continuation.
      const originalRecovery = typeof A.recoverSuspensionsOnStartup === "function";
      let handedToOriginal = 0;
      for (const record of rows) {
        if (record.status !== "running" && record.status !== "suspended") continue;
        const loaded = A.GlobalAgentSessionServer.getLoadedAgent(accountId, record.id);
        if (loaded?.agent?.state?.isStreaming) continue;
        const answered = record.status === "suspended" && record.suspension != null && (record.suspension.response !== undefined || record.suspension.error !== undefined);
        if (record.status === "suspended" && record.suspension && !answered) {
          // Unanswered questions remain actionable through native, explicit-answer transcript reentry.
          recovered.push({ id: record.id, previousStatus: record.status, mode: "awaiting-answer-reentry", resumed: false });
        } else if (record.status === "suspended" && originalRecovery) {
          handedToOriginal += 1;
          recovered.push({ id: record.id, previousStatus: record.status, mode: answered ? "original-reentry-scheduled" : "original-reset-idle", resumed: answered });
        } else {
          A.SessionStore.update(accountId, record.id, { status: "interrupted" });
          recovered.push({ id: record.id, previousStatus: record.status, mode: "explicit-continuation-required", resumed: false });
        }
      }
      if (handedToOriginal > 0) {
        try { await A.recoverSuspensionsOnStartup(accountId); }
        catch (error) { state.errors.recoverSuspensionsOnStartup = error.message; log(`[lifecycle] original suspension recovery failed: ${error.message}`); }
      }
      await A.RecentSessionsStore?.loadCache?.(accountId);
      if (state.closed) return;
      A.registerStartupTabReconciliation?.();
      state.accounts.set(accountId, recovered);
      log(`[lifecycle] reconciled ${recovered.length} persisted executions; ${handedToOriginal} handed to the original suspension recovery`);
    }));
  }
  try {
    await state.initializingAccounts.get(accountId);
    if (state.closed) throw new Error("Aside local lifecycle closed during account initialization");
  } catch (error) { error.lifecycle = lifecycle; throw error; }
  if (startBackground && !state.startPromise) {
    state.background = {};
    const resolve = (name) => A.__lifecycles?.[name] ?? A[name];
    state.startPromise = (async () => {
      const failures = [];
      const start = async (name) => {
        if (state.closed) { state.background[name] = "stopped-before-start"; return; }
        const starter = resolve(name);
        if (typeof starter !== "function") { state.background[name] = "unsupported"; return; }
        const stop = resolve(name.replace(/^start/, "stop"));
        if (typeof stop === "function") state.cleanups.set(name, () => stop());
        state.background[name] = "starting";
        try {
          const handle = await starter();
          const cleanup = typeof handle === "function" ? handle
            : typeof handle?.close === "function" ? () => handle.close()
            : typeof handle?.stop === "function" ? () => handle.stop()
            : null;
          if (cleanup) state.cleanups.set(name, cleanup);
          if (!["stopped", "stop-failed"].includes(state.background[name])) {
            state.background[name] = state.cleanups.has(name) ? "started" : "started-unmanaged";
          }
        } catch (error) {
          if (["stopped", "stop-failed"].includes(state.background[name])) {
            state.errors[`${name}:startup`] = error.message;
          } else {
            state.background[name] = "failed";
            state.errors[name] = error.message;
          }
          failures.push(error);
        }
      };
      await start("startSessionMaintenance");
      await start("startRoutineScheduler");
      // Original bootstrap parity: the memory history backfill also runs at startup (it otherwise only runs
      // from the per-session memory hook), catching sessions that ended while the daemon was down. The
      // original start/stop pair is used unchanged; the promise is the backfill's own lifetime.
      // 909 renamed the pair to *SessionTurnMemoryBackfill (logical Turns); the original start/stop pair is used
      // under whichever name the bundle exports.
      const backfillStart = ["startSessionTurnMemoryBackfill", "startSessionRunMemoryBackfill"].find((candidate) => typeof A[candidate] === "function");
      const backfillStop = backfillStart?.replace("start", "stop");
      if (canonicalMemoryRequested()) state.background.startSessionRunMemoryBackfill = "disabled-belmont-authority";
      else if (backfillStart) {
        const name = backfillStart;
        if (state.closed) state.background[name] = "stopped-before-start";
        else {
          state.background[name] = "starting";
          try {
            const running = Promise.resolve(A[backfillStart](accountId));
            running.catch((error) => { state.errors[name] = error.message; log(`[lifecycle] memory backfill stopped unexpectedly: ${error.message}`); });
            if (typeof A[backfillStop] === "function") state.cleanups.set(name, () => A[backfillStop](accountId));
            if (!["stopped", "stop-failed"].includes(state.background[name])) state.background[name] = state.cleanups.has(name) ? "started" : "started-unmanaged";
          } catch (error) {
            state.background[name] = "failed"; state.errors[name] = error.message; failures.push(error);
          }
        }
      } else state.background.startSessionRunMemoryBackfill = "unsupported";
      if (state.closed) {
        if (failures.length) throw new AggregateError(failures, "Aside local background startup failed");
        return;
      }
      // The original loops enforce saved capture settings internally and must
      // exist before a later UI enable. Unknown adapters keep the explicit gate.
      const contextNames = ["startContextAwareness", "startContextAwarenessComprehension"];
      let enabled = false;
      try {
        enabled = !canonicalMemoryRequested() && (A.__lifecycles?.contextSettingsManaged === true ||
          (contextNames.some((name) => typeof resolve(name) === "function") &&
            A.settings?.(accountId)?.get("contextAwareness")?.enabled === true));
      } catch (error) {
        for (const name of contextNames) { state.background[name] = "failed"; state.errors[name] = error.message; }
        throw error;
      }
      for (const name of contextNames) {
        if (enabled) await start(name);
        else {
          state.background[name] = typeof resolve(name) === "function" ? "disabled-by-setting" : "unsupported";
          // Settings can enable native capture later, after startup. Keep its stop contract.
          const stop = resolve(name.replace(/^start/, "stop"));
          if (typeof stop === "function") state.cleanups.set(name, () => stop());
        }
      }
      if (failures.length) throw new AggregateError(failures, "Aside local background startup failed");
    })();
  }
  if (startBackground) {
    try {
      await state.startPromise;
      if (state.closed) throw new Error("Aside local lifecycle closed during background startup");
    }
    catch (error) { error.lifecycle = lifecycle; throw error; }
  }
  return lifecycle;
}

export function createBrowseSession(A, { accountId, cwd, title, permissionMode, model, profileId, windowId, anchorTargetId }) {
  const id = randomUUID().replace(/-/g, "").slice(0, 21);
  const createdAt = new Date();
  mkdirSync(cwd, { recursive: true });
  const sessionDir = A.getSessionStorageDir({ id, createdAt }, accountId);
  const session = A.SessionStore.insert(accountId, {
    id,
    createdAt,
    projectId: null,
    title,
    trigger: { type: "user", source: "belmont" }, // not "cli": Aside strips ask_user_question/confirm tools from headless (cli) sessions
    cwd,
    permissionMode,
    toolState: A.createDefaultToolState(sessionDir),
    model,
    browserBinding: { profileId, windowId, ...(anchorTargetId ? { anchorTargetId } : {}) },
    incognito: false,
    runtimeConfig: { workingDirs: [cwd], ...(canonicalMemoryRequested() ? { memoryExtractionDisabled: true } : {}) },
  });
  return session;
}

export function describeSuspension(s) {
  const req = s.request ?? {};
  if (s.kind === "ask-user-question") {
    const qs = (req.questions ?? []).map((q, i) => `  Q${i + 1} [${q.header ?? ""}] ${q.question ?? ""}${q.options ? " options: " + q.options.map((o) => o.label ?? o).join(" | ") : ""}`);
    return `ask-user-question\n${qs.join("\n")}`;
  }
  if (s.kind === "approval") {
    const head = `${req.title ?? req.action ?? req.toolName ?? req.tool ?? ""} ${req.description ?? req.reason ?? req.summary ?? ""}`.trim();
    if (head) return `approval: ${head}`;
    const scope = req.scope ?? {};
    if (scope.type === "file" && scope.path) return `approval: 파일 접근 ${scope.path}`;
    if (scope.type && (scope.url ?? scope.host ?? scope.origin)) return `approval: ${scope.type} ${scope.url ?? scope.host ?? scope.origin}`;
    return `approval: ${JSON.stringify(req).slice(0, 300)}`;
  }
  if (s.kind === "action-confirmation") return `action-confirmation: ${req.summary ?? req.description ?? JSON.stringify(req).slice(0, 300)}`;
  return `${s.kind}: ${JSON.stringify(req).slice(0, 300)}`;
}

export function autoResponseFor(s, answerText) {
  if (s.kind === "approval") return { verdict: "allow", always: false };
  if (s.kind === "action-confirmation") return { verdict: "confirm" };
  if (s.kind === "ask-user-question") {
    const qs = s.request?.questions ?? [];
    return { answers: qs.map((q) => ({ header: q.header ?? "", answer: answerText ?? q.options?.[0]?.label ?? q.options?.[0] ?? "yes" })) };
  }
  return null;
}

// belmont-browse hooks consumed by the patched daemon (see tools/patch-daemon.py #5/#6).
export function installDaemonHooks({ log = () => {}, memorySemanticAdapter = null, memorySearch = null, localWebSearch = null } = {}) {
  const memory = memorySearch ?? createMemorySearch({ log, semanticAdapter: memorySemanticAdapter, allowedRoots: [KNOWLEDGE_DIR] });
  const nativeWebSearch = localWebSearch ?? createLocalWebSearch({ log });
  const abort = new AbortController();
  const activeSearches = new Set();
  let closePromise;
  let closed = false;
  const webSearch = {
    ...nativeWebSearch,
    enabled: () => !closed && nativeWebSearch.enabled(),
    execute(args) {
      if (closed) return Promise.reject(new Error("Daemon hooks are closed"));
      const signal = args.signal ? AbortSignal.any([args.signal, abort.signal]) : abort.signal;
      const pending = Promise.resolve().then(() => {
        if (closed) throw new Error("Daemon hooks are closed");
        return nativeWebSearch.execute({ ...args, signal });
      });
      activeSearches.add(pending);
      return pending.finally(() => activeSearches.delete(pending));
    },
  };
  const description = ({ dateRange = true } = {}) => {
    if (typeof memory.description === "function") return memory.description({ dateRange });
    const capability = memory.capabilities();
    const retrieval = capability.mode === "native"
      ? "Use Aside's original semantic memory search and ranking."
      : capability.mode === "hybrid"
      ? "Use configured semantic retrieval and keyword matching; keyword fallback is used if the semantic service is unavailable."
      : "Use local SQLite FTS5 keyword matching with CJK tokenization; semantic matching is not enabled.";
    return `Search the account's permitted Markdown memories. ${retrieval} Provide alternate query phrasings when needed. max_results applies per query; duplicate chunks are merged. ${dateRange ? "Optional from/to dates use inclusive local days. " : ""}Results include file paths, line numbers and excerpts. Incognito and context-awareness restrictions still apply.`;
  };
  const sandbox = (process.env.BELMONT_BROWSE_SANDBOX ?? "bwrap") === "bwrap" && existsSync("/usr/bin/bwrap") ? new BubblewrapBackend({ log }) : null;
  const installed = {
    __belmontLocalWebSearch: webSearch,
    __belmontMemorySearch: (args) => {
      if (closed) return Promise.reject(new Error("Daemon hooks are closed"));
      const pending = Promise.resolve().then(() => {
        if (closed) throw new Error("Daemon hooks are closed");
        return memory.searchMany(args);
      });
      activeSearches.add(pending);
      return pending.finally(() => activeSearches.delete(pending));
    },
    __belmontMemoryCapabilities: () => memory.capabilities(),
    __belmontMemoryDescription: description,
    ...(sandbox ? { __belmontSandboxBackend: sandbox } : {}),
  };
  Object.assign(globalThis, installed);
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = Promise.resolve().then(async () => {
      await Promise.allSettled([...activeSearches]);
      const results = await Promise.allSettled([
        Promise.resolve().then(() => nativeWebSearch.close?.()),
        Promise.resolve().then(() => memory.close?.()),
        Promise.resolve().then(() => sandbox?.close?.()),
      ]);
      const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, "Daemon hook cleanup failed");
    });
    // Bind the close promise before abort listeners can synchronously reenter close.
    abort.abort(new Error("Daemon hooks are closing"));
    for (const [name, value] of Object.entries(installed)) {
      if (globalThis[name] === value) delete globalThis[name];
    }
    return closePromise;
  };
  log(`[hooks] memory_search=${JSON.stringify(memory.capabilities?.() ?? { mode: "lexical" })} sandbox=${sandbox ? "bubblewrap" : "passthrough"}`);
  return { memory, sandbox, webSearch, close };
}
