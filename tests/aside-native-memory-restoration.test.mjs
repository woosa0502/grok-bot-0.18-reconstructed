import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { createNativeMemoryRuntime, installNativeMemoryTransport } from "../belmont-browse/src/memory-native-runtime.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const bundle = path.join(repo, "belmont-browse/vendor/aside-906/apps/daemon/build/daemon.mjs");
const patcher = path.join(repo, "belmont-browse/tools/patch-daemon.py");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function sandbox(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "aside-native-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(overrides = {}) {
  return createNativeMemoryRuntime({ accountId: 7, accountRoot: "/tmp/aside-account-7",
    memoryManager: { searchMany: async () => [] },
    closeNative: async () => {}, fallback: { searchMany: async () => [], close: async () => {} }, ...overrides });
}

test("native ranked rows pass through by identity without double embedding, RRF or truncation", async () => {
  const rows = [{ chunkId: "z", score: 0.02, title: "original first", custom: 42 }, { chunkId: "a", score: 0.97 }];
  let received;
  const service = fixture({ memoryManager: { searchMany: async (args) => { received = args; return rows; } },
    fallback: { searchMany: async () => { throw new Error("lexical must not run"); }, close: async () => {} } });
  assert.equal(service.capabilities().semantic.state, "configured");
  const args = { accountId: 7, accountRoot: "/tmp/aside-account-7", queries: ["different words"], maxResults: 1,
    range: { from: "2026-01-01", to: "2026-12-31" }, excludeContextAwareness: true };
  assert.equal(await service.searchMany(args), rows);
  assert.deepEqual(received, { queries: args.queries, maxResults: 1, range: args.range, excludeContextAwareness: true });
  assert.equal(service.capabilities().mode, "native");
  assert.match(service.capabilities().semantic.lastSuccessfulSearchAt, /^\d{4}-/);
  await service.close();
});

test("native failure uses explicit lexical fallback, preserves scope, and retries original engine", async (t) => {
  const dir = sandbox(t);
  const root = path.join(dir, "account");
  const allowed = path.join(dir, "allowed");
  const denied = path.join(dir, "denied");
  for (const target of [path.join(root, "memory"), allowed, denied]) mkdirSync(target, { recursive: true });
  writeFileSync(path.join(allowed, "recipe.md"), "# Cucumber\nCucumber boats carry mint.");
  writeFileSync(path.join(denied, "secret.md"), "# Cucumber\nCucumber forbidden outside root.");
  symlinkSync(allowed, path.join(root, "memory/sites"));
  symlinkSync(denied, path.join(root, "memory/escape"));
  let failed = true;
  const logs = [];
  const nativeRows = [{ chunkId: "native", score: 0.314, excerpt: "original" }];
  const service = createNativeMemoryRuntime({ accountId: 7, accountRoot: root, allowedRoots: [allowed],
    log: (line) => logs.push(line), closeNative: async () => {},
    memoryManager: { searchMany: async () => {
      if (failed) throw Object.assign(new Error("token SUPERSECRET query PRIVATE"), { kind: "network" });
      return nativeRows;
    } } });
  const rows = await service.searchMany({ queries: ["Cucumber"], maxResults: 5 });
  assert.equal(rows.length, 1);
  assert.match(rows[0].path, /sites\/recipe\.md$/);
  assert.deepEqual(rows[0].retrieval, ["lexical"]);
  assert.equal(service.capabilities().mode, "lexical");
  assert.equal(service.capabilities().semantic.failure.kind, "network");
  assert.match(service.description(), /degraded local lexical/);
  assert.doesNotMatch(JSON.stringify([logs, service.capabilities()]), /SUPERSECRET|PRIVATE/);
  failed = false;
  assert.equal(await service.searchMany({ queries: ["Cucumber"] }), nativeRows);
  assert.equal(service.capabilities().mode, "native");
  await service.close();
});

test("invalid account and invalid dates cannot become fallback reads or native success", async () => {
  let calls = 0;
  const service = fixture({ memoryManager: { searchMany: async () => { calls++; return []; } } });
  for (const args of [{ accountId: 8, queries: ["a"] }, { accountRoot: "/tmp/other", queries: ["a"] },
    { queries: [] }, { queries: [" "] }, { queries: ["a"], range: { from: "2026-02-30" } },
    { queries: ["a"], range: { from: "2026-02-02", to: "2026-02-01" } }]) {
    await assert.rejects(service.searchMany(args));
  }
  assert.equal(calls, 0);
  assert.equal(service.capabilities().semantic.state, "configured");
  await service.close();
});

test("warm is explicit and records only a completed native query; close drains and closes its numeric account once", async () => {
  let release;
  let calls = 0;
  const events = [];
  const service = fixture({ memoryManager: { searchMany: async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    events.push("searched");
    return [];
  } }, closeNative: async (id) => events.push(`native-close-${id}`),
  fallback: { searchMany: async () => [], close: async () => events.push("lexical-close") } });
  assert.equal(calls, 0);
  const warm = service.warm();
  await tick();
  assert.equal(service.capabilities().semantic.state, "warming");
  const closing = service.close();
  assert.equal(service.close(), closing);
  assert.deepEqual(events, []);
  await assert.rejects(service.searchMany({ queries: ["late"] }), /closed/);
  release();
  await warm;
  await closing;
  assert.equal(events[0], "searched");
  assert.equal(events.filter((event) => event === "native-close-7").length, 1);
  assert.equal(service.capabilities().mode, "closed");
});

test("cleanup attempts original account close even when lexical close fails", async () => {
  let closed = false;
  const service = fixture({ closeNative: async () => { closed = true; },
    fallback: { searchMany: async () => [], close: async () => { throw new Error("sqlite failed"); } } });
  await assert.rejects(service.close(), AggregateError);
  assert.equal(closed, true);
});

test("memory token transport pins only original endpoints and preserves real factory options", async () => {
  const previous = { sentinel: true };
  globalThis.__belmontMemoryApi = previous;
  const owner = installNativeMemoryTransport();
  const transport = globalThis.__belmontMemoryApi;
  let config;
  const received = [];
  const createFetch = (options) => { config = options; return async (endpoint, input) => {
    // The original client owns its per-attempt signal before invoking onRequest.
    assert.equal(input.signal, undefined, "supplying options.signal would disable the original timeout");
    const request = { ...input, signal: new AbortController().signal };
    Object.assign(request, await input.onRequest(request));
    received.push({ endpoint, input: request });
    return { token: "REAL_FIXTURE_RESPONSE", expiresIn: 60 };
  }; };
  const schema = { parse: (value) => value };
  try {
    assert.equal(transport.accepts("/memory/auth-token"), true);
    assert.equal(transport.accepts("/accounts/register"), false);
    assert.equal(transport.accepts("https://evil.test/memory/auth-token"), false);
    await assert.rejects(transport.request("/accounts/register", {}, createFetch), /Unsupported/);
    await transport.request("/memory/auth-token/anonymous", { method: "POST", headers: { "x-aside-installation-id": "sha256:real" }, output: schema }, createFetch);
    assert.equal(config.baseURL, "https://api.aside.com");
    assert.equal(config.timeout, 20_000);
    assert.equal(config.retry.attempts, 2);
    assert.equal(config.retry.shouldRetry({ status: 401 }), false);
    assert.equal(config.retry.shouldRetry({ status: 503 }), true);
    assert.equal(received[0].input.output, schema);
    assert.equal(received[0].input.headers["x-aside-installation-id"], "sha256:real");
    await owner.close();
    assert.equal(received[0].input.signal.aborted, true);
    assert.equal(globalThis.__belmontMemoryApi, previous);
  } finally { await owner.close(); delete globalThis.__belmontMemoryApi; }
});

test("original authenticator retains authenticated GET then anonymous only absent-session or 401/403", async () => {
  const source = readFileSync(bundle, "utf8");
  const begin = source.indexOf("AsideMossAuthenticator=class{");
  const end = source.indexOf(",MemoryManager=", begin);
  assert.ok(begin > 0 && end > begin);
  const classSource = source.slice(begin, end).replace("AsideMossAuthenticator=", "");
  class AsideApiError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }
  for (const status of [null, 200, 401, 403, 500, "network"]) {
    const calls = [];
    const Authenticator = vm.runInNewContext(`(${classSource})`, {
      AccountRegistry: { getSession: () => status === null ? undefined : { accessToken: "account" } },
      AsideApiError, mossAuthTokenSchema: {},
      fetchAsideAPIAuthenticated: async (id, endpoint) => {
        calls.push({ id, endpoint });
        if (status === 200) return { token: "signed-in", expiresIn: 60 };
        if (status === "network") throw new Error("network");
        throw new AsideApiError(status);
      },
      getAccountDeviceRegistration: async () => ({ platform: "linux", ikSigKeyFingerprint: "sha256:actual-sig-key" }),
      fetchAsideAPI: async (endpoint, options) => { calls.push({ endpoint, options }); return { token: "anonymous", expiresIn: 60 }; },
    });
    const auth = new Authenticator(7);
    if (status === 500 || status === "network") {
      await assert.rejects(auth.getAuthToken());
      assert.equal(calls.length, 1);
    } else {
      const result = await auth.getAuthToken();
      assert.equal(result.token, status === 200 ? "signed-in" : "anonymous");
      const anon = calls.find((call) => call.endpoint.endsWith("/anonymous"));
      if (status !== 200) {
        assert.equal(anon.options.method, "POST");
        assert.equal(anon.options.headers["x-aside-installation-id"], "sha256:actual-sig-key");
      }
      if (status !== null) assert.equal(calls[0].endpoint, "/memory/auth-token");
    }
  }
});

test("906 memory patch upgrades existing routing and is byte-idempotent without changing original ranking or auth", (t) => {
  const dir = sandbox(t);
  const fixturePath = path.join(dir, "daemon.mjs");
  const original = readFileSync(bundle, "utf8");
  writeFileSync(fixturePath, original);
  const patch = () => {
    const result = spawnSync("python3", [patcher, "--refresh-memory", fixturePath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return readFileSync(fixturePath, "utf8");
  };
  const once = patch();
  assert.equal(patch(), once);
  assert.match(once, /__belmontMemorySearch\(\{accountId:Cn\.accountId,accountRoot:getAccountRoot\(Cn\.accountId\)/);
  assert.match(once, /__belmontMemorySearch\(\{accountId:ei\.accountId,accountRoot:getAccountRoot\(ei\.accountId\)/);
  assert.match(once, /__belmontMemoryApi\?\.accepts\(Cn\)/);
  const memoryPart = (source) => source.slice(source.indexOf("AsideMossAuthenticator=class{"), source.indexOf("async function removeAccountLocalArtifacts("));
  assert.equal(memoryPart(once), memoryPart(original));
  assert.match(once, /MOSS_SESSION_IDLE_RELEASE_MS=3e5/);
  const syntax = spawnSync(process.execPath, ["--check", fixturePath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  // An isolated tool-shape drift must fail even when the UI router still matches.
  const drifted = once.replace("globalThis.__belmontMemorySearch({accountId:Cn.accountId,accountRoot:getAccountRoot(Cn.accountId),",
    "globalThis.__belmontMemorySearch({accountId:ti.accountId,accountRoot:getAccountRoot(ti.accountId),");
  assert.notEqual(drifted, once);
  writeFileSync(fixturePath, drifted);
  const rejected = spawnSync("python3", [patcher, "--refresh-memory", fixturePath], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /final memory tool hook mismatch/);
  assert.equal(readFileSync(fixturePath, "utf8"), drifted, "a rejected refresh must not write a partial patch");
});
