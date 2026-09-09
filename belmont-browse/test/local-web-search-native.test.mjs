import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createLocalWebSearch, isDisabledAsideEndpoint, parseRenderedSearchHtml, LOCAL_WEB_SEARCH_LIMITS } from "../src/web-search.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "belmont-local-web-search-"));
const evidenceDir = process.env.BELMONT_WEB_SEARCH_TEST_ARTIFACT_DIR;
function evidence(name, data) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
}
async function rejected(pending, pattern) {
  let result;
  await assert.rejects(pending, (error) => {
    assert.match(error.message, pattern);
    result = { name: error.name, message: error.message };
    return true;
  });
  return result;
}
const originalEnv = { ASIDE_HOME: process.env.ASIDE_HOME, ASIDE_API_URL: process.env.ASIDE_API_URL };
test.after(() => {
  for (const [key, value] of Object.entries(originalEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  delete globalThis.__belmontLocalWebSearch;
  rmSync(temp, { recursive: true, force: true });
});

const serp = (prefix = "https://example.org/", count = 1, nativeShape = false) => `<html><head><title>Search</title></head><body><main>${Array.from({ length: count }, (_, i) => `<div ${nativeShape ? 'data-rpos="1"' : 'class="result"'}><a href="${prefix}${i}"><h3>Result ${i}</h3></a><div lang="en" data-hveid="1"><span>Observed excerpt ${i}</span></div></div>`).join("")}</main></body></html>`;
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const cases = [];
const testCase = (...args) => cases.push(args);

testCase("local endpoint detection never replaces an explicit cloud endpoint", () => {
  for (const value of ["http://127.0.0.1:9", "http://127.0.0.1:9/"]) assert.equal(isDisabledAsideEndpoint(value), true);
  for (const value of [undefined, "https://api.aside.com", "http://127.0.0.1:9000", "http://127.0.0.1:9/search", "http://user@127.0.0.1:9", "http://localhost:9"]) assert.equal(isDisabledAsideEndpoint(value ?? ""), false);
});

for (const version of ["824", "902"]) {
  const fixture = path.join(temp, version);
  mkdirSync(fixture);
  process.env.ASIDE_HOME = fixture;
  process.env.ASIDE_API_URL = "http://127.0.0.1:9";
  const bundlePath = path.join(root, `vendor/aside-${version}/apps/daemon/build/daemon.mjs`);
  const bundleUrl = pathToFileURL(bundlePath).href;
  const hook = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== bundleUrl) return loaded;
    return { ...loaded, source: Buffer.from(loaded.source).toString("utf8") + `
export function __localSearchInit() { init_directory(); init_accounts(); init_store$3(); init_settings$1(); init_toolset(); init_browser(); init_permission(); init_google_search(); }
export const __localSearchTest = { get AsideBrowser() { return AsideBrowser; }, get PermissionEnforcementHook() { return PermissionEnforcementHook; }, get createSuspendFn() { return createSuspendFn; }, get liveSuspensionRegistry() { return liveSuspensionRegistry; }, createWebSearchTool, createAgentToolset, withReplContext, getCurrentReplContext() { return replRuntimeStorage.getStore(); }, parseHtml, parseGoogleSearchHtml, buildGoogleSearchUrl, buildWebSearchToolResult, setCloudFetch(fn) { fetchAsideAPI = fn; }, disableNotifications() { notifySessionSuspension = async () => {}; } };
` };
  } });
  const mod = await import(bundleUrl);
  mod.__localSearchInit();
  hook.deregister();
  const N = mod.__localSearchTest;
  const A = mod.__belmont;
  const accountRoot = A.getAccountRoot(0);
  mkdirSync(accountRoot, { recursive: true });

  function makeFixture(options = {}) {
    const events = [];
    const controller = new AbortController();
    let policy = { rules: { default: "allow" }, files: {}, sandbox: { enabled: true } };
    const context = {
      accountId: 0,
      accountRoot,
      sessionDir: path.join(accountRoot, "test-session"),
      session: { id: "test-session", cwd: accountRoot, permissionMode: "guard", permission: policy, trigger: { type: "user" }, runtimeConfig: {}, model: { provider: "fixture", modelId: "fixture" }, incognito: false },
      settings: { get: (key) => key === "permission" ? policy : undefined },
      skills: { list: async () => [], resolveForMessage: async () => [] },
      models: {},
      setToolState() {},
      suspend: async (kind, id, request) => {
        events.push({ kind: "ask", id, request });
        if (options.onAsk) return await options.onAsk(kind, id, request, controller);
        return { verdict: "allow", always: false };
      },
    };
    const enforcement = N.PermissionEnforcementHook(context);
    const hooks = { trigger: async (name, request) => {
      const runtime = N.getCurrentReplContext();
      events.push({ kind: "hook", name, id: request.toolCallId, runtimeId: runtime?.toolCallId, hasSignal: runtime?.signal === controller.signal });
      return await enforcement[name]?.(request);
    } };
    context.hooks = hooks;
    const cdp = { on: () => () => {}, transportEvents: { on: () => () => {} } };
    const browser = new N.AsideBrowser(cdp, 0, context.session, hooks);
    const original = { targetId: "original", url: () => "https://original.example/" };
    const other = { targetId: "other", url: () => "https://other.example/" };
    let pages = [original, other];
    let selected = original;
    const ownership = new Map([["original", "borrowed"], ["other", "owned"]]);
    let serial = 0;
    Object.defineProperties(browser, {
      tabs: { get: () => pages },
      page: { get: () => selected, set: (value) => { events.push({ kind: "select", targetId: value?.targetId }); selected = value; } },
      state: { get: () => ({ activePage: selected, tabs: pages.map((page) => ({ targetId: page.targetId, ownership: ownership.get(page.targetId) })) }) },
    });
    browser.openTab = async (url) => {
      if (typeof browser.ensureAccess === "function") await browser.ensureAccess("modify", url);
      events.push({ kind: "open-start", url });
      if (options.beforeOpen) await options.beforeOpen(controller, events);
      const page = {
        targetId: `owned-${++serial}`,
        url: () => options.pageUrl ?? url,
        waitForLoadState: async (state, timeout) => { assert.equal(state, "stable"); assert.equal(timeout, 5000); events.push({ kind: "stable" }); },
        content: async () => {
          if (typeof browser.ensureAccess === "function") await browser.ensureAccess("read", page.url());
          events.push({ kind: "content", targetId: page.targetId });
          if (options.content) return await options.content(controller, events, page, browser);
          return options.html ?? serp(`https://example.org/q${serial}/`, options.count ?? 1);
        },
      };
      pages.push(page);
      ownership.set(page.targetId, "owned");
      selected = page;
      events.push({ kind: "open-done", targetId: page.targetId });
      return page;
    };
    browser.closeTab = async (page) => {
      assert.equal(ownership.get(page.targetId), "owned");
      assert.match(page.targetId, /^owned-/);
      events.push({ kind: "close-start", targetId: page.targetId });
      if (options.beforeClose) await options.beforeClose(controller, events);
      pages = pages.filter((item) => item !== page);
      ownership.delete(page.targetId);
      if (selected === page) selected = pages.at(-1) ?? null;
      events.push({ kind: "close-done", targetId: page.targetId });
    };
    context.browser = browser;
    const local = createLocalWebSearch();
    globalThis.__belmontLocalWebSearch = local;
    const tool = N.createWebSearchTool(context);
    return { events, controller, context, browser, original, other, local, tool, getPolicy: () => policy, setPolicy: (value) => { policy = value; context.session.permission = value; },
      execute: (args = { objective: "news", search_queries: ["news", "", "news"] }, id = "native-websearch-call") => tool.execute(id, args, controller.signal) };
  }

  testCase(`${version}: native parser fixtures use original shape then rendered h3 fallback`, () => {
    const url = "https://www.google.com/search?q=news";
    assert.equal(parseRenderedSearchHtml(serp("https://example.org/", 1, true), url, N).parser, "original-google-html");
    const parsed = parseRenderedSearchHtml(serp(), url, N);
    assert.equal(parsed.parser, "rendered-heading-links");
    assert.deepEqual(parsed.results, [{ url: "https://example.org/0", title: "Result 0", excerpts: ["Observed excerpt 0"] }]);
    assert.equal(parseRenderedSearchHtml('<html><title>Search</title><a href="https://bad.example">No heading</a><a href="/search?q=x"><h3>Related search</h3></a></html>', url, N).results.length, 0);
    assert.equal(parseRenderedSearchHtml('<html><title>CAPTCHA research - Google Search</title><a href="https://research.example/"><h3>Unusual traffic CAPTCHA research</h3></a></html>', url, N).results.length, 1);
    assert.throws(() => parseRenderedSearchHtml('<title>Before you continue to Google</title><a href="https://bad.example"><h3>Fake result</h3></a>', url, N), /consent/);
    assert.throws(() => parseRenderedSearchHtml('<title>Search</title><form id="captcha-form"></form><a href="https://bad.example"><h3>Fake result</h3></a>', url, N), /CAPTCHA/);
  });

  testCase(`${version}: actual native toolset contains exactly one websearch and keeps other tools`, () => {
    const f = makeFixture();
    const toolNames = N.createAgentToolset(f.context, f.browser).map((tool) => tool.name);
    assert.equal(toolNames.filter((name) => name === "websearch").length, 1);
    for (const name of ["repl", "read_file", "webfetch", "memory_search", "write_file", "edit_file"]) assert.ok(toolNames.includes(name), name);
    assert.equal(f.tool.executionMode, "sequential");
    evidence(`toolset-${version}`, { toolNames, websearchExecutionMode: f.tool.executionMode, websearchSchema: f.tool.parameters });
  });

  testCase(`${version}: opaque Google result redirects retain provenance and exclude internal navigation`, async () => {
    const url = "https://www.google.com/search?q=protocol";
    const html = `<html><title>Search</title><body><main>
      <div><a href="/goto?url=CAESopaque_123"><h3>Protocol page</h3></a><p>Observed protocol snippet</p></div>
      <div><a href="https://docs.example.org/page"><h3>Direct page</h3></a><p>Direct snippet</p></div>
      <a href="/goto?url=unheaded">No heading</a>
      <a href="/goto?url="><h3>Empty redirect</h3></a>
      <a href="/goto?url=%20"><h3>Blank redirect</h3></a>
      <a href="/search?q=other"><h3>Related search</h3></a>
      <a href="/preferences"><h3>Settings</h3></a>
      <a href="http://www.google.com/goto?url=x"><h3>Insecure redirect</h3></a>
      <a href="https://user@www.google.com/goto?url=x"><h3>Credentials redirect</h3></a>
      <a href="https://www.google.com:8443/goto?url=x"><h3>Wrong port</h3></a>
    </main></body></html>`;
    const parsed = parseRenderedSearchHtml(html, url, N);
    assert.deepEqual(parsed.results, [
      { url: "https://www.google.com/goto?url=CAESopaque_123", title: "Protocol page", excerpts: ["Observed protocol snippet"], url_kind: "search-result-redirect", final_url_verified: false },
      { url: "https://docs.example.org/page", title: "Direct page", excerpts: ["Direct snippet"] },
    ]);
    if (version === "902") {
      const f = makeFixture({ html });
      const result = await f.execute();
      const body = JSON.parse(result.content[0].text);
      const redirect = body.results.find(({ url_kind }) => url_kind === "search-result-redirect");
      const source = result.details.sources.find(({ id }) => id === redirect.source_id);
      assert.equal(source.url, redirect.url);
      assert.equal(source.url_kind, redirect.url_kind);
      assert.equal(source.final_url_verified, false);
      assert.equal(redirect.final_url_verified, false);
      assert.match(body.redirect_note, /verify its final URL/);
      assert.equal(f.events.filter(({ kind }) => kind === "open-start").length, 1);
    }
  });

  if (process.env.BELMONT_FROZEN_SERP_HTML) {
    testCase(`${version}: captured real Google SERP preserves observed heading hrefs`, async () => {
      const html = readFileSync(process.env.BELMONT_FROZEN_SERP_HTML, "utf8");
      const capture = JSON.parse(readFileSync(process.env.BELMONT_FROZEN_SERP_HTML.replace(/\.html$/, "-shape.json"), "utf8"));
      const parsed = parseRenderedSearchHtml(html, capture.url, N, capture.url);
      assert.equal(parsed.results.length, 5);
      const expectedUrls = capture.links.slice(0, 5).map(({ href }) => new URL(href, capture.url).href);
      assert.deepEqual(parsed.results.map(({ url }) => url), expectedUrls);
      for (const result of parsed.results) {
        assert.equal(result.url_kind, "search-result-redirect");
        assert.equal(result.final_url_verified, false);
      }
      if (version === "902") {
        const f = makeFixture({ html });
        const result = await f.execute();
        const body = JSON.parse(result.content[0].text);
        assert.equal(body.results.length, 5);
        assert.match(body.redirect_note, /verify its final URL/);
        for (const row of body.results) {
          const source = result.details.sources.find(({ id }) => id === row.source_id);
          assert.equal(source.url, row.url);
          assert.equal(source.url_kind, "search-result-redirect");
          assert.equal(source.final_url_verified, false);
        }
        assert.deepEqual(f.events.filter(({ kind }) => kind === "open-start").map(({ url }) => new URL(url).pathname), ["/search"]);
        assert.deepEqual(f.browser.tabs.map(({ targetId }) => targetId), ["original", "other"]);
        evidence("frozen-serp-native-902", { result, events: f.events });
      }
      evidence(`frozen-serp-parser-${version}`, { parsed, expectedUrls });
    });
  }

  testCase(`${version}: native cloud branch preserves request and citation contract`, async () => {
    const f = makeFixture();
    process.env.ASIDE_API_URL = "https://explicit-cloud.example";
    assert.equal(N.createWebSearchTool(f.context).executionMode, undefined);
    let captured;
    N.setCloudFetch(async (...args) => { captured = args; return { session_id: "cloud-session", results: [{ title: "Cloud result", url: "https://cloud-result.example/", excerpts: ["Cloud excerpt"] }] }; });
    const result = await f.execute({ objective: "topic", search_queries: ["one", "two", "three"], mode: "advanced" });
    assert.equal(captured[0], "/search");
    assert.deepEqual(captured[1].body, { objective: "topic", search_queries: ["one", "two", "three"], mode: "advanced", max_chars_total: 25000, session_id: "test-session", client_model: "fixture" });
    assert.equal(captured[1].signal, f.controller.signal);
    assert.equal(captured[1].timeout, 10000);
    assert.equal(result.details.sources[0].url, "https://cloud-result.example/");
    assert.equal(result.details.retrieval, undefined);
    assert.equal(f.events.length, 0);
    evidence(`cloud-${version}`, { endpoint: captured[0], method: captured[1].method, body: captured[1].body, result });
    process.env.ASIDE_API_URL = "http://127.0.0.1:9";
    N.setCloudFetch(async () => { throw new Error("Cloud fetch must not run for local search"); });
  });

  if (version === "824") {
    testCase("824: unsupported local search rejects before any browser or permission operation", async () => {
      const f = makeFixture();
      const rejection = await rejected(f.execute(), /unsupported on daemon 824/);
      assert.equal(f.events.length, 0);
      assert.deepEqual(f.browser.tabs, [f.original, f.other]);
      evidence("unsupported-824", { engine: version, endpoint: process.env.ASIDE_API_URL, rejection, events: f.events, remainingTabs: f.browser.tabs.map((page) => page.targetId) });
    });
  }

  if (version === "902") {

  testCase(`${version}: local execution bounds sequential queries, deduplicates and preserves citation IDs`, async () => {
    const f = makeFixture({ count: 8 });
    const result = await f.execute({ objective: " q1 ", search_queries: ["q1", "q2", "q3", "q4", "q5"], mode: "advanced" });
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.results.length, 12);
    assert.ok(f.events.filter((event) => event.kind === "open-start").length <= 4);
    assert.equal(body.retrieval, "browser-serp");
    assert.equal(body.evidence_scope, "search-result-snippets");
    assert.match(body.mode_note, /unavailable/);
    assert.ok(JSON.stringify(result).length <= LOCAL_WEB_SEARCH_LIMITS.outputChars);
    for (const row of body.results) assert.equal(result.details.sources.find((source) => source.id === row.source_id)?.url, row.url);
    assert.equal(f.browser.page, f.original);
    assert.deepEqual(f.browser.tabs, [f.original, f.other]);
    for (const event of f.events.filter((event) => event.kind === "hook")) {
      assert.equal(event.id, "native-websearch-call");
      assert.equal(event.runtimeId, event.id);
    }
    evidence("success-902", { result, events: f.events, remainingTabs: f.browser.tabs.map((page) => page.targetId), active: f.browser.page.targetId });
  });

  testCase(`${version}: explicit native permission deny stops before tab creation`, async () => {
    const f = makeFixture();
    f.setPolicy({ rules: { default: "allow", deny: [{ type: "network", url: "*" }] } });
    const rejection = await rejected(f.execute(), /Permission denied/);
    assert.equal(f.events.some((event) => event.kind === "open-start"), false);
    evidence("deny-902", { permission: f.getPolicy(), rejection, events: f.events });
  });

  for (const action of ["modify", "read"]) {
    testCase(`902: direct browser ${action} deny remains enforced`, async () => {
      const f = makeFixture();
      f.setPolicy({ rules: { default: "allow", deny: [{ type: "browser", action, url: "*" }] } });
      const rejection = await rejected(f.execute(), /Permission denied/);
      assert.equal(f.events.some((event) => event.kind === "content"), false);
      if (action === "modify") assert.equal(f.events.some((event) => event.kind === "open-start"), false);
      assert.deepEqual(f.browser.tabs, [f.original, f.other]);
      evidence(`deny-browser-${action}-902`, { permission: f.getPolicy(), rejection, events: f.events, active: f.browser.page.targetId });
    });
  }

  testCase(`${version}: actual native ask uses same tool ID and a rejected answer cannot retry`, async () => {
    const f = makeFixture({ onAsk: async () => ({ verdict: "deny", always: false }) });
    f.setPolicy({ rules: { default: "allow", ask: [{ type: "network", url: "*" }] } });
    const rejection = await rejected(f.execute(), /Permission denied/);
    assert.equal(f.events.filter((event) => event.kind === "ask").length, 1);
    assert.equal(f.events.find((event) => event.kind === "ask").id, "native-websearch-call");
    assert.equal(f.events.some((event) => event.kind === "open-start"), false);
    evidence("ask-deny-902", { permission: f.getPolicy(), response: { verdict: "deny", always: false }, rejection, events: f.events });
  });

  testCase(`${version}: cancellation during native open settles ownership and cleanup before returning`, async () => {
    const f = makeFixture({ beforeOpen: async (controller) => { controller.abort(new Error("cancel fixture")); await nextTurn(); } });
    await assert.rejects(f.execute(), /cancel fixture/);
    assert.equal(f.events.some((event) => event.kind === "content"), false);
    assert.equal(f.events.at(-1).kind, "select");
    assert.equal(f.browser.page, f.original);
    assert.deepEqual(f.browser.tabs, [f.original, f.other]);
    const count = f.events.length;
    await nextTurn();
    assert.equal(f.events.length, count);
    evidence("cancel-open-902", { events: f.events, remainingTabs: f.browser.tabs.map((page) => page.targetId), active: f.browser.page.targetId });
  });

  testCase(`${version}: cancellation during content waits for close and never starts another query`, async () => {
    const f = makeFixture({ content: async (controller) => { controller.abort(new Error("cancel content")); await nextTurn(); return serp(); }, beforeClose: async (_controller, events) => { await nextTurn(); events.push({ kind: "close-settled-marker" }); } });
    await assert.rejects(f.execute({ objective: "one", search_queries: ["two", "three", "four"] }), /cancel content/);
    assert.equal(f.events.filter((event) => event.kind === "open-start").length, 1);
    assert.ok(f.events.some((event) => event.kind === "close-settled-marker"));
    assert.equal(f.browser.page, f.original);
    evidence("cancel-content-902", { events: f.events, remainingTabs: f.browser.tabs.map((page) => page.targetId), active: f.browser.page.targetId });
  });

  testCase(`${version}: challenge closes only its own tab, without retry`, async () => {
    const f = makeFixture({ html: '<html><title>Sorry</title><form id="captcha-form"></form></html>' });
    await assert.rejects(f.execute({ objective: "one", search_queries: ["two", "three", "four"] }), /CAPTCHA/);
    assert.equal(f.events.filter((event) => event.kind === "open-start").length, 1);
    assert.deepEqual(f.browser.tabs, [f.original, f.other]);
  });

  testCase(`${version}: user selection during retrieval is not overwritten by restoration`, async () => {
    const f = makeFixture({ content: async (_controller, _events, _page, browser) => { browser.page = browser.tabs.find((page) => page.targetId === "other"); return serp(); } });
    await f.execute();
    assert.equal(f.browser.page, f.other);
  });

  testCase("902: an unrelated third target selected during close is retained", async () => {
    let f;
    const third = { targetId: "third", url: () => "https://third.example/" };
    f = makeFixture({ beforeClose: async () => {
      await nextTurn();
      f.browser.tabs.push(third);
      f.browser.page = third;
    } });
    await f.execute();
    assert.equal(f.browser.page, third);
    assert.deepEqual(f.browser.tabs, [f.original, f.other, third]);
    evidence("third-target-during-close-902", { events: f.events, active: f.browser.page.targetId });
  });

  testCase("902: close failure does not skip restoration and is reported as failure", async () => {
    const f = makeFixture({ beforeClose: async () => { throw new Error("close fixture failure"); } });
    await assert.rejects(f.execute(), /close fixture failure/);
    assert.equal(f.browser.page, f.original);
    assert.equal(f.events.filter((event) => event.kind === "open-start").length, 1);
    evidence("close-failure-902", { events: f.events, active: f.browser.page.targetId, remainingTabs: f.browser.tabs.map((page) => page.targetId) });
  });

  testCase("902: aborting an unresolved native permission ask returns without a delayed browser action", async () => {
    let answer;
    const f = makeFixture({ onAsk: async () => await new Promise((resolve) => { answer = resolve; }) });
    f.setPolicy({ rules: { default: "allow", ask: [{ type: "network", url: "*" }] } });
    const pending = f.execute();
    await nextTurn();
    assert.equal(typeof answer, "function");
    f.controller.abort(new Error("cancel approval"));
    await assert.rejects(pending, /cancel approval/);
    answer({ verdict: "allow", always: false });
    await nextTurn();
    assert.equal(f.events.some((event) => event.kind === "open-start"), false);
  });

  testCase("902: wrong query HTML is rejected and its owned tab is cleaned", async () => {
    const f = makeFixture({ pageUrl: "https://www.google.com/search?q=unrelated" });
    await assert.rejects(f.execute(), /different query/);
    assert.deepEqual(f.browser.tabs, [f.original, f.other]);
  });

  testCase("902: actual stored native approval is rejected on cancellation and its live resolver removed", async () => {
    await A.tryMigrateStateDb(0);
    A.initAccountDirectory(accountRoot);
    N.disableNotifications();
    const f = makeFixture();
    const record = A.SessionStore.insert(0, {
      id: "native-approval-cancel",
      createdAt: new Date(),
      cwd: accountRoot,
      title: "isolated cancellation fixture",
      permissionMode: "guard",
      permission: { rules: { ask: [{ type: "network", url: "*" }], default: "allow" } },
      trigger: { type: "user" },
      model: { provider: "openai-codex", modelId: "gpt-5.5", thinkingLevel: "high", fastMode: false },
      runtimeConfig: {},
    });
    f.context.session = record;
    f.context.suspend = N.createSuspendFn(0, record.id);
    const pending = f.execute();
    await nextTurn();
    const before = A.SessionStore.get(0, record.id);
    assert.equal(before.suspension.kind, "approval");
    assert.equal(before.suspension.toolCallId, "native-websearch-call");
    const key = `${record.id}:native-websearch-call`;
    assert.equal(N.liveSuspensionRegistry.has(key), true);
    f.controller.abort(new Error("cancel actual suspension"));
    await assert.rejects(pending, /cancel actual suspension|aborted/i);
    await nextTurn();
    const after = A.SessionStore.get(0, record.id);
    assert.match(after.suspension.error, /aborted/i);
    assert.equal(N.liveSuspensionRegistry.has(key), false);
    assert.equal(f.events.some((event) => event.kind === "open-start"), false);
    evidence("native-stored-approval-cancel-902", { before: before.suspension, after: after.suspension, statusAfter: after.status, liveResolverAfter: N.liveSuspensionRegistry.has(key), events: f.events });
  });

  testCase("902: a cancelled queued search cannot release a later caller ahead of a live predecessor", async () => {
    let unblock;
    let first = true;
    const f = makeFixture({ beforeOpen: async () => { if (first) { first = false; await new Promise((resolve) => { unblock = resolve; }); } } });
    const args = { objective: "one", search_queries: ["one", "one", "one"] };
    const p1 = f.execute(args, "first-call");
    await nextTurn();
    const secondSignal = new AbortController();
    const p2 = f.tool.execute("second-call", args, secondSignal.signal);
    const p3 = f.tool.execute("third-call", args, new AbortController().signal);
    secondSignal.abort(new Error("cancel queued"));
    await assert.rejects(p2, /cancel queued/);
    assert.equal(f.events.filter((event) => event.kind === "open-start").length, 1);
    unblock();
    await Promise.all([p1, p3]);
    assert.equal(f.events.filter((event) => event.kind === "open-start").length, 2);
    evidence("queue-cancel-902", { events: f.events, active: f.browser.page.targetId });
  });
  }

  testCase(`${version}: maintained refresh is idempotent and fails closed on unknown execute shape`, () => {
    const source = readFileSync(bundlePath, "utf8");
    const file = path.join(fixture, "patch-test.mjs");
    writeFileSync(file, source);
    const args = [path.join(root, "tools/patch-daemon.py"), "--refresh-local-web-search", file];
    const refreshed = spawnSync("python3", args, { encoding: "utf8" });
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.equal(readFileSync(file, "utf8"), source);
    const damaged = source.replace("globalThis.__belmontLocalWebSearch?.enabled()", "globalThis.__changedLocalWebSearch?.enabled()");
    assert.notEqual(damaged, source);
    writeFileSync(file, damaged);
    const rejected = spawnSync("python3", args, { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /anchor mismatch/);
    assert.equal(readFileSync(file, "utf8"), damaged);
  });
}

for (const args of cases) test(...args);
