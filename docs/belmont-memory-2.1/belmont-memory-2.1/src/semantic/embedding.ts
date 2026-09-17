import { assert } from "../types.js";
export interface EmbeddingIdentity { model: string; revision: string; dimension: number; recipe: string }
export interface EmbeddingAdapter {
  readonly identity: EmbeddingIdentity;
  embed(texts: string[], purpose: "query" | "passage", signal: AbortSignal): Promise<number[][]>;
}
export function unit(vector: number[], dimension: number): number[] {
  assert(Array.isArray(vector) && vector.length === dimension && vector.every(Number.isFinite), "INVALID_EMBEDDING");
  const norm = Math.sqrt(vector.reduce((s,v) => s + v*v,0)); assert(norm > 1e-12, "ZERO_EMBEDDING");
  return vector.map(v => v / norm);
}
/** Real HTTP production adapter; works with the included E5 service. No hash/fake embedding fallback. */
export class HttpEmbeddingAdapter implements EmbeddingAdapter {
  constructor(readonly identity: EmbeddingIdentity, private readonly url: string, private readonly token?: string) {
    assert(identity.revision !== "main" && identity.revision.length > 0 && identity.dimension > 0, "PIN_MODEL_REVISION");
    const endpoint = new URL(url); assert(endpoint.protocol === "https:" || endpoint.protocol === "http:" && ["127.0.0.1","localhost","[::1]"].includes(endpoint.hostname), "INSECURE_EMBEDDING_ENDPOINT");
  }
  async embed(texts: string[], purpose: "query" | "passage", signal: AbortSignal): Promise<number[][]> {
    assert(texts.length > 0 && texts.length <= 64 && texts.every(t => t.length <= 64000), "INVALID_EMBEDDING_BATCH");
    const r = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      signal, body: JSON.stringify({ texts, purpose, identity: this.identity }) });
    assert(r.ok, `EMBEDDING_HTTP_${r.status}`);
    const data = await r.json() as { identity: EmbeddingIdentity; embeddings: number[][] };
    assert(data.identity != null && data.identity.model === this.identity.model && data.identity.revision === this.identity.revision && data.identity.dimension === this.identity.dimension && data.identity.recipe === this.identity.recipe, "EMBEDDING_IDENTITY_MISMATCH");
    assert(Array.isArray(data.embeddings) && data.embeddings.length === texts.length, "EMBEDDING_COUNT_MISMATCH");
    return data.embeddings.map(v => unit(v, this.identity.dimension));
  }
}
export async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("DENSE_TIMEOUT")); }, milliseconds); });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  finally { clearTimeout(timer!); controller.abort(); }
}
