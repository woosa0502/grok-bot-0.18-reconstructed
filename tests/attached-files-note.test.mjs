// The phone client uploads attachments under a content hash; the prompt must still carry the name the user knows.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadNotes() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "attached-files-note-entry.ts",
      contents: `export { buildAttachedFilesNote, buildAttachedImageNamesNote, attachedFileDisplayName } from "./source/host/runner/system-prompt.js";`,
    },
    bundle: true, format: "esm", platform: "node", write: false,
    supported: { using: false }, packages: "external",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const notesPromise = loadNotes();
const hashed = "/data/agents/a1/attachments/a5aeef34c8da8087.md";

test("an uploaded file keeps the user's name next to its hashed path", async () => {
  const { buildAttachedFilesNote } = await notesPromise;
  const note = buildAttachedFilesNote([hashed], new Map(), new Map([[hashed, 78]]), new Map([[hashed, "attach-test.md"]]));
  assert.match(note, /"attach-test\.md": \/data\/agents\/a1\/attachments\/a5aeef34c8da8087\.md \(78 B\)/);
  assert.match(note, /The quoted name is what the user calls that file/);
});

test("a file whose stored name already matches needs no quoted name", async () => {
  const { buildAttachedFilesNote, attachedFileDisplayName } = await notesPromise;
  const plain = "/home/u/docs/report.pdf";
  assert.equal(attachedFileDisplayName(plain, new Map([[plain, "report.pdf"]])), null);
  const note = buildAttachedFilesNote([plain], new Map(), new Map(), new Map([[plain, "report.pdf"]]));
  assert.doesNotMatch(note, /quoted name/);
  assert.match(note, /\n- \/home\/u\/docs\/report\.pdf/);
});

test("without names the note is unchanged", async () => {
  const { buildAttachedFilesNote } = await notesPromise;
  assert.equal(buildAttachedFilesNote([hashed]), buildAttachedFilesNote([hashed], new Map(), new Map(), new Map()));
});

test("inline images get their names listed in order", async () => {
  const { buildAttachedImageNamesNote } = await notesPromise;
  const a = "/data/attachments/1838.png"; const b = "/data/attachments/9f00.jpg";
  assert.equal(buildAttachedImageNamesNote([a, b], new Map([[a, "attach-test.png"], [b, "photo.jpg"]])), 'The attached images are "attach-test.png", "photo.jpg" (in the order shown).');
  assert.equal(buildAttachedImageNamesNote([a], new Map()), "");
});
