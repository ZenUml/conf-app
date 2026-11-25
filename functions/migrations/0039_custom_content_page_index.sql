-- Lookups of a page's diagrams (`WHERE pageId IN (...)`) scanned the whole
-- table: on 2026-11-25 27 such lookups took 187 s of D1 time and queued
-- production requests until they failed with "D1 DB is overloaded" (7429).
CREATE INDEX IF NOT EXISTS idx_custom_content_page ON CustomContent (pageId);
