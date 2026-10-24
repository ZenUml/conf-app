-- Migration number: 0017 	 2026-08-11T13:00:00.000Z

-- A conversion job larger than one batch used to report `done` after its first
-- 25 pages and never be claimed again — a silent partial migration. These two
-- columns carry the job across ticks:
--   pageOffset     how far into an explicit pageIds list the executor has got
--                  (space-scoped jobs re-sweep instead: a converted page no
--                  longer matches the Lite-macro CQL)
--   pageBatchLimit per-job override of PAGE_BATCH_LIMIT, so the multi-batch
--                  path is testable without 26 fixture pages

ALTER TABLE ConversionJob ADD COLUMN pageOffset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ConversionJob ADD COLUMN pageBatchLimit INTEGER;
