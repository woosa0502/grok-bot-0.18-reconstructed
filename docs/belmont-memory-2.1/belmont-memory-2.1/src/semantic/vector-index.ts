import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { assert } from "../types.js";
import type { MemoryItem, MemoryType } from "../types.js";
import type { MemorySession } from "../repository.js";
import type { EmbeddingAdapter } from "./embedding.js";
import { unit, withDeadline } from "./embedding.js";
import { allMemories } from "../learning/dreaming.js";
export const VECTOR_INDEX_VERSION = "cosine-flat-f32-v1";
export interface VectorHit { id: string; version: number; cosine: number }
/** Rebuildable local derived index. Exact cosine for personal-sized collections, not an ANN claim. */
export class VectorIndex {
  readonly #db: DatabaseSync;
  readonly indexKey: string;
  constructor(path: string, readonly adapter: EmbeddingAdapter) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS vector_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS vector_item(scope TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,type TEXT NOT NULL,valid_from INTEGER NOT NULL,valid_to INTEGER,vector BLOB NOT NULL,PRIMARY KEY(scope,id)) STRICT;
      CREATE INDEX IF NOT EXISTS vector_scope_type ON vector_item(scope,type,valid_from,valid_to);`);
    this.indexKey = createHash("sha256").update(JSON.stringify([adapter.identity,VECTOR_INDEX_VERSION])).digest("hex");
    const old = this.#db.prepare("SELECT value FROM vector_meta WHERE key='identity'").get();
    if (old?.value !== this.indexKey) this.#db.exec("DELETE FROM vector_item; DELETE FROM vector_meta;");
    this.#db.prepare("INSERT OR REPLACE INTO vector_meta VALUES('identity',?)").run(this.indexKey);
    this.#db.prepare("INSERT OR REPLACE INTO vector_meta VALUES('manifest',?)").run(JSON.stringify({ ...adapter.identity, indexVersion: VECTOR_INDEX_VERSION }));
  }
  #checkIdentity() { assert(this.#db.prepare("SELECT value FROM vector_meta WHERE key='identity'").get()?.value === this.indexKey, "INDEX_MODEL_CHANGED"); }
  close() { this.#db.close(); }
  dropScope(scope: string) { this.#db.prepare("DELETE FROM vector_item WHERE scope=?").run(scope); }
  remove(scope: string, id: string) { this.#db.prepare("DELETE FROM vector_item WHERE scope=? AND id=?").run(scope,id); }
  put(item: MemoryItem, embedding: number[]): void {
    this.#checkIdentity();
    const v = Float32Array.from(unit(embedding, this.adapter.identity.dimension));
    this.#db.prepare("INSERT INTO vector_item VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET version=excluded.version,type=excluded.type,valid_from=excluded.valid_from,valid_to=excluded.valid_to,vector=excluded.vector WHERE excluded.version>=vector_item.version")
      .run(item.scope,item.id,item.version,item.type,item.validFrom,item.validTo,Buffer.from(v.buffer));
  }
  async synchronize(session: MemorySession, scope: string, timeoutMs = 30000): Promise<number> {
    // The v1 outbox has one acknowledgement stream: this is its sole consumer, NOT an independent competing worker.
    const jobs = session.jobs(scope,1000); let done=0;
    for (const j of jobs) {
      const item = session.read(scope,j.itemId);
      if (!item) this.remove(scope,j.itemId);
      else {
        const vector = (await withDeadline(s => this.adapter.embed([`${item.title}\n${item.content}`],"passage",s),timeoutMs))[0]!;
        const current = session.read(scope,item.id);
        if (!current || current.version !== item.version) { this.remove(scope,item.id); continue; }
        this.put(item,vector);
      }
      session.acknowledge(scope,j.seq); done++;
    }
    return done;
  }
  async rebuild(session: MemorySession, scope: string, timeoutMs = 30000): Promise<number> {
    const before = session.snapshot(scope), items = allMemories(session,scope);
    const values: { item: MemoryItem; vector: number[] }[] = [];
    for (let i=0;i<items.length;i+=32) {
      const batch=items.slice(i,i+32), vectors=await withDeadline(s=>this.adapter.embed(batch.map(m=>`${m.title}\n${m.content}`),"passage",s),timeoutMs);
      batch.forEach((item,j)=>values.push({item,vector:vectors[j]!}));
    }
    const after=session.snapshot(scope);
    assert(before.epoch===after.epoch && before.generation===after.generation,"INDEX_REBUILD_STALE");
    this.#db.exec("BEGIN IMMEDIATE");
    try { this.dropScope(scope); for(const v of values) this.put(v.item,v.vector); this.#db.exec("COMMIT"); }
    catch(error){this.#db.exec("ROLLBACK");throw error;}
    return items.length;
  }
  async search(input: { scope: string; query: string; limit: number; signal: AbortSignal; at: number; types?: MemoryType[] }): Promise<VectorHit[]> {
    this.#checkIdentity();
    const q=unit((await this.adapter.embed([input.query],"query",input.signal))[0]!,this.adapter.identity.dimension);
    this.#checkIdentity();
    if(input.signal.aborted) throw new Error("ABORTED");
    const types=input.types??["episodic","semantic","preference","procedural","knowledge"];
    const rows=this.#db.prepare(`SELECT id,version,vector FROM vector_item WHERE scope=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?) AND type IN (${types.map(()=>"?").join(",")})`).all(input.scope,input.at,input.at,...types);
    return rows.map(r=>{const bytes=Uint8Array.from(r.vector as Uint8Array);const v=new Float32Array(bytes.buffer);assert(v.length===q.length,"VECTOR_DIMENSION_MISMATCH");let score=0;for(let i=0;i<v.length;i++)score+=v[i]!*q[i]!;return{id:String(r.id),version:Number(r.version),cosine:score};}).sort((a,b)=>b.cosine-a.cosine||a.id.localeCompare(b.id)).slice(0,input.limit);
  }
}
