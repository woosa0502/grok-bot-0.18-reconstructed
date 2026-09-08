import type { SendIntent } from "./send-intent";

const DATABASE = "belmont-mobile-send-intents";
const STORE = "pending";
type SavedIntent = { scope: string; intent: SendIntent };

function scopeKey(botId: string, replyToId?: string): string { return JSON.stringify([botId, replyToId ?? null]); }

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("전송 기록을 저장할 수 없습니다. 브라우저의 사이트 저장소를 허용한 뒤 다시 시도하세요.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "scope" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("전송 기록을 열지 못했습니다. 사이트 저장소를 확인한 뒤 다시 시도하세요."));
    request.onblocked = () => reject(new Error("다른 창이 전송 기록을 사용 중입니다. 다른 창을 닫고 다시 시도하세요."));
  });
}

/** Resolve only after commit, so a reload cannot outlive an unjournaled network submission. */
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(new Error("전송 내용을 안전하게 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도하세요."));
      tx.onerror = () => undefined; // onabort reports the transaction failure once.
      operation(tx.objectStore(STORE), (next) => { value = next; });
    });
  } finally { db.close(); }
}

function validIntent(value: unknown, botId: string, replyToId?: string): value is SendIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<SendIntent>;
  return intent.botId === botId && intent.replyToId === replyToId
    && typeof intent.text === "string" && typeof intent.clientNonce === "string" && intent.clientNonce.length > 0
    && typeof intent.timestampMs === "number" && Number.isFinite(intent.timestampMs)
    && Array.isArray(intent.attachments) && intent.attachments.every((file) => file && typeof file.id === "string" && typeof file.name === "string" && typeof file.bytesBase64 === "string" && typeof file.size === "number");
}

export async function readSendIntent(botId: string, replyToId?: string): Promise<SendIntent | null> {
  return transaction("readonly", (store, result) => {
    const request = store.get(scopeKey(botId, replyToId));
    request.onsuccess = () => {
      const saved = request.result as SavedIntent | undefined;
      if (saved && !validIntent(saved.intent, botId, replyToId)) {
        // A damaged pending record cannot safely be treated as a new operation.
        request.transaction?.abort();
        return;
      }
      result(saved?.intent ?? null);
    };
  });
}

export async function saveSendIntent(intent: SendIntent): Promise<void> {
  await transaction<void>("readwrite", (store) => { store.put({ scope: scopeKey(intent.botId, intent.replyToId), intent } satisfies SavedIntent); });
}

/** A late response from an older component must never delete a newer pending submission. */
export async function clearSendIntent(intent: SendIntent): Promise<void> {
  await transaction<void>("readwrite", (store) => {
    const key = scopeKey(intent.botId, intent.replyToId);
    const request = store.get(key);
    request.onsuccess = () => { if ((request.result as SavedIntent | undefined)?.intent.clientNonce === intent.clientNonce) store.delete(key); };
  });
}

export async function clearSendIntentJournal(): Promise<void> {
  await transaction<void>("readwrite", (store) => { store.clear(); });
}
