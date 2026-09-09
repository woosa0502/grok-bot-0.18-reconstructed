// Adapter for the INSTALLED @moss-dev/moss-core SessionIndex API (index.d.ts).
// This module deliberately never opens an authenticated session, fetches model
// weights, uploads documents, or discovers credentials by itself. The caller must
// supply a factory for a dedicated empty SessionIndex with its model preloaded.

export function createMossMemoryAdapter({ enabled = false, openSession, modelReady = false, modelId = "moss-minilm" } = {}) {
  const states = new Map();
  const active = new Set();
  let closed = false;
  let status = !enabled ? "disabled" : typeof openSession !== "function" || !modelReady ? "unavailable" : "configured";
  let reason = !enabled ? "Moss semantic retrieval is not enabled."
    : typeof openSession !== "function" ? "Supply an authenticated factory for a dedicated empty Moss SessionIndex."
      : !modelReady ? "Preload the actual Moss embedding model and explicitly set modelReady; automatic model download is disabled."
        : "An explicit model-ready session factory is configured; a successful query has not yet been observed.";

  function capabilities() {
    return { state: status, engine: "moss-core-session-index", model: modelId, ...(reason ? { reason } : {}) };
  }

  async function getState(accountRoot) {
    let state = states.get(accountRoot);
    if (!state) {
      state = { pending: null, session: null, documents: new Map(), tail: Promise.resolve() };
      states.set(accountRoot, state);
    }
    if (!state.session) {
      state.pending ??= Promise.resolve().then(async () => {
        const session = await openSession({ accountRoot, modelId });
        // Ownership transfers only after validation. Do not even close an
        // existing index accidentally returned by a misconfigured factory.
        if (session?.modelId !== modelId || modelId === "custom") throw new Error("Moss session must use the declared built-in embedding model");
        if (session.docCount !== 0) throw new Error("Moss adapter requires a dedicated empty session, never an existing user index");
        for (const method of ["addDocumentsText", "deleteDocuments", "queryText", "close"]) if (typeof session[method] !== "function") throw new Error(`Moss SessionIndex missing ${method}`);
        state.session = session;
        return session;
      }).finally(() => { state.pending = null; });
      await state.pending;
    }
    return state;
  }

  async function runRank({ accountRoot, query, chunks, maxResults }) {
    if (!enabled || !modelReady || typeof openSession !== "function") throw new Error(reason);
    let state;
    try { state = await getState(accountRoot); }
    catch (error) {
      status = "unavailable";
      reason = "Moss session could not be initialized; the caller can use lexical fallback.";
      throw error;
    }
    // One native session per account. Serialize updates and queries so concurrent
    // date/scope filters cannot change the candidate set during another search.
    const run = state.tail.then(async () => {
      const documents = new Map(chunks.map((chunk) => [chunk.id, chunk.text]));
      const remove = [...state.documents.keys()].filter((id) => !documents.has(id));
      if (remove.length) {
        state.session.deleteDocuments(remove);
        for (const id of remove) state.documents.delete(id);
      }
      const add = [...documents].filter(([id, text]) => state.documents.get(id) !== text).map(([id, text]) => ({ id, text }));
      if (add.length) {
        state.session.addDocumentsText(add, { upsert: true });
        for (const { id, text } of add) state.documents.set(id, text);
      }
      const result = state.session.queryText(query, maxResults);
      if (!Array.isArray(result?.docs)) throw new Error("Moss queryText did not return SearchResult.docs");
      status = "available";
      reason = undefined;
      return result.docs.filter((doc) => documents.has(doc.id) && Number.isFinite(doc.score)).map(({ id, score }) => ({ id, score }));
    });
    state.tail = run.catch(() => {});
    try { return await run; }
    catch (error) {
      status = "unavailable";
      reason = "Moss session/model query failed; the caller can use lexical fallback.";
      throw error;
    }
  }

  function rank(args) {
    if (closed) return Promise.reject(new Error("Moss adapter is closed"));
    const run = runRank(args);
    active.add(run);
    return run.finally(() => active.delete(run));
  }

  async function close() {
    if (closed) return;
    closed = true;
    await Promise.allSettled([...active]);
    await Promise.all([...states.values()].map(async (state) => {
      await state.pending?.catch(() => {});
      await state.tail;
      await state.session?.close();
    }));
    states.clear();
    status = "disabled";
    reason = "Moss adapter is closed.";
  }

  return { capabilities, rank, close };
}
