# Memory 2.1 migration adapter handoff

Status: implementation authored; migration, tests, builds and validation have not been run in this task.

## Changed file and ownership

`source/host/extensions/memory/memory-migration.ts` is a new Belmont-specific adapter around the reference kernel's `MemorySession.capture`, `propose`, `importLegacyTombstones`, `read`, `page` and `evidence` APIs. It does not change the kernel schema or write legacy Markdown.

Existing role: `FileMemoryStore` owns `profile.md`, `log/*.md`, and `.dreaming/{explicit,synthesized,tombstones}`. User/project memory uses independent writer shards.

New role: the host-supplied migrator principal imports a frozen source inventory into the canonical kernel. Inventory, source snapshots, progress and UUID mapping are migration metadata; they are never consulted as a second memory authority. Runtime ownership and writer gating are integrated by the host/MemoryService changes documented in the overall handoff.

Entrypoints:

- `readMemoryRolloutState(sandRoot)` reads `memory-2.1/rollout.json`; missing state defaults to legacy, malformed state throws.
- `assertLegacyMemoryWritable(memoryDir)` resolves both lexical and physical ancestors and rejects legacy writes when an installation has entered any nonlegacy stage.
- `discoverMemoryMigrationShards({ sandRoot, agentsRootDir, resolveScope })` returns independently scoped agent, user and project shard descriptors, including metadata-only shards. Actual `agents` layouts and `.shards` compatibility layouts are included.
- `new MemoryMigration({ sandRoot, agentsRootDir, resolveScope, createSession, now? })` performs no migration in its constructor. `createSession(scopes)` must bind a stable, host-owned `actor: "migrator"` principal with `read`, `capture`, `propose`, and `migrate` capabilities. The host owns the SQLite instance and tombstone key.
- `migration.resolveLegacyIds(scope, legacyId)` reads the source mapping and returns zero or more canonical UUIDs for a stale UI ID. It does not read memory payloads or revive deleted items; the runtime must revalidate each UUID in the canonical kernel.
- `canonicalMemoryDatabasePath`, `memoryTombstoneKeyPath`, and `memoryRolloutPath` export the runtime's paths.

## Administrative sequence

Execute only in a separately authorized migration session, after validation of the adapter. No method below was executed for this implementation task.

1. `freeze()` records the cooperative legacy writer barrier. Stop/quiesce legacy synthesis and any external Markdown editor before taking an inventory. The adapter does not stop a live service.
2. `inventory()` discovers source shards and snapshots raw bytes, SHA-256, size, mode, source scope, normalized/unnormalized fact text, legacy IDs, parser issues and origin markers. It refuses unexpected symlinks/special files and records unsupported Markdown/marker/date/parser cases. Reading errors are surfaced. Source snapshots are compared before recording the inventory stage.
3. `importBarriers()` imports every scope's legacy SHA-1 tombstones, including shards containing only deletion metadata. No fact import is allowed until all inventoried scopes have completed this phase.
4. `importFacts()` uses the exact historical 500-character normalization/hash for legacy identity, then the reference kernel normalization for canonical text. Raw source remains in the inventory/evidence. The idempotency key and evidence source references derive from the frozen migration identity and source tuple. `(scope, file, legacy ID)` maps to a canonical UUID in `imports.json`; repeated matching rows preserve separate source-line evidence. Explicit/synthesis markers are retained as legacy provenance and never become user consent.
5. `markValidationReady()` performs coded accounting and source checks before writing `validation-ready`. This label means ready for external validation, not that validation passed.
6. `enableShadowRead()` advances to `shadow-read`. Legacy writers remain frozen. The runtime may compare canonical reads while preserving the existing read contract.
7. `cutover({ approvedBy, validationArtifact, inventoryDigest })` requires the external authorization to name the same frozen inventory. It rechecks source inventory, UUID/content/type/date/evidence accounting, tombstone exclusions, and unaccounted canonical items before recording `canonical`.

The freeze is installation-wide. Legacy reads remain allowed through the frozen and shadow-read stages, while every legacy write stays blocked so application writers cannot change the migration source. This adapter intentionally does not provide partial shard cutover because the existing write boundary is installation-wide. Scope identities remain separate.

## Persisted paths

All paths are beneath the configured Sand root:

- `memory-2.1/canonical.sqlite`: canonical kernel database, opened/managed by the host.
- `memory-2.1/tombstone.key`: host-owned key; retain it with the canonical database.
- `memory-2.1/rollout.json`: current migration stage and canonical write pause state.
- `memory-2.1/inventory.json`: immutable frozen source snapshot and source inventory digest; includes private source bytes and needs the same retention/protection policy as the original memory.
- `memory-2.1/imports.json`: barrier completion, source tuple/line mapping, UUIDs, evidence IDs, and rejection/exclusion accounting.
- `memory-2.1/migration.lock`: exclusive administrative writer lock with PID/time. A crashed owner intentionally leaves a lock rather than guessing whether a different migration is active. Recover a stale lock only after confirming its owner is no longer active; then rerun the interrupted phase with the same inventory and migration identity.

JSON metadata writes use a private temporary file, fsync, atomic rename and directory fsync. Kernel writes continue through the reference transaction/CAS/idempotency boundary. The two do not form one cross-store transaction: replay after a committed kernel write uses the same receipt/evidence identities to repair progress metadata.

## Rollback boundary

`pauseCanonicalWrites()` sets `canonicalWritesPaused: true` while keeping stage `canonical`. The host must honor this state for all canonical learning, explicit writes, deletion and index mutation entrypoints as appropriate. Reads remain canonical; Markdown writes remain blocked. No method restores legacy authority or replaces SQLite from an old snapshot. Re-enabling a paused writer requires a separate recovery decision. Keep the database, tombstone key, deletion barriers and epochs together.

The adapter does not repair invalid source lines, delete user data, clear stale locks automatically, approve validation, create a canary evaluator, or export Markdown. Direct Markdown edits made during a frozen phase prevent further migration until the discrepancy is separately resolved.

## Validation TODO for the testing agent

- Typecheck/build the host integration and check module import cycles and the runtime's actual Sand-root paths.
- Confirm every legacy mutator, synthesis refresh write, shared shard write and delete reaches `assertLegacyMemoryWritable`; check legacy/frozen/shadow/canonical/paused transitions and restart behavior.
- Exercise agent, user, project, direct-root and `.shards` inventories, including tombstone-only shards, unreadable files, invalid UTF-8, unrecognized lines, invalid dates, comments, indentation, normalization/truncation differences, hash collisions, and duplicate source rows.
- Exercise all-shard barrier ordering, tombstone exclusion, stable source tuple/UUID mapping, marker provenance, rejected/quarantined accounting and cross-scope isolation.
- Inject crashes after barrier import, evidence capture, proposal commit, progress rename and stage rename; recover only abandoned locks and rerun with the same migration identity.
- Check that an edited/added/deleted source file or shard prevents readiness/cutover, and that unaccounted canonical items, missing evidence, altered imports and scope resolver changes also prevent cutover.
- Check authorization binding to the inventory digest and rollout metadata persistence across feature flag changes and host restarts.
- Check privacy/retention handling for source snapshots and backups, preserving the latest deletion barriers during any later operational recovery.

No validation outcomes are recorded here.
