-- The recovery gate gains a second feature, `edit`. SQLite cannot alter a CHECK, so the
-- table is rebuilt with CHECK (feature IN ('fullscreen','edit')). Same name, columns, DEFAULT,
-- UNIQUE (cloudId, accountId, feature), grantId UNIQUE and index.
--
-- Child tables (FullscreenRecoverySupportAction, FullscreenRecoveryMailOutbox, and through it
-- FullscreenRecoveryMailWebhookReceipt) reference FullscreenRecoveryRequest(id), and D1 enforces
-- foreign keys by default and runs every query in an implicit transaction:
--   https://developers.cloudflare.com/d1/build-with-d1/foreign-keys/
--   https://developers.cloudflare.com/d1/sql-api/sql-statements/  (PRAGMA defer_foreign_keys)
-- `defer_foreign_keys` postpones the check to the end of the transaction. The DROP below
-- would otherwise fail, because the children point at rows that briefly do not exist. At the
-- end every id is back, so the deferred check passes.
--
-- Order matters, and the usual "create _new, copy, drop old, rename" recipe does not work here:
-- SQLite counts the child rows orphaned by DROP TABLE and only forgives them when rows are
-- INSERTed into the parent again, and an insert into a table that is renamed later does not
-- count. So: park the rows in a holding table, drop the old table, create the final table
-- under its own name, insert the rows back (this clears the deferred violations), then drop
-- the holding table. The table is never renamed, so the children's references stay valid.
-- (0038.spec.ts proves it with foreign keys on, and proves it fails without the pragma.)
PRAGMA defer_foreign_keys = on;

CREATE TABLE FullscreenRecoveryRequest_hold AS SELECT * FROM FullscreenRecoveryRequest;

DROP TABLE FullscreenRecoveryRequest;

CREATE TABLE FullscreenRecoveryRequest (
  id TEXT PRIMARY KEY,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT 'fullscreen' CHECK (feature IN ('fullscreen', 'edit')),
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

INSERT INTO FullscreenRecoveryRequest
  (id, cloudId, accountId, feature, scenariosJson, noteCiphertext, emailCiphertext, consentVersion,
   consentAt, contentId, customContentId, spaceKey, createdAt, grantId, activatedAt, expiresAt,
   supportOutcome, supportOutcomeAt)
SELECT id, cloudId, accountId, feature, scenariosJson, noteCiphertext, emailCiphertext, consentVersion,
   consentAt, contentId, customContentId, spaceKey, createdAt, grantId, activatedAt, expiresAt,
   supportOutcome, supportOutcomeAt
FROM FullscreenRecoveryRequest_hold;

DROP TABLE FullscreenRecoveryRequest_hold;

CREATE INDEX idx_fullscreen_recovery_support_pending
  ON FullscreenRecoveryRequest (createdAt, id);
