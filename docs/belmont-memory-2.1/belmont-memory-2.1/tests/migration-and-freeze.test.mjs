import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { legacyMemoryId, resolveFrozenPrompt, memoryViewKey } from "../dist/index.js";
import { setup, capture, proposal, remember } from "./helpers.mjs";
const S = "user:demo";
function use(t) { const s = setup(); t.after(() => s.kernel.close()); return s; }
test("legacy SHA1 algorithm matches old whitespace, 500-char, lower-case rules", () => {
  const raw = "  HELLO\nWorld " + "a".repeat(510);
  const expected = createHash("sha1").update(raw.replace(/\s+/g, " ").trim().slice(0, 500).toLowerCase()).digest("hex").slice(0, 16);
  assert.equal(legacyMemoryId(raw), expected);
  assert.notEqual(legacyMemoryId("Ａ"), legacyMemoryId("A"));
});
test("legacy tombstones block recreation without pretending legacy explicit means consent", (t) => {
  const { migrator, user } = use(t);
  assert.equal(migrator.importLegacyTombstones(S, [legacyMemoryId("Forgotten Preference")]), 1);
  const e = capture(user, "FORGOTTEN preference");
  assert.equal(user.propose(proposal(user, e, "FORGOTTEN preference")).reason, "TOMBSTONED");
});
test("legacy barrier import is idempotent and remains after clear/reindex", (t) => {
  const { migrator, user } = use(t); const ids = [legacyMemoryId("forgotten")];
  migrator.importLegacyTombstones(S, ids); const before = migrator.snapshot(S);
  assert.equal(migrator.importLegacyTombstones(S, ids), 0); assert.deepEqual(migrator.snapshot(S), before);
  user.clear(S); user.rebuild(S); const e = capture(user, "forgotten");
  assert.equal(user.propose(proposal(user, e, "forgotten")).reason, "TOMBSTONED");
});
test("legacy barrier import is privileged, validated and precedes fact import", (t) => {
  const { agent, user, migrator } = use(t);
  assert.throws(() => agent.importLegacyTombstones(S, ["a".repeat(16)]), { code: "FORBIDDEN" });
  assert.throws(() => migrator.importLegacyTombstones(S, ["../../secret"]), { code: "INVALID_LEGACY_TOMBSTONE" });
  remember(user, "existing");
  assert.throws(() => migrator.importLegacyTombstones(S, ["a".repeat(16)]), { code: "LEGACY_BARRIERS_MUST_PRECEDE_IMPORT" });
});
function stamp(session, more = {}) { return { principalId: "ui:user", policyEpoch: 0, snapshots: [session.snapshot(S)], ...more }; }
test("frozen prompt reuses unchanged view", (t) => {
  const { user } = use(t); const one = resolveFrozenPrompt({ compactionEpoch: 7, stamp: stamp(user), renderLive: () => ({ render: "cached", hasFacts: true }) });
  const two = resolveFrozenPrompt({ previous: one.snapshotToPersist, compactionEpoch: 7, stamp: stamp(user), renderLive: () => { throw new Error("must not render"); } });
  assert.equal(two.render, "cached");
});
test("deletion invalidates a frozen prompt without a compaction change", (t) => {
  const { user } = use(t); const r = remember(user, "sensitive");
  const one = resolveFrozenPrompt({ compactionEpoch: 7, stamp: stamp(user), renderLive: () => ({ render: "sensitive", hasFacts: true }) });
  user.forget(S, r.id);
  const two = resolveFrozenPrompt({ previous: one.snapshotToPersist, compactionEpoch: 7, stamp: stamp(user), renderLive: () => ({ render: "", hasFacts: false }) });
  assert.equal(two.render, ""); assert.equal(two.snapshotToPersist.render, "");
});
test("ACL, principal, membership and generation all invalidate memory views", (t) => {
  const { user } = use(t); const a = stamp(user); const key = memoryViewKey(a);
  assert.notEqual(key, memoryViewKey({ ...a, policyEpoch: 1 }));
  assert.notEqual(key, memoryViewKey({ ...a, principalId: "another" }));
  assert.notEqual(key, memoryViewKey({ ...a, snapshots: [] }));
  remember(user, "new preference"); assert.notEqual(key, memoryViewKey(stamp(user)));
});
test("old compaction-only persisted prompt is never accepted", (t) => {
  const { user } = use(t);
  const result = resolveFrozenPrompt({ previous: { render: "old secret", compactionEpoch: 7 }, compactionEpoch: 7, stamp: stamp(user), renderLive: () => ({ render: "safe", hasFacts: false }) });
  assert.equal(result.render, "safe");
});
