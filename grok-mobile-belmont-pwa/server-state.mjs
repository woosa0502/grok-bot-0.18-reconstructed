import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Private atomic state. A failed write is surfaced before acknowledging a mutation. */
export function readState(file, fallback) {
  if (!file) return fallback;
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export function writeState(file, state) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}
