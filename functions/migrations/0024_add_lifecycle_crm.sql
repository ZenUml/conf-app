-- Minimal in-house CRM for lifecycle email/JSM follow-up.
--
-- lifecycle_contact tracks one row per (contact_email, app): where that
-- contact is in the onboarding/trial nurture sequence (`step`), when the
-- next touch is due (`step_due_at`), and enough license context (seat_tier,
-- license_type, eval window) to decide what to send without a join back to
-- D1's license tables at send time. `suppressed` is the unsubscribe/opt-out
-- flag checked before any send.
--
-- lifecycle_touchpoint is the append-only log of everything sent or logged
-- against a contact — emails, JSM interactions, manual notes — keyed by
-- (contact_email, app) to match the contact table, not a foreign key (D1/
-- SQLite has no enforced FK here, consistent with the rest of this schema).

CREATE TABLE IF NOT EXISTS lifecycle_contact (
  contact_email   TEXT NOT NULL,
  app             TEXT NOT NULL,            -- lite | full | diagramly | asyncapi
  cloud_id        TEXT NOT NULL,
  seat_tier       TEXT,
  license_type    TEXT,                     -- FREE | EVALUATION | COMMERCIAL | ...
  eval_started_at TEXT,
  eval_ends_at    TEXT,
  step            TEXT NOT NULL DEFAULT 'welcome',
  step_due_at     TEXT,
  suppressed      INTEGER NOT NULL DEFAULT 0,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  PRIMARY KEY (contact_email, app)
);

CREATE TABLE IF NOT EXISTS lifecycle_touchpoint (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_email TEXT NOT NULL,
  app           TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- email_sent | email_engaged | email_unsubscribed | jsm | note
  step          TEXT,
  meta          TEXT,                       -- JSON
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_touchpoint_contact
  ON lifecycle_touchpoint (contact_email, app);

CREATE INDEX IF NOT EXISTS idx_lifecycle_contact_step_due
  ON lifecycle_contact (step_due_at)
  WHERE suppressed = 0;
