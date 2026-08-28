import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export interface LocalInferenceCliStatus {
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly executablePath: string | null;
}

function firstExecutable(candidates: readonly (string | undefined)[]): string | null {
  for (const candidate of candidates) if (candidate != null && candidate.length > 0 && existsSync(candidate)) return candidate;
  return null;
}

function pathCandidates(name: string): string[] {
  return (process.env.PATH ?? "").split(delimiter).filter(Boolean).map(directory => join(directory, name));
}

export function resolveCodexCliPath(): string | null {
  const home = homedir();
  return firstExecutable([process.env.CODEX_PATH, join(home, ".local", "bin", "codex"), join(home, ".codex", "bin", "codex"), ...pathCandidates("codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]);
}

export function resolveClaudeCodeCliPath(): string | null {
  const home = homedir();
  return firstExecutable([process.env.CLAUDE_CODE_PATH, join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude"), ...pathCandidates("claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]);
}

function privateJson(path: string): unknown | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function hasUsableCodexLogin(path: string): boolean {
  return isUsableCodexChatGptAuthDocument(privateJson(path));
}

function hasUsablePiCodexLogin(path: string): boolean {
  const raw = privateJson(path);
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return false;
  const credential = (raw as Record<string, unknown>)["openai-codex"];
  if (typeof credential !== "object" || credential == null || Array.isArray(credential)) return false;
  const parsed = credential as Record<string, unknown>;
  return parsed.type === "oauth"
    && typeof parsed.access === "string" && parsed.access.length > 0
    && typeof parsed.refresh === "string" && parsed.refresh.length > 0
    && typeof parsed.expires === "number" && Number.isFinite(parsed.expires);
}

function piCodexAuthCandidates(home: string): string[] {
  const explicit = process.env.SAND_PI_CODEX_AUTH_PATH?.trim();
  const dataRoot = process.env.SAND_DATA_ROOT?.trim();
  return [
    ...(explicit == null || explicit.length === 0 ? [] : [resolve(explicit)]),
    ...(dataRoot == null || dataRoot.length === 0 ? [] : [join(resolve(dataRoot), "pi-auth.json")]),
    join(home, ".grokbot", "pi-auth.json"),
    join(home, ".cursor", "sand", "pi-auth.json"),
  ];
}

export function isUsableCodexChatGptAuthDocument(raw: unknown): boolean {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return false;
  const parsed = raw as Record<string, any>;
  const authMode = parsed.auth_mode;
  const hasApiKey = typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.length > 0;
  const isChatGptMode = authMode === "chatgpt" || (authMode == null && !hasApiKey);
  return isChatGptMode
    && typeof parsed.tokens?.access_token === "string" && parsed.tokens.access_token.length > 0
    && typeof parsed.tokens?.refresh_token === "string" && parsed.tokens.refresh_token.length > 0
    && typeof parsed.tokens?.id_token === "string" && parsed.tokens.id_token.length > 0
    && typeof parsed.tokens?.account_id === "string" && parsed.tokens.account_id.length > 0;
}

export function getLocalInferenceCliStatus(): { readonly codex: LocalInferenceCliStatus; readonly "claude-code": LocalInferenceCliStatus } {
  const home = homedir();
  const codexPath = resolveCodexCliPath();
  const claudePath = resolveClaudeCodeCliPath();
  const legacyCodexAuthPath = join(process.env.CODEX_HOME?.trim() || join(home, ".codex"), "auth.json");
  const piAuthPaths = piCodexAuthCandidates(home);
  const piConfigured = piAuthPaths.some(hasUsablePiCodexLogin);
  const migratableLegacyLogin = hasUsableCodexLogin(legacyCodexAuthPath);
  return {
    // Pi owns Codex auth and transport. A private legacy Codex login remains a
    // one-time migration source; the CLI binary is optional after migration.
    codex: {
      installed: piConfigured || migratableLegacyLogin || codexPath != null,
      authenticated: piConfigured || migratableLegacyLogin,
      executablePath: codexPath,
    },
    "claude-code": {
      installed: claudePath != null,
      authenticated: existsSync(join(home, ".claude", ".credentials.json")) || (process.env.ANTHROPIC_API_KEY?.length ?? 0) > 0,
      executablePath: claudePath,
    },
  };
}
