-- Pre-generated diagram drafts for Confluence pages that have no diagram yet.
-- functions/api/title-draft.ts queues a title on a miss; scripts/title-draft/batch.mjs
-- (run by an operator) fills the queue. Scoped by the verified FIT cloudId and forgeAppId.
CREATE TABLE title_draft (
  cloud_id TEXT,
  forge_app_id TEXT,
  page_id TEXT,
  title TEXT NOT NULL,
  title_hash TEXT NOT NULL,
  space_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','no_diagram')),
  mermaid TEXT,
  kind TEXT,
  confidence REAL,
  requested_at INTEGER NOT NULL,
  generated_at INTEGER,
  PRIMARY KEY (cloud_id, forge_app_id, page_id)
);
CREATE INDEX idx_title_draft_status_requested ON title_draft(status, requested_at);
