-- JSM manual-action audit and idempotency for temporary Lite extensions.
-- The customer-facing license remains in SPACE_LICENSE_KV; this table fixes a
-- ticket action's target/expiry before the KV write so retries cannot widen or
-- lengthen the grant.

CREATE TABLE IF NOT EXISTS ExtensionAction (
  ticketKey TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('initial', 'feedback')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied')),
  clientDomain TEXT NOT NULL,
  cloudId TEXT NOT NULL,
  spaceKey TEXT NOT NULL,
  userAccountId TEXT NOT NULL,
  macroCount INTEGER NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (ticketKey, action)
);

CREATE INDEX IF NOT EXISTS ix_extension_action_target
  ON ExtensionAction (cloudId, spaceKey, userAccountId, createdAt);
