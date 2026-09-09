import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordIdentity, verifyIdentity } from "../belmont-browse/tools/native-build-identity.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "native-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = path.join(root, "snapshot"); mkdirSync(snapshot);
  writeFileSync(path.join(snapshot, "manifest.json"), JSON.stringify({ baseCommit: "base", localHead: "head", capturedAt: "2026-09-09T00:00:00Z" }));
  writeFileSync(path.join(snapshot, "chromium.patch"), "--- a\n+++ b\n");
  writeFileSync(path.join(snapshot, "args.gn"), "is_debug = false\n");
  const chrome = path.join(root, "chrome"); writeFileSync(chrome, Buffer.alloc(4096, 1));
  // A pinned daemon bundle the launcher would load for engine 907.
  mkdirSync(path.join(root, "research-archives/aside"), { recursive: true });
  mkdirSync(path.join(root, "belmont-browse/vendor/aside-907/apps/daemon/build"), { recursive: true });
  const bundle = path.join(root, "belmont-browse/vendor/aside-907/apps/daemon/build/daemon.mjs"); writeFileSync(bundle, "export const daemon = 1;\n");
  const { createHash } = require("node:crypto");
  writeFileSync(path.join(root, "research-archives/aside/artifacts.json"), JSON.stringify({ artifacts: [{ kind: "patched-daemon-bundle", target: "belmont-browse/vendor/aside-907/apps/daemon/build/daemon.mjs", sha256: createHash("sha256").update(readFileSync(bundle)).digest("hex") }] }));
  const identityFile = path.join(snapshot, "build-identity.json");
  const options = { chrome, engine: "907", snapshotDir: snapshot, repoRoot: root, identityFile };
  return { root, snapshot, chrome, bundle, identityFile, options };
}
const require = (await import("node:module")).createRequire(import.meta.url);

test("a recorded build verifies through the exact-file fast path and through a forced hash", async (t) => {
  const f = fixture(t);
  const identity = await recordIdentity(f.options);
  assert.equal(identity.chrome.bytes, 4096);
  assert.match(identity.chrome.mtimeNs, /^\d+$/u, "mtime is recorded as an exact integer, not 'undefined'");
  assert.equal(Object.keys(identity.snapshotInputs).length, 3);
  assert.deepEqual(await verifyIdentity(f.options), { ok: true, problems: [], identity: JSON.parse(readFileSync(f.identityFile, "utf8")) });
  assert.equal((await verifyIdentity({ ...f.options, hashBinary: "always" })).ok, true);
});

test("negative control: a source snapshot changed after the build refuses the stale binary", async (t) => {
  const f = fixture(t);
  await recordIdentity(f.options);
  writeFileSync(path.join(f.snapshot, "chromium.patch"), "--- a\n+++ b\n+one more native change\n");
  const result = await verifyIdentity(f.options);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /chromium\.patch changed after the recorded build \(stale binary\)/u);
});

test("negative control: a binary that is not the recorded build is refused even when its size matches", async (t) => {
  const f = fixture(t);
  await recordIdentity(f.options);
  writeFileSync(f.chrome, Buffer.alloc(4096, 2));
  const result = await verifyIdentity(f.options);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /is not the recorded build/u);
});

test("a same-size, same-mtime file is accepted without hashing, and a touched file falls back to the hash", async (t) => {
  const f = fixture(t);
  const identity = await recordIdentity(f.options);
  // Rewrite identical bytes with a new mtime: the fast path misses, the hash still matches.
  writeFileSync(f.chrome, Buffer.alloc(4096, 1));
  utimesSync(f.chrome, new Date(Date.now() + 5_000), new Date(Date.now() + 5_000));
  assert.equal((await verifyIdentity(f.options)).ok, true);
  assert.equal(identity.chrome.sha256, JSON.parse(readFileSync(f.identityFile, "utf8")).chrome.sha256);
});

test("a daemon bundle that differs from the pinned archive is refused; a missing record is refused with the fix", async (t) => {
  const f = fixture(t);
  await recordIdentity(f.options);
  writeFileSync(f.bundle, "export const daemon = 2; // locally modified\n");
  const result = await verifyIdentity(f.options);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /differs from the pinned archive bundle/u);
  const missing = await verifyIdentity({ ...f.options, identityFile: path.join(f.root, "absent.json") });
  assert.equal(missing.ok, false);
  assert.match(missing.problems[0], /no recorded build identity/u);
});
