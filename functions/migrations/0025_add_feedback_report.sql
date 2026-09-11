-- In-product feedback submitted explicitly by an authenticated Forge user.
-- Diagram source is never copied here; Confluence remains the system of
-- record. User-authorized screenshot metadata is added separately in 0026;
-- bytes are kept only in the private, retention-controlled R2 bucket.
CREATE TABLE IF NOT EXISTS FeedbackReport (
  reportReference TEXT PRIMARY KEY,
  submissionId TEXT NOT NULL,
  installationId TEXT NOT NULL,
  cloudId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  clientDomain TEXT,
  description TEXT NOT NULL,
  surface TEXT NOT NULL,
  hostModule TEXT NOT NULL,
  diagramType TEXT NOT NULL,
  diagramTitle TEXT NOT NULL,
  spaceName TEXT NOT NULL,
  macroUuid TEXT NOT NULL,
  contentId TEXT NOT NULL,
  customContentId TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (submissionId, installationId, accountId)
);

CREATE INDEX IF NOT EXISTS idx_feedback_report_created_at
  ON FeedbackReport(createdAt);
