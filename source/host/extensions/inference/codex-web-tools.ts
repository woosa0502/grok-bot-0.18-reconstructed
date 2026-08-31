// Codex-mode web tools. In local Codex (no-Cursor) mode the inference extension has no Cursor
// AiService to back WebSearch / WebFetch, so the tools were simply absent. These replacements keep
// the exact service shapes the tool layer consumes — WebFetch returns { content } | { error }, and
// WebSearch returns { answer, documents: [{ url, title, text }] } — so nothing downstream changes.
//
// WebFetch is a self-contained local HTTP fetch (no model, no Codex): the audit noted the existing
// wrapper was validation/truncation only, so this supplies the actual fetch with redirect, timeout,
// size cap, and a text extraction pass. WebSearch reuses the same Codex backend the codex CLI uses
// (`web_search = "live"`), via the native web_search tool on the OpenAI Responses API — see
// createCodexWebSearchService.

const FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_BYTES = 5_000_000;
const MAX_CONTENT_CHARS = 100_000;
// A plain browser UA: search and many sites reject obvious bot identifiers (DuckDuckGo's HTML
// endpoint returns a 202 challenge for them), so the local web tools present a normal browser.
const FETCH_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const SEARCH_MAX_RESULTS = 8;
const SEARCH_SNIPPET_CHARS = 400;

export type WebFetchResult = { content: string } | { error: string; isTimeout?: boolean };
export interface WebSearchDocument { readonly url: string; readonly title: string; readonly text: string; }
export interface WebSearchResult { readonly answer: string; readonly documents: readonly WebSearchDocument[]; }

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _m;
    });
}

function htmlToText(html: string): string {
  const withoutHead = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutHead
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|header|footer|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .trim();
}

// Content types that must not be decoded as UTF-8 text (strict-review P1-09):
// serving mojibake from a PDF/image/archive both wastes the context window and
// misleads the model into "reading" garbage.
function binaryContentTypeNote(contentType: string): string | undefined {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type.length === 0) return undefined;
  const binary = type.startsWith("image/") || type.startsWith("audio/") || type.startsWith("video/") || type.startsWith("font/")
    || type === "application/pdf" || type === "application/octet-stream" || type === "application/zip"
    || type === "application/gzip" || type === "application/x-tar" || type === "application/wasm";
  return binary ? `Web fetch: the response is binary (${type}), not readable text. Download it with Shell (curl/wget) if the file itself is needed.` : undefined;
}

function extractText(contentType: string, body: string): string {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "text/html" || type === "application/xhtml+xml") return htmlToText(body);
  // text/plain, application/json, text/markdown, application/xml, and other text/* pass through raw.
  return body.trim();
}

function signalFromContext(context: unknown): AbortSignal | undefined {
  if (typeof context !== "object" || context == null) return undefined;
  const signal = (context as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader == null) return await response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value == null) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, Math.min(total, maxBytes)));
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const take = Math.min(chunk.byteLength, length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

export function createCodexWebFetchService() {
  return async (ctx: unknown, url: string): Promise<WebFetchResult> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: `Web fetch failed: invalid URL "${url}".` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: `Web fetch failed: unsupported protocol "${parsed.protocol}".` };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // Propagate caller cancellation (strict-review P1-09): an aborted turn must
    // not leave the fetch running to the full timeout.
    const callerSignal = signalFromContext(ctx);
    const onCallerAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const response = await fetch(parsed.href, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": FETCH_USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8" },
      });
      // Re-validate where the redirect chain actually landed (strict-review
      // P1-09): the pre-flight check saw only the initial URL.
      try {
        const finalUrl = new URL(response.url || parsed.href);
        if (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") {
          return { error: `Web fetch failed: redirect landed on unsupported protocol "${finalUrl.protocol}".` };
        }
      } catch {
        return { error: "Web fetch failed: redirect landed on an unparsable URL." };
      }
      if (!response.ok) {
        return { error: `Web fetch failed: HTTP ${response.status} ${response.statusText}`.trim() };
      }
      const contentType = response.headers.get("content-type") ?? "";
      const binaryNote = binaryContentTypeNote(contentType);
      if (binaryNote !== undefined) return { error: binaryNote };
      const body = await readBodyCapped(response, MAX_FETCH_BYTES);
      const text = extractText(contentType, body);
      const trimmed = text.length > MAX_CONTENT_CHARS
        ? `${text.slice(0, MAX_CONTENT_CHARS)}\n\n[truncated at ${MAX_CONTENT_CHARS} characters]`
        : text;
      if (trimmed.length === 0) return { error: `Web fetch returned no readable text for ${parsed.href}.` };
      return { content: trimmed };
    } catch (error) {
      const aborted = controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
      if (callerSignal?.aborted === true) return { error: "Web fetch was canceled." };
      if (aborted) return { error: `Web fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s.`, isTimeout: true };
      return { error: `Web fetch failed: ${(error as { message?: string })?.message ?? String(error)}` };
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}

function stripToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function resolveResultUrl(href: string): string {
  const decoded = decodeEntities(href);
  const redirect = /[?&]uddg=([^&]+)/.exec(decoded);
  if (redirect?.[1] != null) {
    try {
      return decodeURIComponent(redirect[1]);
    } catch {
      return decoded;
    }
  }
  return decoded.startsWith("//") ? `https:${decoded}` : decoded;
}

// WebSearch for local Codex mode. Belmont's Codex path cannot enable the OpenAI Responses
// web_search tool (Pi projects only function tools, and the ChatGPT-backend transport is
// WebSocket + account-scoped headers that are impractical to reproduce), so this issues a keyless,
// auth-free search against DuckDuckGo's HTML endpoint and returns the same { answer, documents }
// shape the tool renders. answer is empty (no synthesized summary); the agent reads the ranked
// documents and can WebFetch the top URLs for full content — the search-then-read research loop.
export function createCodexWebSearchService() {
  return async (_ctx: unknown, args: { searchTerm: string; explanation?: string }): Promise<WebSearchResult> => {
    const term = args.searchTerm.trim();
    if (term.length === 0) return { answer: "", documents: [] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(SEARCH_ENDPOINT, {
        method: "POST",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": FETCH_USER_AGENT, "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
        body: `q=${encodeURIComponent(term)}`,
      });
      if (!response.ok) throw new Error(`web search HTTP ${response.status}`);
      const html = await readBodyCapped(response, MAX_FETCH_BYTES);
      const titles = [...html.matchAll(/<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      // Pair each snippet with ITS result block (the HTML between this title and
      // the next), not by global array index — a result without a snippet used to
      // shift every later description onto the wrong title/URL (strict-review P1-09).
      const snippetPattern = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
      const documents: WebSearchDocument[] = [];
      for (const [index, match] of titles.entries()) {
        if (documents.length >= SEARCH_MAX_RESULTS) break;
        const url = resolveResultUrl(match[1] ?? "");
        const title = stripToText(match[2] ?? "");
        if (url.length === 0 || !/^https?:/.test(url)) continue;
        const blockStart = match.index ?? 0;
        const blockEnd = titles[index + 1]?.index ?? html.length;
        const snippet = snippetPattern.exec(html.slice(blockStart, blockEnd));
        documents.push({ url, title, text: stripToText(snippet?.[1] ?? "").slice(0, SEARCH_SNIPPET_CHARS) });
      }
      return { answer: "", documents };
    } catch (error) {
      const aborted = controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
      throw new Error(aborted ? `Web search timed out after ${FETCH_TIMEOUT_MS / 1000}s.` : `Web search failed: ${(error as { message?: string })?.message ?? String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  };
}
