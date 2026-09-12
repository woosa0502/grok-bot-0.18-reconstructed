// Local, read-only memory retrieval. FTS5 is the deterministic offline fallback;
// semantic retrieval is used only when a caller explicitly supplies a real backend.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const CJK_CLASS = "\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const CJK_RUNS = new RegExp(`[${CJK_CLASS}]+`, "gu");
const CJK_GAP = new RegExp(`([${CJK_CLASS}])[ \\t]+(?=[${CJK_CLASS}])`, "gu");
const WORDS = /[\p{L}\p{N}]+/gu;
const DEFAULT_CHUNK_CHARS = 1024; // Original Aside's target is 256 tokens * 4 characters.
const RRF_K = 60; // Rank fusion, not an embedding score or a claim of semantic similarity.

const normalize = (text) => String(text).normalize("NFKC").toLowerCase();
const compactCjk = (text) => normalize(text).replace(CJK_GAP, "$1");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const unquote = (value) => value.replace(/^("|')([\s\S]*)\1$/, "$2");
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

export function cjkBigrams(text) {
  const out = [];
  for (const run of compactCjk(text).match(CJK_RUNS) ?? []) {
    const chars = [...run];
    if (chars.length === 1) out.push(run);
    for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

export function parseFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end < 0) return { meta: {}, body: normalized, bodyOffset: 0 };
  const meta = {};
  let listKey;
  for (const line of lines.slice(1, end)) {
    const pair = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (pair) {
      listKey = pair[2].trim() ? undefined : pair[1];
      meta[pair[1]] = unquote(pair[2].trim().replace(/^\[|\]$/g, ""));
    } else if (listKey && /^\s+-\s+/.test(line)) {
      meta[listKey] += ` ${unquote(line.replace(/^\s+-\s+/, "").trim())}`;
    } else if (line.trim() && !/^\s/.test(line)) {
      listKey = undefined;
    }
  }
  return { meta, body: lines.slice(end + 1).join("\n"), bodyOffset: end + 1 };
}

function day(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
  if (!match) return "";
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : "";
}

export function isContextAwarenessMemoryPath(file) {
  return file.replaceAll("\\", "/").includes("episodic/context-awareness-");
}

/** Chunks retain exact source line locations, including frontmatter and blank lines. */
export function chunkMemoryFile(file, text, { maxChunkChars = DEFAULT_CHUNK_CHARS } = {}) {
  if (!Number.isInteger(maxChunkChars) || maxChunkChars < 64) throw new TypeError("maxChunkChars must be an integer >= 64");
  const { meta, body, bodyOffset } = parseFrontmatter(text);
  const title = meta.title || body.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, ".md");
  const aliases = meta.aliases ?? "";
  const pageDay = path.basename(file).match(/(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?:[^\d]|$)/)?.[1];
  const date = day(meta.windowFrom ?? meta.window_from) || day(pageDay) || day(meta.date) || day(meta.updated_at ?? meta.updated);
  const headings = [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const chunks = [];
  let offset = 0;
  let sourceLine = bodyOffset + 1;
  while (offset < body.length) {
    let end = Math.min(offset + maxChunkChars, body.length);
    if (end < body.length) {
      const window = body.slice(offset, end);
      // Favor a section/paragraph boundary, then a complete line. Very long lines
      // split by character count; their chunks still point to the same source line.
      const boundaries = [...window.matchAll(/\n(?=#{1,6}\s)|\n\n+/g)];
      const preferred = boundaries.findLast((match) => match.index >= maxChunkChars / 2);
      const newline = window.lastIndexOf("\n");
      const whitespace = [...window.matchAll(/\s+/g)].at(-1);
      if (preferred) end = offset + preferred.index + 1;
      else if (newline >= maxChunkChars / 2) end = offset + newline + 1;
      else if (whitespace?.index >= maxChunkChars / 2) end = offset + whitespace.index + whitespace[0].length;
    }
    const raw = body.slice(offset, end);
    const leading = raw.length - raw.trimStart().length;
    const chunkBody = raw.trim();
    const start = offset + leading;
    const line = sourceLine + (raw.slice(0, leading).match(/\n/g)?.length ?? 0);
    if (chunkBody) {
      const stack = [];
      for (const heading of headings) {
        if (heading.index > start) break;
        stack.length = heading[1].length - 1;
        stack[heading[1].length - 1] = heading[2];
      }
      const headingText = stack.filter(Boolean).join(" > ");
      const id = hash(`${file}\0${start}\0${chunkBody}`);
      chunks.push({ id, path: file, line, title, aliases, headings: headingText, date, body: chunkBody,
        text: [title, headingText, aliases, chunkBody].filter(Boolean).join("\n") });
    }
    sourceLine += raw.match(/\n/g)?.length ?? 0;
    offset = end;
  }
  return chunks;
}

function listMarkdown(walkRoots, allowedRoots, log) {
  const out = [];
  const visited = new Set();
  const files = new Set();
  function walk(dir) {
    let canonical;
    let entries;
    try {
      canonical = realpathSync(dir);
      if (!allowedRoots.some((root) => inside(root, canonical)) || visited.has(canonical)) return;
      visited.add(canonical);
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"));
    } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      try {
        const target = realpathSync(file);
        if (!allowedRoots.some((root) => inside(root, target))) continue;
        const stat = statSync(file);
        if (stat.isDirectory()) walk(file);
        else if (stat.isFile() && entry.name.endsWith(".md") && !files.has(target)) {
          files.add(target);
          out.push({ file, target, stat });
        }
      } catch { log("[memory-search] skipped an unreadable or concurrently removed entry"); }
    }
  }
  for (const r of walkRoots) walk(r);
  return out;
}

/** Natural-language OR across words; every bigram within one CJK word must match. */
export function buildFtsQuery(query) {
  const terms = new Set();
  for (const word of normalize(query).match(WORDS) ?? []) {
    const runs = word.match(CJK_RUNS) ?? [];
    for (const run of runs) {
      const grams = [...new Set(cjkBigrams(run))];
      const column = [...run].length === 1 ? "cjkchars" : "ngrams";
      terms.add(`(${grams.map((gram) => `${column}:"${gram}"`).join(" AND ")})`);
    }
    for (const latin of word.replace(CJK_RUNS, " ").match(WORDS) ?? []) terms.add(`"${latin}"*`);
  }
  return [...terms].join(" OR ");
}

function resultFor(chunk, query, score, retrieval) {
  const needles = [...new Set(compactCjk(query).match(WORDS) ?? [])];
  const lines = chunk.body.split("\n");
  const match = lines.findIndex((line) => needles.some((needle) => compactCjk(line).includes(needle)));
  const index = match < 0 ? 0 : match;
  const excerpt = lines.slice(index).join(" ").replace(/\s+/g, " ").trim();
  return {
    path: chunk.path, line: chunk.line + index, title: chunk.title,
    ...(chunk.date ? { date: chunk.date } : {}),
    excerpt: excerpt.length > 400 ? `${excerpt.slice(0, 397)}...` : excerpt,
    chunkId: chunk.id, score, retrieval,
  };
}

export function createMemorySearch({ log = () => {}, semanticAdapter = null, allowedRoots = [], maxChunkChars = DEFAULT_CHUNK_CHARS } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE VIRTUAL TABLE mem USING fts5(root UNINDEXED, id UNINDEXED, path UNINDEXED, title, aliases, headings, body, ngrams, cjkchars, date UNINDEXED, context UNINDEXED, tokenize='unicode61 remove_diacritics 2')`);
  const roots = new Map();
  const activeSearches = new Set();
  const insert = db.prepare("INSERT INTO mem(root, id, path, title, aliases, headings, body, ngrams, cjkchars, date, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const remove = db.prepare("DELETE FROM mem WHERE root = ? AND path = ?");
  let closed = false;
  let semanticError;

  function rootPath(accountRoot) {
    if (typeof accountRoot !== "string" || !accountRoot.trim()) throw new TypeError("accountRoot is required");
    const resolved = path.resolve(accountRoot);
    try { return realpathSync(resolved); } catch { return resolved; }
  }

  function refresh(accountRoot, sitesRoot) {
    if (closed) throw new Error("memory search is closed");
    const root = rootPath(accountRoot);
    const memoryDir = path.join(root, "memory");
    const real = (dir) => { try { return realpathSync(dir); } catch { return path.resolve(dir); } };
    // A per-session sites overlay replaces the operational site knowledge FOR THAT SESSION ONLY: the overlay
    // is walked and allowed, while the global KNOWLEDGE_DIR sites (reached through the account's memory/sites
    // symlink) fall outside the allowed set and are excluded. It is indexed under a distinct key so an eval
    // session's candidate page never mixes into — or leaks out of — the shared per-account view.
    const sites = sitesRoot ? real(sitesRoot) : null;
    const allowed = (sites ? [memoryDir, sites] : [memoryDir, ...allowedRoots]).map(real);
    const walkRoots = sites ? [memoryDir, sites] : [memoryDir];
    const key = sites ? `${root} ${sites}` : root;
    const indexed = roots.get(key) ?? new Map();
    roots.set(key, indexed);
    const files = listMarkdown(walkRoots, allowed, log);
    const found = new Set(files.map(({ file }) => file));
    for (const file of indexed.keys()) if (!found.has(file)) { remove.run(key, file); indexed.delete(file); }
    let changed = 0;
    for (const { file, target, stat } of files) {
      const fingerprint = [target, stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino].join(":");
      if (indexed.get(file)?.fingerprint === fingerprint) continue;
      let chunks;
      try { chunks = chunkMemoryFile(file, readFileSync(file, "utf8"), { maxChunkChars }); }
      catch { remove.run(key, file); indexed.delete(file); continue; }
      remove.run(key, file);
      for (const chunk of chunks) {
        const grams = cjkBigrams(chunk.text).join(" ");
        const chars = (compactCjk(chunk.text).match(CJK_RUNS) ?? []).flatMap((run) => [...run]).join(" ");
        const context = isContextAwarenessMemoryPath(file) || isContextAwarenessMemoryPath(target) ? 1 : 0;
        chunk.context = Boolean(context);
        insert.run(key, chunk.id, file, normalize(chunk.title), normalize(chunk.aliases), normalize(chunk.headings), normalize(chunk.body), grams, chars, chunk.date, context);
      }
      indexed.set(file, { fingerprint, chunks });
      changed += 1;
    }
    if (changed) log(`[memory-search] indexed ${changed} file(s)${sites ? " (session sites overlay)" : ""}, read-only chunk index`);
    return key;
  }

  function capabilities() {
    const semantic = semanticAdapter?.capabilities?.() ?? { state: "disabled", engine: null, model: null, reason: "No semantic adapter configured; offline lexical retrieval only." };
    return {
      mode: semantic.state === "available" && !semanticError ? "hybrid" : "lexical",
      lexical: { engine: "sqlite-fts5", chunks: true, cjk: true },
      semantic: semanticError ? { ...semantic, state: "unavailable", reason: semanticError } : semantic,
    };
  }

  /** Aside's maxResults is PER QUERY; separate chunks in one file are independent hits. */
  async function runSearchMany({ accountRoot, sitesRoot, queries, maxResults = 5, range, excludeContextAwareness = false }) {
    if (!Array.isArray(queries) || queries.some((query) => typeof query !== "string")) throw new TypeError("queries must be an array of strings");
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new RangeError("maxResults must be between 1 and 10 per query");
    if (sitesRoot !== undefined && (typeof sitesRoot !== "string" || !sitesRoot.trim())) throw new TypeError("sitesRoot, when given, must be a non-empty string");
    const from = range?.from === undefined ? "" : day(range.from);
    const to = range?.to === undefined ? "" : day(range.to);
    if ((range?.from !== undefined && !from) || (range?.to !== undefined && !to) || (from && to && from > to)) throw new RangeError("range requires valid inclusive dates with from <= to");
    const root = refresh(accountRoot, sitesRoot);
    const chunks = [...roots.get(root).values()].flatMap((entry) => entry.chunks).filter((chunk) =>
      (!excludeContextAwareness || !chunk.context) && (!chunk.date || ((!from || chunk.date >= from) && (!to || chunk.date <= to))));
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const seen = new Map();
    // Filters apply before either backend's top-K, so excluded pages cannot crowd
    // eligible matches out of the candidate window. Undated pages remain eligible.
    const lexical = db.prepare(`SELECT id, bm25(mem, 0, 0, 0, 6, 4, 2, 1, 1.5, 0, 0, 0) AS score FROM mem WHERE root = ? AND mem MATCH ? AND (? = 0 OR context = 0) AND (date = '' OR ((? = '' OR date >= ?) AND (? = '' OR date <= ?))) ORDER BY score, path, id LIMIT ?`);
    for (const query of [...new Set(queries.map((query) => query.trim()).filter(Boolean))]) {
      const expr = buildFtsQuery(query);
      const lexicalRows = expr ? lexical.all(root, expr, excludeContextAwareness ? 1 : 0, from, from, to, to, maxResults * 4) : [];
      const rankings = [{ name: "lexical", rows: lexicalRows }];
      if (chunks.length && semanticAdapter && semanticAdapter.capabilities().state !== "disabled") {
        try {
          const rows = await semanticAdapter.rank({ accountRoot: root, query, chunks, maxResults: maxResults * 4 });
          if (!Array.isArray(rows)) throw new TypeError("semantic adapter returned invalid results");
          rankings.push({ name: "semantic", rows: rows.filter((row) => byId.has(row.id) && Number.isFinite(row.score)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) });
          semanticError = undefined;
        } catch {
          // Do not print backend error strings: they can contain credentials or query text.
          semanticError = "Semantic backend failed; deterministic lexical fallback is active.";
          log("[memory-search] semantic backend unavailable; using lexical fallback");
        }
      }
      const fused = new Map();
      for (const { name, rows } of rankings) {
        const unique = new Set();
        let rank = 0;
        for (const row of rows) {
          if (!byId.has(row.id) || unique.has(row.id)) continue;
          unique.add(row.id);
          const hit = fused.get(row.id) ?? { id: row.id, score: 0, retrieval: [] };
          hit.score += 1 / (RRF_K + ++rank);
          hit.retrieval.push(name);
          fused.set(row.id, hit);
        }
      }
      for (const hit of [...fused.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, maxResults)) {
        if (!seen.has(hit.id) || seen.get(hit.id).score < hit.score) seen.set(hit.id, resultFor(byId.get(hit.id), query, hit.score, hit.retrieval));
      }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  }

  function searchMany(args) {
    if (closed) return Promise.reject(new Error("memory search is closed"));
    const run = runSearchMany(args);
    activeSearches.add(run);
    return run.finally(() => activeSearches.delete(run));
  }

  async function close() {
    if (closed) return;
    closed = true;
    await Promise.allSettled([...activeSearches]);
    db.close();
    roots.clear();
    await semanticAdapter?.close?.();
  }

  return { searchMany, refresh, capabilities, close, size: () => [...roots.values()].reduce((count, files) => count + files.size, 0) };
}
