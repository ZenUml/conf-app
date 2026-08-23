-- Migration number: 0016     2026-08-23T00:00:00.000Z
--
-- The extension request stores only coded research answers. Diagram content,
-- free text, contact details, and client-controlled expiry values are
-- deliberately absent. D1 owns both replay idempotency and the once-only
-- automatic grant constraint.

CREATE TABLE IF NOT EXISTS PaywallExtensionRequest (
  requestId TEXT PRIMARY KEY,
  idempotencyKey TEXT NOT NULL,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  spaceId TEXT NOT NULL,
  spaceKey TEXT NOT NULL,
  macroCount INTEGER NOT NULL CHECK (macroCount >= 101),
  currentTask TEXT NOT NULL,
  diagramAudience TEXT NOT NULL,
  aiTools TEXT NOT NULL,
  aiDiagramUsage TEXT NOT NULL,
  processRequirement TEXT NOT NULL,
  cloudAiPolicy TEXT NOT NULL,
  requestedScope TEXT NOT NULL CHECK (requestedScope IN ('self', 'space', 'site')),
  urgency TEXT NOT NULL CHECK (urgency IN ('today', 'this_week', 'planning_ahead')),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'auto_granted', 'manual_review')),
  grantId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (cloudId, accountId, spaceId, idempotencyKey)
);

CREATE TABLE IF NOT EXISTS PaywallExtensionGrant (
  grantId TEXT PRIMARY KEY,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  spaceId TEXT NOT NULL,
  spaceKey TEXT NOT NULL,
  sourceRequestId TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason = 'first_automatic_extension'),
  status TEXT NOT NULL CHECK (status = 'active'),
  grantedAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (cloudId, accountId, spaceId)
);

CREATE INDEX IF NOT EXISTS idx_paywall_extension_request_scope
  ON PaywallExtensionRequest (cloudId, accountId, spaceId, createdAt);

CREATE INDEX IF NOT EXISTS idx_paywall_extension_grant_entitlement
  ON PaywallExtensionGrant (cloudId, accountId, spaceId, expiresAt);
