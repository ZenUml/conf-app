-- Migration number: 0016 	 2026-08-11T00:00:00.000Z

-- Vendor-operated Lite->Full macro conversion queue (phase 1).
-- Enqueued by tools/lite2full/enqueue.py; claimed and executed by the Full
-- app's scheduled function via functions/conversion/*.
-- docs/superpowers/specs/2026-08-11-lite-to-full-conversion.md

CREATE TABLE IF NOT EXISTS ConversionJob (
  id TEXT PRIMARY KEY,                 -- uuid, minted by the enqueue script
  cloudId TEXT NOT NULL,               -- target tenant; claim matches on the FIT cloudId
  spaceKey TEXT,                       -- convert a whole space...
  pageIds TEXT,                        -- ...or an explicit JSON array of page ids (one of the two)
  dryRun INTEGER NOT NULL DEFAULT 0,
  requestSource TEXT NOT NULL,         -- customer request provenance (email/ticket ref); never empty
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | claimed | done | failed | cancelled
  claimedAt TEXT,
  completedAt TEXT,
  statsJson TEXT,                      -- totals reported by the executor (counts only, no content)
  failureStage TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_conversion_job_claim
  ON ConversionJob (cloudId, status, createdAt);
