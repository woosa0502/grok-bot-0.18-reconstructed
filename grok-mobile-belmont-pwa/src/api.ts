import type {
  AttachmentPreview,
  AttachmentRef,
  Bot,
  BotTemplate,
  MemoryRecord,
  ModelSelection,
  ModelOption,
  TemplateImportResult,
  ComputerState,
  CodexUsage,
  FileSystemListing,
  FileSystemPreview,
  FileSystemScope,
  MediaSearchResult,
  MessageSearchResult,
  MobileMessage,
  MobileSettings,
  PendingAttachment,
  RoutineAutomation,
  RoutedTool,
  SkillCatalogItem,
} from "./types";
import { clearSendIntentJournal } from "./send-intent-journal";

export class MobileApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const value = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new MobileApiError(value.error ?? `요청에 실패했습니다. (${response.status})`, response.status);
  return value;
}

export const api = {
  session: () => request<{ paired: boolean; pairingRequired: boolean }>("/api/session"),
  pair: async (code: string) => {
    const result = await request<{ paired: boolean }>("/api/pair", { method: "POST", body: JSON.stringify({ code }) });
    if (result.paired) await clearSendIntentJournal();
    return result;
  },
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST", body: "{}" }),
  bots: () => request<{ bots: Bot[]; managerId: string | null }>("/api/bots"),
  createBot: (input: { name: string; description: string; shape: string; color: string }) => request<unknown>("/api/bots", { method: "POST", body: JSON.stringify({ ...input, clientNonce: crypto.randomUUID() }) }),
  messages: (botId: string, beforeSeq?: number | null, signal?: AbortSignal) => request<{ entries: MobileMessage[]; nextBeforeSeq: number | null }>(`/api/bots/${encodeURIComponent(botId)}/messages?limit=60${beforeSeq == null ? "" : `&beforeSeq=${beforeSeq}`}`, { signal }),
  send: (botId: string, text: string, attachments: PendingAttachment[], signal?: AbortSignal, replyToId?: string, clientNonce: string = crypto.randomUUID()) => request<{ accepted: boolean; clientNonce: string }>(`/api/bots/${encodeURIComponent(botId)}/messages`, {
    method: "POST",
    signal,
    body: JSON.stringify({ text, clientNonce, attachments: attachments.map(({ name, bytesBase64 }) => ({ name, bytesBase64 })), ...(replyToId ? { replyToId, isFork: true } : {}) }),
  }),
  thread: (botId: string, rootId: string, signal?: AbortSignal) => request<{ entries: MobileMessage[] }>(`/api/bots/${encodeURIComponent(botId)}/threads/${encodeURIComponent(rootId)}`, { signal }),
  stop: (botId: string, target: { expectedStopGuard?: string; expectedClientNonce?: string }) => request<{ ok: boolean; interrupted?: boolean; stale?: boolean }>(`/api/bots/${encodeURIComponent(botId)}/stop`, { method: "POST", body: JSON.stringify(target) }),
  react: (botId: string, entryId: string, emoji: string) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/messages/${encodeURIComponent(entryId)}/reaction`, { method: "POST", body: JSON.stringify({ emoji }) }),
  answerWidget: (botId: string, entryId: string, value: string) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/widgets/${encodeURIComponent(entryId)}`, { method: "POST", body: JSON.stringify({ value }) }),
  resolveApproval: (botId: string, entryId: string, input: { kind: "approval" | "local-permission"; requestId: string; resolution: string }) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/approvals/${encodeURIComponent(entryId)}`, { method: "POST", body: JSON.stringify(input) }),
  hideBot: (botId: string, hidden: boolean) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/hidden`, { method: "POST", body: JSON.stringify({ hidden }) }),
  markRead: (botId: string) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/read`, { method: "POST", body: JSON.stringify({}) }),
  updateBot: (botId: string, profile: { name: string; description: string }) => request<{ bot: Bot | null }>(`/api/bots/${encodeURIComponent(botId)}/profile`, { method: "POST", body: JSON.stringify({ profile }) }),
  setBotNotifications: (botId: string, enabled: boolean) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/notifications`, { method: "POST", body: JSON.stringify({ enabled }) }),
  createGroup: (input: { name: string; description: string; memberAgentIds: string[] }) => request<{ bot: Bot | null }>("/api/groups", { method: "POST", body: JSON.stringify(input) }),
  setGroupMembers: (botId: string, memberAgentIds: string[]) => request<{ bot: Bot | null }>(`/api/bots/${encodeURIComponent(botId)}/members`, { method: "POST", body: JSON.stringify({ memberAgentIds }) }),
  searchMessages: (query: string) => request<{ results: MessageSearchResult[] }>(`/api/search/messages?query=${encodeURIComponent(query)}`),
  searchMedia: (query: string) => request<{ results: MediaSearchResult[] }>(`/api/search/media?query=${encodeURIComponent(query)}`),
  attachmentPreview: (attachment: AttachmentRef) => request<AttachmentPreview>("/api/attachments/preview", { method: "POST", body: JSON.stringify(attachment) }),
  attachmentContentUrl: (attachment: AttachmentRef) => `/api/attachments/content?agentId=${encodeURIComponent(attachment.agentId)}&path=${encodeURIComponent(attachment.path)}&name=${encodeURIComponent(attachment.name)}`,
  shareAttachment: (attachment: AttachmentRef, targetAgentId: string, message = "") => request<{ accepted: boolean }>("/api/attachments/share", { method: "POST", body: JSON.stringify({ ...attachment, targetAgentId, message }) }),
  computer: (botId: string) => request<ComputerState>(`/api/bots/${encodeURIComponent(botId)}/computer`),
  ensureComputer: (botId: string) => request<ComputerState>(`/api/bots/${encodeURIComponent(botId)}/computer/ensure`, { method: "POST", body: "{}" }),
  resetComputer: (botId: string) => request<ComputerState>(`/api/bots/${encodeURIComponent(botId)}/computer/reset`, { method: "POST", body: "{}" }),
  computerWindow: (botId: string, windowIndex: number) => request<ComputerState>(`/api/bots/${encodeURIComponent(botId)}/computer?windowIndex=${windowIndex}`),
  routines: (botId: string) => request<{ routines: RoutineAutomation[] }>(`/api/bots/${encodeURIComponent(botId)}/routines`),
  createRoutine: (botId: string, spec: { name: string; prompt: string; trigger: Record<string, unknown>; isEnabled: boolean }) => request<{ routines: RoutineAutomation[] }>(`/api/bots/${encodeURIComponent(botId)}/routines`, { method: "POST", body: JSON.stringify({ spec }) }),
  updateRoutine: (botId: string, routineId: string, spec: { name: string; prompt: string; trigger: Record<string, unknown>; isEnabled: boolean }) => request<{ routines: RoutineAutomation[] }>(`/api/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}`, { method: "PATCH", body: JSON.stringify({ spec }) }),
  setRoutineEnabled: (botId: string, routineId: string, isEnabled: boolean) => request<{ routines: RoutineAutomation[] }>(`/api/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}/enabled`, { method: "POST", body: JSON.stringify({ isEnabled }) }),
  runRoutine: (botId: string, routineId: string) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}/run`, { method: "POST", body: "{}" }),
  deleteRoutine: (botId: string, routineId: string) => request<{ routines: RoutineAutomation[] }>(`/api/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(routineId)}`, { method: "DELETE", body: "{}" }),
  skills: (query = "") => request<{ skills: SkillCatalogItem[] }>(`/api/skills?query=${encodeURIComponent(query)}`),
  tools: () => request<{ tools: RoutedTool[] }>("/api/tools"),
  settings: () => request<MobileSettings>("/api/settings"),
  codexUsage: () => request<CodexUsage>("/api/codex/usage"),
  fileSystemList: (scope: FileSystemScope, path = "", offset = 0) => request<FileSystemListing>(`/api/filesystem/list?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}&offset=${offset}`),
  fileSystemPreview: (scope: FileSystemScope, path: string) => request<FileSystemPreview>(`/api/filesystem/preview?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`),
  fileSystemContentUrl: (scope: FileSystemScope, path: string) => `/api/filesystem/content?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`,
  botTemplate: (botId: string) => request<{ template: BotTemplate }>(`/api/bots/${encodeURIComponent(botId)}/template`),
  importTemplate: (body: { url?: string; template?: BotTemplate | string; name?: string }) => request<TemplateImportResult>("/api/templates/import", { method: "POST", body: JSON.stringify(body) }),
  sendForm: (botId: string, fields: Record<string, string>, note?: string) => request<{ ok: boolean; prompt: string }>(`/api/bots/${encodeURIComponent(botId)}/form`, { method: "POST", body: JSON.stringify({ fields, note }) }),
  memories: (botId: string) => request<{ memories: MemoryRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/memories`),
  addMemory: (botId: string, content: string, tier: "profile" | "log" = "profile") => request<{ memory: MemoryRecord | null }>(`/api/bots/${encodeURIComponent(botId)}/memories`, { method: "POST", body: JSON.stringify({ content, tier }) }),
  deleteMemory: (botId: string, memoryId: string) => request<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" }),
  botModel: (botId: string) => request<{ id: string; selection: ModelSelection | null; defaultSelection: ModelSelection | null; models: ModelOption[] }>(`/api/bots/${encodeURIComponent(botId)}/model`),
  setBotModel: (botId: string, selection: { modelId: string; effort?: string; maxMode?: boolean } | null) => request<{ id: string; selection: ModelSelection | null; models: ModelOption[] }>(`/api/bots/${encodeURIComponent(botId)}/model`, { method: "POST", body: JSON.stringify({ selection }) }),
  feedback: (body: { kind: "feedback" | "rating" | "report"; category?: string; detail?: string; rating?: number; botId?: string; entryId?: string }) => request<{ ok: boolean }>("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
  setSetting: <K extends keyof MobileSettings>(key: K, value: MobileSettings[K]) => request<MobileSettings>("/api/settings", { method: "POST", body: JSON.stringify({ key, value }) }),
};

export function subscribeToEvents(onEvent: () => void, onDown: () => void): () => void {
  let source: EventSource;
  try {
    source = new EventSource(new URL("/api/events", window.location.href).href);
  } catch {
    onDown();
    return () => undefined;
  }
  source.onmessage = onEvent;
  // EventSource reconnects itself, but events missed while disconnected need a full resync.
  source.onopen = onEvent;
  source.onerror = onDown;
  return () => source.close();
}

export async function fileToAttachment(file: File): Promise<PendingAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return { id: crypto.randomUUID(), name: file.name, size: file.size, bytesBase64: btoa(binary) };
}
