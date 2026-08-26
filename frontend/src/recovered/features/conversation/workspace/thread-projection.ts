import type { TranscriptThreadSummary } from "../cards/transcript-card/thread-summary-controller";
import { inferAttachmentKind, type ConversationTranscriptEntry, type DraftAttachment } from "./model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5290440-5291920
// Recovered from the shipped WGe/Dpt/KGe/N_n thread projection family.

export interface TranscriptThreadProjection {
  readonly visibleEntries: readonly ConversationTranscriptEntry[];
  readonly threadSummaries: ReadonlyMap<string, TranscriptThreadSummary>;
}

const EMPTY_SUMMARIES: ReadonlyMap<string, TranscriptThreadSummary> = new Map();
const THREAD_TITLE_LIMIT = 40;
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2410705-2411245 (Xun/o5e)
const THREAD_MARKDOWN_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/`+/gu, ""],
  [/!\[([^\]]*)\]\([^)]*\)/gu, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/gu, "$1"],
  [/\$\$((?:[^$\\]|\\[\s\S])+)\$\$/gu, "$1"],
  [/\\\(([\s\S]+?)\\\)/gu, "$1"],
  [/\\\[([\s\S]+?)\\\]/gu, "$1"],
  [/\\\$/gu, "$"],
  [/^\s{0,3}#{1,6}\s+/gmu, ""],
  [/^\s{0,3}>\s?/gmu, ""],
  [/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gmu, ""],
  [/\*\*([^*]+)\*\*/gu, "$1"],
  [/__([^_]+)__/gu, "$1"],
  [/~~([^~]+)~~/gu, "$1"],
  [/\*([^*\n]+)\*/gu, "$1"],
  [/(?<!\w)_([^_\n]+)_(?!\w)/gu, "$1"],
  [/\|/gu, " "],
];

function normalizedThreadText(text: string): string {
  return THREAD_MARKDOWN_REPLACEMENTS
    .reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text)
    .replace(/\s+/gu, " ")
    .trim();
}

function truncateThreadTitle(text: string): string {
  const normalized = normalizedThreadText(text);
  if (normalized.length === 0) return "Thread";
  if (normalized.length <= THREAD_TITLE_LIMIT) return normalized;
  const prefix = normalized
    .slice(0, THREAD_TITLE_LIMIT - 1)
    .replace(/[\s:;,.!?\u2013\u2014-]+$/u, "");
  return `${prefix}\u2026`;
}

function basename(value: string): string {
  let pathname = value;
  try {
    pathname = decodeURIComponent(new URL(value).pathname);
  } catch {
    // Local paths are already usable as pathname input.
  }
  const trimmed = pathname.replace(/\/+$/u, "");
  const candidate = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return candidate.length > 0 ? candidate : value;
}

function titleForAttachment(attachment: DraftAttachment): string {
  return inferAttachmentKind({
    mimeType: attachment.mimeType,
    fileName: attachment.name,
    urlOrPath: attachment.path,
  }) === "image"
    ? "Photo"
    : attachment.name.length > 0 ? attachment.name : basename(attachment.path);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

/**
 * Mirrors the shipped ide -> jvn breadcrumb-title path over the reconstructed
 * transcript model: normalized 40-character text, Photo, file name/basename,
 * or a link hostname.
 * @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4726680-4727500
 */
export function threadTitleForEntry(entry: ConversationTranscriptEntry | undefined): string {
  if (entry == null) return "Thread";
  if (entry.kind === "message") {
    if (normalizedThreadText(entry.text).length > 0) return truncateThreadTitle(entry.text);
    const attachment = entry.attachments?.[0];
    return attachment == null ? "Thread" : titleForAttachment(attachment);
  }
  if (entry.kind === "send-message") {
    switch (entry.message.type) {
      case "text": return truncateThreadTitle(entry.message.content);
      case "attachment": {
        const fileName = entry.message.fileName;
        if (isHttpUrl(entry.message.url) && (fileName == null || fileName.length === 0)) return hostname(entry.message.url);
        return inferAttachmentKind({ fileName, urlOrPath: entry.message.url }) === "image"
          ? "Photo"
          : fileName != null && fileName.length > 0 ? fileName : basename(entry.message.url);
      }
      case "widget": return truncateThreadTitle(entry.message.widget.prompt);
      case "cursor-agent": return truncateThreadTitle(entry.message.title?.trim().length
        ? `Cursor agent: ${entry.message.title.trim()}`
        : "Cursor cloud agent");
      case "secret-request": return truncateThreadTitle(entry.message.secretRequest.label);
      case "email-draft": return truncateThreadTitle(entry.message.draft.subject || entry.message.draft.body);
      case "slack-draft": return truncateThreadTitle(entry.message.draft.body);
      case "auto-review-approval": return truncateThreadTitle(`Approval required: ${entry.message.approval.summary}`);
      case "local-tool-permission": return truncateThreadTitle(`Permission required: ${String(entry.message.ask.target)}`);
      case "connector": return truncateThreadTitle(entry.message.variant === "connected"
        ? `${entry.message.connector} connected`
        : `Connect ${entry.message.connector}`);
      case "connectors": return truncateThreadTitle(entry.message.connectors.length > 0
        ? `Connect ${entry.message.connectors.join(", ")}`
        : "Connect tools");
      case "listener-connect": return truncateThreadTitle(`Connect ${entry.message.platform === "slack" ? "Slack" : "GitHub"}`);
    }
  }
  if (entry.kind === "permission-request") return truncateThreadTitle(entry.title);
  if (entry.kind === "local-tool-permission") return truncateThreadTitle(`Permission required: ${String(entry.ask.target)}`);
  if (entry.kind === "computer-handoff" && entry.threadTitle != null) return truncateThreadTitle(entry.threadTitle);
  return "Thread";
}

function isThreadableEntry(entry: ConversationTranscriptEntry): boolean {
  return entry.kind === "message"
    || entry.kind === "send-message"
    || entry.kind === "notice"
    || entry.kind === "computer-handoff"
    || entry.kind === "local-tool-permission"
    || entry.kind === "permission-request";
}

function replyTarget(entry: ConversationTranscriptEntry): string | null {
  if (!isThreadableEntry(entry)) return null;
  const target = Reflect.get(entry, "replyToId");
  return typeof target === "string" && target.length > 0 ? target : null;
}

export function isBranchedThreadEntry(entry: ConversationTranscriptEntry): boolean {
  return isThreadableEntry(entry) && Reflect.get(entry, "branched") === true;
}

export function resolveThreadRootId(
  entries: readonly ConversationTranscriptEntry[],
  entryId: string,
): string {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let rootId = entryId;
  const visited = new Set([entryId]);
  for (;;) {
    const entry = byId.get(rootId);
    if (entry == null || !isBranchedThreadEntry(entry)) break;
    const parentId = replyTarget(entry);
    if (parentId == null || !byId.has(parentId) || visited.has(parentId)) break;
    visited.add(parentId);
    rootId = parentId;
  }
  return rootId;
}

export function hasResolvedThreadRoot(
  entries: readonly ConversationTranscriptEntry[],
  entryId: string,
): boolean {
  const rootId = resolveThreadRootId(entries, entryId);
  const root = entries.find((entry) => entry.id === rootId);
  return root != null && !isBranchedThreadEntry(root);
}

export function threadEntryIds(
  entries: readonly ConversationTranscriptEntry[],
  rootId: string | null,
): ReadonlySet<string> | null {
  if (rootId == null) return null;
  const byId = new Map<string, ConversationTranscriptEntry>();
  const children = new Map<string, string[]>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    const parentId = replyTarget(entry);
    if (parentId == null) continue;
    const siblings = children.get(parentId);
    if (siblings == null) children.set(parentId, [entry.id]);
    else siblings.push(entry.id);
  }
  const result = new Set([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const parentId = pending.shift();
    if (parentId == null) continue;
    for (const childId of children.get(parentId) ?? []) {
      if (result.has(childId)) continue;
      const child = byId.get(childId);
      if (child == null || !isBranchedThreadEntry(child)) continue;
      result.add(childId);
      pending.push(childId);
    }
  }
  return result;
}

function resolvedRootId(
  entry: ConversationTranscriptEntry,
  byId: ReadonlyMap<string, ConversationTranscriptEntry>,
): string | null {
  let current = entry;
  const visited = new Set([entry.id]);
  for (;;) {
    const parentId = replyTarget(current);
    if (parentId == null) return null;
    const parent = byId.get(parentId);
    if (parent == null) return null;
    if (!isBranchedThreadEntry(parent)) return parentId;
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    current = parent;
  }
}

export function projectTranscriptThreads(
  entries: readonly ConversationTranscriptEntry[],
  options: { readonly mayHoldOlderHistory?: boolean } = {},
): TranscriptThreadProjection {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visibleEntries: ConversationTranscriptEntry[] = [];
  const replyCounts = new Map<string, number>();
  let foundBranch = false;

  for (const entry of entries) {
    if (!isBranchedThreadEntry(entry)) {
      visibleEntries.push(entry);
      continue;
    }
    const rootId = resolvedRootId(entry, byId);
    if (rootId == null) {
      if (options.mayHoldOlderHistory === true) {
        foundBranch = true;
        continue;
      }
      visibleEntries.push(entry);
      continue;
    }
    foundBranch = true;
    replyCounts.set(rootId, (replyCounts.get(rootId) ?? 0) + 1);
  }

  if (!foundBranch) return { visibleEntries: entries, threadSummaries: EMPTY_SUMMARIES };
  const threadSummaries = new Map<string, TranscriptThreadSummary>();
  for (const [rootId, count] of replyCounts) threadSummaries.set(rootId, { rootId, count });
  return { visibleEntries, threadSummaries };
}
