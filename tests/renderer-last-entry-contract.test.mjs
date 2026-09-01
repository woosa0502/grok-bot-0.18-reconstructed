// A12: the production host's sidebar last-entry projection emits attachment
// `kinds` as an ARRAY of { kind, count } (session-projection
// buildAttachmentLastEntry — the DEFECT-3 shape the pinned renderer needs).
// The editable frontend's parser only accepted the legacy record form
// { image: 1 } and silently dropped the canonical shape. Both must parse.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModel() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "model-entry.ts",
      contents: 'export { parseRendererAgentLastEntry } from "./frontend/src/production/model.js";',
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("the canonical host array shape parses", async () => {
  const { parseRendererAgentLastEntry } = await loadModel();
  const parsed = parseRendererAgentLastEntry({
    kind: "attachment",
    count: 3,
    kinds: [{ kind: "image", count: 2 }, { kind: "file", count: 1 }],
  });
  assert.deepEqual(parsed, { kind: "attachment", count: 3, kinds: { image: 2, file: 1 } });
});

test("the legacy record shape still parses; garbage is rejected", async () => {
  const { parseRendererAgentLastEntry } = await loadModel();
  assert.deepEqual(
    parseRendererAgentLastEntry({ kind: "attachment", count: 1, kinds: { image: 1 } }),
    { kind: "attachment", count: 1, kinds: { image: 1 } },
  );
  assert.equal(parseRendererAgentLastEntry({ kind: "attachment", count: 1, kinds: [{ kind: "", count: 1 }] }), null);
  assert.equal(parseRendererAgentLastEntry({ kind: "attachment", count: 1, kinds: [{ kind: "image", count: 0 }] }), null);
});
