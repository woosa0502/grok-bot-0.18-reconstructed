// Preserve Aside's account-owned Moss index, original ranking and idle release.
// The lexical index is an explicit fallback; native rows never enter its RRF path.
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createMemorySearch } from "./memory-search.mjs";

const MEMORY_API_PATHS = new Set(["/memory/auth-token", "/memory/auth-token/anonymous"]);
const MEMORY_API_URL = "https://api.aside.com";

/** Keep the daemon's authenticator, schema, refresh and 401/403 fallback logic.
 * Only its two memory token requests bypass the wrapper's disabled cloud URL.
 * The supplied createFetch is the daemon's original HTTP client, never a mock token.
 */
export function installNativeMemoryTransport() {
  const previous = globalThis.__belmontMemoryApi;
  const previousModulePath = process.env.ASIDE_MOSS_CORE_NODE_PATH;
  let nativeModulePath = previousModulePath;
  if (!nativeModulePath && process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) {
    // The original SEA loader supports this override; npm's package discovery
    // is otherwise bypassed when running its recovered JavaScript with Node.
    try {
      const require = createRequire(import.meta.url);
      const entry = require.resolve("@moss-dev/moss-core");
      const candidate = path.join(path.dirname(entry), `js-binding.linux-${process.arch}-gnu.node`);
      if (existsSync(candidate)) process.env.ASIDE_MOSS_CORE_NODE_PATH = nativeModulePath = candidate;
    } catch { /* Missing optional native installation remains an explicit fallback. */ }
  }
  const controller = new AbortController();
  const active = new Set();
  let client;
  let closed = false;
  let state = "configured";
  const transport = {
    accepts: (endpoint) => MEMORY_API_PATHS.has(endpoint),
    async request(endpoint, options, createFetch) {
      if (closed) throw new Error("Native memory transport is closed");
      if (!MEMORY_API_PATHS.has(endpoint)) throw new Error("Unsupported native memory endpoint");
      if (typeof createFetch !== "function") throw new TypeError("Aside createFetch is required");
      client ??= createFetch({
        baseURL: MEMORY_API_URL,
        timeout: 20_000,
        retry: { type: "linear", attempts: 2, delay: 1_000,
          shouldRetry: (error) => error === null || error.status === 408 || error.status === 429 || error.status >= 500 },
        throw: true,
      });
      // better-fetch disables its own per-attempt timeout when options.signal is
      // supplied. Combine shutdown only after it creates the request signal, so
      // the original 20s timeout and retries remain active.
      const onRequest = async (request) => {
        const amended = await options?.onRequest?.(request);
        const signal = amended?.signal ?? request.signal;
        return { ...amended, signal: AbortSignal.any([signal, controller.signal]) };
      };
      const run = Promise.resolve().then(() => client(endpoint, { ...options, onRequest }));
      active.add(run);
      try { const result = await run; state = "available"; return result; }
      catch (error) { state = "unavailable"; throw error; }
      finally { active.delete(run); }
    },
    capabilities: () => ({ state: closed ? "closed" : state, origin: MEMORY_API_URL, nativeModulePath: nativeModulePath ?? null,
      endpoints: [...MEMORY_API_PATHS], authentication: "original-aside-moss-authenticator" }),
  };
  let closing;
  globalThis.__belmontMemoryApi = transport;
  return {
    capabilities: transport.capabilities,
    close() {
      if (closing) return closing;
      closed = true;
      controller.abort();
      if (globalThis.__belmontMemoryApi === transport) {
        if (previous === undefined) delete globalThis.__belmontMemoryApi;
        else globalThis.__belmontMemoryApi = previous;
      }
      if (previousModulePath === undefined && nativeModulePath && process.env.ASIDE_MOSS_CORE_NODE_PATH === nativeModulePath) delete process.env.ASIDE_MOSS_CORE_NODE_PATH;
      closing = Promise.allSettled([...active]).then(() => {});
      return closing;
    },
  };
}

export function createNativeMemoryRuntime({ accountId, accountRoot, memoryManager,
  closeNative, fallback, allowedRoots = [], log = () => {} } = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 0) throw new TypeError("A numeric Aside accountId is required");
  if (typeof accountRoot !== "string" || !accountRoot.trim()) throw new TypeError("accountRoot is required");
  if (typeof closeNative !== "function") throw new TypeError("Account-aware closeNative is required");
  const root = path.resolve(accountRoot);
  const lexical = fallback ?? createMemorySearch({ allowedRoots, log });
  if (typeof lexical.searchMany !== "function" || typeof lexical.close !== "function") throw new TypeError("A lexical fallback service is required");
  const active = new Set();
  let state = typeof memoryManager?.searchMany === "function" ? "configured" : "unavailable";
  let lastError = state === "unavailable" ? { kind: "native-contract-missing" } : null;
  let lastNativeSuccessAt = null;
  let closed = false;
  let closing;

  function capabilities() {
    return {
      mode: closed ? "closed" : state === "available" ? "native" : state === "unavailable" ? "lexical" : "native-pending",
      accountId,
      semantic: { state: closed ? "closed" : state, engine: "aside-memory-manager", model: "original-aside-moss-model",
        ...(lastError ? { failure: { ...lastError }, reason: "Original memory search unavailable; lexical fallback is active." } : {}),
        lastSuccessfulSearchAt: lastNativeSuccessAt },
      lexical: { engine: "sqlite-fts5", role: "degraded-fallback", cjk: true },
      scope: { native: "Original regular Markdown traversal under account memory; symlinks are not indexed.",
        lexical: "Account memory plus explicitly allowed roots reached through its links.",
        allowedRoots: [...allowedRoots] },
      nativeRanking: "Original searchMany results, unchanged",
      nativeIdleRelease: "Original MemoryManager idle behavior is retained",
    };
  }

  function validate(args) {
    if (args?.accountId !== undefined && args.accountId !== accountId) throw new Error("Memory search accountId does not match its owner");
    if (args?.accountRoot !== undefined && path.resolve(args.accountRoot) !== root) throw new Error("Memory search accountRoot does not match its owner");
    if (!Array.isArray(args?.queries) || args.queries.length < 1 || args.queries.some((query) => typeof query !== "string" || !query.trim())) {
      throw new TypeError("queries must contain nonempty strings");
    }
    if (args.maxResults !== undefined && (!Number.isInteger(args.maxResults) || args.maxResults < 1 || args.maxResults > 10)) throw new RangeError("maxResults must be between 1 and 10");
    if (args.range !== undefined) {
      if (!args.range || typeof args.range !== "object") throw new TypeError("range must be an object");
      for (const value of [args.range.from, args.range.to]) {
        if (value !== undefined && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new RangeError("range requires valid dates");
      }
      if (args.range.from && args.range.to && args.range.from > args.range.to) throw new RangeError("range.from must not follow range.to");
    }
  }

  async function runNative(args) {
    if (typeof memoryManager?.searchMany !== "function") throw Object.assign(new Error("Original MemoryManager.searchMany is unavailable"), { kind: "native-contract-missing" });
    // Do not create another index, embed again, merge ranks, truncate or rewrite rows.
    const result = await memoryManager.searchMany({ queries: args.queries, maxResults: args.maxResults,
      range: args.range, excludeContextAwareness: args.excludeContextAwareness });
    if (!Array.isArray(result)) throw Object.assign(new TypeError("Original memory search returned invalid results"), { kind: "native-contract-invalid" });
    state = "available";
    lastError = null;
    lastNativeSuccessAt = new Date().toISOString();
    return result;
  }

  function unavailable(error) {
    state = "unavailable";
    // Original error text can contain paths, queries or credentials. Report a bounded category only.
    const known = new Set(["network", "unavailable", "native-contract-missing", "native-contract-invalid"]);
    lastError = { kind: known.has(error?.kind) ? error.kind : "native-failure" };
    log(`[memory-native] original search unavailable (${lastError.kind}); lexical fallback active`);
  }

  function track(operation) {
    if (closed) return Promise.reject(new Error("Native memory runtime is closed"));
    const run = Promise.resolve().then(operation);
    active.add(run);
    return run.finally(() => active.delete(run));
  }

  function searchMany(args) {
    return track(async () => {
      validate(args);
      // An evaluation session carries a per-session sites overlay (args.sitesRoot). It MUST read its isolated
      // overlay and never the account's native memory, so it bypasses the native MemoryManager (which cannot
      // scope to an overlay and would both ignore the candidate page and leak operational/account memory) and
      // uses the isolated lexical view directly. Ordinary sessions are unchanged: native first, lexical on failure.
      if (args.sitesRoot) return lexical.searchMany({ ...args, accountId, accountRoot: root });
      try { return await runNative(args); }
      catch (error) { unavailable(error); }
      return lexical.searchMany({ ...args, accountId, accountRoot: root });
    });
  }

  function warm({ query = "memory" } = {}) {
    return track(async () => {
      const args = { queries: [query], maxResults: 1 };
      validate(args);
      state = "warming";
      try { await runNative(args); }
      catch (error) { unavailable(error); }
      return capabilities();
    });
  }

  function description({ dateRange = true } = {}) {
    const current = capabilities();
    const intro = current.mode === "native" ? "Search saved memory using Aside's original semantic memory engine."
      : current.mode === "lexical" ? "Search saved memory using degraded local lexical matching; semantic search is currently unavailable."
        : "Search saved memory using Aside's original memory engine; semantic readiness has not yet been observed. Local lexical search is used if it fails.";
    return `${intro} Return source paths, line numbers and excerpts.${dateRange ? " Optional date ranges and context-awareness exclusion are supported." : ""} Original semantic traversal excludes symbolic links; linked knowledge roots are covered only by the explicit lexical fallback.`;
  }

  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      await Promise.allSettled([...active]);
      const results = await Promise.allSettled([Promise.resolve().then(() => lexical.close()), Promise.resolve().then(() => closeNative(accountId))]);
      state = "closed";
      const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, "Memory runtime cleanup failed");
    })();
    return closing;
  }

  return { searchMany, warm, capabilities, description, close };
}
