import { spawn } from "node:child_process";

import type { PdfTextExtractor } from "../../packages/agent/tools/core/read/read.js";

// Local PDF text extraction for the Read tools (ExternalRead + box Read).
//
// The immutable 0.18 carriers ship the lazy Piscina producer but omit
// pdf-worker.{js,ts}, so upstream's extractor is not recoverable. Locally the
// text is extracted with poppler's `pdftotext` (present on the WSL host) and,
// when that binary is missing, with pdfjs-dist. Either path returns plain text;
// a PDF without extractable text (scanned/image-only) yields a short note so the
// model does not mistake an empty result for an empty document.

export const PDF_NO_TEXT_NOTE = "(no extractable text — the PDF appears to be scanned or image-only)";

export interface LocalPdfTextExtractorOptions {
  readonly pdftotextPath?: string;
  readonly pdfjsImport?: () => Promise<PdfjsLike>;
}

interface PdfjsLike {
  getDocument(options: { data: Uint8Array }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }> }> };
}

export function createLocalPdfTextExtractor(options: LocalPdfTextExtractorOptions = {}): PdfTextExtractor {
  const binary = options.pdftotextPath ?? process.env.SAND_PDFTOTEXT_PATH ?? "pdftotext";
  const importPdfjs = options.pdfjsImport ?? defaultPdfjsImport;
  return async (bytes) => {
    let firstError: unknown;
    try {
      return finishText(await extractWithPdftotext(binary, bytes));
    } catch (error) {
      firstError = error;
    }
    try {
      return finishText(await extractWithPdfjs(importPdfjs, bytes));
    } catch (error) {
      const detail = (value: unknown) => value instanceof Error ? value.message : String(value);
      throw new Error(`PDF text extraction failed (pdftotext: ${detail(firstError)}; pdfjs: ${detail(error)})`);
    }
  };
}

export function extractWithPdftotext(binary: string, bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, ["-layout", "-enc", "UTF-8", "-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${binary} exited with code ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`));
    });
    child.stdin.on("error", () => { /* pdftotext may close stdin early on malformed input; the close handler reports it */ });
    child.stdin.end(Buffer.from(bytes));
  });
}

export async function extractWithPdfjs(importPdfjs: () => Promise<PdfjsLike>, bytes: Uint8Array): Promise<string> {
  const pdfjs = await importPdfjs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str === "string") text += item.str;
      if (item.hasEOL) text += "\n";
    }
    pages.push(text);
  }
  return pages.join("\f");
}

function defaultPdfjsImport(): Promise<PdfjsLike> {
  // Non-literal specifier: pdfjs-dist stays outside the host bundle and is
  // resolved from node_modules only when pdftotext is unavailable.
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  return import(specifier) as Promise<PdfjsLike>;
}

function finishText(text: string): string {
  const trimmed = text.replace(/\f+$/u, "").trimEnd();
  return trimmed.trim().length === 0 ? PDF_NO_TEXT_NOTE : trimmed;
}
