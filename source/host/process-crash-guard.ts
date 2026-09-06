export type ProcessCrashKind = "uncaughtException" | "unhandledRejection";
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  // A plain object (an RPC error payload, a runtime's rejection record) stringifies to
  // "[object Object]", which hid 16 host rejections on 2026-09-05; keep the payload readable.
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : undefined;
    let detail: string;
    try { detail = JSON.stringify(value) ?? String(value); } catch { detail = String(value); }
    if (detail === "{}") detail = String(value);
    return new Error((message === undefined ? detail : `${message} ${detail}`).slice(0, 2000));
  }
  return new Error(String(value));
}
export function handleProcessCrash(options: { scope: string; onError?: (error: Error, kind: ProcessCrashKind) => void }, kind: ProcessCrashKind, value: unknown): void { const error = toError(value); console.error(`[${options.scope}] ${kind} (kept alive):`, error); try { options.onError?.(error, kind); } catch {} }
export function installProcessCrashGuards(options: { scope: string; onError?: (error: Error, kind: ProcessCrashKind) => void }) { let reporter = options.onError; const report = (kind: ProcessCrashKind, value: unknown) => handleProcessCrash({ scope: options.scope, ...(reporter === undefined ? {} : { onError: reporter }) }, kind, value); process.on("uncaughtException", (value) => report("uncaughtException", value)); process.on("unhandledRejection", (value) => report("unhandledRejection", value)); return { setReporter(onError: ((error: Error, kind: ProcessCrashKind) => void) | undefined) { reporter = onError; } }; }
