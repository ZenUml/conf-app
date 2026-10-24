-- Migration number: 0015 	 2026-07-26T00:00:00.000Z

CREATE TABLE IF NOT EXISTS PreparedDiagram (
  cloudId TEXT NOT NULL,
  pageId TEXT NOT NULL,
  appId INTEGER NOT NULL,
  diagramType TEXT NOT NULL,
  diagramSource TEXT NOT NULL,
  title TEXT,
  curatedAt TEXT NOT NULL,
  curatedBy TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cloudId, pageId, appId)
);
