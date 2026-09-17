-- Prefer the transactional MemoryKernel constructor upgrade. Reference additive SQL only.
-- Run only after verifying meta.version = 1 and taking a consistent backup.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS memory_details (
  item_id TEXT PRIMARY KEY REFERENCES memory_item(id),
  payload TEXT NOT NULL
) STRICT;
UPDATE meta SET value='2' WHERE key='version';
COMMIT;
-- No user facts, evidence, revisions, tombstones, outbox or FTS rows are rewritten.
