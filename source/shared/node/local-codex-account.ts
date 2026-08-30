import { accountCacheScope } from "./cursor-token.js";

/**
 * The synthetic account the standalone (Codex/Pi) build signs in as. The desktop
 * delivers it as the coordinator auth status; the host has no Cursor account at all
 * in this mode, so anything that scopes settings "per account" must derive the SAME
 * scope from these constants — otherwise the two sides flip the stored scope on every
 * launch and each flip drops the account-scoped settings (auto-review instructions,
 * model defaults, local tool permission).
 */
export const LOCAL_CODEX_AUTH_ID = "local-codex";
export const LOCAL_CODEX_EMAIL = "local@codex";
export const LOCAL_CODEX_DISPLAY_NAME = "Belmont Local";
export const SAND_LOCAL_CODEX_MODE_ENV = "SAND_LOCAL_CODEX_MODE";

export function isLocalCodexMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SAND_LOCAL_CODEX_MODE_ENV] === "1";
}

/** Account cache scope for the local Codex account — identical on the desktop and host. */
export function localCodexAccountCacheScope(): string {
  return accountCacheScope(LOCAL_CODEX_AUTH_ID);
}
