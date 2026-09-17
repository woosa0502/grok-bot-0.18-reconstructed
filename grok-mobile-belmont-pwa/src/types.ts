export type BabyGrokShape = "blob" | "pebble" | "bean" | "egg" | "squircle" | "tablet" | "capsule" | "cylinder" | "hex" | "gem" | "crystal" | "wedge" | "shield" | "dome" | "arch" | "cloud" | "teardrop" | "leaf";
export type BabyGrokColor = "black" | "brown" | "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "violet" | "magenta" | "gray";
export type BabyGrokState =
  | "sleeping" | "waking" | "idle" | "listening" | "thinking" | "searching" | "working" | "loading"
  | "excited" | "surprised" | "suspicious" | "angry" | "drowsy" | "happy" | "curious" | "confused"
  | "bored" | "proud" | "shy" | "sad" | "laughing" | "scared" | "playful" | "celebrate"
  | "orbit" | "radar" | "progress" | "spawning" | "humming" | "dictating" | "writing" | "sending"
  | "receiving" | "uploading" | "notifying" | "alerting" | "dragging" | "bouncing" | "powering-down";

export interface Bot {
  id: string;
  name: string;
  title: string;
  description: string;
  avatar: { shape: BabyGrokShape; color: BabyGrokColor };
  isManager: boolean;
  isPinned: boolean;
  isRunning: boolean;
  isComposing: boolean;
  /** Server-computed mascot state (ports the desktop agent-avatar activity gate); undefined on older gateways. */
  characterState?: BabyGrokState;
  /** Identity of the currently observed user run; changes when a new prompt is accepted. */
  stopGuard?: string | null;
  userIntentRevision?: number;
  isUserStopped?: boolean;
  isHidden: boolean;
  hasUnread: boolean;
  unreadCount: number;
  awaitingUserResponse: boolean;
  lastMessagePreview: string;
  lastActivityAt: number;
  notificationsEnabled: boolean;
  notifyOnUpdatesEnabled: boolean;
  isGroup: boolean;
  memberIds: string[];
}

interface MessageBase {
  id: string;
  role: "user" | "assistant";
  timestampMs: number;
  replyToId?: string;
  branched?: boolean;
  reactions?: Array<{ emoji: string; by: string }>;
}

export interface TextMessage extends MessageBase {
  type: "text";
  content: string;
  isStreaming?: boolean;
  optimistic?: boolean;
  clientNonce?: string;
}

export interface AgentActivityMessage extends MessageBase {
  type: "agent-activity";
  agentId: string;
  agentName: string;
  direction: "incoming" | "outgoing";
  content: string;
  jobId: string;
  isError: boolean;
}

export interface ApprovalMessage extends MessageBase {
  type: "approval";
  agentId: string;
  requestId: string;
  surface: string;
  summary: string;
  reason: string;
  command: string;
  status: string;
}

export interface LocalPermissionMessage extends MessageBase {
  type: "local-permission";
  agentId: string;
  requestId: string;
  action: string;
  target: string;
  status: string;
}

export interface WidgetMessage extends MessageBase {
  type: "widget";
  agentId: string;
  prompt: string;
  options: Array<{ label: string; value: string; style: string }>;
  skipped: boolean;
  /** The value the user chose, once answered; null while open. */
  answered: string | null;
}

export interface AttachmentMessage extends MessageBase {
  type: "attachment";
  agentId: string;
  name: string;
  path: string;
  byteSize: number;
  kind: AttachmentKind;
  mime: string | null;
  width: number | null;
  height: number | null;
}

export type MobileMessage = TextMessage | AgentActivityMessage | ApprovalMessage | LocalPermissionMessage | WidgetMessage | AttachmentMessage;

export interface ModelOption { id: string; label: string; efforts: string[] }
export interface ModelSelection { modelId: string; maxMode: boolean; parameters: Array<{ id: string; value: string }> }
export interface BotTemplate {
  version: number;
  exportedAt: number;
  name: string;
  description: string;
  avatar: { shape: string | null; color: string | null };
  skills: Array<{ id?: string; name: string; description: string; body: string }>;
  routines: Array<{ name: string; prompt: string; schedule: string; isEnabled: boolean }>;
}
export interface TemplateImportResult {
  bot: { id: string; name: string };
  status: "complete" | "partial";
  skills: string[];
  newWorkflowIds: string[];
  routines: string[];
  issues: Array<{ kind: "skill" | "routine" | "isolation"; name: string; message: string }>;
  source: string;
}
export interface MemoryRecord { id: string; content: string; createdAt: number; kind: string }

export interface MobileSettings {
  notificationsEnabled: boolean;
  autoReviewEnabled: boolean;
  localToolPermission: "always" | "ask" | "never";
  userTimeZone: string;
  userLanguage: string;
  agentDefaultModel: ModelSelection | null;
  models: ModelOption[];
  pinnedAgentIds: string[];
  hostVersion: unknown;
  latestHostVersion: string;
  hostUpdateAvailable: boolean;
  hostBusy: boolean;
  pluginAuthBlocked: number;
}

export interface CodexUsageWindow {
  id: string;
  limitId: string;
  limitName: string;
  scope: "primary" | "secondary";
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}

export interface CodexUsage {
  planType: string | null;
  windows: CodexUsageWindow[];
  resetCredits: number | null;
  activity: {
    lifetimeTokens: number | null;
    peakDailyTokens: number | null;
    currentStreakDays: number | null;
    recentDaily: Array<{ startDate: string; tokens: number }>;
  };
  fetchedAt: number;
}

export interface UsageStat {
  label: string;
  calls: number;
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  reasoningKnown: boolean;
  cost: number;
  costKnown: boolean;
  costUnknownCalls: number;
  ok: number;
  error: number;
  aborted: number;
}

export interface UsageLedger {
  since: string;
  firstTs: number | null;
  lastTs: number | null;
  total: UsageStat;
  byBot: UsageStat[];
  byModel: UsageStat[];
  byJob: UsageStat[];
}

export interface ComputerState {
  state: string;
  ready: boolean;
  viewerUrl: string | null;
  windows: Array<{ windowIndex: number; ready: boolean }>;
  handoff: unknown;
}

export type FileSystemScope = "windows" | "belmont";

export interface FileSystemEntry {
  name: string;
  path: string;
  type: "directory" | "file" | "link" | "other";
  kind: AttachmentKind | null;
  size: number | null;
  modifiedAt: number | null;
}

export interface FileSystemListing {
  scope: FileSystemScope;
  label: string;
  path: string;
  displayPath: string;
  parentPath: string | null;
  entries: FileSystemEntry[];
  totalEntries: number;
  nextOffset: number | null;
}

export interface FileSystemPreview {
  scope: FileSystemScope;
  path: string;
  displayPath: string;
  name: string;
  kind: "text" | "image" | "pdf" | "video" | "audio" | "binary";
  bytes: number;
  modifiedAt: number;
  contentUrl: string;
  text?: string;
  truncated?: boolean;
}

export interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  bytesBase64: string;
}

export type AttachmentKind = "image" | "video" | "audio" | "pdf" | "markdown" | "table" | "json" | "document" | "archive" | "text" | "file";

export interface AttachmentRef {
  agentId: string;
  entryId: string;
  name: string;
  path: string;
  byteSize: number;
  kind: AttachmentKind;
  mime: string | null;
  width: number | null;
  height: number | null;
}

export interface AttachmentPreview {
  kind: "text" | "binary" | "image" | "pdf" | "media";
  bytes: number;
  text?: string;
  truncated?: boolean;
  dataUrl?: string;
  width?: number | null;
  height?: number | null;
  contentUrl?: string;
  mime?: string | null;
}

export interface MessageSearchResult {
  agentId: string;
  entryId: string;
  role: "user" | "assistant";
  timestampMs: number;
  snippet: string;
}

export interface MediaSearchResult {
  agentId: string;
  entryId: string;
  fileName: string;
  ext: string;
  mime: string | null;
  kind: AttachmentKind;
  timestampMs: number;
  width: number | null;
  height: number | null;
}

export interface RoutineRun {
  id: string;
  status: "running" | "ok" | "error";
  startedAt: number;
  detail?: string | null;
  event?: string | null;
}

export interface RoutineAutomation {
  id: string;
  name: string;
  prompt: string;
  trigger: Record<string, unknown>;
  triggerDescription: string;
  isEnabled: boolean;
  runs: RoutineRun[];
  createdAt?: number;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  source: string;
  publisher?: string;
  iconUrl?: string;
  install?: Record<string, unknown>;
}

export interface RoutedTool {
  name: string;
  providerIdentifier: string;
  toolName: string;
  description: string;
}
