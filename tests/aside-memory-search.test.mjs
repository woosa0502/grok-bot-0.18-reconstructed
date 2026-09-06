import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMemorySearch, chunkMemoryFile } from "../belmont-browse/src/memory-search.mjs";
import { createMossMemoryAdapter } from "../belmont-browse/src/memory-moss-adapter.mjs";

function fixture(t, options) {
  const base = mkdtempSync(path.join(os.tmpdir(), "belmont-memory-test-"));
  const accountRoot = path.join(base, "account");
  const search = createMemorySearch(options);
  t.after(async () => { await search.close(); rmSync(base, { recursive: true, force: true }); });
  function put(name, contents, root = accountRoot) {
    const file = path.join(root, "memory", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return file;
  }
  const find = (query, options = {}) => search.searchMany({ accountRoot, queries: [query], ...options });
  return { base, accountRoot, search, put, find };
}

test("source lines include frontmatter, CRLF, BOM and blank lines", async (t) => {
  const { put, find } = fixture(t);
  for (const newline of ["\n", "\r\n"]) {
    const name = newline.length === 1 ? "lf.md" : "crlf.md";
    put(name, "\uFEFF" + ["---", 'title: "Remembered project"', "aliases:", "  - projects", "---", "", "# Notes", "Exactneedle describes the result."].join(newline));
  }
  const rows = await find("Exactneedle");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.line, 8);
    assert.match(readFileSync(row.path, "utf8").split(/\r?\n/)[row.line - 1], /Exactneedle/);
    assert.equal(row.title, "Remembered project");
    assert.match(row.excerpt, /^Exactneedle/);
  }
});

test("date filtering occurs before limit, with inclusive boundaries and timeless pages", async (t) => {
  const { put, find } = fixture(t);
  for (let i = 0; i < 35; i += 1) put(`old-${i}.md`, "---\ndate: 2020-01-01\n---\nrecallneedle");
  const wanted = put("activity-2026-09-06.md", `A detailed recallneedle entry ${"ordinary filler ".repeat(50)}`);
  assert.equal((await find("recallneedle", { maxResults: 1, range: { from: "2026-09-06", to: "2026-09-06" } }))[0].path, wanted);
  const timeless = put("timeless.md", "recallneedle");
  const rows = await find("recallneedle", { range: { from: "2026-09-06", to: "2026-09-06" } });
  assert.deepEqual(new Set(rows.map((row) => row.path)), new Set([wanted, timeless]));
  assert.equal(rows.find((row) => row.path === timeless).date, undefined);
  await assert.rejects(find("needle", { range: { from: "2026-02-30" } }), /valid inclusive dates/);
  await assert.rejects(find("needle", { range: { from: "2026-09-07", to: "2026-09-06" } }), /valid inclusive dates/);
});

test("quoted updated_at and filename dates work; parent directory dates do not date timeless files", async (t) => {
  const { base, accountRoot, put, find, search } = fixture(t);
  put("note.md", '---\nupdated_at: "2026-09-06T18:00:00+09:00"\n---\ntimeneedle');
  assert.equal((await find("timeneedle", { range: { from: "2026-09-06", to: "2026-09-06" } }))[0].date, "2026-09-06");
  const another = path.join(base, "archive-2000-01-01");
  put("timeless.md", "timeneedle", another);
  const rows = await search.searchMany({ accountRoot: another, queries: ["timeneedle"], range: { from: "2026-09-06" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, undefined);
  assert.ok(!rows[0].path.startsWith(accountRoot));
});

test("separate matching chunks in one file survive; duplicate queries dedupe by chunk", async (t) => {
  const { put, find, search, accountRoot } = fixture(t, { maxChunkChars: 128 });
  const content = ["# Durable notes", "alphaunique first decision", ...Array(30).fill("ordinary filler line"), "# Follow-up", "omegaunique separate decision"].join("\n");
  const file = put("long.md", content);
  const rows = await search.searchMany({ accountRoot, queries: ["alphaunique", "omegaunique", "alphaunique"], maxResults: 1 });
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.chunkId)).size, 2);
  assert.deepEqual(rows.map((row) => row.line).sort((a, b) => a - b), [2, 34]);
  assert.ok(rows.every((row) => row.path === file));
  assert.equal((await find("alphaunique")).length, 1);
  assert.ok(chunkMemoryFile(file, content, { maxChunkChars: 128 }).every((chunk) => chunk.body.length <= 128));
});

test("Korean normalization, spacing, single characters and Japanese/Han retrieval preserve recall", async (t) => {
  const { put, find } = fixture(t);
  put("korean.md", "우리는 인공 지능과 프로젝트완성도를 검토했다. 앱 기능을 확인했다.".normalize("NFD"));
  put("negative.md", "프로모션 프로그램의 기록");
  put("japanese.md", "東京都のカタカナ表示を確認する");
  for (const query of ["인공지능", "프로젝트", "완성도", "앱"]) {
    const rows = await find(query);
    assert.equal(rows.length, 1, query);
    assert.equal(path.basename(rows[0].path), "korean.md", query);
  }
  assert.equal((await find("프로젝트 완성도")).length, 1);
  assert.equal((await find("東京"))[0].path.endsWith("japanese.md"), true);
  assert.equal((await find("カタカナ"))[0].path.endsWith("japanese.md"), true);
  assert.deepEqual(await find("\"*(){}: OR NOT"), []);
});

test("account paths are canonical and sibling-prefix roots never remove each other's entries", async (t) => {
  const { base, accountRoot, put, search } = fixture(t);
  const other = path.join(base, "account-other");
  const first = put("item.md", "firstneedle");
  put("item.md", "secondneedle", other);
  await search.searchMany({ accountRoot: other, queries: ["secondneedle"] });
  assert.equal((await search.searchMany({ accountRoot: `${accountRoot}/../account/`, queries: ["firstneedle"] }))[0].path, first);
  assert.equal((await search.searchMany({ accountRoot: other, queries: ["secondneedle"] })).length, 1);
  assert.deepEqual(await search.searchMany({ accountRoot, queries: ["secondneedle"] }), []);
  assert.equal(search.size(), 2);
});

test("scope exclusions precede top-K and also recognize aliases of context-awareness pages", async (t) => {
  const { accountRoot, put, find } = fixture(t);
  for (let i = 0; i < 30; i += 1) put(`episodic/context-awareness-2026-09-${String(i + 1).padStart(2, "0")}.md`, "scopeneedle");
  const target = path.join(accountRoot, "memory", "episodic", "context-awareness-2026-09-01.md");
  symlinkSync(target, path.join(accountRoot, "memory", "alias.md"));
  const wanted = put("remember.md", `scopeneedle ${"filler ".repeat(50)}`);
  const rows = await find("scopeneedle", { excludeContextAwareness: true, maxResults: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, wanted);
});

test("symlink cycles terminate; external knowledge is included only through explicitly allowed roots", async (t) => {
  const { base, accountRoot, put, find, search } = fixture(t);
  put("note.md", "localneedle");
  symlinkSync(path.join(accountRoot, "memory"), path.join(accountRoot, "memory", "cycle"));
  const external = path.join(base, "knowledge");
  mkdirSync(external);
  writeFileSync(path.join(external, "playbook.md"), "externalneedle");
  symlinkSync(external, path.join(accountRoot, "memory", "sites"));
  assert.equal((await find("localneedle")).length, 1);
  assert.deepEqual(await find("externalneedle"), []);
  assert.equal(search.size(), 1);
  const allowed = createMemorySearch({ allowedRoots: [external] });
  t.after(() => allowed.close());
  assert.equal((await allowed.searchMany({ accountRoot, queries: ["externalneedle"] })).length, 1);
});

test("missing memory search is read-only; updates, deletion and close remove stale results", async (t) => {
  const { accountRoot, put, find, search } = fixture(t);
  assert.deepEqual(await find("anything"), []);
  assert.equal(existsSync(path.join(accountRoot, "memory")), false);
  const file = put("entry.md", "beforevalue");
  assert.equal((await find("beforevalue")).length, 1);
  const original = statSync(file);
  writeFileSync(file, "after_value");
  utimesSync(file, original.atime, original.mtime);
  assert.deepEqual(await find("beforevalue"), []);
  assert.equal((await find("after")).length, 1);
  rmSync(file);
  assert.deepEqual(await find("after"), []);
  assert.equal(search.size(), 0);
  await search.close();
  await assert.rejects(find("anything"), /closed/);
});

// Scripted native-contract responses below test adapter routing and fallback only.
// They are NOT embeddings and do not establish semantic quality of a real model.
function nativeContractFactory({ failQuery = () => false } = {}) {
  const calls = [];
  function openSession({ accountRoot, modelId }) {
    const documents = new Map();
    calls.push({ kind: "open", accountRoot, modelId });
    return {
      modelId,
      get docCount() { return documents.size; },
      addDocumentsText(docs, options) {
        calls.push({ kind: "add", accountRoot, docs: structuredClone(docs), options });
        for (const doc of docs) documents.set(doc.id, doc);
      },
      deleteDocuments(ids) { calls.push({ kind: "delete", accountRoot, ids }); for (const id of ids) documents.delete(id); },
      queryText(query, topK) {
        calls.push({ kind: "query", accountRoot, query, documents: [...documents.values()] });
        if (failQuery()) throw new Error("backend error containing a credential must not be logged");
        return { docs: [...documents.values()].filter((doc) => query === "vehicle" ? doc.text.includes("automobile") : doc.text.includes(query)).slice(0, topK).map((doc) => ({ ...doc, score: 0.9 })) };
      },
      async close() { calls.push({ kind: "close", accountRoot }); },
    };
  }
  return { calls, openSession };
}

test("Moss stays disabled without explicit setup and cannot initiate authentication or model loading", async () => {
  let calls = 0;
  const adapter = createMossMemoryAdapter({ openSession: () => { calls += 1; } });
  assert.equal(adapter.capabilities().state, "disabled");
  await assert.rejects(adapter.rank({ accountRoot: "/synthetic", query: "q", chunks: [], maxResults: 1 }), /not enabled/);
  assert.equal(calls, 0);
  const missing = createMossMemoryAdapter({ enabled: true, openSession: () => { calls += 1; } });
  assert.equal(missing.capabilities().state, "unavailable");
  await assert.rejects(missing.rank({}), /Preload/);
  assert.equal(calls, 0);
});

test("native Moss adapter supplies chunks, exposes observed availability, and has a lexical negative control", async (t) => {
  const fake = nativeContractFactory();
  const adapter = createMossMemoryAdapter({ enabled: true, modelReady: true, openSession: fake.openSession });
  const { accountRoot, put, find, search } = fixture(t, { semanticAdapter: adapter });
  put("car.md", "The automobile needs maintenance.");
  assert.equal(search.capabilities().semantic.state, "configured");
  assert.equal(search.capabilities().mode, "lexical");
  const lexical = createMemorySearch();
  t.after(() => lexical.close());
  assert.deepEqual(await lexical.searchMany({ accountRoot, queries: ["vehicle"] }), []);
  const rows = await find("vehicle");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].retrieval, ["semantic"]);
  assert.equal(search.capabilities().mode, "hybrid");
  assert.equal(search.capabilities().semantic.state, "available");
  assert.equal(fake.calls.filter((call) => call.kind === "add")[0].options.upsert, true);
  await find("vehicle");
  assert.equal(fake.calls.filter((call) => call.kind === "add").length, 1);
});

test("semantic candidates are scoped/date-filtered before native top-K; accounts get separate sessions", async (t) => {
  const fake = nativeContractFactory();
  const adapter = createMossMemoryAdapter({ enabled: true, modelReady: true, openSession: fake.openSession });
  const { base, accountRoot, put, find, search } = fixture(t, { semanticAdapter: adapter });
  put("episodic/context-awareness-2026-09-06.md", "automobile hidden");
  put("old-2020-01-01.md", "automobile old");
  const wanted = put("new-2026-09-06.md", "automobile current");
  const rows = await find("vehicle", { excludeContextAwareness: true, range: { from: "2026-09-06", to: "2026-09-06" }, maxResults: 1 });
  assert.equal(rows[0].path, wanted);
  const firstQuery = fake.calls.find((call) => call.kind === "query");
  assert.equal(firstQuery.documents.length, 1);
  assert.match(firstQuery.documents[0].text, /current/);
  const other = path.join(base, "other");
  put("second.md", "automobile other", other);
  const second = await search.searchMany({ accountRoot: other, queries: ["vehicle"] });
  assert.ok(second[0].path.startsWith(other));
  assert.equal(fake.calls.filter((call) => call.kind === "open").length, 2);
  await find("vehicle");
  await find("vehicle", { excludeContextAwareness: true, range: { from: "2026-09-06" } });
  assert.ok(fake.calls.some((call) => call.kind === "delete" && call.accountRoot === accountRoot));
});

test("semantic failure retains lexical results, clears availability, and never prints raw backend secrets", async (t) => {
  let fail = false;
  const logs = [];
  const fake = nativeContractFactory({ failQuery: () => fail });
  const adapter = createMossMemoryAdapter({ enabled: true, modelReady: true, openSession: fake.openSession });
  const { put, find, search } = fixture(t, { semanticAdapter: adapter, log: (line) => logs.push(line) });
  put("entry.md", "ordinaryneedle");
  assert.equal((await find("ordinaryneedle")).length, 1);
  fail = true;
  const rows = await find("ordinaryneedle");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].retrieval, ["lexical"]);
  assert.equal(search.capabilities().mode, "lexical");
  assert.equal(search.capabilities().semantic.state, "unavailable");
  assert.ok(!logs.join("\n").includes("credential"));
  fail = false;
  await find("ordinaryneedle");
  assert.equal(search.capabilities().semantic.state, "available");
});

test("Moss rejects existing user indexes and wrong model sessions without touching them", async () => {
  for (const invalid of [{ docCount: 1, modelId: "moss-minilm" }, { docCount: 0, modelId: "custom" }]) {
    let closed = false;
    let mutated = false;
    const adapter = createMossMemoryAdapter({ enabled: true, modelReady: true, openSession: async () => ({
      ...invalid, close: async () => { closed = true; },
      addDocumentsText: () => { mutated = true; }, deleteDocuments: () => { mutated = true; }, queryText: () => { mutated = true; },
    }) });
    await assert.rejects(adapter.rank({ accountRoot: "/synthetic", query: "q", chunks: [], maxResults: 1 }));
    assert.equal(closed, false);
    assert.equal(mutated, false);
    assert.equal(adapter.capabilities().state, "unavailable");
    await adapter.close();
  }
});

test("long-line chunk boundaries keep complete words searchable", async (t) => {
  const { put, find } = fixture(t, { maxChunkChars: 128 });
  const file = put("line.md", `${"filler ".repeat(17)}boundaryneedle final words`);
  const rows = await find("boundaryneedle");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, file);
  assert.equal(rows[0].line, 1);
  assert.match(rows[0].excerpt, /boundaryneedle/);
});

test("adapter close waits for an opening session and does not close it during its query", async () => {
  let resolve;
  let closed = false;
  const opening = new Promise((done) => { resolve = done; });
  const adapter = createMossMemoryAdapter({ enabled: true, modelReady: true, openSession: () => opening });
  const query = adapter.rank({ accountRoot: "/synthetic", query: "test", chunks: [{ id: "one", text: "test" }], maxResults: 1 });
  const closing = adapter.close();
  resolve({ modelId: "moss-minilm", docCount: 0,
    addDocumentsText() { assert.equal(closed, false); }, deleteDocuments() {},
    queryText() { assert.equal(closed, false); return { docs: [{ id: "one", score: 1 }] }; },
    async close() { closed = true; },
  });
  assert.deepEqual(await query, [{ id: "one", score: 1 }]);
  await closing;
  assert.equal(closed, true);
  assert.equal(adapter.capabilities().state, "disabled");
});

test("native adapter methods agree with the installed Moss API declaration", () => {
  const declarations = readFileSync(new URL("../belmont-browse/node_modules/@moss-dev/moss-core/index.d.ts", import.meta.url), "utf8");
  const session = declarations.slice(declarations.indexOf("export declare class SessionIndex"), declarations.indexOf("export type JsSessionIndex"));
  for (const signature of ["addDocumentsText(docs: Array<DocumentInfo>", "deleteDocuments(docIds: Array<string>)", "queryText(query: string, topK: number", "get docCount(): number", "get modelId(): string", "close(): Promise<void>"]) {
    assert.ok(session.includes(signature), signature);
  }
});
