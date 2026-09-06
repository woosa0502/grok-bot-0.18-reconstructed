import { TodoItem, TodoStatus } from "../../packages/proto/generated/agent/v1/todo_tool_pb.js";
import { isInjectedReminderMessage } from "./send-message-reminder-middleware.js";
import {
  asCoreMessage,
  BOOKKEEPING_TOOL_NAMES,
  DELIVERY_TOOL_NAMES,
} from "./turn-shape.js";

/**
 * "Is the user's task finished?" — the one question Belmont's turn loop could not answer. A turn ends
 * the moment the model stops calling tools, so a bot that sends a progress note and stops looks the
 * same as one that finished. The Aside browse engine never has this problem: the host polls a task
 * until the service says done. This module gives Belmont the equivalent signal from what it already
 * has — the model's own TodoWrite list (persisted in the conversation state) plus the shape of the
 * work it did in the run — so the runtime can hand the turn back until the list is clear, without
 * adding a second planning system.
 */
export interface OpenTodo {
  readonly id: string;
  readonly content: string;
  readonly status: "in_progress" | "pending";
}

/** Tools that hand work to someone else; their reply revives the agent, so ending on one is waiting, not stopping. */
export const HANDOFF_TOOL_NAMES: ReadonlySet<string> = new Set(["SendToAgent", "Task"]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** A call name or requested background flag is intent; only its successful result proves a wait. */
function isPendingHandoff(name: string, part: unknown, highLevel: unknown): boolean {
  const result = object(part);
  const meta = object(highLevel);
  if (result?.isError === true || meta?.isError === true) return false;
  const output = object(meta?.output);
  const success = object(output?.success);
  if (name === "Task" && success != null) {
    return success.isBackground === true;
  }
  if (output?.error != null) return false;
  // Core history normally retains the structured protobuf result above. Text-only histories
  // (e.g. restored/compacted executor messages) still use the tool's exact acknowledgement prefix.
  const text = typeof result?.result === "string" ? result.result.trim() : "";
  if (name === "Task") {
    return text.startsWith("Subagent is running in the background.")
      || text.startsWith("The user manually backgrounded the subagent. It is still running;");
  }
  // A group "Posted" acknowledgement delivers a room message; it does not arm a reply wake
  // for this caller. Only the direct-agent async delivery contract establishes that wait.
  return name === "SendToAgent" && text.startsWith("Sent to ");
}

export interface TodoBlobStoreLike {
  getBlob(ctx: unknown, blobId: Uint8Array): Promise<Uint8Array | undefined>;
}

/** Reads the unfinished TodoWrite items out of a persisted conversation state (in state order). */
export async function readOpenTodos(
  state: { readonly todos?: readonly Uint8Array[] } | null | undefined,
  blobStore: TodoBlobStoreLike | null | undefined,
  ctx: unknown,
): Promise<OpenTodo[]> {
  const ids = state?.todos;
  if (ids == null || ids.length === 0) return [];
  if (blobStore == null) throw new Error("Todo blob store is unavailable");
  const open: OpenTodo[] = [];
  for (const id of ids) {
    const bytes = await blobStore.getBlob(ctx, id);
    if (bytes === undefined) throw new Error("Persisted todo blob is missing");
    const item = TodoItem.fromBinary(bytes);
    if (item.status === TodoStatus.IN_PROGRESS) open.push({ id: item.id, content: item.content, status: "in_progress" });
    else if (item.status === TodoStatus.PENDING) open.push({ id: item.id, content: item.content, status: "pending" });
    else if (item.status !== TodoStatus.COMPLETED && item.status !== TodoStatus.CANCELLED) throw new Error("Persisted todo status is unknown");
  }
  return open;
}

export interface RunWorkShape {
  /** Non-delivery, non-bookkeeping tool calls since the run's prompt. */
  readonly workToolCalls: number;
  /** The run's last piece of work handed the task to another agent or a subagent. */
  readonly handedOff: boolean;
  /** TodoWrite calls since the run's prompt: the run engaged with its task list. */
  readonly todoWrites: number;
}

/**
 * Shape of the work in one run, from the messages the model last saw (the recorded prompt): tool
 * calls after the last real prompt boundary, ignoring deliveries (SendMessage/ReactToMessage) and
 * bookkeeping (memory, todo). Reminders are not boundaries.
 */
export function runWorkShape(rawMessages: readonly unknown[]): RunWorkShape {
  const messages = rawMessages.map(asCoreMessage);
  let boundary = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || isInjectedReminderMessage(message)) continue;
    if (message.role === "user" || message.role === "system") {
      boundary = index;
      break;
    }
  }
  let workToolCalls = 0;
  let todoWrites = 0;
  let lastWork: { name: string; callId: string | undefined } | undefined;
  for (let index = boundary + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "assistant" || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type !== "tool-call" || part.toolName == null) continue;
      const name = part.toolName;
      if (name === "TodoWrite") todoWrites += 1;
      if (DELIVERY_TOOL_NAMES.has(name) || BOOKKEEPING_TOOL_NAMES.has(name)) continue;
      workToolCalls += 1;
      lastWork = { name, callId: part.toolCallId };
    }
  }
  let handedOff = false;
  if (lastWork?.callId != null && HANDOFF_TOOL_NAMES.has(lastWork.name)) {
    for (let index = messages.length - 1; index > boundary; index -= 1) {
      const message = messages[index];
      if (message?.role !== "tool" || typeof message.content === "string") continue;
      const part = message.content.find((item) => item.type === "tool-result" && item.toolCallId === lastWork?.callId);
      if (part == null) continue;
      handedOff = isPendingHandoff(lastWork.name, part, message.providerOptions?.cursor?.highLevelToolCallResult);
      break;
    }
  }
  return { workToolCalls, handedOff, todoWrites };
}

/** Task continuations per user turn; each is a full model run, so the loop stays bounded. */
export const MAX_TASK_CONTINUATIONS = 24;
/** Consecutive continuations that did no work before the runtime stops handing the turn back. */
export const MAX_IDLE_TASK_CONTINUATIONS = 1;
/** Wall-clock budget for one user turn including its continuations. */
export const TASK_CONTINUATION_DEADLINE_MS = 3 * 60 * 60 * 1000;

export interface TaskContinuationInput {
  readonly openTodos: readonly OpenTodo[] | undefined;
  readonly aborted: boolean;
  readonly taskCompletionUnknown?: boolean;
  readonly awaitingUserSelection: boolean;
  readonly handedOff: boolean;
  readonly continuations: number;
  readonly idleContinuations: number;
  readonly elapsedMs: number;
}

export type TaskStopReason = "done" | "aborted" | "unknown" | "awaiting_user" | "handed_off" | "idle" | "cap" | "deadline";
export type TaskContinuationDecision =
  | { readonly continue: true }
  | { readonly continue: false; readonly reason: TaskStopReason };

/** Pure decision: hand the turn back to the model, or let it end. Mirrors the Aside engine's "poll until done". */
export function decideTaskContinuation(input: TaskContinuationInput): TaskContinuationDecision {
  if (input.aborted) return { continue: false, reason: "aborted" };
  if (input.taskCompletionUnknown === true) return { continue: false, reason: "unknown" };
  if (input.awaitingUserSelection) return { continue: false, reason: "awaiting_user" };
  if (input.handedOff) return { continue: false, reason: "handed_off" };
  if (input.openTodos === undefined || input.openTodos.length === 0) return { continue: false, reason: "done" };
  if (input.idleContinuations >= MAX_IDLE_TASK_CONTINUATIONS) return { continue: false, reason: "idle" };
  if (input.continuations >= MAX_TASK_CONTINUATIONS) return { continue: false, reason: "cap" };
  if (input.elapsedMs >= TASK_CONTINUATION_DEADLINE_MS) return { continue: false, reason: "deadline" };
  return { continue: true };
}

export interface ApprovalCardEntryLike {
  readonly kind?: string;
  readonly timestampMs?: number;
  readonly message?: {
    readonly type?: string;
    readonly approval?: { readonly status?: string };
    readonly ask?: { readonly status?: string };
  };
}

const ANSWERED_YES_CARD_STATUSES: ReadonlySet<string> = new Set(["approved", "allowed"]);

/**
 * True when a card the user must answer (an Auto-review approval or a local-tool permission ask)
 * was raised in this turn and is not answered yes: pending, denied, and expired all mean the user is
 * in the loop, so the runtime must not keep handing the turn back and re-raising the same card.
 */
export function turnHasUnapprovedCard(entries: readonly ApprovalCardEntryLike[], sinceMs: number): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry.kind !== "send-message") continue;
    if (typeof entry.timestampMs === "number" && entry.timestampMs < sinceMs) continue;
    const type = entry.message?.type;
    const status = type === "auto-review-approval"
      ? entry.message?.approval?.status
      : type === "local-tool-permission"
        ? entry.message?.ask?.status
        : undefined;
    if (status === undefined) continue;
    if (!ANSWERED_YES_CARD_STATUSES.has(status)) return true;
  }
  return false;
}

export type ParkedTaskReason = "awaiting_user" | "idle" | "cap" | "deadline";
export const PARKED_TASK_RESUME_VALUE = "이어가기";
export const PARKED_TASK_STOP_VALUE = "그만두기";

/**
 * Park the task — leave a resume card in the chat — when the bot was actively working and stopped
 * short with items still open. A turn that did no work (a greeting, "잠깐 멈춰") parks nothing, a
 * handoff waits for the other bot's reply, and done/aborted have nothing to resume.
 */
export interface ParkTaskInput {
  readonly reason: TaskStopReason;
  readonly openTodos: readonly OpenTodo[] | undefined;
  readonly workToolCalls: number;
  readonly continuations: number;
}
export function shouldParkTask(input: ParkTaskInput): input is ParkTaskInput & { readonly reason: ParkedTaskReason } {
  if (input.openTodos === undefined || input.openTodos.length === 0) return false;
  if (input.reason === "done" || input.reason === "aborted" || input.reason === "unknown" || input.reason === "handed_off") return false;
  return input.continuations > 0 || input.workToolCalls > 0;
}

const PARKED_TASK_REASON_TEXT: Record<ParkedTaskReason, string> = {
  awaiting_user: "승인이나 답이 필요한 단계에서 멈췄어. 이어가면 필요한 확인을 다시 요청할게.",
  idle: "더 진행하지 못하고 멈췄어.",
  cap: "한 턴에 이어갈 수 있는 횟수를 다 써서 멈췄어.",
  deadline: "한 턴의 시간 한도를 다 써서 멈췄어.",
};
const MAX_LISTED_PARKED_TODOS = 5;
export const PARKED_TASK_PROMPT_PREFIX = "작업이 끝나지 않은 채 멈춰 있어.";

/** The item list a parked card shows; the same list identifies "the same parked task" later. */
function parkedTaskItemBlock(openTodos: readonly OpenTodo[]): string {
  const listed = openTodos.slice(0, MAX_LISTED_PARKED_TODOS).map((todo) => `· ${todo.content}`);
  const more = openTodos.length > MAX_LISTED_PARKED_TODOS ? [`· … 외 ${openTodos.length - MAX_LISTED_PARKED_TODOS}개`] : [];
  return [`남은 항목 ${openTodos.length}개:`, ...listed, ...more].join("\n");
}

export interface ParkedCardEntryLike {
  readonly kind?: string;
  readonly respondedValue?: unknown;
  readonly message?: { readonly type?: string; readonly widget?: { readonly prompt?: string } };
}

/**
 * True when the most recent parked-task card in the chat is for this same item list and the user
 * has not answered it. The user has already been asked; a later unrelated turn (a quick question,
 * a small chore) must not run another continuation for the parked list or drop a second card.
 * Answering the card (이어가기 / 그만두기) or a change in the list ends the hold.
 */
export function hasUnansweredParkedTaskCard(entries: readonly ParkedCardEntryLike[], openTodos: readonly OpenTodo[]): boolean {
  if (openTodos.length === 0) return false;
  const block = parkedTaskItemBlock(openTodos);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry.kind !== "send-message" || entry.message?.type !== "widget") continue;
    const prompt = entry.message.widget?.prompt;
    if (typeof prompt !== "string" || !prompt.startsWith(PARKED_TASK_PROMPT_PREFIX)) continue;
    return entry.respondedValue == null && prompt.endsWith(block);
  }
  return false;
}

/** The chat card a parked task leaves behind: tap 이어가기 later and the bot picks the list back up. */
export function buildParkedTaskWidget(reason: ParkedTaskReason, openTodos: readonly OpenTodo[]): {
  readonly type: "widget";
  readonly widget: { readonly prompt: string; readonly options: readonly { readonly label: string; readonly value: string; readonly style?: string }[] };
} {
  return {
    type: "widget",
    widget: {
      prompt: [`${PARKED_TASK_PROMPT_PREFIX} ${PARKED_TASK_REASON_TEXT[reason]}`, parkedTaskItemBlock(openTodos)].join("\n"),
      options: [
        { label: PARKED_TASK_RESUME_VALUE, value: PARKED_TASK_RESUME_VALUE, style: "primary" },
        { label: PARKED_TASK_STOP_VALUE, value: PARKED_TASK_STOP_VALUE, style: "danger" },
      ],
    },
  };
}

const MAX_LISTED_TODOS = 12;

/** Hidden self-wake that hands the turn back while the task list is not clear. */
export function buildTaskContinuationPrompt(
  openTodos: readonly OpenTodo[],
  delivery: "user" | "origin" = "user",
): string {
  const listed = openTodos.slice(0, MAX_LISTED_TODOS).map((todo) => `- (${todo.status === "in_progress" ? "in progress" : "pending"}) ${todo.content}`);
  const more = openTodos.length > MAX_LISTED_TODOS ? [`- … and ${openTodos.length - MAX_LISTED_TODOS} more`] : [];
  return [
    "[task continuation] Nobody new has messaged you. The runtime is handing the turn back because your task list still has unfinished items from the user's request:",
    ...listed,
    ...more,
    "Keep working on them now, in this turn, until they are done or genuinely blocked. Update the list with TodoWrite as items finish or turn out to be unnecessary.",
    delivery === "user"
      ? "Send short progress notes with SendMessage on real beats, and report the outcome with SendMessage when the work is done."
      : "Keep the original wake's recipient and delivery rule: send delegated results back to the requesting agent; a quiet routine or background follow-up stays silent unless its original instruction calls for a useful notification. This continuation does not create a new reason to message the user.",
    "If you are waiting on something outside this turn — another bot's reply, the user's answer, an approval, a scheduled time — do nothing and end the turn without any tool call; you will be woken when it arrives. Do not re-ask, re-send, or repeat a delegation. Do not mark an item done unless it is actually done.",
  ].join("\n");
}
