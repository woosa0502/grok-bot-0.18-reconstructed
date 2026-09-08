import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const message = (id, content) => ({ id, kind: "message", role: "user", content, timestampMs: 10 });
const media = (id, fileName) => ({ id, kind: "user-attachment", file_name: fileName, file_path: `/fixture/${fileName}` });

async function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), "belmont-search-consistency-"));
  const closes = [];
  t.after(async () => {
    for (const close of closes.reverse()) await close();
    rmSync(root, { recursive: true, force: true });
  });
  const bundle = join(root, "search.mjs");
  await build({
    stdin: {
      contents: ["search-index-db", "search-index-writer", "search-index-service"].map((name) => `export * from "./source/host/extensions/content-search/${name}.ts";`).join("\n"),
      resolveDir: repo,
      loader: "ts",
    },
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    packages: "external",
    logLevel: "silent",
  });
  const sut = await import(pathToFileURL(bundle).href);
  const agentsRootDir = join(root, "agents");
  const indexDbPath = join(root, "search-index.db");
  mkdirSync(join(agentsRootDir, "bot"), { recursive: true });
  const source = new DatabaseSync(join(agentsRootDir, "bot", "store.db"));
  closes.push(() => source.close());
  source.exec("CREATE TABLE transcript_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL)");
  const insert = (entry) => source.prepare("INSERT INTO transcript_entries(id, entry) VALUES (?, ?)").run(entry.id, JSON.stringify(entry));
  const edit = (entry) => source.prepare("UPDATE transcript_entries SET entry = ? WHERE id = ?").run(JSON.stringify(entry), entry.id);
  entries.forEach(insert);
  const openWriter = () => {
    const db = sut.openSearchIndexDb(indexDbPath);
    sut.ensureSearchIndexSchema(db);
    sut.stampSearchIndexSchemaVersion(db);
    const writer = new sut.SandSearchIndexWriter(db, agentsRootDir);
    let closed = false;
    const close = () => { if (!closed) { closed = true; writer.close(); db.close(); } };
    closes.push(close);
    return { db, writer, close };
  };
  return { ...sut, source, insert, edit, openWriter, agentsRootDir, indexDbPath, closes };
}

test("reconciliation after restart detects missed message and media content edits", async (t) => {
  const fx = await fixture(t, [message("m1", "old cobalt"), media("f1", "old-cobalt.pdf")]);
  const first = fx.openWriter();
  first.writer.reconcile();
  first.close();
  fx.edit(message("m1", "new zircon"));
  fx.edit(media("f1", "new-zircon.pdf"));
  const restarted = fx.openWriter();
  restarted.writer.reconcile();
  assert.deepEqual(fx.searchMessages(restarted.db, "zircon", 10).map((row) => row.entryId), ["m1"]);
  assert.deepEqual(fx.searchMedia(restarted.db, "zircon", 10).map((row) => row.entryId), ["f1"]);
  assert.deepEqual(fx.searchMessages(restarted.db, "cobalt", 10), []);
  assert.deepEqual(fx.searchMedia(restarted.db, "cobalt", 10), []);
});

test("an incremental job cannot certify other durable rows it has not indexed", async (t) => {
  const fx = await fixture(t, [message("m1", "baseline")]);
  const first = fx.openWriter();
  first.writer.reconcile();
  const delivered = message("m2", "delivered silver");
  fx.insert(delivered);
  fx.insert(message("m3", "missing zircon"));
  first.writer.upsertEntries("bot", [delivered]);
  first.close();
  const restarted = fx.openWriter();
  restarted.writer.reconcile();
  assert.deepEqual(fx.searchMessages(restarted.db, "zircon", 10).map((row) => row.entryId), ["m3"]);
  assert.equal(restarted.db.prepare("SELECT COUNT(*) AS n FROM messages").get().n, 3);
});

test("an incremental delete does not hide a separate missed content edit", async (t) => {
  const fx = await fixture(t, [message("m1", "remove cobalt"), message("m2", "old silver")]);
  const first = fx.openWriter();
  first.writer.reconcile();
  fx.source.prepare("DELETE FROM transcript_entries WHERE id = ?").run("m1");
  fx.edit(message("m2", "new zircon"));
  first.writer.deleteEntry("bot", "m1");
  first.close();
  const restarted = fx.openWriter();
  restarted.writer.reconcile();
  assert.deepEqual(fx.searchMessages(restarted.db, "zircon", 10).map((row) => row.entryId), ["m2"]);
  assert.deepEqual(fx.searchMessages(restarted.db, "cobalt", 10), []);
});

test("automatic worker recovery indexes every durable append before reporting ready", async (t) => {
  const fx = await fixture(t, [message("m1", "baseline")]);
  let failed = false;
  const health = [];
  const service = new fx.SandSearchIndexService({
    indexDbPath: fx.indexDbPath,
    agentsRootDir: fx.agentsRootDir,
    disposeDeadline: { run: (operation) => operation() },
    report: (event) => health.push(event),
    createJobPort: () => {
      const owner = fx.openWriter();
      return {
        async post(job) {
          if (!failed && job.kind === "upsert-entries" && job.entries.some((entry) => entry.id === "m3")) {
            failed = true;
            owner.close();
            return { ok: false, message: "fixture worker exited before pending append", isWorkerUnavailable: true, isIndexCorrupt: false };
          }
          owner.writer.runJob(job);
          return { ok: true };
        },
        async terminate() { owner.close(); },
      };
    },
  });
  fx.closes.push(() => service.dispose());
  service.start();
  await service.whenIdle();
  for (const entry of [message("m2", "delivered silver"), message("m3", "missing zircon")]) {
    fx.insert(entry);
    service.applyMutation({ kind: "entries-upserted", agentId: "bot", entries: [entry] });
  }
  // Recovery appends reconciliation to the tail while settling the failed job.
  for (let n = 0; n < 4; n += 1) await service.whenIdle();
  assert.equal(failed, true);
  assert.equal(health.filter((event) => event.kind === "worker_respawn").length, 1);
  assert.equal(service.isSearchReady, true);
  assert.deepEqual(service.searchMessages("zircon", 10).map((row) => row.entryId), ["m3"]);
});
