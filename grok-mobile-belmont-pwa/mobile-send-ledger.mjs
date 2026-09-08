import { createHash, randomUUID } from "node:crypto";
import { readState, writeState } from "./server-state.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const sendKey = (deviceId, botId, nonce) => digest(JSON.stringify([deviceId, botId, nonce]));
export const scopedMobileNonce = (deviceId, botId, nonce) => `mobile-v1:${digest(JSON.stringify([deviceId, botId]))}:${Buffer.from(nonce).toString("base64url")}`;

export function unwrapMobileNonce(nonce) {
  const match = /^mobile-v1:[a-f0-9]{64}:([A-Za-z0-9_-]+)$/u.exec(nonce);
  return match ? Buffer.from(match[1], "base64url").toString("utf8") : nonce;
}

export function normalizeMobileSend(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) throw invalid("메시지 요청이 올바르지 않습니다.");
  const prompt = typeof body.text === "string" ? body.text.trim() : "";
  const clientNonce = typeof body.clientNonce === "string" ? body.clientNonce : randomUUID();
  if (!clientNonce || clientNonce.length > 256) throw invalid("메시지 식별자가 올바르지 않습니다.");
  if (body.attachments != null && !Array.isArray(body.attachments)) throw invalid("첨부 파일이 올바르지 않습니다.");
  if ((body.attachments?.length ?? 0) > 8) throw invalid("첨부 파일은 8개까지 보낼 수 있습니다.");
  const attachments = (body.attachments ?? []).map((attachment) => {
    if (typeof attachment?.name !== "string" || !attachment.name.trim() || attachment.name.length > 255) throw invalid("첨부 파일 이름이 올바르지 않습니다.");
    const encoded = attachment.bytesBase64;
    if (typeof encoded !== "string" || !encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) throw invalid("첨부 파일 데이터가 올바르지 않습니다.");
    return { name: attachment.name, bytesBase64: encoded };
  });
  if (!prompt && !attachments.length) throw invalid("메시지나 첨부 파일이 필요합니다.");
  return { clientNonce, payload: { prompt, attachments,
    ...(typeof body.replyToId === "string" && body.replyToId ? { replyToId: body.replyToId } : {}),
    ...(body.isFork === true ? { isFork: true } : {}),
  } };
}

/** The host also persists acceptance by nonce; retrying a lost response is safe with identical paths. */
export function createMobileSendLedger({ file = null, now = Date.now, retentionMs = 30 * 86400_000 } = {}) {
  const records = new Map(Object.entries(readState(file, { records: {} }).records));
  const inFlight = new Map();
  const persist = () => writeState(file, { version: 1, records: Object.fromEntries(records) });
  return {
    async send(deviceId, botId, body, gateway) {
      const { clientNonce, payload } = normalizeMobileSend(body);
      const key = sendKey(deviceId, botId, clientNonce);
      const fingerprint = digest(JSON.stringify(payload));
      let record = records.get(key);
      if (record?.cancelled) throw invalid("중단한 메시지입니다. 새 메시지로 보내려면 내용을 다시 작성하세요.", 409);
      if (record && record.fingerprint !== fingerprint) throw invalid("같은 메시지 식별자로 다른 내용을 보낼 수 없습니다.", 409);
      if (inFlight.has(key)) return await inFlight.get(key);
      if (record?.accepted) return { accepted: true, clientNonce };
      if (!record) {
        // Never evict pending records: a retry must retain its original uploaded attachment paths.
        for (const [id, value] of records) if (value.accepted && value.updatedAt < now() - retentionMs) records.delete(id);
        record = { fingerprint, uploaded: [], updatedAt: now(), accepted: false,
          gatewayNonce: scopedMobileNonce(deviceId, botId, clientNonce) };
        records.set(key, record);
        persist();
      }
      const pending = (async () => {
        if (record.dispatchAttempted) {
          // The host keeps a bounded receipt ledger. Once that history has gaps, blindly
          // replaying a nonce could duplicate an older accepted message after eviction.
          const receipt = await gateway.call("promptAcceptanceStatus", { accountSlot: "host", clientNonce: record.gatewayNonce });
          let accepted = receipt?.outcome === "found" && receipt.record?.status === "accepted";
          if (receipt?.outcome === "found" && receipt.record?.agentId && receipt.record.agentId !== botId) throw invalid("메시지 수신 기록의 Bot이 일치하지 않습니다.", 409);
          if (receipt?.outcome === "unknown-durability") {
            let beforeSeq;
            for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
              const page = await gateway.call("getAgentTranscriptTail", { id: botId, limit: 100, ...(beforeSeq == null ? {} : { beforeSeq }) });
              if (page?.entries?.some((entry) => entry.role === "user" && (entry.clientNonce === record.gatewayNonce || entry.metadata?.["sand.client_nonce"] === record.gatewayNonce))) { accepted = true; break; }
              if (page?.nextBeforeSeq == null || page.nextBeforeSeq === beforeSeq) break;
              beforeSeq = page.nextBeforeSeq;
            }
          }
          if (accepted) {
            record.accepted = true; record.updatedAt = now(); persist();
            return { accepted: true, clientNonce };
          }
          if (receipt?.outcome !== "not-found") throw invalid(receipt?.record?.status === "pending"
            ? "이 메시지는 데스크톱에서 처리 중입니다. 잠시 후 다시 확인하세요."
            : "이전 전송의 수신 여부를 확인하지 못했습니다. 중복 전송을 막기 위해 대화를 먼저 확인하세요.", 409);
        }
        for (let index = 0; index < payload.attachments.length; index++) {
          if (record.cancelled) throw invalid("메시지 전송을 중단했습니다.", 409);
          if (record.uploaded[index]) continue;
          const attachment = payload.attachments[index];
          // The host upload itself is content addressed, including after a lost upload response.
          const result = await gateway.call("uploadAttachment", { filename: attachment.name, bytesBase64: attachment.bytesBase64, agentId: botId });
          if (typeof result?.path !== "string" || !result.path) throw invalid("첨부 파일 저장을 확인하지 못했습니다.", 502);
          record.uploaded[index] = { path: result.path, name: attachment.name };
          record.updatedAt = now();
          persist();
        }
        if (record.cancelled) throw invalid("메시지 전송을 중단했습니다.", 409);
        record.dispatchAttempted = true;
        record.updatedAt = now();
        persist();
        await gateway.call("sendPrompt", {
          agentId: botId, prompt: payload.prompt,
          attachmentPaths: record.uploaded.map((item) => item.path), attachmentNames: record.uploaded.map((item) => item.name),
          directAddressedAcceptance: true, clientNonce: record.gatewayNonce, enterEpochMs: now(), composedAtMs: now(),
          ...(payload.replyToId ? { replyToId: payload.replyToId } : {}), ...(payload.isFork ? { isFork: true } : {}),
        });
        record.accepted = true;
        record.updatedAt = now();
        persist();
        return { accepted: true, clientNonce };
      })();
      inFlight.set(key, pending);
      try { return await pending; } finally { inFlight.delete(key); }
    },
    async stop(deviceId, botId, body, gateway) {
      const expectedClientNonce = typeof body.expectedClientNonce === "string" && body.expectedClientNonce.length > 0 && body.expectedClientNonce.length <= 256 ? body.expectedClientNonce : null;
      const expectedStopGuard = typeof body.expectedStopGuard === "string" && body.expectedStopGuard.length > 0 && body.expectedStopGuard.length <= 512 ? body.expectedStopGuard : null;
      if (!expectedClientNonce && !expectedStopGuard) throw invalid("중단할 작업을 확인할 수 없습니다. 목록을 새로고침한 뒤 다시 시도하세요.", 409);
      const record = expectedClientNonce ? records.get(sendKey(deviceId, botId, expectedClientNonce)) : null;
      if (expectedClientNonce && !expectedStopGuard && !record) {
        // The stop HTTP request can overtake the send HTTP request. Reserve its nonce
        // before acknowledging cancellation so the delayed send cannot start later.
        records.set(sendKey(deviceId, botId, expectedClientNonce), {
          cancelled: true, fingerprint: null, uploaded: [], accepted: false, updatedAt: now(),
          gatewayNonce: scopedMobileNonce(deviceId, botId, expectedClientNonce),
        });
        persist();
        return { id: botId, interrupted: false, cancelledSubmission: true };
      }
      if (record && !record.dispatchAttempted && !record.accepted) {
        const firstStop = !record.cancelled;
        record.cancelled = true;
        record.updatedAt = now();
        persist();
        return { id: botId, interrupted: firstStop, cancelledSubmission: true };
      }
      const args = { id: botId,
        ...(expectedStopGuard ? { expectedStopGuard } : {}),
        ...(expectedClientNonce ? { expectedClientNonce: scopedMobileNonce(deviceId, botId, expectedClientNonce) } : {}),
      };
      const result = await gateway.call("interruptAgent", args);
      // Stop can also overtake the host's acceptance of an already-dispatched send.
      // First try immediately (to interrupt active work), then retry the same guard
      // after our send settles. Never substitute the newer run's token.
      const pending = expectedClientNonce ? inFlight.get(sendKey(deviceId, botId, expectedClientNonce)) : null;
      if (result?.stale === true && pending) {
        await pending.catch(() => undefined);
        return await gateway.call("interruptAgent", args);
      }
      return result;
    },
  };
}
