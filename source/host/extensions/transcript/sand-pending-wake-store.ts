import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SAND_PENDING_WAKE_FILE_NAME } from "../../durable-file-policy.js";
import type { PendingWakeKind, PendingWakeMarker } from "./async-task-union.js";
export const PENDING_WAKE_KINDS = ["cloud-agent", "subagent", "shell", "agent-message"] as const;
/** Payload-bearing markers (messages, stored results) survive prune for 14 days. */
export const PENDING_WAKE_PAYLOAD_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;
export interface QuietWakeOrigin {
  automation?: { id: string; name: string };
}
/** Durable agent-to-agent message payload (Phase B / AUDIT-5): the marker IS the message. */
export interface DurableAgentMessagePayload {
  from: { id: string; name: string };
  text: string;
  images?: readonly { url: string; alt?: string }[];
  priority?: boolean;
  /** The transcript entry was already appended before a crash — do not append again. */
  displayed?: boolean;
  /**
   * Group-turn wake: agentId is the GROUP id, the message already sits in the
   * room transcript, and redelivery re-runs the group turn (members respond)
   * instead of a 1:1 inbound wake.
   */
  group?: boolean;
}
/** Durable background completion payload (Phase B / P1-04): the result survives a restart. */
export interface DurableCompletionPayload {
  status: string;
  result?: string;
  detail?: string;
  outputPath?: string;
}
export interface DurablePendingWakeMarker extends PendingWakeMarker {
  quietOrigin?: QuietWakeOrigin;
  interruptedByRecreate?: boolean;
  agentMessage?: DurableAgentMessagePayload;
  completion?: DurableCompletionPayload;
  /** Original task prompt persisted at dispatch, so a lost child can be re-dispatched. */
  taskPrompt?: string;
}
export function coerceQuietOrigin(
  value: unknown,
): DurablePendingWakeMarker["quietOrigin"] | null {
  if (typeof value !== "object" || value == null) return null;
  const automation = (value as { automation?: unknown }).automation;
  if (typeof automation !== "object" || automation == null) return {};
  const a = automation as Record<string, unknown>;
  return typeof a.id === "string" &&
    a.id.length > 0 &&
    typeof a.name === "string"
    ? { automation: { id: a.id, name: a.name } }
    : {};
}
export function coerceMarker(entry: unknown): DurablePendingWakeMarker | null {
  if (typeof entry !== "object" || entry == null) return null;
  const e = entry as Record<string, unknown>;
  if (
    typeof e.agentId !== "string" ||
    !e.agentId ||
    typeof e.workId !== "string" ||
    !e.workId ||
    !PENDING_WAKE_KINDS.includes(e.kind as PendingWakeKind)
  )
    return null;
  const quietOrigin = coerceQuietOrigin(e.quietOrigin);
  return {
    agentId: e.agentId,
    kind: e.kind as PendingWakeKind,
    workId: e.workId,
    markedAtMs:
      typeof e.markedAtMs === "number" && Number.isFinite(e.markedAtMs)
        ? e.markedAtMs
        : 0,
    ...(quietOrigin != null ? { quietOrigin } : {}),
    ...(typeof e.title === "string" && e.title.length > 0
      ? { title: e.title }
      : {}),
    ...(typeof e.subagentType === "string" && e.subagentType.length > 0
      ? { subagentType: e.subagentType }
      : {}),
    ...(e.interruptedByRecreate === true
      ? { interruptedByRecreate: true }
      : {}),
    ...(coerceAgentMessage(e.agentMessage) == null
      ? {}
      : { agentMessage: coerceAgentMessage(e.agentMessage)! }),
    ...(coerceCompletion(e.completion) == null
      ? {}
      : { completion: coerceCompletion(e.completion)! }),
    ...(typeof e.taskPrompt === "string" && e.taskPrompt.length > 0
      ? { taskPrompt: e.taskPrompt }
      : {}),
  };
}
function coerceAgentMessage(value: unknown): DurableAgentMessagePayload | null {
  if (typeof value !== "object" || value == null) return null;
  const v = value as Record<string, unknown>;
  const from = v.from as Record<string, unknown> | undefined;
  if (typeof v.text !== "string" || v.text.length === 0) return null;
  if (typeof from?.id !== "string" || from.id.length === 0) return null;
  const images = Array.isArray(v.images)
    ? v.images.flatMap((image) => {
        const i = image as Record<string, unknown>;
        return typeof i?.url === "string" && i.url.length > 0
          ? [{ url: i.url, ...(typeof i.alt === "string" ? { alt: i.alt } : {}) }]
          : [];
      })
    : [];
  return {
    from: { id: from.id, name: typeof from.name === "string" ? from.name : "An agent" },
    text: v.text,
    ...(images.length === 0 ? {} : { images }),
    ...(v.priority === true ? { priority: true } : {}),
    ...(v.displayed === true ? { displayed: true } : {}),
    ...(v.group === true ? { group: true } : {}),
  };
}
function coerceCompletion(value: unknown): DurableCompletionPayload | null {
  if (typeof value !== "object" || value == null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.status !== "string" || v.status.length === 0) return null;
  return {
    status: v.status,
    ...(typeof v.result === "string" ? { result: v.result } : {}),
    ...(typeof v.detail === "string" ? { detail: v.detail } : {}),
    ...(typeof v.outputPath === "string" ? { outputPath: v.outputPath } : {}),
  };
}
export function coercePendingWakeMarkers(
  value: unknown,
): DurablePendingWakeMarker[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const marker = coerceMarker(entry);
        return marker == null ? [] : [marker];
      })
    : [];
}
export function parsePendingWakeFile(
  raw: string | null,
): DurablePendingWakeMarker[] {
  if (raw == null) return [];
  try {
    const value = JSON.parse(raw) as { pending?: unknown };
    return typeof value === "object" && value != null
      ? coercePendingWakeMarkers(value.pending)
      : [];
  } catch {
    return [];
  }
}
export function markerKeyMatches(
  marker: DurablePendingWakeMarker,
  agentId: string,
  kind: PendingWakeKind,
  workId: string,
): boolean {
  return (
    marker.agentId === agentId &&
    marker.kind === kind &&
    marker.workId === workId
  );
}
export function upsertPendingWakeMarker(
  existing: readonly DurablePendingWakeMarker[],
  marker: DurablePendingWakeMarker,
): DurablePendingWakeMarker[] {
  // Payload preservation invariant (external review r5): watch-arming callers
  // persist payload-LESS events for the same key (e.g. watchCloudAgent after a
  // restart), and a whole-marker replace silently destroyed a stored completion
  // or message. Payload fields only ever leave the store via clearOne.
  const previous = existing.find((entry) =>
    markerKeyMatches(entry, marker.agentId, marker.kind, marker.workId),
  );
  const merged: DurablePendingWakeMarker = {
    ...marker,
    ...(marker.agentMessage == null && previous?.agentMessage != null
      ? { agentMessage: previous.agentMessage }
      : {}),
    ...(marker.completion == null && previous?.completion != null
      ? { completion: previous.completion }
      : {}),
    ...(marker.taskPrompt == null && previous?.taskPrompt != null
      ? { taskPrompt: previous.taskPrompt }
      : {}),
  };
  return [
    ...existing.filter(
      (entry) =>
        !markerKeyMatches(entry, marker.agentId, marker.kind, marker.workId),
    ),
    merged,
  ];
}
export class SandPendingWakeStore {
  readonly filePath: string;
  constructor(rootDir: string) {
    this.filePath = join(rootDir, SAND_PENDING_WAKE_FILE_NAME);
  }
  markPending(marker: DurablePendingWakeMarker): boolean {
    try {
      this.write(upsertPendingWakeMarker(this.readPending(), marker));
      return true;
    } catch {
      return false;
    }
  }
  listPending(): DurablePendingWakeMarker[] {
    return this.readPending();
  }
  hasPending(agentId: string, kind: PendingWakeKind, workId: string): boolean {
    return this.readPending().some((entry) =>
      markerKeyMatches(entry, agentId, kind, workId),
    );
  }
  clearOne(agentId: string, kind: PendingWakeKind, workId: string): boolean {
    try {
      const existing = this.readPending(),
        remaining = existing.filter(
          (entry) => !markerKeyMatches(entry, agentId, kind, workId),
        );
      if (remaining.length === existing.length) return false;
      remaining.length === 0 ? this.deleteFile() : this.write(remaining);
      return true;
    } catch {
      return false;
    }
  }
  clearAgent(agentId: string): void {
    try {
      const existing = this.readPending(),
        remaining = existing.filter((entry) => entry.agentId !== agentId);
      if (remaining.length === existing.length) return;
      remaining.length === 0 ? this.deleteFile() : this.write(remaining);
    } catch {}
  }
  clearAll(): void {
    this.deleteFile();
  }
  pruneStale(maxAgeMs: number, nowMs = Date.now()): DurablePendingWakeMarker[] {
    try {
      // Kind-aware retention (external review r3 #3): an undelivered agent
      // message or an already-arrived completion RESULT is still valuable after
      // a weekend off — only watch-style wakes (a cloud agent / shell / child
      // that no longer exists after this long) age out at the caller's window;
      // payload-bearing markers get a much longer cap.
      const ageLimitFor = (entry: DurablePendingWakeMarker): number =>
        entry.kind === "agent-message" || entry.completion != null
          ? Math.max(maxAgeMs, PENDING_WAKE_PAYLOAD_MAX_AGE_MS)
          : maxAgeMs;
      const existing = this.readPending(),
        pruned = existing.filter(
          (entry) => nowMs - entry.markedAtMs > ageLimitFor(entry),
        );
      if (pruned.length === 0) return [];
      const remaining = existing.filter(
        (entry) => nowMs - entry.markedAtMs <= ageLimitFor(entry),
      );
      remaining.length === 0 ? this.deleteFile() : this.write(remaining);
      return pruned;
    } catch {
      return [];
    }
  }
  readPending(): DurablePendingWakeMarker[] {
    try {
      return parsePendingWakeFile(readFileSync(this.filePath, "utf8"));
    } catch {
      return [];
    }
  }
  write(pending: readonly DurablePendingWakeMarker[]): void {
    const part = `${this.filePath}.part`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {}
    writeFileSync(part, JSON.stringify({ version: 1, pending }));
    renameSync(part, this.filePath);
  }
  deleteFile(): void {
    try {
      rmSync(this.filePath, { force: true });
    } catch {}
  }
}
