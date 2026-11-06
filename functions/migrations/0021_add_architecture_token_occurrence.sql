-- Architecture Tokens Phase 1: rebuildable reverse index of explicit Mermaid
-- sequence participants, uploaded by the local pipeline
-- (tools/architecture-tokens/upload-index.mjs), replaced per tenant per run.
-- Confluence custom content stays the system of record; rendering never
-- depends on this table. `rawLabel` adds no new data class: CustomContent.body
-- already holds the whole diagram. Decisions (Phase 2) anchor on
-- (contentId, actorId) and therefore survive a replace.

CREATE TABLE IF NOT EXISTS ArchitectureTokenOccurrence (
  cloudId        TEXT    NOT NULL,
  spaceId        TEXT    NOT NULL,
  contentId      TEXT    NOT NULL,
  pageId         TEXT    NOT NULL,
  contentVersion INTEGER NOT NULL,
  actorId        TEXT    NOT NULL,
  rawLabel       TEXT    NOT NULL,
  comparisonKey  TEXT    NOT NULL,
  declKind       TEXT    NOT NULL CHECK (declKind IN ('participant', 'actor')),
  lineNumber     INTEGER NOT NULL,
  runId          TEXT    NOT NULL,
  indexedAt      TEXT    NOT NULL,
  PRIMARY KEY (cloudId, contentId, actorId, lineNumber)
);

CREATE INDEX IF NOT EXISTS ArchitectureTokenOccurrence_key
  ON ArchitectureTokenOccurrence (cloudId, comparisonKey);

CREATE INDEX IF NOT EXISTS ArchitectureTokenOccurrence_content
  ON ArchitectureTokenOccurrence (cloudId, contentId);
