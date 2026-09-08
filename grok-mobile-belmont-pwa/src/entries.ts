import type { MobileMessage } from "./types";

const OPTIMISTIC_MATCH_WINDOW_MS = 5 * 60_000;

/**
 * Dedupes transcript entries by id and retires optimistic (locally echoed) user bubbles once the
 * desktop's confirmed copy is present: matched by clientNonce, or — for older desktops that do not
 * echo the nonce — by identical text from the same side within five minutes.
 */
export function reconcileEntries(entries: MobileMessage[]): MobileMessage[] {
  const unique = [...new Map(entries.map((entry) => [entry.id, entry])).values()];
  const confirmed = unique.filter((entry) => entry.type === "text" && entry.role === "user" && !entry.optimistic);
  const settled = unique.filter((entry) => {
    if (entry.type !== "text" || !entry.optimistic) return true;
    return !confirmed.some((other) => other.type === "text" && (
      (entry.clientNonce && other.clientNonce === entry.clientNonce)
      || ((!entry.clientNonce || !other.clientNonce) && entry.replyToId === other.replyToId && other.content === entry.content && Math.abs(other.timestampMs - entry.timestampMs) <= OPTIMISTIC_MATCH_WINDOW_MS)
    ));
  });
  return settled.sort((left, right) => left.timestampMs - right.timestampMs);
}
