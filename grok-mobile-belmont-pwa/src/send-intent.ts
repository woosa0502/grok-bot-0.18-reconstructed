import type { PendingAttachment } from "./types";

export type SendIntent = {
  botId: string;
  text: string;
  attachments: PendingAttachment[];
  replyToId?: string;
  clientNonce: string;
  timestampMs: number;
};

/** Keep the identity until acceptance. A lost HTTP response is not proof that a send failed. */
export function prepareSendIntent(previous: SendIntent | null, input: Pick<SendIntent, "botId" | "text" | "attachments" | "replyToId">): SendIntent {
  const same = previous != null
    && previous.botId === input.botId && previous.text === input.text && previous.replyToId === input.replyToId
    && previous.attachments.length === input.attachments.length
    && previous.attachments.every((file, index) => file.name === input.attachments[index]?.name && file.bytesBase64 === input.attachments[index]?.bytesBase64);
  return same ? previous : { ...input, attachments: input.attachments.map((file) => ({ ...file })), clientNonce: crypto.randomUUID(), timestampMs: Date.now() };
}
