-- Deterministic auto-welcome for the lifecycle CRM (functions/migrations/
-- 0024_add_lifecycle_crm.sql). Welcome is a low-risk transactional/
-- onboarding email: a contact is AUTO-sent after passing every check in
-- senderCore.mjs's evaluateEligibility() -- there is no per-email human
-- approval step. This migration adds the per-contact eligibility state that
-- decision needs (welcome_state / block_reason / retry_count / last_error /
-- last_failed_at / unsubscribed_at), the operator control surface
-- (lifecycle_setting: global kill switch, per-app pause, retry cap, rate
-- limit), and an audit trail of every sender run (lifecycle_run) so a run's
-- outcome never has to be re-derived from touchpoints.
--
-- Purely additive: existing lifecycle_contact rows get welcome_state='new'
-- (re-evaluated on the next sender run, same as a freshly ingested contact)
-- and retry_count=0; nothing here rewrites step/step_due_at/suppressed,
-- which stay owned by ingestCore.mjs / migration 0024.

ALTER TABLE lifecycle_contact ADD COLUMN welcome_state TEXT NOT NULL DEFAULT 'new';
ALTER TABLE lifecycle_contact ADD COLUMN block_reason TEXT;
ALTER TABLE lifecycle_contact ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lifecycle_contact ADD COLUMN last_error TEXT;
ALTER TABLE lifecycle_contact ADD COLUMN last_failed_at TEXT;
ALTER TABLE lifecycle_contact ADD COLUMN unsubscribed_at TEXT;

-- Operator-facing settings, one row per key so a new setting never needs a
-- schema migration. Seeded conservatively: automation_enabled starts
-- 'false' (an operator must explicitly opt in before any auto-send can
-- happen), paused_apps starts empty, and max_retries/rate_limit_per_run
-- start at sane production defaults.
CREATE TABLE IF NOT EXISTS lifecycle_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO lifecycle_setting (key, value, updated_at) VALUES
  ('automation_enabled', 'false', '1970-01-01T00:00:00.000Z'),
  ('paused_apps', '[]', '1970-01-01T00:00:00.000Z'),
  ('max_retries', '3', '1970-01-01T00:00:00.000Z'),
  ('rate_limit_per_run', '50', '1970-01-01T00:00:00.000Z');

-- One row per sendWelcomeCore() invocation (dry, live, or a --test-to
-- single-send), whether or not it actually reached any contact -- a run
-- skipped entirely by the automation_off gate still gets a row (due=sent=
-- blocked=failed=0, skipped_reason='automation_off') so "was automation
-- ever on" is answerable from lifecycle_run alone.
CREATE TABLE IF NOT EXISTS lifecycle_run (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  mode           TEXT NOT NULL,             -- dry | live | test
  due            INTEGER NOT NULL DEFAULT 0,
  sent           INTEGER NOT NULL DEFAULT 0,
  blocked        INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  skipped_reason TEXT,
  meta           TEXT                       -- JSON
);
