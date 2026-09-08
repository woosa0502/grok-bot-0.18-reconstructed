// A paired phone must stay paired across mobile-server restarts: sessions live in a 0600 file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSessionStore } from "../server.mjs";

test("sessions survive a store re-creation from the same file and expired ones are dropped", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "linear-sessions-"));
  const file = path.join(dir, ".sessions.json");
  try {
    let clock = 1_000;
    const first = createSessionStore(file, () => clock);
    first.set("alive", 10_000);
    first.set("stale", 2_000);
    assert.equal((statSync(file).mode & 0o777), 0o600);
    clock = 5_000;
    const second = createSessionStore(file, () => clock);
    assert.equal(second.get("alive"), 10_000, "a live session is restored");
    assert.equal(second.get("stale"), undefined, "an expired session is not restored");
    second.delete("alive");
    const third = createSessionStore(file, () => clock);
    assert.equal(third.size, 0, "logout is persisted too");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without a file the store is purely in-memory (test/preview mode)", () => {
  const store = createSessionStore(null, () => 0);
  store.set("t", 10);
  assert.equal(store.get("t"), 10);
});
