-- Migration number: 0019
-- Replace HMAC-derived viewer keys with trusted Atlassian account IDs.
-- Existing viewer keys are retained as opaque legacy account IDs so aggregate
-- counts do not reset. They are not treated as verified Atlassian identities.

ALTER TABLE DiagramAudience RENAME TO DiagramAudience_hmac;

CREATE TABLE DiagramAudience (
  cloudId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  customContentId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  firstViewedAt TEXT NOT NULL,
  lastViewedAt TEXT NOT NULL,
  viewDays INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cloudId, forgeAppId, customContentId, accountId)
) WITHOUT ROWID;

CREATE INDEX idx_diagram_audience_account
  ON DiagramAudience (cloudId, accountId);

INSERT INTO DiagramAudience (
  cloudId, forgeAppId, customContentId, accountId, firstViewedAt, lastViewedAt, viewDays
)
SELECT
  cloudId, forgeAppId, customContentId, viewerKey, firstViewedAt, lastViewedAt, viewDays
FROM DiagramAudience_hmac;

DROP TABLE DiagramAudience_hmac;
