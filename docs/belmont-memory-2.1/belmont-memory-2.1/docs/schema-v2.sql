
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS scope_state(
  id TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS evidence(
  id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scope_state(id), source TEXT NOT NULL,
  ref_digest TEXT NOT NULL, content TEXT, occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL, revoked_at INTEGER,
  UNIQUE(scope, ref_digest)
) STRICT;
CREATE TABLE IF NOT EXISTS memory_item(
  id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scope_state(id), type TEXT NOT NULL,
  content TEXT NOT NULL, title TEXT NOT NULL, aliases TEXT NOT NULL,
  authority TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','forgotten')),
  version INTEGER NOT NULL, valid_from INTEGER NOT NULL, valid_to INTEGER,
  recorded_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS memory_details(item_id TEXT PRIMARY KEY REFERENCES memory_item(id), payload TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS item_scope ON memory_item(scope, status, type);
CREATE TABLE IF NOT EXISTS memory_evidence(
  item_id TEXT NOT NULL REFERENCES memory_item(id), evidence_id TEXT NOT NULL REFERENCES evidence(id),
  PRIMARY KEY(item_id,evidence_id)
) STRICT;
CREATE INDEX IF NOT EXISTS reverse_evidence ON memory_evidence(evidence_id,item_id);
CREATE TABLE IF NOT EXISTS dependency(
  parent_id TEXT NOT NULL REFERENCES memory_item(id), child_id TEXT NOT NULL REFERENCES memory_item(id),
  PRIMARY KEY(parent_id,child_id)
) STRICT;
CREATE TABLE IF NOT EXISTS revision(
  item_id TEXT NOT NULL REFERENCES memory_item(id), version INTEGER NOT NULL,
  payload TEXT NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY(item_id,version)
) STRICT;
CREATE TABLE IF NOT EXISTS tombstone(
  scope TEXT NOT NULL REFERENCES scope_state(id), digest TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(scope,digest)
) STRICT;
-- Old empty .deleted files retain only this non-keyed content hash.
-- Preserve the algorithm separately: HMAC(old_hash) would NOT match future content.
CREATE TABLE IF NOT EXISTS legacy_tombstone(
  scope TEXT NOT NULL REFERENCES scope_state(id), legacy_id TEXT NOT NULL, imported_at INTEGER NOT NULL,
  PRIMARY KEY(scope,legacy_id)
) STRICT;
CREATE TABLE IF NOT EXISTS receipt(
  scope TEXT NOT NULL, key_digest TEXT NOT NULL, request_digest TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES memory_item(id), version INTEGER NOT NULL,
  PRIMARY KEY(scope,key_digest)
) STRICT;
CREATE TABLE IF NOT EXISTS memory_event(
  seq INTEGER PRIMARY KEY, scope TEXT NOT NULL, action TEXT NOT NULL, item_id TEXT, at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS outbox(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, item_id TEXT NOT NULL,
  version INTEGER NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('upsert','delete'))
) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  item_id UNINDEXED, title, aliases, body, grams, tokenize='unicode61 remove_diacritics 2'
);

