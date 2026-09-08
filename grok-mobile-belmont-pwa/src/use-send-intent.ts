import { useEffect, useRef, useState } from "react";
import type { PendingAttachment } from "./types";
import { prepareSendIntent, type SendIntent } from "./send-intent";
import { clearSendIntent, readSendIntent, saveSendIntent } from "./send-intent-journal";

export function useSendIntent(botId: string, replyToId?: string, fallbackDraft = "") {
  const [draft, setDraft] = useState(fallbackDraft);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const pendingIntent = useRef<SendIntent | null>(null);

  useEffect(() => {
    let current = true;
    setReady(false);
    setRecoveryError("");
    void readSendIntent(botId, replyToId).then((intent) => {
      if (!current) return;
      pendingIntent.current = intent;
      if (intent) { setDraft(intent.text); setAttachments(intent.attachments); }
      setReady(true);
    }).catch((caught) => { if (current) setRecoveryError(caught instanceof Error ? caught.message : "이전 전송을 복원하지 못했습니다."); });
    return () => { current = false; };
  }, [botId, replyToId]);

  function prepare(): SendIntent {
    if (!ready) throw new Error("이전 전송 기록을 확인하고 있습니다.");
    const intent = prepareSendIntent(pendingIntent.current, { botId, text: draft.trim(), attachments, replyToId });
    pendingIntent.current = intent;
    return intent;
  }

  async function accepted(intent: SendIntent): Promise<void> {
    await clearSendIntent(intent);
    if (pendingIntent.current?.clientNonce === intent.clientNonce) pendingIntent.current = null;
  }

  return { draft, setDraft, attachments, setAttachments, ready, recoveryError, pendingIntent, prepare, persist: saveSendIntent, accepted };
}
