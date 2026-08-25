import { Buffer } from "node:buffer";

const MAX_TRANSPORT_BYTES = 200 * 1024 * 1024;

function numericObjectBytes(value: unknown): Uint8Array | null {
  if (typeof value !== "object" || value == null) return null;
  const record = value as Record<string, unknown>;
  const numericKeys = Object.keys(record).filter(key => /^(?:0|[1-9][0-9]*)$/u.test(key)).sort((left, right) => Number(left) - Number(right));
  const declaredLength = Number.isSafeInteger(record.length) ? Number(record.length)
    : Number.isSafeInteger(record.byteLength) ? Number(record.byteLength)
      : numericKeys.length;
  if (declaredLength < 0 || declaredLength > MAX_TRANSPORT_BYTES || numericKeys.length !== declaredLength) return null;
  const bytes = new Uint8Array(declaredLength);
  for (let index = 0; index < declaredLength; index += 1) {
    if (numericKeys[index] !== String(index)) return null;
    const byte = record[String(index)];
    if (!Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255) return null;
    bytes[index] = Number(byte);
  }
  return bytes;
}

export function normalizeAttachmentBytesForTransport(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    try { return new Uint8Array(value as ArrayBuffer); } catch { return null; }
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_TRANSPORT_BYTES || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
    return Uint8Array.from(value);
  }
  return numericObjectBytes(value);
}

export function encodeAttachmentBytesForRpc(value: unknown): string | null {
  const bytes = normalizeAttachmentBytesForTransport(value);
  return bytes == null ? null : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function decodeAttachmentBytesFromRpc(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_TRANSPORT_BYTES / 3) * 4) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return null;
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}
