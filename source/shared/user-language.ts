/** The phone's 언어 setting: the language the user wants replies in. Empty means "follow the user's own language". */
export function normalizeUserLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 40);
  return trimmed.length === 0 ? undefined : trimmed;
}

export function renderUserLanguageSystemPrompt(language: string | null | undefined): string {
  const normalized = normalizeUserLanguage(language);
  if (normalized === undefined) return "";
  return `The user's preferred reply language is ${normalized}. Reply in it unless the user writes to you in another language, in which case follow theirs.`;
}
