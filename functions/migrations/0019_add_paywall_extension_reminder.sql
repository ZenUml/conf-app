-- Migration number: 0019     2026-08-23T00:00:00.000Z
--
-- One bounded T-24h reminder per exact seven-day extension grant. This table
-- stores lifecycle and entitlement-check outcomes only; recipients and
-- questionnaire answers are deliberately absent.

CREATE TABLE IF NOT EXISTS PaywallExtensionReminder (
  reminderId TEXT PRIMARY KEY,
  grantId TEXT NOT NULL UNIQUE,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  spaceId TEXT NOT NULL,
  spaceKey TEXT NOT NULL,
  dueAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN (
      'scheduled', 'ready', 'suppressed_paid',
      'suppressed_expired', 'dispatched'
    )),
  entitlementCheckOutcome TEXT
    CHECK (entitlementCheckOutcome IN ('confirmed', 'absent', 'unknown')),
  entitlementCheckedAt TEXT,
  lastErrorCode TEXT,
  dispatchedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK (dueAt < expiresAt),
  FOREIGN KEY (grantId) REFERENCES PaywallExtensionGrant(grantId)
);

CREATE INDEX IF NOT EXISTS idx_paywall_extension_reminder_due
  ON PaywallExtensionReminder (state, dueAt, expiresAt);
