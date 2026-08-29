import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { transform } from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function loadWebTools() {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/codex-web-tools.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function stubResponse({ ok = true, status = 200, statusText = "OK", contentType = "text/html", body = "" }) {
  return {
    ok,
    status,
    statusText,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    body: null, // no stream -> service falls back to text()
    text: async () => body,
  };
}

async function withFetch(fetchImpl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("WebFetch extracts readable text from HTML and drops scripts/styles", async () => {
  const { createCodexWebFetchService } = await loadWebTools();
  const svc = createCodexWebFetchService();
  const html = "<html><head><style>.x{color:red}</style><script>alert(1)</script></head><body><h1>Title</h1><p>Hello&nbsp;world &amp; more.</p></body></html>";
  const result = await withFetch(async () => stubResponse({ body: html }), () => svc(null, "https://example.com"));
  assert.ok("content" in result, `expected content, got ${JSON.stringify(result)}`);
  assert.match(result.content, /Title/);
  assert.match(result.content, /Hello world & more\./);
  assert.doesNotMatch(result.content, /alert\(1\)/);
  assert.doesNotMatch(result.content, /color:red/);
  assert.doesNotMatch(result.content, /<h1>/);
});

test("WebFetch passes non-HTML text bodies through untouched", async () => {
  const { createCodexWebFetchService } = await loadWebTools();
  const svc = createCodexWebFetchService();
  const result = await withFetch(
    async () => stubResponse({ contentType: "application/json", body: '{"zen":"Practicality beats purity."}' }),
    () => svc(null, "https://api.example.com/zen"),
  );
  assert.ok("content" in result);
  assert.equal(result.content, '{"zen":"Practicality beats purity."}');
});

test("WebSearch parses DuckDuckGo HTML results into ranked documents", async () => {
  const { createCodexWebSearchService } = await loadWebTools();
  const svc = createCodexWebSearchService();
  const ddgHtml = [
    '<div class="result__body">',
    '<h2 class="result__title"><a rel="nofollow" class="result__a" href="https://a.example/one">First &amp; Best</a></h2>',
    '<a class="result__snippet" href="x">Snippet one about the topic.</a>',
    '</div>',
    '<div class="result__body">',
    '<h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example%2Ftwo&rut=z">Second Result</a></h2>',
    '<a class="result__snippet" href="y">Snippet two.</a>',
    '</div>',
    // a non-http anchor that must be filtered out
    '<h2 class="result__title"><a class="result__a" href="javascript:void(0)">skip me</a></h2>',
  ].join("\n");
  let sentBody;
  const result = await withFetch(async (_url, init) => { sentBody = init?.body; return stubResponse({ contentType: "text/html", body: ddgHtml }); }, () => svc(null, { searchTerm: "the topic" }));
  assert.equal(sentBody, "q=the%20topic", "query must be posted as a urlencoded form body");
  assert.equal(result.answer, "");
  assert.equal(result.documents.length, 2, "non-http anchors are filtered");
  assert.deepEqual(result.documents[0], { url: "https://a.example/one", title: "First & Best", text: "Snippet one about the topic." });
  // The DuckDuckGo redirect wrapper is decoded back to the real destination.
  assert.equal(result.documents[1].url, "https://b.example/two");
});

test("WebSearch throws on a non-OK search response and returns empty for a blank query", async () => {
  const { createCodexWebSearchService } = await loadWebTools();
  const svc = createCodexWebSearchService();
  await assert.rejects(() => withFetch(async () => stubResponse({ ok: false, status: 202, statusText: "Accepted" }), () => svc(null, { searchTerm: "x" })), /web search HTTP 202/);
  let called = 0;
  const blank = await withFetch(async () => { called++; return stubResponse({ body: "" }); }, () => svc(null, { searchTerm: "   " }));
  assert.deepEqual(blank, { answer: "", documents: [] });
  assert.equal(called, 0, "a blank query must not hit the network");
});

test("WebFetch surfaces HTTP errors and never calls fetch for bad URLs/protocols", async () => {
  const { createCodexWebFetchService } = await loadWebTools();
  const svc = createCodexWebFetchService();
  // HTTP error status
  const httpError = await withFetch(async () => stubResponse({ ok: false, status: 404, statusText: "Not Found" }), () => svc(null, "https://example.com/missing"));
  assert.ok("error" in httpError && /404/.test(httpError.error));
  // Invalid URL and non-http(s) protocol must be rejected before any fetch runs.
  let fetchCalls = 0;
  const guarded = async () => { fetchCalls++; return stubResponse({ body: "x" }); };
  const invalid = await withFetch(guarded, () => svc(null, "not a url"));
  const fileProto = await withFetch(guarded, () => svc(null, "file:///etc/passwd"));
  assert.ok("error" in invalid && /invalid URL/.test(invalid.error));
  assert.ok("error" in fileProto && /unsupported protocol/.test(fileProto.error));
  assert.equal(fetchCalls, 0, "fetch must not run for invalid URL or blocked protocol");
});
