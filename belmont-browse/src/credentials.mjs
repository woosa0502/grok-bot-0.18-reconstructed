// belmont-browse: keep Belmont's Codex OAuth credential and the Aside account credential file in sync (our code).
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";

export const BELMONT_PI_AUTH_PATH =
  process.env.SAND_PI_CODEX_AUTH_PATH?.trim() ||
  path.resolve(import.meta.dirname, "../../.cache/belmont-wsl-profile/sand-data/pi-auth.json");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonPrivate(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

// Copies the newer openai-codex credential between the two files. Returns a short status line.
export function syncCodexCredential(asideCredentialsPath, { direction = "auto" } = {}) {
  const belmont = readJson(BELMONT_PI_AUTH_PATH) ?? {};
  const aside = readJson(asideCredentialsPath) ?? {};
  const b = belmont["openai-codex"];
  const a = aside["openai-codex"];
  if (!b && !a) return `no openai-codex credential in either file (${BELMONT_PI_AUTH_PATH})`;
  const newer = (x, y) => (x?.expires ?? 0) >= (y?.expires ?? 0) ? "belmont" : "aside";
  const winner = direction === "auto" ? newer(b, a) : direction;
  if (winner === "belmont" && b) {
    if (!a || a.access !== b.access) {
      writeJsonPrivate(asideCredentialsPath, { ...aside, "openai-codex": b });
      return `aside <- belmont (expires ${new Date(b.expires).toISOString()})`;
    }
    return "in sync";
  }
  if (winner === "aside" && a) {
    if (!b || b.access !== a.access) {
      writeJsonPrivate(BELMONT_PI_AUTH_PATH, { ...belmont, "openai-codex": a });
      return `belmont <- aside (expires ${new Date(a.expires).toISOString()})`;
    }
    return "in sync";
  }
  return "nothing to copy";
}

export function credentialSummary(file) {
  const data = readJson(file) ?? {};
  return Object.entries(data).map(([provider, c]) => `${provider}:${c.type}${c.expires ? " exp=" + new Date(c.expires).toISOString() : ""}`).join(", ") || "(empty)";
}

export function hasFile(file) {
  return existsSync(file);
}
