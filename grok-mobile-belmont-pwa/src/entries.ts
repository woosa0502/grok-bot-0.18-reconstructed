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

export type RunPresentation = "idle" | "composing" | "working" | "post-response";

/**
 * Describes only what the mobile transcript can prove. A visible assistant reply may be followed by
 * provider or runtime work, so this deliberately says "post-response" rather than implying that the
 * turn has completed. Any newer user or activity entry returns the presentation to ordinary work.
 */
export function runPresentation(entries: MobileMessage[], isRunning: boolean, isComposing: boolean, responseObservedInRun = false): RunPresentation {
  if (isComposing) return "composing";
  if (!isRunning) return "idle";

  let latestUserIndex = -1;
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]?.role === "user") latestUserIndex = index;
  }
  const latest = entries.at(-1);
  if (responseObservedInRun && latestUserIndex >= 0 && latest?.type === "text" && latest.role === "assistant" && !latest.isStreaming && entries.length - 1 > latestUserIndex) {
    return "post-response";
  }
  return "working";
}

export interface RunObservation {
  scope: string;
  runKey: string;
  running: boolean;
  latestAssistantId: string | null;
  baselineAssistantId: string | null;
}

/** Tracks an assistant entry appearing after this screen observed the current run begin. */
export function nextRunObservation(previous: RunObservation | null, entries: MobileMessage[], scope: string, runKey: string, running: boolean): RunObservation {
  let latestAssistantId: string | null = null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "text" && entry.role === "assistant") { latestAssistantId = entry.id; break; }
  }
  if (previous == null || previous.scope !== scope) return { scope, runKey, running, latestAssistantId, baselineAssistantId: latestAssistantId };
  const beganNewRun = running && (!previous.running || previous.runKey !== runKey);
  return {
    scope,
    runKey,
    running,
    latestAssistantId,
    baselineAssistantId: beganNewRun ? previous.latestAssistantId : previous.baselineAssistantId,
  };
}
