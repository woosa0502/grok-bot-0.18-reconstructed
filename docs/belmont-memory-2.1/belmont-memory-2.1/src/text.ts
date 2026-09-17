import { createHash, createHmac } from "node:crypto";
/** Preserve punctuation: C++ != C, -1 != 1. NOT a semantic equivalence detector. */
export function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
export function digest(key: Uint8Array, ...parts: string[]): string {
  return createHmac("sha256", key).update(JSON.stringify(parts)).digest("hex");
}
export function cjkBigrams(text: string): string[] {
  const grams = new Set<string>();
  for (const run of normalize(text).match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
    const chars = [...run];
    if (chars.length === 1) grams.add(run);
    for (let i = 0; i + 1 < chars.length; i++) grams.add(chars[i]! + chars[i + 1]!);
  }
  return [...grams];
}
/** All tokens are generated/quoted, never interpolate user FTS operators. */
export function ftsQuery(text: string, cjk = true): string {
  const normalized = normalize(text).slice(0, 512);
  const terms = new Set<string>();
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token) && cjk) {
      for (const gram of cjkBigrams(token)) terms.add(`grams:"${gram}"`);
    } else terms.add(`{title aliases body}:"${token}"`);
  }
  return [...terms].slice(0, 64).join(" OR ");
}
export interface RankedCandidate { id: string; version: number }
export interface RankedChannel { name: string; weight: number; candidates: RankedCandidate[] }
/** RRF combines ranks, not incomparable BM25/cosine magnitudes. */
export function reciprocalRankFusion(channels: RankedChannel[], k = 60) {
  const scores = new Map<string, { id: string; version: number; score: number; channels: string[] }>();
  for (const channel of channels) {
    if (!Number.isFinite(channel.weight) || channel.weight <= 0) continue;
    const seen = new Set<string>();
    channel.candidates.forEach((candidate, index) => {
      const key = `${candidate.id}:${candidate.version}`;
      if (seen.has(key)) return;
      seen.add(key);
      const entry = scores.get(key) ?? { ...candidate, score: 0, channels: [] };
      entry.score += channel.weight / (k + index + 1);
      entry.channels.push(channel.name);
      scores.set(key, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Exact compatibility with inspected Belmont memoryIdFor; do NOT NFKC-normalize before hashing. */
export function legacyMemoryId(raw: string): string {
  const key = raw.replace(/\s+/g, " ").trim().slice(0, 500).toLowerCase();
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}
