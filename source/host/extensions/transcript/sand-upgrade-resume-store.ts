import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SAND_UPGRADE_RESUME_FILE_NAME } from "../../durable-file-policy.js";
export interface UpgradeResumeMarker {
  agentId: string;
  markedAtMs: number;
  markerId?: string;
  source?: string;
  automationId?: string;
  automationRunId?: string;
}
export function coerceUpgradeResumeMarker(
  entry: unknown,
): UpgradeResumeMarker | null {
  if (typeof entry !== "object" || entry == null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.agentId !== "string" || !e.agentId) return null;
  return {
    agentId: e.agentId,
    markedAtMs:
      typeof e.markedAtMs === "number" && Number.isFinite(e.markedAtMs)
        ? e.markedAtMs
        : 0,
    ...(typeof e.markerId === "string" ? { markerId: e.markerId } : {}),
    ...(typeof e.source === "string" ? { source: e.source } : {}),
    ...(typeof e.automationId === "string"
      ? { automationId: e.automationId }
      : {}),
    ...(typeof e.automationRunId === "string"
      ? { automationRunId: e.automationRunId }
      : {}),
  };
}
export const coerceMarker2 = coerceUpgradeResumeMarker;
export function parseUpgradeResumeFile(
  raw: string | null,
): UpgradeResumeMarker[] {
  if (raw == null) return [];
  try {
    const value = JSON.parse(raw) as { pending?: unknown };
    return typeof value === "object" &&
      value != null &&
      Array.isArray(value.pending)
      ? value.pending.flatMap((entry) => {
          const marker = coerceUpgradeResumeMarker(entry);
          return marker == null ? [] : [marker];
        })
      : [];
  } catch {
    return [];
  }
}
export function upsertResumeMarker(
  existing: readonly UpgradeResumeMarker[],
  marker: UpgradeResumeMarker,
): UpgradeResumeMarker[] {
  return [
    ...existing.filter((entry) => entry.agentId !== marker.agentId),
    marker,
  ];
}
export class SandUpgradeResumeStore {
  readonly filePath: string;
  constructor(rootDir: string) {
    this.filePath = join(rootDir, SAND_UPGRADE_RESUME_FILE_NAME);
  }
  markPending(marker: UpgradeResumeMarker): UpgradeResumeMarker | null {
    try {
      // Every arm owns a distinct generation, even within the same millisecond.
      const pending = { ...marker, markerId: randomUUID() };
      this.write(upsertResumeMarker(this.readPending(), pending));
      return pending;
    } catch {
      return null;
    }
  }
  listPending(): UpgradeResumeMarker[] {
    return this.readPending();
  }
  clear(agentId: string): void {
    try {
      const remaining = this.readPending().filter(
        (entry) => entry.agentId !== agentId,
      );
      remaining.length === 0 ? this.deleteFile() : this.write(remaining);
    } catch {}
  }
  clearIfPending(marker: UpgradeResumeMarker): boolean {
    try {
      const pending = this.readPending();
      const matches = (entry: UpgradeResumeMarker): boolean =>
        entry.agentId === marker.agentId &&
        (entry.markerId != null || marker.markerId != null
          ? entry.markerId === marker.markerId
          : entry.markedAtMs === marker.markedAtMs &&
            entry.source === marker.source &&
            entry.automationId === marker.automationId &&
            entry.automationRunId === marker.automationRunId);
      if (!pending.some(matches)) return false;
      const remaining = pending.filter((entry) => !matches(entry));
      remaining.length === 0
        ? rmSync(this.filePath, { force: true })
        : this.write(remaining);
      return true;
    } catch {
      return false;
    }
  }
  clearAll(): void {
    this.deleteFile();
  }
  readPending(): UpgradeResumeMarker[] {
    try {
      return parseUpgradeResumeFile(readFileSync(this.filePath, "utf8"));
    } catch {
      return [];
    }
  }
  write(pending: readonly UpgradeResumeMarker[]): void {
    const part = `${this.filePath}.part`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {}
    writeFileSync(part, JSON.stringify({ version: 1, pending }));
    renameSync(part, this.filePath);
  }
  deleteFile(): void {
    try {
      rmSync(this.filePath, { force: true });
    } catch {}
  }
}
