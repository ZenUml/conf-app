-- Migration number: 0018  2026-08-12T00:00:00.000Z

CREATE TABLE IF NOT EXISTS DiagramAudience (
  cloudId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  customContentId TEXT NOT NULL,
  viewerKey TEXT NOT NULL,
  firstViewedAt TEXT NOT NULL,
  lastViewedAt TEXT NOT NULL,
  viewDays INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cloudId, forgeAppId, customContentId, viewerKey)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_diagram_audience_viewer
  ON DiagramAudience (cloudId, viewerKey);
