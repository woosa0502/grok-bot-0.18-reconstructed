// Optional read-only observation of one explicitly selected Aside session.
// The recovered GET /sessions/:id contract has id/status, but no prompt nonce.
// Preserve that limitation instead of inventing a correlation from the newest chat.
export function createAsideStateReader(config, sessionId, fetchImpl = fetch) {
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535
      || typeof config.token !== "string" || !config.token || typeof sessionId !== "string" || !sessionId) {
    throw new Error("Explicit Aside config and session id required");
  }
  return async () => {
    const response = await fetchImpl(`http://127.0.0.1:${config.port}/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Aside session observation failed");
    const value = await response.json();
    if (value.id !== sessionId || typeof value.status !== "string") throw new Error("Aside session identity mismatch");
    return { taskId: value.id, status: value.status, source: "aside-session-get",
      agent: typeof value.agent === "string" ? value.agent : undefined,
      // Forward only an actual service nonce if a future contract provides one.
      clientNonce: typeof value.clientNonce === "string" ? value.clientNonce : undefined };
  };
}
