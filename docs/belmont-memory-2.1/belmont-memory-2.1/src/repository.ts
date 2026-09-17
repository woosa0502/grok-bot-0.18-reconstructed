import { validateDetails } from "./learning/validate.js";
import type { MemoryDetails } from "./learning/contracts.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { SCHEMA, SCHEMA_VERSION } from "./schema.js";
import { cjkBigrams, digest, ftsQuery, legacyMemoryId, normalize } from "./text.js";
import { decide } from "./policy.js";
import { assert, finiteTime } from "./types.js";
import type { Authority, Capability, Evidence, EvidenceInput, IndexJob, MemoryItem, MemoryType, Principal, Proposal, ProposalResult, SearchHit, Snapshot, Source } from "./types.js";

type Row = Record<string, unknown>;
export interface KernelOptions {
  path: string; tombstoneKey: Uint8Array; now?: () => number;
  /** Fault injection for tests only. Production must not set this. */
  testFault?: (point: "after-item-write" | "after-forget-payload") => void;
}
export interface SearchOptions { limit?: number; at?: number; types?: MemoryType[]; cjk?: boolean }
const TYPES: MemoryType[] = ["episodic", "semantic", "preference", "procedural", "knowledge"];

/** Single logical memory authority; SQLite transactions also serialize other connections. */
export class MemoryKernel {
  readonly #db: DatabaseSync;
  readonly #key: Uint8Array;
  readonly #now: () => number;
  readonly #fault: KernelOptions["testFault"];
  constructor(options: KernelOptions) {
    assert(options.tombstoneKey.byteLength >= 32, "WEAK_TOMBSTONE_KEY");
    this.#key = new Uint8Array(options.tombstoneKey);
    this.#now = options.now ?? Date.now;
    this.#fault = options.testFault;
    this.#db = new DatabaseSync(options.path);
    try {
      this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      this.#tx(() => {
        this.#db.exec(SCHEMA);
        const version = this.#db.prepare("SELECT value FROM meta WHERE key='version'").get();
        assert(version == null || version.value === "1" || version.value === String(SCHEMA_VERSION), "UNSUPPORTED_SCHEMA");
        const expected = digest(this.#key, "belmont-memory-key-check-v1");
        const current = this.#db.prepare("SELECT value FROM meta WHERE key='key-check'").get();
        assert(current == null || current.value === expected, "TOMBSTONE_KEY_MISMATCH");
        this.#db.prepare("INSERT INTO meta VALUES ('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(SCHEMA_VERSION));
        this.#db.prepare("INSERT OR IGNORE INTO meta VALUES ('key-check',?)").run(expected);
      });
      // Logical FTS segment cleanup. WAL/backups still require separate physical retention controls.
      this.#db.exec("INSERT INTO memory_fts(memory_fts, rank) VALUES('secure-delete', 1)");
    } catch (error) { this.#db.close(); throw error; }
  }
  close(): void { this.#db.close(); }
  /** This factory is a HOST boundary, not an agent-callable tool. */
  session(principal: Principal): MemorySession {
    assert(principal.id.length > 0 && principal.id.length <= 256, "INVALID_PRINCIPAL");
    const frozen = Object.freeze({ ...principal, scopes: Object.freeze([...principal.scopes]), capabilities: Object.freeze([...principal.capabilities]) });
    return new MemorySession(this, frozen);
  }
  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.#db.exec("COMMIT"); return result; }
    catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  #authorize(p: Principal, scope: string, cap: Capability): void {
    assert(typeof scope === "string" && scope.length > 0 && scope.length <= 256, "INVALID_SCOPE");
    assert(p.scopes.includes(scope) && p.capabilities.includes(cap), "FORBIDDEN");
  }
  #ensureScope(scope: string): void { this.#db.prepare("INSERT OR IGNORE INTO scope_state(id) VALUES(?)").run(scope); }
  #snapshot(scope: string): Snapshot {
    const row = this.#db.prepare("SELECT epoch,generation FROM scope_state WHERE id=?").get(scope);
    return { scope, epoch: Number(row?.epoch ?? 0), generation: Number(row?.generation ?? 0) };
  }
  #bump(scope: string, epoch = false): void {
    this.#db.prepare(`UPDATE scope_state SET generation=generation+1${epoch ? ",epoch=epoch+1" : ""} WHERE id=?`).run(scope);
  }
  snapshot(p: Principal, scope: string): Snapshot { this.#authorize(p, scope, "read"); return this.#snapshot(scope); }
  #event(scope: string, action: string, id: string | null): void {
    this.#db.prepare("INSERT INTO memory_event(scope,action,item_id,at) VALUES(?,?,?,?)").run(scope, action, id, this.#now());
  }
  #evidence(row: Row): Evidence {
    return { id: String(row.id), scope: String(row.scope), source: row.source as Source, content: row.content == null ? null : String(row.content), occurredAt: Number(row.occurred_at), recordedAt: Number(row.recorded_at), revokedAt: row.revoked_at == null ? null : Number(row.revoked_at) };
  }
  capture(p: Principal, input: EvidenceInput): Evidence {
    this.#authorize(p, input.scope, "capture");
    assert(typeof input.content === "string" && input.content.length > 0 && input.content.length <= 64_000, "INVALID_EVIDENCE");
    assert(typeof input.sourceRef === "string" && input.sourceRef.length > 0 && input.sourceRef.length <= 1024, "INVALID_SOURCE_REF");
    assert(finiteTime(input.occurredAt) && Number.isSafeInteger(input.expectedEpoch), "INVALID_TIME");
    const sources: Record<Principal["actor"], Source[]> = {
      user: ["user-message"], aside: ["browser", "tool-outcome"],
      agent: ["assistant", "tool-outcome"], consolidator: ["assistant"], migrator: ["legacy"],
    };
    assert(sources[p.actor]?.includes(input.source), "SOURCE_SPOOFING");
    return this.#tx(() => {
      this.#ensureScope(input.scope);
      assert(this.#snapshot(input.scope).epoch === input.expectedEpoch, "STALE_EPOCH");
      // Source identity is bound to source class; no plaintext URL/account IDs in the ledger key.
      const refDigest = digest(this.#key, "source", input.source, input.sourceRef);
      const prior = this.#db.prepare("SELECT * FROM evidence WHERE scope=? AND ref_digest=?").get(input.scope, refDigest);
      if (prior != null) {
        assert(prior.revoked_at == null, "EVIDENCE_REVOKED");
        assert(prior.content === input.content && prior.occurred_at === input.occurredAt, "SOURCE_ID_CONFLICT");
        return this.#evidence(prior);
      }
      const id = randomUUID(), now = this.#now();
      this.#db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?,?,NULL)").run(id, input.scope, input.source, refDigest, input.content, input.occurredAt, now);
      this.#bump(input.scope); this.#event(input.scope, "capture", id);
      return { id, scope: input.scope, source: input.source, content: input.content, occurredAt: input.occurredAt, recordedAt: now, revokedAt: null };
    });
  }
  evidence(p: Principal, scope: string, id: string): Evidence | null {
    this.#authorize(p, scope, "read");
    const row = this.#db.prepare("SELECT * FROM evidence WHERE id=? AND scope=? AND revoked_at IS NULL").get(id, scope);
    return row == null ? null : this.#evidence(row);
  }
  #item(row: Row): MemoryItem {
    const evidenceIds = this.#db.prepare("SELECT evidence_id FROM memory_evidence WHERE item_id=? ORDER BY evidence_id").all(String(row.id)).map((e) => String(e.evidence_id));
    const detailRow = this.#db.prepare("SELECT payload FROM memory_details WHERE item_id=?").get(String(row.id));
    return { ...(detailRow ? { details: JSON.parse(String(detailRow.payload)) as MemoryDetails } : {}), id: String(row.id), scope: String(row.scope), type: row.type as MemoryType, content: String(row.content), title: String(row.title), aliases: JSON.parse(String(row.aliases)) as string[], authority: row.authority as Authority, version: Number(row.version), validFrom: Number(row.valid_from), validTo: row.valid_to == null ? null : Number(row.valid_to), recordedAt: Number(row.recorded_at), updatedAt: Number(row.updated_at), evidenceIds };
  }
  #read(scope: string, id: string): MemoryItem | null {
    const row = this.#db.prepare(`SELECT * FROM memory_item m WHERE m.id=? AND m.scope=? AND m.status='active'
      AND NOT EXISTS (SELECT 1 FROM memory_evidence me JOIN evidence e ON e.id=me.evidence_id WHERE me.item_id=m.id AND e.revoked_at IS NOT NULL)`).get(id, scope);
    return row == null ? null : this.#item(row);
  }
  read(p: Principal, scope: string, id: string): MemoryItem | null { this.#authorize(p, scope, "read"); return this.#read(scope, id); }
  list(p: Principal, scope: string, limit = 100): MemoryItem[] {
    this.#authorize(p, scope, "read"); assert(Number.isInteger(limit) && limit >= 1 && limit <= 1000, "INVALID_LIMIT");
    return this.#db.prepare("SELECT id FROM memory_item WHERE scope=? AND status='active' ORDER BY updated_at DESC,id LIMIT ?").all(scope, limit).flatMap((r) => { const m = this.#read(scope, String(r.id)); return m == null ? [] : [m]; });
  }
  page(p: Principal, scope: string, after = "", limit = 200): MemoryItem[] {
    this.#authorize(p, scope, "read"); assert(Number.isInteger(limit) && limit > 0 && limit <= 1000, "INVALID_LIMIT");
    return this.#db.prepare("SELECT id FROM memory_item WHERE scope=? AND status='active' AND id>? ORDER BY id LIMIT ?").all(scope, after, limit).flatMap(r => { const m = this.#read(scope, String(r.id)); return m ? [m] : []; });
  }
  #checkProposal(input: Proposal): void {
    assert(TYPES.includes(input.type) && typeof input.content === "string", "INVALID_PROPOSAL");
    assert(normalize(input.content).length > 0 && input.content.length <= 4000, "INVALID_CONTENT");
    assert(input.title == null || typeof input.title === "string" && input.title.length <= 256, "INVALID_TITLE");
    assert(input.aliases == null || Array.isArray(input.aliases) && input.aliases.length <= 16 && input.aliases.every((a) => typeof a === "string" && a.length <= 128), "INVALID_ALIASES");
    assert(Array.isArray(input.evidenceIds) && input.evidenceIds.length > 0 && input.evidenceIds.length <= 64 && input.evidenceIds.every((x) => typeof x === "string"), "EVIDENCE_REQUIRED");
    assert(input.parentIds == null || Array.isArray(input.parentIds) && input.parentIds.length <= 32 && input.parentIds.every((x) => typeof x === "string"), "INVALID_PARENTS");
    assert(typeof input.idempotencyKey === "string" && input.idempotencyKey.length > 0 && input.idempotencyKey.length <= 256, "INVALID_IDEMPOTENCY_KEY");
    assert(input.validFrom == null || finiteTime(input.validFrom), "INVALID_TIME");
    assert(input.validTo == null || finiteTime(input.validTo) && input.validTo > (input.validFrom ?? this.#now()), "INVALID_TIME_RANGE");
    assert(input.basedOn != null && input.basedOn.scope === input.scope, "INVALID_SNAPSHOT");
    // Unknown authority/origin/actor fields are never consulted by the policy.
  }
  propose(p: Principal, input: Proposal): ProposalResult { return this.batch(p, input.scope, [input])[0]!; }
  batch(p: Principal, scope: string, inputs: Proposal[]): ProposalResult[] {
    this.#authorize(p, scope, "propose");
    assert(inputs.length > 0 && inputs.length <= 64, "INVALID_BATCH");
    for (const input of inputs) { assert(input.scope === scope, "CROSS_SCOPE_BATCH"); this.#checkProposal(input); }
    const targets = inputs.flatMap((i) => i.target == null ? [] : [i.target.id]);
    assert(new Set(targets).size === targets.length, "DUPLICATE_TARGET");
    return this.#tx(() => {
      this.#ensureScope(scope);
      const before = this.#snapshot(scope);
      const results = inputs.map((input) => this.#write(p, input, before));
      // An invalid/review-only batch commits NOTHING; return its decisions without partial writes.
      if (results.some((r) => r.status !== "committed")) throw new BatchNotCommitted(results);
      return results;
    });
  }
  #write(p: Principal, input: Proposal, before: Snapshot): ProposalResult {
    const key = digest(this.#key, "receipt", p.id, input.idempotencyKey);
    const { basedOn: _snapshot, ...intent } = input;
    const request = digest(this.#key, "request", JSON.stringify(intent));
    const prior = this.#db.prepare("SELECT * FROM receipt WHERE scope=? AND key_digest=?").get(input.scope, key);
    if (prior != null) {
      assert(prior.request_digest === request, "IDEMPOTENCY_CONFLICT");
      return { status: "committed", id: String(prior.item_id), version: Number(prior.version) };
    }
    assert(before.epoch === input.basedOn.epoch && before.generation === input.basedOn.generation, "STALE_SNAPSHOT");
    let target: MemoryItem | undefined;
    if (input.target != null) {
      target = this.#read(input.scope, input.target.id) ?? undefined;
      assert(target != null && target.version === input.target.expectedVersion, "STALE_ITEM");
      assert(target.type === input.type, "IMMUTABLE_MEMORY_TYPE");
    }
    const ids = new Set([...input.evidenceIds, ...(target?.evidenceIds ?? [])]);
    for (const parentId of input.parentIds ?? []) {
      assert(parentId !== target?.id, "SELF_DEPENDENCY");
      const parent = this.#read(input.scope, parentId); assert(parent != null, "INVALID_PARENT");
      // Reject cycles when an existing item is amended to depend on its descendant.
      if (target != null) {
        const cycle = this.#db.prepare(`WITH RECURSIVE descendants(id) AS (SELECT child_id FROM dependency WHERE parent_id=? UNION SELECT d.child_id FROM dependency d JOIN descendants x ON d.parent_id=x.id) SELECT 1 FROM descendants WHERE id=? LIMIT 1`).get(target.id, parentId);
        assert(cycle == null, "DEPENDENCY_CYCLE");
      }
      parent.evidenceIds.forEach((id) => ids.add(id));
    }
    assert(ids.size <= 256, "EVIDENCE_LINEAGE_TOO_LARGE");
    const evidence = [...ids].map((id) => {
      const row = this.#db.prepare("SELECT * FROM evidence WHERE id=? AND scope=? AND revoked_at IS NULL").get(id, input.scope);
      assert(row != null, "INVALID_EVIDENCE_REFERENCE"); return this.#evidence(row);
    });
    validateDetails(p, input, evidence, target);
    const decision = decide(p, input, evidence, target);
    if (!decision.allow) return { status: decision.status, reason: decision.reason };
    const content = normalize(input.content);
    const deleted = this.#db.prepare("SELECT 1 FROM tombstone WHERE scope=? AND digest=?").get(input.scope, digest(this.#key, "fact", content));
    const legacyDeleted = this.#db.prepare("SELECT 1 FROM legacy_tombstone WHERE scope=? AND legacy_id IN (?,?)").get(input.scope, legacyMemoryId(input.content), legacyMemoryId(content));
    if (deleted != null || legacyDeleted != null) return { status: "rejected", reason: "TOMBSTONED" };
    const now = this.#now(), id = target?.id ?? randomUUID(), version = (target?.version ?? 0) + 1;
    const title = normalize(input.title ?? ""), aliases = (input.aliases ?? []).map(normalize);
    const validFrom = input.validFrom ?? now, validTo = input.validTo ?? null;
    if (target == null) {
      this.#db.prepare("INSERT INTO memory_item VALUES(?,?,?,?,?,?,?,'active',?,?,?,?,?)").run(id, input.scope, input.type, content, title, JSON.stringify(aliases), decision.authority, version, validFrom, validTo, now, now);
    } else {
      this.#db.prepare("UPDATE memory_item SET content=?,title=?,aliases=?,authority=?,version=?,valid_from=?,valid_to=?,updated_at=? WHERE id=?").run(content, title, JSON.stringify(aliases), decision.authority, version, validFrom, validTo, now, id);
    }
    if (input.details != null) this.#db.prepare("INSERT INTO memory_details VALUES(?,?) ON CONFLICT(item_id) DO UPDATE SET payload=excluded.payload").run(id, JSON.stringify(input.details));
    this.#fault?.("after-item-write");
    const link = this.#db.prepare("INSERT OR IGNORE INTO memory_evidence VALUES(?,?)");
    ids.forEach((e) => link.run(id, e));
    for (const parentId of input.parentIds ?? []) this.#db.prepare("INSERT OR IGNORE INTO dependency VALUES(?,?)").run(parentId, id);
    const item = this.#read(input.scope, id)!;
    this.#db.prepare("INSERT INTO revision VALUES(?,?,?,?)").run(id, version, JSON.stringify(item), now);
    this.#index(item);
    this.#db.prepare("INSERT INTO outbox(scope,item_id,version,operation) VALUES(?,?,?,'upsert')").run(input.scope, id, version);
    this.#db.prepare("INSERT INTO receipt VALUES(?,?,?,?,?)").run(input.scope, key, request, id, version);
    this.#bump(input.scope); this.#event(input.scope, target == null ? "create" : "update", id);
    return { status: "committed", id, version };
  }
  #index(item: MemoryItem): void {
    this.#db.prepare("DELETE FROM memory_fts WHERE item_id=?").run(item.id);
    this.#db.prepare("INSERT INTO memory_fts(item_id,title,aliases,body,grams) VALUES(?,?,?,?,?)").run(item.id, item.title, item.aliases.join(" "), item.content, cjkBigrams(`${item.title} ${item.aliases.join(" ")} ${item.content}`).join(" "));
  }
  search(p: Principal, scope: string, query: string, options: SearchOptions = {}): SearchHit[] {
    this.#authorize(p, scope, "read");
    const limit = options.limit ?? 10, at = options.at ?? this.#now(), types = options.types ?? TYPES;
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 200, "INVALID_LIMIT");
    assert(finiteTime(at) && types.length > 0 && types.length <= TYPES.length && types.every((t) => TYPES.includes(t)), "INVALID_FILTER");
    const expr = ftsQuery(query, options.cjk ?? true); if (!expr) return [];
    const rows = this.#db.prepare(`SELECT m.*, bm25(memory_fts,0,6.0,4.0,1.0,1.5) AS score
      FROM memory_fts JOIN memory_item m ON m.id=memory_fts.item_id
      WHERE memory_fts MATCH ? AND m.scope=? AND m.status='active'
      AND m.valid_from<=? AND (m.valid_to IS NULL OR m.valid_to>?)
      AND m.type IN (${types.map(() => "?").join(",")})
      AND NOT EXISTS (SELECT 1 FROM memory_evidence me JOIN evidence e ON e.id=me.evidence_id WHERE me.item_id=m.id AND e.revoked_at IS NOT NULL)
      ORDER BY score,m.id LIMIT ?`).all(expr, scope, at, at, ...types, limit);
    return rows.map((row) => ({ item: this.#item(row), score: -Number(row.score), channels: ["sparse"] }));
  }
  forget(p: Principal, scope: string, id: string): { forgotten: number; epoch: number } {
    this.#authorize(p, scope, "forget"); assert(p.actor === "user", "USER_FORGET_REQUIRED");
    return this.#tx(() => {
      this.#ensureScope(scope);
      const item = this.#read(scope, id); assert(item != null, "NOT_FOUND");
      const count = this.#erase(scope, [id]); this.#bump(scope, true); this.#event(scope, "forget", id);
      return { forgotten: count, epoch: this.#snapshot(scope).epoch };
    });
  }
  clear(p: Principal, scope: string): { forgotten: number; epoch: number } {
    this.#authorize(p, scope, "forget"); assert(p.actor === "user", "USER_FORGET_REQUIRED");
    return this.#tx(() => {
      this.#ensureScope(scope);
      const ids = this.#db.prepare("SELECT id FROM memory_item WHERE scope=? AND status='active'").all(scope).map((r) => String(r.id));
      const count = this.#erase(scope, ids);
      this.#db.prepare("UPDATE evidence SET content=NULL,revoked_at=COALESCE(revoked_at,?) WHERE scope=?").run(this.#now(), scope);
      this.#db.prepare("DELETE FROM receipt WHERE scope=?").run(scope);
      // Increment even for an empty scope: otherwise an old queued task can refill it.
      this.#bump(scope, true); this.#event(scope, "clear", null);
      return { forgotten: count, epoch: this.#snapshot(scope).epoch };
    });
  }
  #erase(scope: string, seeds: string[]): number {
    const affected = new Set(seeds), evidenceIds = new Set<string>();
    // Conservative erasure closure over original evidence and derivation links.
    let changed = true;
    while (changed) {
      const count = affected.size + evidenceIds.size;
      for (const id of affected) {
        for (const row of this.#db.prepare("SELECT evidence_id FROM memory_evidence WHERE item_id=?").all(id)) evidenceIds.add(String(row.evidence_id));
        for (const row of this.#db.prepare("SELECT child_id FROM dependency WHERE parent_id=?").all(id)) affected.add(String(row.child_id));
      }
      for (const id of evidenceIds) for (const row of this.#db.prepare("SELECT m.id FROM memory_evidence me JOIN memory_item m ON m.id=me.item_id WHERE me.evidence_id=? AND m.scope=? AND m.status='active'").all(id, scope)) affected.add(String(row.id));
      changed = count !== affected.size + evidenceIds.size;
    }
    const now = this.#now(); let removed = 0;
    for (const id of affected) {
      const row = this.#db.prepare("SELECT * FROM memory_item WHERE id=? AND scope=? AND status='active'").get(id, scope);
      if (row == null) continue;
      const payloads = this.#db.prepare("SELECT payload FROM revision WHERE item_id=?").all(id);
      const contents = [String(row.content), ...payloads.map((r) => (JSON.parse(String(r.payload)) as MemoryItem).content)];
      for (const content of contents) this.#db.prepare("INSERT OR IGNORE INTO tombstone VALUES(?,?,?)").run(scope, digest(this.#key, "fact", normalize(content)), now);
      this.#db.prepare("DELETE FROM memory_fts WHERE item_id=?").run(id);
      this.#db.prepare("DELETE FROM revision WHERE item_id=?").run(id);
      this.#db.prepare("DELETE FROM memory_details WHERE item_id=?").run(id);
      this.#db.prepare("DELETE FROM receipt WHERE item_id=?").run(id);
      this.#db.prepare("DELETE FROM outbox WHERE item_id=?").run(id);
      this.#db.prepare("DELETE FROM dependency WHERE parent_id=? OR child_id=?").run(id, id);
      this.#db.prepare("DELETE FROM memory_evidence WHERE item_id=?").run(id);
      const version = Number(row.version) + 1;
      this.#db.prepare("UPDATE memory_item SET content='',title='',aliases='[]',status='forgotten',version=?,updated_at=? WHERE id=?").run(version, now, id);
      this.#db.prepare("INSERT INTO outbox(scope,item_id,version,operation) VALUES(?,?,?,'delete')").run(scope, id, version);
      removed++;
    }
    this.#fault?.("after-forget-payload");
    for (const id of evidenceIds) this.#db.prepare("UPDATE evidence SET content=NULL,revoked_at=COALESCE(revoked_at,?) WHERE id=? AND scope=?").run(now, id, scope);
    return removed;
  }
  /** Run before importing facts. An old explicit marker is NOT proof of user consent. */
  importLegacyTombstones(p: Principal, scope: string, ids: readonly string[]): number {
    this.#authorize(p, scope, "migrate"); assert(p.actor === "migrator", "MIGRATOR_REQUIRED");
    assert(Array.isArray(ids) && ids.length <= 10000 && ids.every((id) => typeof id === "string" && /^[a-f0-9]{16}$/.test(id)), "INVALID_LEGACY_TOMBSTONE");
    return this.#tx(() => {
      this.#ensureScope(scope);
      const missing = [...new Set(ids)].filter((id) => this.#db.prepare("SELECT 1 FROM legacy_tombstone WHERE scope=? AND legacy_id=?").get(scope, id) == null);
      if (missing.length === 0) return 0;
      assert(this.#db.prepare("SELECT 1 FROM memory_item WHERE scope=? AND status='active' LIMIT 1").get(scope) == null, "LEGACY_BARRIERS_MUST_PRECEDE_IMPORT");
      const insert = this.#db.prepare("INSERT INTO legacy_tombstone VALUES(?,?,?)");
      missing.forEach((id) => insert.run(scope, id, this.#now()));
      this.#bump(scope, true); this.#event(scope, "legacy-barriers-imported", null);
      return missing.length;
    });
  }
  rebuild(p: Principal, scope: string): number {
    this.#authorize(p, scope, "index");
    return this.#tx(() => {
      this.#db.prepare("DELETE FROM memory_fts WHERE item_id IN (SELECT id FROM memory_item WHERE scope=?)").run(scope);
      const rows = this.#db.prepare("SELECT * FROM memory_item WHERE scope=? AND status='active'").all(scope);
      for (const row of rows) { const item = this.#read(scope, String(row.id)); if (item != null) this.#index(item); }
      return rows.length;
    });
  }
  jobs(p: Principal, scope: string, limit = 100): IndexJob[] {
    this.#authorize(p, scope, "index"); assert(Number.isInteger(limit) && limit > 0 && limit <= 1000, "INVALID_LIMIT");
    return this.#db.prepare("SELECT * FROM outbox WHERE scope=? ORDER BY seq LIMIT ?").all(scope, limit).map((r) => ({ seq: Number(r.seq), scope, itemId: String(r.item_id), version: Number(r.version), operation: r.operation as "upsert" | "delete" }));
  }
  acknowledge(p: Principal, scope: string, seq: number): void {
    this.#authorize(p, scope, "index");
    this.#db.prepare("DELETE FROM outbox WHERE scope=? AND seq=?").run(scope, seq);
  }
  history(p: Principal, scope: string, id: string): MemoryItem[] {
    this.#authorize(p, scope, "read"); if (this.#read(scope, id) == null) return [];
    return this.#db.prepare("SELECT payload FROM revision WHERE item_id=? ORDER BY version").all(id).map((r) => JSON.parse(String(r.payload)) as MemoryItem);
  }
}
class BatchNotCommitted extends Error {
  constructor(readonly results: ProposalResult[]) { super("Batch not committed"); }
}
/** Caller-bound façade. Its principal must never be supplied by the LLM. */
export class MemorySession {
  constructor(private readonly kernel: MemoryKernel, private readonly principal: Principal) {}
  snapshot(scope: string) { return this.kernel.snapshot(this.principal, scope); }
  capture(input: EvidenceInput) { return this.kernel.capture(this.principal, input); }
  evidence(scope: string, id: string) { return this.kernel.evidence(this.principal, scope, id); }
  read(scope: string, id: string) { return this.kernel.read(this.principal, scope, id); }
  page(scope: string, after?: string, limit?: number) { return this.kernel.page(this.principal, scope, after, limit); }
  list(scope: string, limit?: number) { return this.kernel.list(this.principal, scope, limit); }
  propose(input: Proposal): ProposalResult {
    try { return this.kernel.propose(this.principal, input); }
    catch (error) { if (error instanceof BatchNotCommitted) return error.results[0]!; throw error; }
  }
  batch(scope: string, inputs: Proposal[]): ProposalResult[] {
    try { return this.kernel.batch(this.principal, scope, inputs); }
    catch (error) {
      if (error instanceof BatchNotCommitted) return error.results.map((r) => r.status === "committed" ? { status: "rejected", reason: "BATCH_ROLLED_BACK" } : r);
      throw error;
    }
  }
  search(scope: string, query: string, options?: SearchOptions) { return this.kernel.search(this.principal, scope, query, options); }
  forget(scope: string, id: string) { return this.kernel.forget(this.principal, scope, id); }
  clear(scope: string) { return this.kernel.clear(this.principal, scope); }
  importLegacyTombstones(scope: string, ids: readonly string[]) { return this.kernel.importLegacyTombstones(this.principal, scope, ids); }
  rebuild(scope: string) { return this.kernel.rebuild(this.principal, scope); }
  jobs(scope: string, limit?: number) { return this.kernel.jobs(this.principal, scope, limit); }
  acknowledge(scope: string, seq: number) { return this.kernel.acknowledge(this.principal, scope, seq); }
  history(scope: string, id: string) { return this.kernel.history(this.principal, scope, id); }
}
