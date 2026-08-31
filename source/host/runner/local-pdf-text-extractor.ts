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

// A malformed PDF must not hang the turn or buffer output forever
// (strict-review P1-10): the subprocess gets a hard deadline and is killed past
// it, and both extractors stop at a generous output cap.
export const PDF_EXTRACT_TIMEOUT_MS = 30_000;
export const PDF_EXTRACT_MAX_CHARS = 4_000_000;
export const PDF_EXTRACT_MAX_PAGES = 1_000;

export function extractWithPdftotext(binary: string, bytes: Uint8Array, timeoutMs = PDF_EXTRACT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, ["-layout", "-enc", "UTF-8", "-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    deadline.unref?.();
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (stdout.length < PDF_EXTRACT_MAX_CHARS) stdout += chunk;
    });
    child.stderr!.on("data", (chunk: string) => { if (stderr.length < 16_384) stderr += chunk; });
    child.on("error", (error) => { clearTimeout(deadline); reject(error); });
    // Settle on "exit", not "close": a killed extractor can leave grandchildren
    // holding the stdio pipes, which delays "close" until THEY exit.
    child.on("exit", () => {
      if (timedOut) { clearTimeout(deadline); reject(new Error(`${binary} timed out after ${Math.round(timeoutMs / 1000)}s`)); }
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (timedOut) reject(new Error(`${binary} timed out after ${Math.round(timeoutMs / 1000)}s`));
      else if (code === 0) resolve(stdout.slice(0, PDF_EXTRACT_MAX_CHARS));
      else reject(new Error(`${binary} exited with code ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`));
    });
    child.stdin!.on("error", () => { /* pdftotext may close stdin early on malformed input; the close handler reports it */ });
    child.stdin!.end(Buffer.from(bytes));
  });
}

export async function extractWithPdfjs(importPdfjs: () => Promise<PdfjsLike>, bytes: Uint8Array): Promise<string> {
  const pdfjs = await importPdfjs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  let totalChars = 0;
  const pageLimit = Math.min(document.numPages, PDF_EXTRACT_MAX_PAGES);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str === "string") text += item.str;
      if (item.hasEOL) text += "\n";
    }
    pages.push(text);
    totalChars += text.length;
    if (totalChars >= PDF_EXTRACT_MAX_CHARS) break;
  }
  if (document.numPages > pages.length) pages.push(`(truncated: ${document.numPages - pages.length} more pages not extracted)`);
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
