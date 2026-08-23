-- Migration number: 0020     2026-08-23T00:00:00.000Z
--
-- The first extension questionnaire was five questions wide. Version 2 keeps
-- only the operational scope/timing answers plus an optional research answer.
-- SQLite cannot alter the old NOT NULL columns or their CHECK constraints, so
-- rebuild the request table and copy every existing request as questionnaire
-- version 1. PaywallAdminNotification has a requestId foreign key, so preserve
-- that dependent table in a temporary data-only table while the parent is
-- rebuilt, then recreate its original constraints and indexes.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE PaywallExtensionRequest_new (
  requestId TEXT PRIMARY KEY,
  idempotencyKey TEXT NOT NULL,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  spaceId TEXT NOT NULL,
  spaceKey TEXT NOT NULL,
  macroCount INTEGER NOT NULL CHECK (macroCount >= 101),
  questionnaireVersion INTEGER NOT NULL DEFAULT 1
    CHECK (questionnaireVersion IN (1, 2)),
  currentTask TEXT,
  diagramAudience TEXT,
  aiTools TEXT,
  aiDiagramUsage TEXT,
  aiDiagramUse TEXT
    CHECK (aiDiagramUse IS NULL OR aiDiagramUse IN ('regularly', 'occasionally', 'interested', 'no')),
  processRequirement TEXT,
  cloudAiPolicy TEXT,
  requestedScope TEXT NOT NULL CHECK (requestedScope IN ('self', 'space', 'site', 'not_sure')),
  urgency TEXT NOT NULL CHECK (urgency IN ('today', 'this_week', 'planning_ahead', 'no_hard_deadline')),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'auto_granted', 'manual_review')),
  grantId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (cloudId, accountId, spaceId, idempotencyKey)
);

INSERT INTO PaywallExtensionRequest_new (
  requestId, idempotencyKey, cloudId, accountId, spaceId, spaceKey,
  macroCount, questionnaireVersion, currentTask, diagramAudience, aiTools,
  aiDiagramUsage, aiDiagramUse, processRequirement, cloudAiPolicy,
  requestedScope, urgency, state, grantId, createdAt, updatedAt
)
SELECT
  requestId, idempotencyKey, cloudId, accountId, spaceId, spaceKey,
  macroCount, 1, currentTask, diagramAudience, aiTools,
  aiDiagramUsage, NULL, processRequirement, cloudAiPolicy,
  requestedScope, urgency, state, grantId, createdAt, updatedAt
FROM PaywallExtensionRequest;

CREATE TABLE PaywallAdminNotification_backup AS
SELECT * FROM PaywallAdminNotification;

DROP TABLE PaywallAdminNotification;
DROP TABLE PaywallExtensionRequest;
ALTER TABLE PaywallExtensionRequest_new RENAME TO PaywallExtensionRequest;

CREATE TABLE PaywallAdminNotification (
  notificationId TEXT PRIMARY KEY,
  requestId TEXT NOT NULL,
  grantId TEXT NOT NULL,
  cloudId TEXT NOT NULL,
  templateVersion TEXT NOT NULL,
  routingOutcome TEXT NOT NULL
    CHECK (routingOutcome IN ('automatic', 'manual', 'suppressed')),
  routingReasonCodes TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN (
      'queued', 'sending', 'sent', 'retry_pending',
      'delivered', 'clicked', 'failed', 'manual', 'suppressed'
    )),
  providerMessageId TEXT,
  attemptCount INTEGER NOT NULL DEFAULT 0 CHECK (attemptCount >= 0),
  maxAttempts INTEGER NOT NULL DEFAULT 3 CHECK (maxAttempts BETWEEN 1 AND 5),
  lastErrorCode TEXT,
  nextAttemptAt TEXT,
  sentAt TEXT,
  deliveredAt TEXT,
  clickedAt TEXT,
  failedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (grantId, templateVersion),
  UNIQUE (providerMessageId),
  FOREIGN KEY (requestId) REFERENCES PaywallExtensionRequest(requestId),
  FOREIGN KEY (grantId) REFERENCES PaywallExtensionGrant(grantId)
);

INSERT INTO PaywallAdminNotification (
  notificationId, requestId, grantId, cloudId, templateVersion,
  routingOutcome, routingReasonCodes, state, providerMessageId,
  attemptCount, maxAttempts, lastErrorCode, nextAttemptAt, sentAt,
  deliveredAt, clickedAt, failedAt, createdAt, updatedAt
)
SELECT
  notificationId, requestId, grantId, cloudId, templateVersion,
  routingOutcome, routingReasonCodes, state, providerMessageId,
  attemptCount, maxAttempts, lastErrorCode, nextAttemptAt, sentAt,
  deliveredAt, clickedAt, failedAt, createdAt, updatedAt
FROM PaywallAdminNotification_backup;

DROP TABLE PaywallAdminNotification_backup;

CREATE INDEX IF NOT EXISTS idx_paywall_extension_request_scope
  ON PaywallExtensionRequest (cloudId, accountId, spaceId, createdAt);

CREATE INDEX IF NOT EXISTS idx_paywall_admin_notification_dispatch
  ON PaywallAdminNotification (state, nextAttemptAt, createdAt);

-- The migration must leave both existing and newly-created foreign keys valid.
PRAGMA foreign_key_check;
