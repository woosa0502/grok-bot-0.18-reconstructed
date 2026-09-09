// Local search uses the current session's browser and returns SERP evidence only.
export const LOCAL_WEB_SEARCH_LIMITS = Object.freeze({
  queries: 4,
  resultsPerQuery: 5,
  resultsTotal: 12,
  outputChars: 25000,
  htmlChars: 5 * 1024 * 1024,
  titleChars: 512,
  excerptChars: 1600,
  urlChars: 4096,
});

export function isDisabledAsideEndpoint(value = process.env.ASIDE_API_URL) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "9" &&
      url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function externalResultUrl(value) {
  try {
    let url = new URL(value, "https://www.google.com");
    if (url.hostname === "www.google.com" && url.pathname === "/url") {
      url = new URL(url.searchParams.get("q") ?? url.searchParams.get("url"));
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
        /(^|\.)(?:google\.[a-z.]+|gstatic\.com|googleusercontent\.com)$/.test(url.hostname)) return null;
    url.hash = "";
    return url.href.length <= LOCAL_WEB_SEARCH_LIMITS.urlChars ? url.href : null;
  } catch {
    return null;
  }
}

// Preserve an observed opaque result href; never infer its destination from a display URL.
// This is called only for an anchor containing a result heading on a validated Google SERP.
function searchResultRedirectUrl(value) {
  try {
    const url = new URL(value, "https://www.google.com");
    if (url.origin !== "https://www.google.com" || url.username || url.password ||
        url.pathname !== "/goto" || !compact(url.searchParams.get("url")) ||
        url.href.length > LOCAL_WEB_SEARCH_LIMITS.urlChars) return null;
    return url.href;
  } catch {
    return null;
  }
}

function assertSearchUrl(pageUrl, requestedUrl) {
  const url = new URL(pageUrl);
  if (url.hostname === "consent.google.com" || (/^(.+\.)?google\.com$/.test(url.hostname) && url.pathname.startsWith("/sorry"))) {
    throw new Error("Local web search stopped at a CAPTCHA or consent page; no retry was attempted.");
  }
  if (url.protocol !== "https:" || url.hostname !== "www.google.com" || url.pathname !== "/search") {
    throw new Error("Local web search did not remain on the requested Google search page.");
  }
  if (requestedUrl && url.searchParams.get("q") !== new URL(requestedUrl).searchParams.get("q")) {
    throw new Error("Local web search navigated to a different query.");
  }
}

function assertSearchPage(document, pageUrl, requestedUrl) {
  const url = new URL(pageUrl);
  const title = compact(document.querySelector("title")?.textContent);
  const blocked = url.hostname === "consent.google.com" ||
    (/^(.+\.)?google\.com$/.test(url.hostname) && url.pathname.startsWith("/sorry")) ||
    document.querySelector('form[action*="/sorry"], form[action*="consent.google"], iframe[src*="/recaptcha/"], #captcha-form, .g-recaptcha') ||
    /^(?:before you continue to google|unusual traffic|sorry(?:[.! ]|$))/i.test(title);
  if (blocked) throw new Error("Local web search stopped at a CAPTCHA or consent page; no retry was attempted.");
  assertSearchUrl(pageUrl, requestedUrl);
}

/** Original parser first; fallback accepts headed external links or explicit Google result redirects. */
export function parseRenderedSearchHtml(html, pageUrl, native, requestedUrl) {
  if (typeof html !== "string" || html.length > LOCAL_WEB_SEARCH_LIMITS.htmlChars) {
    throw new Error("Local web search HTML exceeds its 5 MiB character budget.");
  }
  const document = native.parseHtml(html);
  assertSearchPage(document, pageUrl, requestedUrl);
  let original = [];
  try { original = native.parseGoogleSearchHtml(html, LOCAL_WEB_SEARCH_LIMITS.resultsPerQuery); } catch {}
  const normalize = (items) => items.flatMap((item) => {
    const url = externalResultUrl(item.url);
    const title = compact(item.title).slice(0, LOCAL_WEB_SEARCH_LIMITS.titleChars);
    return url && title ? [{ url, title, excerpts: compact(item.snippet) ? [compact(item.snippet).slice(0, LOCAL_WEB_SEARCH_LIMITS.excerptChars)] : [] }] : [];
  });
  const parsed = normalize(original);
  if (parsed.length) return { parser: "original-google-html", results: parsed };

  const fallback = [];
  const seen = new Set();
  for (const link of document.querySelectorAll("a[href]")) {
    const heading = link.querySelector("h3");
    const title = compact(heading?.textContent);
    const href = link.getAttribute("href");
    const directUrl = externalResultUrl(href);
    const url = directUrl ?? searchResultRedirectUrl(href);
    if (!heading || !title || !url || seen.has(url)) continue;
    seen.add(url);
    // A snippet may only come from an enclosing block containing this one result heading.
    let block = link;
    for (let parent = link.parentElement; parent && !["BODY", "HTML", "MAIN"].includes(parent.tagName); parent = parent.parentElement) {
      if (parent.querySelectorAll("h3").length !== 1) break;
      block = parent;
    }
    const text = compact(block.textContent);
    const titleAt = text.indexOf(title);
    const snippet = titleAt >= 0 ? text.slice(titleAt + title.length).trim() : "";
    fallback.push({
      url,
      title: title.slice(0, LOCAL_WEB_SEARCH_LIMITS.titleChars),
      excerpts: snippet ? [snippet.slice(0, LOCAL_WEB_SEARCH_LIMITS.excerptChars)] : [],
      ...(!directUrl ? { url_kind: "search-result-redirect", final_url_verified: false } : {}),
    });
    if (fallback.length >= LOCAL_WEB_SEARCH_LIMITS.resultsPerQuery) break;
  }
  return { parser: "rendered-heading-links", results: fallback };
}

function checkAbort(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Local web search aborted");
  error.name = "AbortError";
  throw error;
}

// Racing a permission/queue wait is safe: no browser operation is started by its late result.
async function waitAbortable(pending, signal, onAbort = () => {}) {
  if (!signal) return await pending;
  let listener;
  const aborted = new Promise((_, reject) => {
    listener = () => {
      Promise.resolve().then(onAbort).catch(() => {}).finally(() => {
        try { checkAbort(signal); } catch (error) { reject(error); }
      });
    };
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener("abort", listener); }
}

function resultEnvelope(native, sessionId, mode, results, parsers) {
  const built = native.buildWebSearchToolResult({ session_id: sessionId, results });
  const redirects = new Set(results.filter((result) => result.url_kind === "search-result-redirect").map((result) => result.url));
  // Native result rows retain added evidence fields; native citation sources need them copied.
  const sources = built.details.sources.map((source) => redirects.has(source.url)
    ? { ...source, url_kind: "search-result-redirect", final_url_verified: false }
    : source);
  const evidence = {
    retrieval: "browser-serp",
    evidence_scope: "search-result-snippets",
    requested_mode: mode ?? "basic",
    ...(mode === "advanced" ? { mode_note: "Local browser SERP retrieval; advanced deep retrieval is unavailable in this mode." } : {}),
    ...(redirects.size ? { redirect_note: "Some URLs are observed Google search-result redirects. Open a selected result in the browser to verify its final URL and page content before citing the destination." } : {}),
    parsers: [...parsers],
  };
  return { content: [{ type: "text", text: JSON.stringify({ ...built.result, ...evidence }) }], details: { ...built.details, sources, ...evidence } };
}

export function createLocalWebSearch({ log = () => {} } = {}) {
  const queues = new WeakMap();
  return {
    enabled: () => isDisabledAsideEndpoint(),
    async execute({ context, toolCallId, args, signal, native }) {
      if (native.engine !== "902") throw new Error("Local browser websearch is unsupported on daemon 824; this path requires daemon 902. No search was started.");
      if (!toolCallId) throw new Error("Local web search requires its native tool call ID.");
      const browser = context.browser;
      if (!browser || !context.hooks?.trigger) throw new Error("Local web search requires the current session browser and permission hooks.");
      const queries = [...new Set([args.objective, ...(args.search_queries ?? [])].map(compact).filter(Boolean))].slice(0, LOCAL_WEB_SEARCH_LIMITS.queries);
      if (!queries.length) throw new Error("Local web search requires a nonempty query.");
      const previous = queues.get(browser) ?? Promise.resolve();
      let release;
      const current = new Promise((resolve) => { release = resolve; });
      queues.set(browser, current);
      try { await waitAbortable(previous, signal); }
      catch (error) {
        // Keep cancelled waiters in the chain until the live predecessor releases ownership.
        previous.finally(() => { release(); if (queues.get(browser) === current) queues.delete(browser); });
        throw error;
      }
      const capture = () => {}; // Native tab lifecycle chatter is not search-result evidence.
      const cancelApproval = () => native.cancelPendingApproval(context, toolCallId);
      const onAbort = () => { Promise.resolve(cancelApproval()).catch(() => {}); };
      signal?.addEventListener("abort", onAbort);
      try {
        checkAbort(signal);
        return await native.withReplContext({ toolCallId, signal, appendText: capture }, async () => {
          const permissionContext = {
            ...context,
            suspend: (...values) => {
              checkAbort(signal);
              return waitAbortable(Promise.resolve(context.suspend(...values)), signal, cancelApproval);
            },
          };
          const permit = async (scope) => {
            checkAbort(signal);
            const permission = await native.checkPermission(permissionContext, toolCallId, scope);
            checkAbort(signal);
            if (permission.verdict !== "allow") throw new Error(`Permission denied: local web search ${scope.type} ${scope.action ?? "access"}`);
          };
          const accepted = [];
          const seen = new Set();
          const parsers = new Set();
          let envelope = resultEnvelope(native, context.session.id, args.mode, accepted, parsers);
          for (const query of queries) {
            checkAbort(signal);
            if (accepted.length >= LOCAL_WEB_SEARCH_LIMITS.resultsTotal) break;
            const url = native.buildGoogleSearchUrl(query, { limit: LOCAL_WEB_SEARCH_LIMITS.resultsPerQuery });
            await permit({ type: "network", url });
            await permit({ type: "browser", action: "modify", url });
            // Keep all native HookRegistry handlers, in addition to the explicit permission check.
            await waitAbortable(browser.ensureNetworkAccess(url), signal, cancelApproval);
            checkAbort(signal);
            const originalPage = browser.page ?? browser.tabs.find((page) => page.targetId === browser.state.activePage?.targetId) ?? null;
            const initialIds = new Set(browser.tabs.map((page) => page.targetId));
            let ownedPage;
            // Native abort wrappers race promises. Mask those races for each ownership transaction,
            // retain the tool ID, and observe the real signal at every settled operation boundary.
            // This may defer cancellation until the native command settles; it is not a new timeout.
            const atomic = (operation) => native.withReplContext({ toolCallId, appendText: capture }, operation);
            let parsed;
            try {
              ownedPage = await atomic(() => browser.openTab(url));
              const owned = browser.state.tabs.find((tab) => tab.targetId === ownedPage.targetId);
              if (initialIds.has(ownedPage.targetId) || owned?.ownership !== "owned") {
                throw new Error("Local web search did not acquire a new owned tab.");
              }
              checkAbort(signal);
              await atomic(() => ownedPage.waitForLoadState("stable", 5000));
              checkAbort(signal);
              const beforeUrl = ownedPage.url();
              assertSearchUrl(beforeUrl, url);
              await permit({ type: "browser", action: "read", url: beforeUrl });
              const html = await atomic(() => ownedPage.content());
              checkAbort(signal);
              const afterUrl = ownedPage.url();
              if (afterUrl !== beforeUrl) throw new Error("Local web search navigated while reading results.");
              parsed = parseRenderedSearchHtml(html, afterUrl, native, url);
            } finally {
              if (ownedPage && !initialIds.has(ownedPage.targetId)) {
                const owned = browser.state.tabs.find((tab) => tab.targetId === ownedPage.targetId);
                const restore = browser.page?.targetId === ownedPage.targetId || browser.state.activePage?.targetId === ownedPage.targetId;
                // Closing can select the last remaining tab. Restore only from that expected state;
                // preserve a user selection that changes while close is awaiting native completion.
                const expectedAfterClose = browser.tabs.filter((page) => page.targetId !== ownedPage.targetId).at(-1)?.targetId ?? null;
                try { if (owned?.ownership === "owned") await atomic(() => browser.closeTab(ownedPage)); }
                finally {
                  const active = browser.page?.targetId ?? browser.state.activePage?.targetId ?? null;
                  if (restore && [ownedPage.targetId, expectedAfterClose, null].includes(active)) {
                    if (originalPage && browser.tabs.some((page) => page.targetId === originalPage.targetId)) browser.page = originalPage;
                    else if (originalPage === null) browser.page = null;
                  }
                }
              }
            }
            checkAbort(signal);
            parsers.add(parsed.parser);
            for (const result of parsed.results) {
              if (seen.has(result.url) || accepted.length >= LOCAL_WEB_SEARCH_LIMITS.resultsTotal) continue;
              let candidate = result;
              let next = resultEnvelope(native, context.session.id, args.mode, [...accepted, candidate], parsers);
              if (JSON.stringify(next).length > LOCAL_WEB_SEARCH_LIMITS.outputChars) {
                candidate = { ...candidate, excerpts: [] };
                next = resultEnvelope(native, context.session.id, args.mode, [...accepted, candidate], parsers);
              }
              if (JSON.stringify(next).length > LOCAL_WEB_SEARCH_LIMITS.outputChars) continue;
              seen.add(candidate.url);
              accepted.push(candidate);
              envelope = next;
            }
          }
          checkAbort(signal);
          if (!accepted.length) envelope = resultEnvelope(native, context.session.id, args.mode, accepted, parsers);
          if (JSON.stringify(envelope).length > LOCAL_WEB_SEARCH_LIMITS.outputChars) throw new Error("Local web search metadata exceeds its output budget.");
          log(`[websearch] browser-serp results=${accepted.length} queries<=${queries.length}`);
          return envelope;
        });
      } finally {
        signal?.removeEventListener("abort", onAbort);
        release();
        if (queues.get(browser) === current) queues.delete(browser);
      }
    },
  };
}
