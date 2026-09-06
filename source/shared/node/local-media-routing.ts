/** The local Codex executor projects media to text/images; Gemini keeps its native route. */
export function usesLocalMediaPreprocessing(modelId: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.SAND_LOCAL_CODEX_MODE === "1" && modelId?.startsWith("gpt-") === true;
}
