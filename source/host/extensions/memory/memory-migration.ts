import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { normalizeMemoryContent } from "../../runner/sand-memory.js";
import { inspectLegacyMarkdown } from "./kernel/legacy-import.js";
import type { MemorySession } from "./kernel/repository.js";
import { legacyMemoryId, normalize } from "./kernel/text.js";

export const MEMORY_ROLLOUT_STAGES = ["legacy", "frozen", "inventory", "barriers", "imported", "validation-ready", "shadow-read", "canonical"] as const;
export type MemoryRolloutStage = typeof MEMORY_ROLLOUT_STAGES[number];
export interface MemoryRolloutState {
  version: 1;
  stage: MemoryRolloutStage;
  revision: number;
  updatedAt: number;
  migrationId?: string;
  inventoryDigest?: string;
  validationAuthorization?: { approvedBy: string; validationArtifact: string; inventoryDigest: string };
  /** Pausing canonical writes never re-enables Markdown or discards deletion epochs. */
  canonicalWritesPaused?: boolean;
}
export interface MemoryMigrationShard {
  memoryDir: string;
  scope: string;
  kind: "agent" | "user" | "project";
  agentId?: string;
  project?: string;
}
interface SourceFile {
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
  rawBase64: string;
}
export interface MemoryMigrationIssue { path: string; line?: number; reason: string }
interface SourceFact {
  scope: string;
  file: string;
  line: number;
  legacyId: string;
  kind: "profile" | "log";
  createdAt: number;
  rawContent: string;
  legacyContent: string;
  canonicalContent: string;
  legacyOrigin: "explicit" | "synthesis" | "legacy";
  normalizationChanged: boolean;
}
export interface MemoryMigrationInventory {
  version: 1;
  migrationId: string;
  sandRoot: string;
  agentsRootDir: string;
  shards: MemoryMigrationShard[];
  files: SourceFile[];
  facts: SourceFact[];
  tombstones: Array<{ scope: string; path: string; legacyId: string }>;
  issues: MemoryMigrationIssue[];
  digest: string;
}
interface ImportRecord {
  scope: string;
  file: string;
  legacyId: string;
  lines: number[];
  status: "committed" | "tombstoned" | "rejected" | "review_required";
  canonicalId?: string;
  evidenceIds?: string[];
  reason?: string;
}
interface ImportLedger { version: 1; migrationId: string; inventoryDigest: string; barrierScopes: string[]; records: Record<string, ImportRecord> }
export interface MemoryMigrationOptions {
  sandRoot: string;
  agentsRootDir?: string;
  resolveScope(memoryDir: string): string;
  /** Host constructs a stable actor=migrator principal with read/capture/propose/migrate. */
  createSession(scopes: readonly string[]): MemorySession;
  now?: () => number;
}

export function memoryRolloutPath(sandRoot: string): string { return join(sandRoot, "memory-2.1", "rollout.json"); }
export function canonicalMemoryDatabasePath(sandRoot: string): string { return join(sandRoot, "memory-2.1", "canonical.sqlite"); }
export function memoryTombstoneKeyPath(sandRoot: string): string { return join(sandRoot, "memory-2.1", "tombstone.key"); }

/** Persistent state wins over runtime feature flags. A corrupt state never means legacy. */
export function readMemoryRolloutState(sandRoot: string): MemoryRolloutState {
  const path = memoryRolloutPath(sandRoot);
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if (isMissing(error)) return { version: 1, stage: "legacy", revision: 0, updatedAt: 0 };
    throw error;
  }
  const value = JSON.parse(raw) as MemoryRolloutState;
  requireMigration(value != null && value.version === 1 && MEMORY_ROLLOUT_STAGES.includes(value.stage)
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0, "INVALID_ROLLOUT_STATE");
  if (value.stage !== "legacy") requireMigration(typeof value.migrationId === "string" && value.migrationId.length > 0, "MISSING_MIGRATION_ID");
  if (!["legacy", "frozen"].includes(value.stage)) requireMigration(typeof value.inventoryDigest === "string" && /^[a-f0-9]{64}$/u.test(value.inventoryDigest), "MISSING_INVENTORY_DIGEST");
  return value;
}

/** Called by every legacy write, including markers and synthesis refresh metadata. */
export function assertLegacyMemoryWritable(memoryDir: string): void {
  const paths = new Set([resolve(memoryDir)]);
  let existing = resolve(memoryDir);
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  paths.add(resolve(realpathSync(existing), relative(existing, resolve(memoryDir))));
  for (const path of paths) {
    let directory = path;
    for (;;) {
      // Only ENOENT means no installation metadata. EACCES/corruption must not
      // silently turn the old Markdown writer back on.
      const state = readMemoryRolloutState(directory);
      requireMigration(state.stage === "legacy", `LEGACY_WRITER_FROZEN:${state.stage}`);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
}

/** Descriptors retain each source shard as its own scope; no user/project merge. */
export function discoverMemoryMigrationShards(options: Pick<MemoryMigrationOptions, "sandRoot" | "agentsRootDir" | "resolveScope">): MemoryMigrationShard[] {
  const sandRoot = resolve(options.sandRoot), agentsRoot = resolve(options.agentsRootDir ?? join(sandRoot, "agents"));
  requireContained(sandRoot, agentsRoot);
  const shards = new Map<string, MemoryMigrationShard>();
  const add = (memoryDir: string, details: Omit<MemoryMigrationShard, "memoryDir" | "scope">): void => {
    if (!directoryExists(memoryDir)) return;
    const path = resolve(memoryDir), scope = options.resolveScope(path);
    requireMigration(scope.length > 0 && scope.length <= 256, "INVALID_MIGRATION_SCOPE");
    shards.set(path, { memoryDir: path, scope, ...details });
  };
  for (const agentId of childDirectories(agentsRoot)) add(join(agentsRoot, agentId, "memory"), { kind: "agent", agentId });
  const shared = (root: string, details: Pick<MemoryMigrationShard, "kind" | "project">): void => {
    if (!directoryExists(root)) return;
    // Direct-root legacy facts and metadata are inventoried separately from writer shards.
    if (["profile.md", "log", ".dreaming"].some((name) => existsSync(join(root, name)))) add(root, details);
    for (const layout of ["agents", ".shards"]) {
      for (const agentId of childDirectories(join(root, layout))) add(join(root, layout, agentId), { ...details, agentId });
    }
  };
  shared(join(sandRoot, "user-memory"), { kind: "user" });
  for (const project of childDirectories(join(sandRoot, "projects"))) shared(join(sandRoot, "projects", project, "memory"), { kind: "project", project });
  const result = [...shards.values()].sort((a, b) => a.memoryDir.localeCompare(b.memoryDir));
  requireMigration(new Set(result.map((shard) => shard.scope)).size === result.length, "MIGRATION_SCOPE_COLLISION");
  return result;
}

/** Explicit administrative entrypoint. Construction never freezes, imports, or cuts over. */
export class MemoryMigration {
  readonly sandRoot: string;
  readonly agentsRootDir: string;
  private readonly directory: string;
  private readonly now: () => number;
  constructor(private readonly options: MemoryMigrationOptions) {
    this.sandRoot = resolve(options.sandRoot);
    this.agentsRootDir = resolve(options.agentsRootDir ?? join(this.sandRoot, "agents"));
    this.directory = join(this.sandRoot, "memory-2.1");
    this.now = options.now ?? Date.now;
    requireContained(this.sandRoot, this.agentsRootDir);
  }
  state(): MemoryRolloutState { return readMemoryRolloutState(this.sandRoot); }
  /** Compatibility lookup only. Callers must revalidate every UUID in the kernel. */
  resolveLegacyIds(scope: string, legacyId: string): string[] {
    if (!/^[a-f0-9]{16}$/u.test(legacyId) || ["legacy", "frozen"].includes(this.state().stage)) return [];
    const ledger = this.readImports(this.readInventory());
    return [...new Set(Object.values(ledger.records).flatMap((record) => record.scope === scope && record.legacyId === legacyId && record.status === "committed" && record.canonicalId != null ? [record.canonicalId] : []))].sort();
  }
  readInventory(): MemoryMigrationInventory {
    const inventory = readJson<MemoryMigrationInventory>(join(this.directory, "inventory.json"));
    const state = this.state();
    requireMigration(inventory.version === 1 && inventory.migrationId === state.migrationId && inventory.digest === state.inventoryDigest && inventory.digest === inventoryDigest(inventory), "INVENTORY_MISMATCH");
    return inventory;
  }
  freeze(): MemoryRolloutState {
    return this.locked(() => {
      const state = this.state();
      if (state.stage !== "legacy") return state;
      return this.advance(state, "frozen", { migrationId: randomUUID() });
    });
  }
  inventory(): MemoryMigrationInventory {
    return this.locked(() => {
      const state = this.requireStage("frozen", "inventory");
      if (state.stage === "inventory") { const current = this.readInventory(); this.assertSourcesUnchanged(current); return current; }
      const inventory = this.collect(state.migrationId!);
      this.assertSourcesUnchanged(inventory);
      atomicJson(join(this.directory, "inventory.json"), inventory);
      atomicJson(join(this.directory, "imports.json"), { version: 1, migrationId: inventory.migrationId, inventoryDigest: inventory.digest, barrierScopes: [], records: {} } satisfies ImportLedger);
      this.advance(state, "inventory", { inventoryDigest: inventory.digest });
      return inventory;
    });
  }
  importBarriers(): MemoryRolloutState {
    return this.locked(() => {
      const state = this.requireStage("inventory", "barriers"), inventory = this.readInventory();
      this.assertImportable(inventory); this.assertSourcesUnchanged(inventory);
      const session = this.options.createSession(inventory.shards.map((shard) => shard.scope)), ledger = this.readImports(inventory);
      for (const { scope } of inventory.shards) {
        const ids = inventory.tombstones.filter((barrier) => barrier.scope === scope).map((barrier) => barrier.legacyId);
        // The kernel primitive is idempotent, including a crash before recording this scope.
        if (!ids.length) session.importLegacyTombstones(scope, []);
        for (let offset = 0; offset < ids.length; offset += 10_000) session.importLegacyTombstones(scope, ids.slice(offset, offset + 10_000));
        if (!ledger.barrierScopes.includes(scope)) ledger.barrierScopes.push(scope);
        this.writeImports(ledger);
      }
      return state.stage === "barriers" ? state : this.advance(state, "barriers");
    });
  }
  importFacts(): MemoryRolloutState {
    return this.locked(() => {
      const state = this.requireStage("barriers", "imported"), inventory = this.readInventory();
      this.assertImportable(inventory); this.assertSourcesUnchanged(inventory);
      const ledger = this.readImports(inventory), scopes = inventory.shards.map((shard) => shard.scope);
      requireMigration(scopes.every((scope) => ledger.barrierScopes.includes(scope)), "GLOBAL_BARRIERS_REQUIRED");
      const session = this.options.createSession(scopes);
      for (const [key, facts] of factGroups(inventory)) {
        const fact = facts[0]!;
        if (ledger.records[key]?.status === "committed" || ledger.records[key]?.status === "tombstoned") continue;
        const base: Omit<ImportRecord, "status"> = { scope: fact.scope, file: fact.file, legacyId: fact.legacyId, lines: facts.map((item) => item.line) };
        const deletedIds = new Set(inventory.tombstones.filter((barrier) => barrier.scope === fact.scope).map((barrier) => barrier.legacyId));
        if (deletedIds.has(fact.legacyId) || deletedIds.has(legacyMemoryId(fact.canonicalContent))) {
          ledger.records[key] = { ...base, status: "tombstoned", reason: "LEGACY_DELETION_BARRIER" };
          this.writeImports(ledger); continue;
        }
        const evidenceIds = facts.map((source) => session.capture({
          scope: source.scope,
          source: "legacy",
          sourceRef: `memory-migration:${inventory.migrationId}:${hash(JSON.stringify([source.scope, source.file, source.line, source.legacyId]))}`,
          content: JSON.stringify({ rawContent: source.rawContent, legacyContent: source.legacyContent, legacyOrigin: source.legacyOrigin, sourceFile: source.file, sourceLine: source.line, legacyId: source.legacyId, userConsent: false }),
          occurredAt: source.createdAt,
          expectedEpoch: session.snapshot(source.scope).epoch,
        }).id);
        const result = session.propose({
          scope: fact.scope,
          type: fact.kind === "profile" ? "semantic" : "episodic",
          content: fact.canonicalContent,
          evidenceIds,
          validFrom: Math.min(...facts.map((source) => source.createdAt)),
          idempotencyKey: `memory-migration:${inventory.migrationId}:${key}`,
          basedOn: session.snapshot(fact.scope),
        });
        ledger.records[key] = result.status === "committed"
          ? { ...base, status: "committed", canonicalId: result.id, evidenceIds }
          : { ...base, status: result.status, reason: result.reason, evidenceIds };
        this.writeImports(ledger);
      }
      this.assertAccounting(inventory, ledger, session);
      return state.stage === "imported" ? state : this.advance(state, "imported");
    });
  }
  /** Structural accounting only; this stage does not claim external validation passed. */
  markValidationReady(): MemoryRolloutState { return this.transitionWithAccounting("imported", "validation-ready"); }
  enableShadowRead(): MemoryRolloutState { return this.transitionWithAccounting("validation-ready", "shadow-read"); }
  cutover(authorization: NonNullable<MemoryRolloutState["validationAuthorization"]>): MemoryRolloutState {
    return this.locked(() => {
      const state = this.requireStage("shadow-read", "canonical"), inventory = this.readInventory();
      requireMigration(authorization.approvedBy.trim().length > 0 && authorization.validationArtifact.trim().length > 0 && authorization.inventoryDigest === inventory.digest, "EXTERNAL_VALIDATION_AUTHORIZATION_REQUIRED");
      this.assertSourcesUnchanged(inventory);
      this.assertAccounting(inventory, this.readImports(inventory), this.options.createSession(inventory.shards.map((shard) => shard.scope)));
      return state.stage === "canonical" ? state : this.advance(state, "canonical", { validationAuthorization: { ...authorization }, canonicalWritesPaused: false });
    });
  }
  /** Recovery boundary: retain SQLite, key, tombstones and epochs; freeze its writer. */
  pauseCanonicalWrites(): MemoryRolloutState {
    return this.locked(() => { const state = this.requireStage("canonical"); return this.advance(state, "canonical", { canonicalWritesPaused: true }); });
  }
  private transitionWithAccounting(from: MemoryRolloutStage, to: MemoryRolloutStage): MemoryRolloutState {
    return this.locked(() => {
      const state = this.requireStage(from, to), inventory = this.readInventory();
      this.assertImportable(inventory); this.assertSourcesUnchanged(inventory);
      this.assertAccounting(inventory, this.readImports(inventory), this.options.createSession(inventory.shards.map((shard) => shard.scope)));
      return state.stage === to ? state : this.advance(state, to);
    });
  }
  private collect(migrationId: string): MemoryMigrationInventory {
    const shards = discoverMemoryMigrationShards({ ...this.options, sandRoot: this.sandRoot, agentsRootDir: this.agentsRootDir });
    const inventory: MemoryMigrationInventory = { version: 1, migrationId, sandRoot: this.sandRoot, agentsRootDir: this.agentsRootDir, shards, files: [], facts: [], tombstones: [], issues: [], digest: "" };
    for (const shard of shards) {
      const files: SourceFile[] = [];
      const walk = (directory: string): void => {
        for (const name of readdirSync(directory).sort()) {
          const path = join(directory, name);
          if (shards.some((other) => other.memoryDir === path)) continue;
          const stat = lstatSync(path);
          requireMigration(!stat.isSymbolicLink(), `MIGRATION_SYMLINK:${path}`);
          if (stat.isDirectory()) { walk(path); continue; }
          requireMigration(stat.isFile(), `MIGRATION_SPECIAL_FILE:${path}`);
          const raw = readFileSync(path);
          files.push({ path, sha256: hash(raw), bytes: raw.byteLength, mode: stat.mode & 0o777, rawBase64: raw.toString("base64") });
        }
      };
      walk(shard.memoryDir); inventory.files.push(...files);
      for (const file of files) {
        const rel = relative(shard.memoryDir, file.path).split("\\").join("/");
        const tombstone = /^\.dreaming\/tombstones\/([a-f0-9]{16})\.deleted$/u.exec(rel);
        if (tombstone) { inventory.tombstones.push({ scope: shard.scope, path: file.path, legacyId: tombstone[1]! }); continue; }
        if (rel.startsWith(".dreaming/tombstones/")) inventory.issues.push({ path: file.path, reason: "INVALID_TOMBSTONE_FILENAME" });
        const kind = rel === "profile.md" ? "profile" : /^log\/[^/]+\.md$/u.test(rel) ? "log" : null;
        if (kind == null) {
          if (rel.endsWith(".md")) inventory.issues.push({ path: file.path, reason: "UNSUPPORTED_MARKDOWN_PATH" });
          if (/^\.dreaming\/(explicit|synthesized)\//u.test(rel) && !/^\.dreaming\/(explicit|synthesized)\/[a-f0-9]{16}\.memory$/u.test(rel)) inventory.issues.push({ path: file.path, reason: "INVALID_ORIGIN_MARKER" });
          continue;
        }
        const bytes = Buffer.from(file.rawBase64, "base64"), raw = bytes.toString("utf8");
        if (!Buffer.from(raw, "utf8").equals(bytes)) { inventory.issues.push({ path: file.path, reason: "INVALID_UTF8" }); continue; }
        const parsed = inspectLegacyMarkdown(raw, kind), lines = raw.split(/\r?\n/u);
        inventory.issues.push(...parsed.issues.map((issue) => ({ path: file.path, ...issue })));
        const inspectedLines = new Set([...parsed.facts, ...parsed.issues].map((entry) => entry.line));
        for (const [index, line] of lines.entries()) {
          if (/^-\s+\(\d{4}-\d{2}-\d{2}\)\s+(.+?)\s*$/u.test(line) && !inspectedLines.has(index + 1)) {
            inventory.issues.push({ path: file.path, line: index + 1, reason: "LEGACY_PARSER_DIFFERENCE" });
          }
        }
        for (const fact of parsed.facts) {
          // The product parser does not accept indentation before '-'. Do not
          // invent an extra baseline fact just because the reference trims it.
          const originalLine = lines[fact.line - 1]!;
          const legacyMatch = /^-\s+\(\d{4}-\d{2}-\d{2}\)\s+(.+?)\s*$/u.exec(originalLine);
          if (legacyMatch == null) { inventory.issues.push({ path: file.path, line: fact.line, reason: "LEGACY_PARSER_DIFFERENCE" }); continue; }
          if (fact.createdAt < 0) { inventory.issues.push({ path: file.path, line: fact.line, reason: "UNSUPPORTED_PRE_EPOCH_DATE" }); continue; }
          const rawContent = legacyMatch[1]!;
          const legacyContent = normalizeMemoryContent(rawContent), legacyId = legacyMemoryId(rawContent), canonicalContent = normalize(legacyContent);
          const explicit = files.some((source) => source.path === join(shard.memoryDir, ".dreaming", "explicit", `${legacyId}.memory`));
          const synthesized = files.some((source) => source.path === join(shard.memoryDir, ".dreaming", "synthesized", `${legacyId}.memory`));
          inventory.facts.push({ scope: shard.scope, file: file.path, line: fact.line, legacyId, kind, createdAt: fact.createdAt, rawContent, legacyContent, canonicalContent, legacyOrigin: explicit ? "explicit" : synthesized ? "synthesis" : "legacy", normalizationChanged: canonicalContent !== rawContent });
        }
      }
    }
    for (const facts of factGroups(inventory).values()) {
      if (new Set(facts.map((fact) => fact.canonicalContent)).size !== 1) inventory.issues.push({ path: facts[0]!.file, reason: "LEGACY_ID_CONTENT_COLLISION" });
      if (facts.length > 64) inventory.issues.push({ path: facts[0]!.file, reason: "LEGACY_EVIDENCE_GROUP_EXCEEDS_KERNEL_LIMIT" });
    }
    inventory.files.sort((a, b) => a.path.localeCompare(b.path));
    inventory.digest = inventoryDigest(inventory);
    return inventory;
  }
  private assertImportable(inventory: MemoryMigrationInventory): void { requireMigration(inventory.issues.length === 0, `MIGRATION_PARSER_ISSUES:${inventory.issues.length}`); }
  private assertSourcesUnchanged(inventory: MemoryMigrationInventory): void { requireMigration(this.collect(inventory.migrationId).digest === inventory.digest, "FROZEN_SOURCE_CHANGED"); }
  private assertAccounting(inventory: MemoryMigrationInventory, ledger: ImportLedger, session: MemorySession): void {
    this.assertImportable(inventory);
    const groups = factGroups(inventory), expectedIds = new Map<string, Set<string>>();
    requireMigration(Object.keys(ledger.records).length === groups.size, "UNACCOUNTED_IMPORTS");
    requireMigration(inventory.shards.every((shard) => ledger.barrierScopes.includes(shard.scope)), "GLOBAL_BARRIERS_REQUIRED");
    for (const [key, facts] of groups) {
      const entry = ledger.records[key], first = facts[0]!;
      requireMigration(entry != null && entry.scope === first.scope && entry.file === first.file && entry.legacyId === first.legacyId && JSON.stringify(entry.lines) === JSON.stringify(facts.map((fact) => fact.line)), "IMPORT_MAPPING_MISMATCH");
      if (entry.status === "tombstoned") {
        requireMigration(inventory.tombstones.some((barrier) => barrier.scope === first.scope && [first.legacyId, legacyMemoryId(first.canonicalContent)].includes(barrier.legacyId)), "UNACCOUNTED_TOMBSTONE_EXCLUSION");
        continue;
      }
      requireMigration(entry.status === "committed" && entry.canonicalId != null, "IMPORT_REJECTED_OR_QUARANTINED");
      const item = session.read(entry.scope, entry.canonicalId);
      requireMigration(item != null && item.authority === "legacy" && item.content === first.canonicalContent && item.validFrom === Math.min(...facts.map((fact) => fact.createdAt)) && item.type === (first.kind === "profile" ? "semantic" : "episodic"), "CANONICAL_IMPORT_CHANGED");
      requireMigration(entry.evidenceIds?.length === facts.length && item.evidenceIds.length === facts.length && entry.evidenceIds.every((id) => item.evidenceIds.includes(id) && session.evidence(entry.scope, id)?.source === "legacy"), "IMPORT_EVIDENCE_MISMATCH");
      const ids = expectedIds.get(entry.scope) ?? new Set<string>();
      requireMigration(!ids.has(item.id), "IMPORT_UUID_COLLISION"); ids.add(item.id); expectedIds.set(entry.scope, ids);
    }
    for (const { scope } of inventory.shards) {
      const expected = expectedIds.get(scope) ?? new Set<string>(), actual = new Set<string>();
      let after = "";
      for (;;) {
        const page = session.page(scope, after, 1000);
        if (!page.length) break;
        for (const item of page) actual.add(item.id);
        after = page[page.length - 1]!.id;
      }
      requireMigration(actual.size === expected.size && [...actual].every((id) => expected.has(id)), `UNACCOUNTED_CANONICAL_ITEMS:${scope}`);
    }
  }
  private readImports(inventory: MemoryMigrationInventory): ImportLedger {
    const ledger = readJson<ImportLedger>(join(this.directory, "imports.json"));
    requireMigration(ledger.version === 1 && ledger.migrationId === inventory.migrationId && ledger.inventoryDigest === inventory.digest, "IMPORT_LEDGER_MISMATCH"); return ledger;
  }
  private writeImports(ledger: ImportLedger): void { atomicJson(join(this.directory, "imports.json"), ledger); }
  private requireStage(...stages: MemoryRolloutStage[]): MemoryRolloutState { const state = this.state(); requireMigration(stages.includes(state.stage), `MIGRATION_STAGE:${state.stage}`); return state; }
  private advance(previous: MemoryRolloutState, stage: MemoryRolloutStage, fields: Partial<MemoryRolloutState> = {}): MemoryRolloutState {
    requireMigration(this.state().revision === previous.revision, "MIGRATION_STATE_CHANGED");
    const next: MemoryRolloutState = { ...previous, ...fields, version: 1, stage, revision: previous.revision + 1, updatedAt: this.now() };
    atomicJson(memoryRolloutPath(this.sandRoot), next); return next;
  }
  private locked<T>(operation: () => T): T {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "migration.lock"), fd = openSync(path, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: this.now() })); fsyncSync(fd); return operation(); }
    finally { closeSync(fd); unlinkSync(path); }
  }
}

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
function requireMigration(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function requireContained(root: string, path: string): void { const rel = relative(root, path); requireMigration(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`), "MIGRATION_ROOT_ESCAPE"); }
function directoryExists(path: string): boolean {
  try { const stat = lstatSync(path); requireMigration(!stat.isSymbolicLink(), `MIGRATION_SYMLINK:${path}`); requireMigration(stat.isDirectory(), `MIGRATION_NOT_DIRECTORY:${path}`); return true; }
  catch (error) { if (isMissing(error)) return false; throw error; }
}
function childDirectories(path: string): string[] {
  if (!directoryExists(path)) return [];
  return readdirSync(path).sort().filter((name) => { const stat = lstatSync(join(path, name)); requireMigration(!stat.isSymbolicLink(), `MIGRATION_SYMLINK:${join(path, name)}`); return stat.isDirectory(); });
}
function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function inventoryDigest(inventory: MemoryMigrationInventory): string { const { digest: _digest, ...content } = inventory; return hash(JSON.stringify(content)); }
function factGroups(inventory: MemoryMigrationInventory): Map<string, SourceFact[]> {
  const groups = new Map<string, SourceFact[]>();
  for (const fact of inventory.facts) { const key = hash(JSON.stringify([fact.scope, fact.file, fact.legacyId])), entries = groups.get(key) ?? []; entries.push(fact); groups.set(key, entries); }
  return groups;
}
function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
function atomicJson(path: string, value: unknown): void {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`), fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
