-- Migration number: 0017     2026-08-23T00:00:00.000Z
--
-- Marketplace technical contacts are application-encrypted before reaching
-- D1. Neither table has a plaintext email/name column. Machine refreshes only
-- upsert MarketplaceContactResolution; the append-only override history is an
-- operator-owned audit trail and always takes precedence while active.

CREATE TABLE IF NOT EXISTS MarketplaceContactResolution (
  cloudId TEXT PRIMARY KEY,
  contactCiphertext TEXT,
  maskedOperatorDisplay TEXT,
  classification TEXT NOT NULL
    CHECK (classification IN ('direct_customer', 'partner', 'uncertain', 'missing')),
  routingOutcome TEXT NOT NULL
    CHECK (routingOutcome IN ('automatic', 'manual')),
  reasonCodes TEXT NOT NULL,
  sourceSchemaVersion TEXT NOT NULL,
  sourceRecordCount INTEGER NOT NULL CHECK (sourceRecordCount >= 1),
  sourceRefreshedAt TEXT NOT NULL,
  sourceLastSeenAt TEXT NOT NULL,
  cacheExpiresAt TEXT NOT NULL,
  retentionUntil TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK (routingOutcome != 'automatic' OR contactCiphertext IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_contact_resolution_freshness
  ON MarketplaceContactResolution (cacheExpiresAt, retentionUntil);

CREATE TABLE IF NOT EXISTS MarketplaceContactOverride (
  overrideId TEXT PRIMARY KEY,
  cloudId TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'partner', 'suppress')),
  contactCiphertext TEXT,
  maskedOperatorDisplay TEXT,
  auditReason TEXT NOT NULL CHECK (length(trim(auditReason)) > 0),
  operatorId TEXT NOT NULL CHECK (length(trim(operatorId)) > 0),
  effectiveAt TEXT NOT NULL,
  expiresAt TEXT,
  retentionUntil TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK (expiresAt IS NULL OR expiresAt > effectiveAt)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_contact_override_active
  ON MarketplaceContactOverride (cloudId, effectiveAt, expiresAt, createdAt);

CREATE INDEX IF NOT EXISTS idx_marketplace_contact_override_retention
  ON MarketplaceContactOverride (retentionUntil);
