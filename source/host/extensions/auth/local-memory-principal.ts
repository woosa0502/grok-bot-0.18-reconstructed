import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJwtPayload } from "../../../shared/node/cursor-token.js";
import { isLocalCodexMode } from "../../../shared/node/local-codex-account.js";
import { isGatewayAuthenticationRequired } from "../../gateway-config.js";
import { getSandRootDir } from "../../host-paths.js";

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads identity from Belmont's own Pi OAuth store without invoking Pi,
 * refreshing credentials, or importing another CLI's login. accountId names
 * the ChatGPT account/workspace and is deliberately not a personal principal.
 */
function readPiOAuthSubject(env: NodeJS.ProcessEnv, now: number): string | null {
  const path = env.SAND_PI_CODEX_AUTH_PATH?.trim() || join(getSandRootDir(), "pi-auth.json");
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    if (typeof process.getuid === "function" && (info.uid !== process.getuid() || (info.mode & 0o022) !== 0)) return null;
    const stored: unknown = JSON.parse(readFileSync(path, "utf8"));
    const credential = record(stored) ? stored["openai-codex"] : undefined;
    if (
      !record(credential)
      || credential.type !== "oauth"
      || typeof credential.access !== "string"
      || typeof credential.refresh !== "string"
      || credential.refresh.length === 0
      || typeof credential.expires !== "number"
      || !Number.isFinite(credential.expires)
      || credential.expires <= now
    ) return null;
    const payload = parseJwtPayload(credential.access);
    if (payload?.exp == null || !Number.isFinite(payload.exp) || payload.exp * 1_000 <= now) return null;
    const subject = payload.sub?.trim();
    return subject == null || subject.length === 0 || /[\u0000-\u001f\u007f]/.test(subject)
      ? null
      : `openai-codex:${subject}`;
  } catch {
    return null;
  }
}

/**
 * Local mode authenticates incoming commands at gateway-server.handleRequest.
 * A bearer proves local access, not a user id: use an existing OAuth subject,
 * or an explicitly configured profile owner when no account subject exists.
 */
export function resolveLocalMemoryPrincipal(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string | null {
  if (!isLocalCodexMode(env) || !isGatewayAuthenticationRequired(env)) return null;
  const oauthSubject = readPiOAuthSubject(env, now);
  if (oauthSubject != null) return oauthSubject;
  const explicitOwner = env.SAND_MEMORY_LOCAL_PRINCIPAL_ID?.trim();
  return explicitOwner != null && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(explicitOwner)
    ? `local:${explicitOwner}`
    : null;
}
