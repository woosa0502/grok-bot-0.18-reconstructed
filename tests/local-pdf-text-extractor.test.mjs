// Local PDF text extraction for the Read tools (pdftotext → pdfjs-dist fallback)
// and its binding into the host's ExternalRead / box Read tool options.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadExtractor() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/host/runner/local-pdf-text-extractor.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

async function loadRuntime() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      contents: `
        export { BoxExecRuntime } from "./source/box-exec-daemon/server.js";
        export { ReadArgs } from "./source/packages/proto/generated/agent/v1/read_exec_pb.js";
      `,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    packages: "external",
    supported: { using: false },
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const cache = path.join(repoRoot, "node_modules/.cache/belmont-tests");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, "pdf-read-"));
  const filename = path.join(directory, "runtime.mjs");
  try {
    await writeFile(filename, result.outputFiles[0].text);
    return await import(pathToFileURL(filename).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// A minimal single-page PDF with one Helvetica text run. poppler reconstructs the
// missing xref table, so no byte offsets are needed.
function minimalPdf(text) {
  const content = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${content.length} >> stream`,
    content,
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n"), "latin1");
}

async function hasPdftotext() {
  try { await promisify(execFile)("pdftotext", ["-v"]); return true; }
  catch (error) { return error?.code !== "ENOENT"; }
}

test("pdftotext extracts the text of a minimal PDF", { skip: !(await hasPdftotext()) && "pdftotext not installed" }, async () => {
  const { createLocalPdfTextExtractor } = await loadExtractor();
  const extract = createLocalPdfTextExtractor();
  const text = await extract(new Uint8Array(minimalPdf("HELLO PDF 42")));
  assert.match(text, /HELLO PDF 42/);
});

test("falls back to pdfjs when pdftotext is unavailable, and reports both failures", async () => {
  const { createLocalPdfTextExtractor, PDF_NO_TEXT_NOTE } = await loadExtractor();
  const fakePdfjs = async () => ({
    getDocument: () => ({ promise: Promise.resolve({
      numPages: 2,
      getPage: async (n) => ({ getTextContent: async () => ({ items: n === 1 ? [{ str: "page one" }, { str: "", hasEOL: true }] : [{ str: "page two" }] }) }),
    }) }),
  });
  const extract = createLocalPdfTextExtractor({ pdftotextPath: "/nonexistent/belmont-pdftotext", pdfjsImport: fakePdfjs });
  assert.equal(await extract(new Uint8Array([37, 80, 68, 70])), "page one\n\fpage two");

  const emptyPdfjs = async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) }) }) });
  const extractEmpty = createLocalPdfTextExtractor({ pdftotextPath: "/nonexistent/belmont-pdftotext", pdfjsImport: emptyPdfjs });
  assert.equal(await extractEmpty(new Uint8Array([37, 80, 68, 70])), PDF_NO_TEXT_NOTE);

  const brokenPdfjs = async () => { throw new Error("pdfjs missing"); };
  const extractBroken = createLocalPdfTextExtractor({ pdftotextPath: "/nonexistent/belmont-pdftotext", pdfjsImport: brokenPdfjs });
  await assert.rejects(extractBroken(new Uint8Array([37, 80, 68, 70])), /PDF text extraction failed \(pdftotext: .*ENOENT.*; pdfjs: pdfjs missing\)/);
});

test("box daemon hands PDF bytes back as data output instead of refusing them", async () => {
  const source = await readFile(path.join(repoRoot, "source/box-exec-daemon/server.ts"), "utf8");
  assert.doesNotMatch(source, /text extraction is not available in this build/);
  assert.match(source, /if \(looksLikePdf \|\| looksLikeImage\) \{\s*return new ReadResult\(\{ result: \{ case: "success", value: new ReadSuccess\(\{\s*path: args\.path,\s*output: \{ case: "data", value: new Uint8Array\(data\) \}/);
});

test("box PDF reads preserve all bytes and ignore text ranges for signature and extension detection", async t => {
  const { BoxExecRuntime, ReadArgs } = await loadRuntime();
  const root = await mkdtemp(path.join(tmpdir(), "belmont-pdf-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const terminals = path.join(root, "terminals");
  await mkdir(workspace);
  await mkdir(terminals);
  const runtime = new BoxExecRuntime(workspace, terminals, { PATH: process.env.PATH ?? "" });
  t.after(() => runtime.stop());
  const fixtures = [
    ["signature.bin", Buffer.concat([minimalPdf("BOX PDF CONTRACT"), Buffer.from([0, 128, 255, 10])])],
    ["extension.PDF", Buffer.from([0, 128, 255, 10, 65, 10, 66])],
  ];
  for (const [filename, bytes] of fixtures) {
    await writeFile(path.join(workspace, filename), bytes);
    const requestPath = `/workspace/${filename}`;
    const { result } = await runtime.read(new ReadArgs({ path: requestPath, offset: 2, limit: 1 }));
    assert.equal(result.case, "success", filename);
    assert.equal(result.value.path, requestPath);
    assert.equal(result.value.output.case, "data", filename);
    assert.deepEqual(Buffer.from(result.value.output.value), bytes, filename);
    assert.equal(result.value.fileSize, BigInt(bytes.byteLength));
    assert.equal(result.value.totalLines, 0);
    assert.equal(result.value.truncated, false);
    assert.equal(result.value.rangeApplied, false);
  }
  await writeFile(path.join(workspace, "plain.txt"), "alpha\nbeta\ngamma");
  const { result } = await runtime.read(new ReadArgs({ path: "/workspace/plain.txt", offset: 2, limit: 1 }));
  assert.equal(result.case, "success");
  assert.equal(result.value.output.case, "content", "ordinary text must retain its text output branch");
  assert.equal(result.value.output.value, "beta");
  assert.equal(result.value.rangeApplied, true);
});

test("host binds the local extractor into both Read tools", async () => {
  const source = await readFile(path.join(repoRoot, "source/host/host-runner-composition.ts"), "utf8");
  assert.match(source, /const localPdfTextExtractor = createLocalPdfTextExtractor\(\)/);
  const external = source.slice(source.indexOf("createExternalReadToolInputs:"), source.indexOf("createBoxReadToolInputs:"));
  assert.match(external, /pdfTextExtractor: localPdfTextExtractor/);
  const box = source.slice(source.indexOf("createBoxReadToolInputs:"), source.indexOf("createBoxLsToolInputs:"));
  assert.match(box, /pdfTextExtractor: localPdfTextExtractor/);
  assert.doesNotMatch(source, /Leaving the extractor absent/);
});
