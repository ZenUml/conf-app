-- Migration number: 0018     2026-08-23T00:00:00.000Z
--
-- Transactional administrator-email outbox. Recipient contact remains in the
-- encrypted Marketplace contact cache; this table stores delivery correlation
-- and bounded retry state only. Survey research answers are deliberately not
-- copied here.

CREATE TABLE IF NOT EXISTS PaywallAdminNotification (
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

CREATE INDEX IF NOT EXISTS idx_paywall_admin_notification_dispatch
  ON PaywallAdminNotification (state, nextAttemptAt, createdAt);

CREATE TABLE IF NOT EXISTS PaywallAdminNotificationEvent (
  eventId TEXT PRIMARY KEY,
  providerMessageId TEXT NOT NULL,
  eventType TEXT NOT NULL
    CHECK (eventType IN ('email.sent', 'email.delivered', 'email.clicked', 'email.failed')),
  receivedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paywall_admin_notification_event_provider
  ON PaywallAdminNotificationEvent (providerMessageId, receivedAt);
