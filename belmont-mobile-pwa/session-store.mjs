import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/* Best-effort session persistence so a gateway restart does not force the
   phone to pair again. The file holds bearer secrets, so it is written 0600
   inside a 0700 directory, atomically via rename. Any failure falls back to
   memory-only sessions. */

export function loadSessions(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSessions(path, record) {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    /* persistence is best-effort; in-memory sessions keep working */
  }
}
