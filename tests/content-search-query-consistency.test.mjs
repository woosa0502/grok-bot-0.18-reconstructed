import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const compiled = await build({
  stdin: {
    contents: [
      'export { RosterSearch } from "./source/host/extensions/transcript/roster-search.ts";',
      'export { setTranscript } from "./source/host/extensions/transcript/transcript-store.ts";',
      'export { findAgentContentMatches } from "./source/host/extensions/content-search/agent-content-search.ts";',
      'export { ensureSearchIndexSchema, searchMessages } from "./source/host/extensions/content-search/search-index-db.ts";',
      'export { SandSearchIndexService } from "./source/host/extensions/content-search/search-index-service.ts";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node26",
  write: false,
});
const sut = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

function message(id, content, timestampMs) {
  return { id, kind: "message", role: "user", content, timestampMs };
}

function fixture(t, raw, existing = Object.keys(raw)) {
  const db = new DatabaseSync(":memory:");
  sut.ensureSearchIndexSchema(db);
  const insert = db.prepare("INSERT INTO messages(agent_id, entry_id, role, timestamp_ms, body) VALUES (?, ?, ?, ?, ?)");
  for (const [agentId, entries] of Object.entries(raw)) {
    for (const entry of entries) {
      insert.run(agentId, entry.id, entry.role, entry.timestampMs, entry.content.trim().slice(0, 20_000));
    }
  }
  const service = new sut.SandSearchIndexService({
    indexDbPath: "unused-query-fixture",
    agentsRootDir: "unused-query-fixture",
    workerEntryPath: "unused-query-fixture-worker.mjs",
    report() {},
    disposeDeadline: { run: (operation) => operation() },
  });
  // Exercise the production query service without starting workers or opening
  // any on-disk account. Its only database is this owned SQLite fixture.
  service.db = db;
  let activeId = null;
  let ready = true;
  let unavailable = false;
  let rosterReads = 0;
  let afterQuery;
  const calls = [];
  const roster = new sut.RosterSearch({
    getActiveAgentId: () => activeId,
    sessions: { get inMemoryTranscriptAgentId() { return activeId; } },
    sessionStore: {
      agentExists: (id) => existing.includes(id),
      async listAgents() {
        rosterReads += 1;
        return existing.map((id) => ({ id, updatedAt: Math.max(1, ...raw[id].map((row) => row.timestampMs)) }));
      },
      readAgentTranscriptEntries: (id) => raw[id],
    },
    contentSearch: {
      get isSearchReady() { return ready; },
      maxMatchesPerAgent: 5,
      maxResults: 50,
      searchMessages(options) {
        calls.push(options);
        const matches = unavailable ? null : service.searchMessages(options.query, options.limit, options.excludedAgentIds);
        afterQuery?.();
        return matches;
      },
      findTranscriptMatches: sut.findAgentContentMatches,
    },
  });
  t.after(() => { sut.setTranscript([]); db.close(); });
  return {
    db, roster, calls,
    activate(id, entries = id == null ? [] : raw[id]) { activeId = id; sut.setTranscript(entries); },
    ready(value) { ready = value; },
    unavailable(value) { unavailable = value; },
    afterQuery(callback) { afterQuery = callback; },
    get rosterReads() { return rosterReads; },
  };
}

const ids = (rows) => rows.map((row) => row.entryId);

test("active and fallback searches preserve indexed prefix, AND, diacritic and escaped-query semantics", async (t) => {
  const f = fixture(t, { alpha: [
    message("substring", "foobarbaz", 100),
    message("separated", "alpha middle gamma", 200),
    message("accent", "café", 300),
    message("punctuation", "foo-barista", 400),
    message("quote", 'say "quoted"', 500),
    message("operator", "OR", 600),
    message("korean", "동작 확인", 700),
    message("eight", "one two three four five six seven eight", 800),
  ] });
  const cases = [
    ["bar", ["punctuation"]],
    ["foob", ["substring"]],
    ["alpha gamma", ["separated"]],
    ["gam alp", ["separated"]],
    ["cafe", ["accent"]],
    ["ＣＡＦＥ", ["accent"]],
    ["foo-bar", ["punctuation"]],
    ['"quoted"', ["quote"]],
    ["OR", ["operator"]],
    ["동작", ["korean"]],
    ["one two three four five six seven eight missing", ["eight"]],
    ["***", []],
    ["definitelymissing", []],
  ];
  for (const [query, expected] of cases) {
    for (const state of ["inactive", "active", "fallback"]) {
      f.activate(state === "active" ? "alpha" : null);
      f.ready(state !== "fallback");
      assert.deepEqual(ids(await f.roster.searchAgents(query)), expected, `${state}: ${query}`);
    }
  }
});

test("deleted-agent matches cannot starve older results and ready searches do not enumerate agent DBs", async (t) => {
  const raw = {};
  for (let agent = 0; agent < 12; agent += 1) {
    raw[`deleted-${agent}`] = Array.from({ length: 7 }, (_, row) =>
      message(`stale-${agent}-${row}`, "needle", 1000 + agent * 10 + row));
  }
  raw.kept = [message("kept-match", "needle", 100)];
  const f = fixture(t, raw, ["kept"]);
  assert.deepEqual(ids(await f.roster.searchAgents("needle", 1)), ["kept-match"]);
  assert.equal(f.rosterReads, 0);
  assert.equal(f.calls.length, 13);
  for (let index = 0; index < f.calls.length; index += 1) {
    assert.equal(f.calls[index].limit, 1);
    assert.equal(new Set(f.calls[index].excludedAgentIds).size, index);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS total FROM messages").get().total, 85);
});

test("stale active rows are excluded before the SQL limit and current transcript text is used", async (t) => {
  const f = fixture(t, {
    active: Array.from({ length: 7 }, (_, row) => message(`old-${row}`, "needle", 1000 + row)),
    kept: [message("kept-match", "needle", 100)],
  });
  f.activate("active", [message("fresh", "changed text", 2000)]);
  assert.deepEqual(ids(await f.roster.searchAgents("needle", 1)), ["kept-match"]);
  assert.deepEqual(f.calls[0].excludedAgentIds, ["active"]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(ids(await f.roster.searchAgents("changed", 1)), ["fresh"]);
});

test("all-deleted results terminate at index exhaustion, and unavailable queries fall back", async (t) => {
  const deleted = fixture(t, { gone: [message("gone", "needle", 100)] }, []);
  assert.deepEqual(await deleted.roster.searchAgents("needle", 1), []);
  assert.equal(deleted.calls.length, 2);
  const kept = fixture(t, { kept: [message("kept", "alpha middle gamma", 100)] });
  kept.unavailable(true);
  assert.deepEqual(ids(await kept.roster.searchAgents("alpha gamma", 1)), ["kept"]);
  assert.equal(kept.rosterReads, 1);
});

test("an active-agent switch during the index await cannot label another transcript with the old ID", async (t) => {
  const f = fixture(t, {
    first: [message("first-message", "needle", 100)],
    second: [message("second-message", "needle", 200)],
  });
  f.activate("first");
  f.afterQuery(() => f.activate("second"));
  const rows = await f.roster.searchAgents("needle");
  assert.deepEqual(rows.map(({ agentId, entryId }) => ({ agentId, entryId })), [
    { agentId: "second", entryId: "second-message" },
    { agentId: "first", entryId: "first-message" },
  ]);
});

test("the active matcher retains newest-five, hidden-entry and role rules", () => {
  const entries = Array.from({ length: 7 }, (_, row) => message(`entry-${row}`, "needle", row + 1));
  entries.push({ ...message("hidden", "needle", 100), hiddenOutboundAgentPeerMessage: true });
  assert.deepEqual(ids(sut.findAgentContentMatches(entries, "needle")), ["entry-6", "entry-5", "entry-4", "entry-3", "entry-2"]);
  const auxiliary = [
    { id: "notice", kind: "notice", text: "needle" },
    { id: "sent", kind: "send-message", message: { type: "text", content: "needle" } },
    { id: "attachment", kind: "send-message", message: { type: "attachment", content: "needle" } },
  ];
  assert.deepEqual(sut.findAgentContentMatches(auxiliary, "needle").map(({ entryId, role, timestampMs }) => ({ entryId, role, timestampMs })), [
    { entryId: "sent", role: "assistant", timestampMs: 0 },
    { entryId: "notice", role: "assistant", timestampMs: 0 },
  ]);
});

test("active and stored messages share the indexed trimmed body boundary and empty/zero-limit behavior", async (t) => {
  const f = fixture(t, { alpha: [message("long", `   ${"x ".repeat(10_000)}tailunique`, 100)] });
  for (const state of ["inactive", "active", "fallback"]) {
    f.activate(state === "active" ? "alpha" : null);
    f.ready(state !== "fallback");
    assert.deepEqual(await f.roster.searchAgents("tailunique"), [], state);
    assert.deepEqual(await f.roster.searchAgents("x", 0), [], state);
    assert.deepEqual(await f.roster.searchAgents("  \t "), [], state);
  }
});
