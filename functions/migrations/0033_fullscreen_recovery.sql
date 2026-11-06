-- Fullscreen contact recovery is independent of edit and Space licenses.
-- One row atomically persists the contact request and pending personal grant.
CREATE TABLE FullscreenRecoveryRequest (
  id TEXT PRIMARY KEY,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT 'fullscreen' CHECK (feature = 'fullscreen'),
  scenariosJson TEXT NOT NULL,
  noteCiphertext TEXT NOT NULL,
  emailCiphertext TEXT NOT NULL,
  consentVersion TEXT NOT NULL,
  consentAt TEXT NOT NULL,
  contentId TEXT,
  customContentId TEXT,
  spaceKey TEXT,
  createdAt TEXT NOT NULL,
  grantId TEXT NOT NULL UNIQUE,
  activatedAt TEXT,
  expiresAt TEXT,
  supportOutcome TEXT CHECK (supportOutcome IN ('customer_replied', 'next_step_agreed', 'closed')),
  supportOutcomeAt TEXT,
  UNIQUE (cloudId, accountId, feature)
);
CREATE INDEX idx_fullscreen_recovery_support_pending
  ON FullscreenRecoveryRequest (createdAt, id);

-- A command ID makes each trusted support action idempotent. Actions and the
-- grant update are committed in one D1 batch transaction.
CREATE TABLE FullscreenRecoverySupportAction (
  commandId TEXT PRIMARY KEY,
  requestId TEXT NOT NULL REFERENCES FullscreenRecoveryRequest(id),
  action TEXT NOT NULL CHECK (action IN ('extend', 'outcome')),
  actorId TEXT NOT NULL,
  reason TEXT NOT NULL,
  supportOutcome TEXT CHECK (supportOutcome IN ('customer_replied', 'next_step_agreed', 'closed')),
  oldExpiresAt TEXT,
  newExpiresAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_fullscreen_recovery_support_action_request
  ON FullscreenRecoverySupportAction (requestId, createdAt);
