import { isInjectedReminderMessage } from "./send-message-reminder-middleware.js";
import { SAND_REACT_TO_MESSAGE_TOOL_NAME } from "./tools/sand-reaction-tool.js";
import { SAND_SEND_MESSAGE_TOOL_NAME } from "./tools/send-message-tool.js";
import { SAND_UPDATE_STATE_TOOL_NAME } from "./tools/sand-state-tool.js";

export const DELIVERY_TOOL_NAMES = new Set([
  SAND_SEND_MESSAGE_TOOL_NAME,
  SAND_REACT_TO_MESSAGE_TOOL_NAME,
]);

export interface CorePart {
  readonly type: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

export interface CoreMessage {
  readonly role: string;
  readonly content: string | readonly CorePart[];
  readonly providerOptions?: {
    readonly cursor?: { readonly highLevelToolCallResult?: unknown };
  };
}

export function asCoreMessage(value: unknown): CoreMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("role" in value) || typeof value.role !== "string") return undefined;
  if (
    !("content" in value)
    || (typeof value.content !== "string" && !Array.isArray(value.content))
  ) return undefined;
  return value as CoreMessage;
}

export function toolCallNames(message: CoreMessage): string[] {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return [];
  }
  return message.content.flatMap((part) =>
    part.type === "tool-call" && part.toolName != null
      ? [part.toolName]
      : []
  );
}

export function hasDeliveryToolCall(names: readonly string[]): boolean {
  return names.some((name) => DELIVERY_TOOL_NAMES.has(name));
}

function deliveryToolCallIds(message: CoreMessage): string[] {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return [];
  }
  return message.content.flatMap((part) =>
    part.type === "tool-call"
      && part.toolName != null
      && DELIVERY_TOOL_NAMES.has(part.toolName)
      && part.toolCallId != null
      ? [part.toolCallId]
      : []
  );
}

function erroredToolResultIds(
  messages: readonly (CoreMessage | undefined)[],
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (
      message === undefined
      || message.role !== "tool"
      || typeof message.content === "string"
    ) continue;
    const highLevel = message.providerOptions?.cursor
      ?.highLevelToolCallResult;
    if (
      typeof highLevel !== "object"
      || highLevel === null
      || Array.isArray(highLevel)
      || !("isError" in highLevel)
      || highLevel.isError !== true
    ) continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && part.toolCallId != null) {
        ids.add(part.toolCallId);
      }
    }
  }
  return ids;
}

export function isBlankAssistantMessage(message: CoreMessage): boolean {
  if (message.role !== "assistant") return false;
  if (typeof message.content === "string") {
    return message.content.trim().length === 0;
  }
  return message.content.every(
    (part) => part.type === "text" && (part.text ?? "").trim().length === 0,
  );
}

export const BOOKKEEPING_TOOL_NAMES = new Set([SAND_UPDATE_STATE_TOOL_NAME, "TodoWrite"]);

export interface SilentTailOptions {
  /**
   * The turn delivered (an acknowledgement) and worked before the visible history starts — the
   * context was compacted mid-turn, so the summary is now the boundary and the earlier
   * SendMessage is no longer in `rawMessages`. Comes from the settle collectors.
   */
  readonly deliveredBeforeVisibleHistory?: boolean;
  /**
   * This run continues a turn that already acknowledged the user (a closing-send nudge run). Work
   * done here that ends without a delivery is silent; ending at once with no work is the model
   * saying there was nothing more to report, and is not.
   */
  readonly continuesAcknowledgedTurn?: boolean;
}

/**
 * True when the turn told the user something (usually the opening acknowledgement) and then did
 * work that never reached them: after the last successful delivery there are non-bookkeeping
 * tool calls, or the turn ended on plain assistant text (never shown to the user), or the turn was
 * compacted mid-way and nothing was delivered after the summary. Bookkeeping tools (memory,
 * todo) after a final SendMessage are not "work". Turns with no delivery at all are the reply
 * nudge's job, not this detector's.
 */
export function turnEndedOnSilentToolCalls(
  rawMessages: readonly unknown[],
  options: SilentTailOptions = {},
): boolean {
  const messages = rawMessages.map(asCoreMessage);
  const deliveredBefore = options.deliveredBeforeVisibleHistory === true;
  let tailIndex = messages.length - 1;
  while (tailIndex >= 0) {
    const message = messages[tailIndex];
    if (
      message === undefined
      || message.role === "tool"
      || isBlankAssistantMessage(message)
      || isInjectedReminderMessage(message)
    ) {
      tailIndex -= 1;
      continue;
    }
    break;
  }

  const tail = tailIndex >= 0 ? messages[tailIndex] : undefined;
  // Nothing (or only the prompt/summary) after the boundary: silent iff the ack happened earlier.
  if (tail === undefined || tail.role !== "assistant") return deliveredBefore;
  const erroredIds = erroredToolResultIds(messages);
  const delivers = (message: CoreMessage): boolean =>
    deliveryToolCallIds(message).some((id) => !erroredIds.has(id));
  if (delivers(tail)) return false;

  let boundary = -1;
  for (let index = tailIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || isInjectedReminderMessage(message)) continue;
    if (message.role === "user" || message.role === "system") {
      boundary = index;
      break;
    }
  }

  let deliveriesAfterBoundary = 0;
  let workSinceDelivery = 0;
  for (let index = boundary + 1; index <= tailIndex; index += 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "assistant") continue;
    if (delivers(message)) {
      deliveriesAfterBoundary += 1;
      workSinceDelivery = 0;
      continue;
    }
    workSinceDelivery += toolCallNames(message).filter((name) =>
      !DELIVERY_TOOL_NAMES.has(name) && !BOOKKEEPING_TOOL_NAMES.has(name)
    ).length;
  }
  if (deliveredBefore && deliveriesAfterBoundary === 0) return true;
  if (options.continuesAcknowledgedTurn === true && deliveriesAfterBoundary === 0) {
    return workSinceDelivery > 0;
  }
  return deliveriesAfterBoundary > 0 && workSinceDelivery > 0;
}
