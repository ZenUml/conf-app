-- The reply is prepared only after a support operator reviews the case.
-- Snapshot fields are encrypted with FULLSCREEN_RECOVERY_ENCRYPTION_KEY.
CREATE TABLE FullscreenRecoveryMailOutbox (
  id TEXT PRIMARY KEY,
  requestId TEXT NOT NULL REFERENCES FullscreenRecoveryRequest(id),
  templateVersion TEXT NOT NULL,
  recipientCiphertext TEXT NOT NULL,
  snapshotCiphertext TEXT NOT NULL,
  snapshotHmacSha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','sending','accepted','delivered','bounced','failed','delivery_unknown')),
  attemptCount INTEGER NOT NULL DEFAULT 0,
  maxAttempts INTEGER NOT NULL DEFAULT 3,
  claimId TEXT,
  firstAttemptAt TEXT,
  lastAttemptAt TEXT,
  providerMessageId TEXT UNIQUE,
  providerOccurredAt TEXT,
  lastErrorCode TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  createdBy TEXT NOT NULL,
  lastManualAction TEXT,
  lastManualActor TEXT,
  lastManualAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(requestId, templateVersion)
);
CREATE INDEX idx_fullscreen_recovery_mail_queue ON FullscreenRecoveryMailOutbox(state, updatedAt);
CREATE TABLE FullscreenRecoveryMailWebhookReceipt (
  eventId TEXT PRIMARY KEY,
  -- A signed event can arrive while Resend's send response is still in flight.
  outboxId TEXT REFERENCES FullscreenRecoveryMailOutbox(id),
  providerMessageId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  occurredAt TEXT NOT NULL,
  receivedAt TEXT NOT NULL
);
CREATE INDEX idx_fullscreen_recovery_mail_receipt_provider
  ON FullscreenRecoveryMailWebhookReceipt(providerMessageId, occurredAt);
