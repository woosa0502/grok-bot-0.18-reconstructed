import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, ".build"), { recursive: true });
const tmp = await mkdtemp(path.join(root, ".build/job-header-test-"));
const out = path.join(tmp, "usage-ledger.mjs");
await build({
  entryPoints: [path.join(root, "source/host/extensions/inference/usage-ledger.ts")],
  outfile: out, bundle: true, platform: "node", format: "esm", target: "node26",
});
const { parseLeadingJobHeader } = await import(pathToFileURL(out).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

test("well-formed job tags parse to tagged ids", () => {
  assert.deepEqual(parseLeadingJobHeader("[job:ok]"), { kind: "tagged", jobIds: ["ok"], reason: null });
  assert.deepEqual(parseLeadingJobHeader("[job:ok] 안녕"), { kind: "tagged", jobIds: ["ok"], reason: null });
  assert.deepEqual(parseLeadingJobHeader("[foo][job:ok]"), { kind: "tagged", jobIds: ["ok"], reason: null });
  const multi = parseLeadingJobHeader("[job:a][job:b]");
  assert.equal(multi.kind, "tagged");
  assert.deepEqual(multi.jobIds, ["a", "b"]);
  assert.equal(multi.reason, "shared");
});

test("no leading job tag is untagged", () => {
  assert.equal(parseLeadingJobHeader("보통 프롬프트").kind, "untagged");
  assert.equal(parseLeadingJobHeader("[note] hi").kind, "untagged");
  assert.equal(parseLeadingJobHeader("").kind, "untagged");
  assert.equal(parseLeadingJobHeader(null).kind, "untagged");
});

test("malformed closed job id is invalid (whole discard)", () => {
  assert.equal(parseLeadingJobHeader("[job:ok][job:bad/id]").kind, "invalid");
});

// Regression (GPT Pro review, 2026-09-16): an unterminated leading "[job:" tag must be
// invalid, not silently accepted as its already-parsed prefix. Before the fix
// "[job:ok][job:" attributed usage to "ok".
test("unterminated leading job tag is invalid, not a silent prefix", () => {
  assert.equal(parseLeadingJobHeader("[job:ok][job:").kind, "invalid");
  assert.equal(parseLeadingJobHeader("[job:").kind, "invalid");
  // A non-job unterminated bracket just ends the leading run; prior job tags still classify.
  assert.deepEqual(parseLeadingJobHeader("[job:ok][foo").jobIds, ["ok"]);
});
