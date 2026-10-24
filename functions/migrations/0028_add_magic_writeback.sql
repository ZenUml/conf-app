-- Temporary delivery transport. Source bodies are never stored here.
CREATE TABLE MagicWriteback (
  id TEXT PRIMARY KEY,
  cloudId TEXT NOT NULL,
  appId TEXT NOT NULL,
  environmentId TEXT NOT NULL,
  installationId TEXT NOT NULL,
  contentId TEXT NOT NULL,
  sourceHash TEXT NOT NULL,
  artifact TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  claimToken TEXT,
  claimUntil INTEGER
);
CREATE INDEX MagicWriteback_target ON MagicWriteback (cloudId, appId, environmentId, installationId, contentId, createdAt);
CREATE INDEX MagicWriteback_expiry ON MagicWriteback (expiresAt);
