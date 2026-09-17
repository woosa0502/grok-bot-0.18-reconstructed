// A per-session sites overlay (the isolation learn-measure relies on) must let an eval session read a
// candidate site page while the operational site knowledge — reached through the account's memory/sites
// symlink — stays invisible to that session, and invisible the other way for ordinary sessions.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemorySearch } from "../src/memory-search.mjs";

test("a per-session sitesRoot overlay isolates site knowledge from the operational store", async () => {
  const base = fs.mkdtempSync(join(tmpdir(), "mem-search-overlay-"));
  const knowledge = join(base, "knowledge"), opSites = join(knowledge, "sites");
  const accountRoot = join(base, "account"), memoryDir = join(accountRoot, "memory");
  const overlay = join(base, "eval-overlay");
  fs.mkdirSync(opSites, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(overlay, { recursive: true });
  fs.writeFileSync(join(memoryDir, "profile.md"), "# Profile\n\nThe user prefers memorytoken things.\n");
  fs.writeFileSync(join(opSites, "example.com.md"), "# example.com\n\nUse championtoken to proceed.\n");
  fs.symlinkSync(opSites, join(memoryDir, "sites")); // the account's operational site knowledge symlink
  fs.writeFileSync(join(overlay, "example.com.md"), "# example.com\n\nUse drafttoken to proceed.\n");

  const search = createMemorySearch({ allowedRoots: [knowledge] });
  try {
    const q = (sitesRoot) => search.searchMany({ accountRoot, sitesRoot, queries: ["championtoken", "drafttoken", "memorytoken"], maxResults: 10 });
    const has = (rows, needle) => rows.some((r) => (r.excerpt || "").includes(needle));

    const globalRows = await q(undefined);
    assert.ok(has(globalRows, "championtoken"), "global view sees the operational page");
    assert.ok(!has(globalRows, "drafttoken"), "global view does NOT see the eval overlay");
    assert.ok(has(globalRows, "memorytoken"), "global view sees account memory");

    const evalRows = await q(overlay);
    assert.ok(has(evalRows, "drafttoken"), "eval view sees the overlay candidate");
    assert.ok(!has(evalRows, "championtoken"), "eval view does NOT see the operational page (isolation)");
    assert.ok(has(evalRows, "memorytoken"), "eval view still sees account memory");

    // The global view is unchanged after an eval search (distinct index key, no cross-contamination).
    const globalAgain = await q(undefined);
    assert.ok(has(globalAgain, "championtoken") && !has(globalAgain, "drafttoken"), "global view is unaffected by the eval overlay search");
  } finally { await search.close(); fs.rmSync(base, { recursive: true, force: true }); }
});
