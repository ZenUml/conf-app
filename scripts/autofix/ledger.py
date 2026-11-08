"""Private, local SQLite incident/outbox foundation. No network or executor.

Only trusted adapters may call this API. They authenticate/validate deliveries,
verify policy, and hash evidence before calling. Never pass customer text as an
ID/reason code. There is deliberately no JSON payload, title, URL or stack field.
The initial ``triage`` effect is durable work, NOT permission to contact GitHub.

Lease fencing protects local writes, not a remote service. A claimed effect may
have executed even when a worker dies before recording success. Expired claims
become UNKNOWN, never pending. Reconciliation must query authoritative remote
state. ``not_applied`` additionally requires proof the previous executor and
any in-flight request can no longer apply the action; absence alone is unsafe.
No API here can establish that proof or authorize release/rollback by itself.

Use one connection per worker, on a local filesystem in a trusted directory.
DELETE journal + FULL synchronous provide crash durability without long-lived
WAL sidecars. This is not encrypted or tamper-proof against the filesystem owner.
Keep the database outside the public repository and back it up privately.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
from uuid import uuid4


class LedgerError(Exception):
  """Base for expected ledger conflicts."""


class DeliveryConflict(LedgerError):
  """A provider reused a delivery ID for different input/correlation."""


class EffectConflict(LedgerError):
  """An effect key was reused with different intended input."""


class RevisionConflict(LedgerError):
  """The caller's snapshot is stale."""


class LeaseConflict(LedgerError):
  """The effect cannot be executed or this executor no longer owns it."""


class InvalidTransition(LedgerError):
  """The requested attempt/effect transition is invalid."""


@dataclass(frozen=True)
class EffectSpec:
  kind: str
  request_digest: str
  candidate_sha: str = ''
  variant: str = ''


TRANSITIONS = {
  'received': {'fixing', 'blocked'}, 'fixing': {'testing', 'blocked'},
  'testing': {'deploying', 'blocked'},
  'deploying': {'monitoring', 'rollback_required', 'blocked'},
  'monitoring': {'verified', 'rollback_required', 'blocked'},
  'rollback_required': {'rolled_back', 'blocked'},
  'blocked': {'fixing', 'testing', 'monitoring'}, 'verified': set(), 'rolled_back': set(),
}
EFFECT_KINDS = frozenset({
  'triage', 'create_issue', 'start_agent', 'create_pr', 'publish_release',
  'observe_release', 'rollback_release', 'mirror_project', 'resolve_sentry', 'analytics',
})
EFFECT_STATUSES = frozenset({'pending', 'claimed', 'unknown', 'succeeded', 'failed'})
TOKEN = re.compile(r'[A-Za-z0-9_-]{1,128}\Z')
DIGEST = re.compile(r'[a-f0-9]{64}\Z')
SHA = re.compile(r'[a-f0-9]{40}\Z')
APPLICATION_ID = 0x41554658

SCHEMA = """
CREATE TABLE incidents (
  incident_key TEXT PRIMARY KEY,
  created_at REAL NOT NULL
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL REFERENCES incidents(incident_key),
  number INTEGER NOT NULL CHECK(number > 0),
  stage TEXT NOT NULL CHECK(stage IN ('received','fixing','testing','deploying',
    'monitoring','rollback_required','blocked','verified','rolled_back')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  UNIQUE(incident_key, number)
);
CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  kind TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  candidate_sha TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending','claimed','unknown','succeeded','failed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  fence INTEGER NOT NULL DEFAULT 0 CHECK(fence >= 0),
  owner TEXT,
  lease_until REAL,
  evidence_digest TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  UNIQUE(attempt_id, kind, candidate_sha, variant),
  CHECK((status = 'claimed' AND owner IS NOT NULL AND lease_until IS NOT NULL)
    OR (status != 'claimed' AND owner IS NULL AND lease_until IS NULL))
);
CREATE INDEX effects_by_status ON effects(status, created_at);
CREATE TABLE deliveries (
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  body_digest TEXT NOT NULL,
  incident_key TEXT NOT NULL REFERENCES incidents(incident_key),
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  effect_id TEXT NOT NULL REFERENCES effects(id),
  received_at REAL NOT NULL,
  PRIMARY KEY(provider, delivery_id)
);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at REAL NOT NULL,
  incident_key TEXT NOT NULL REFERENCES incidents(incident_key),
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL,
  effect_id TEXT REFERENCES effects(id),
  effect_revision INTEGER,
  fence INTEGER,
  state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  evidence_digest TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
"""


def _token(value, name):
  if not isinstance(value, str) or not TOKEN.fullmatch(value):
    raise ValueError(f'{name} must be a bounded opaque identifier/code')
  return value


def _digest(value, name, *, optional=False):
  if optional and value == '':
    return value
  if not isinstance(value, str) or not DIGEST.fullmatch(value):
    raise ValueError(f'{name} must be a lowercase SHA-256 digest')
  return value


def _integer(value, name):
  if type(value) is not int or value < 0:
    raise ValueError(f'{name} must be a nonnegative integer')


def _duration(value):
  if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 3600:
    raise ValueError('lease_seconds must be finite and between 0 and 3600')


def _spec(effect):
  if not isinstance(effect, EffectSpec) or effect.kind not in EFFECT_KINDS:
    raise ValueError('unknown effect kind')
  _digest(effect.request_digest, 'request_digest')
  if not isinstance(effect.candidate_sha, str) or (effect.candidate_sha and not SHA.fullmatch(effect.candidate_sha)):
    raise ValueError('candidate_sha must be empty or a lowercase 40-character SHA')
  if effect.variant not in ('', 'diagramly', 'lite', 'full'):
    raise ValueError('unsupported variant')
  if effect.kind in {'publish_release', 'observe_release', 'rollback_release'} and not (effect.candidate_sha and effect.variant):
    raise ValueError('release effects require a pinned candidate and variant')
  return effect


class Ledger:
  def __init__(self, path, *, clock=time.time):
    self.path = Path(path).absolute()
    self.clock = clock
    self._db = None
    # Do not chmod existing files or follow symlinks into an unintended database.
    if not self.path.parent.is_dir():
      raise FileNotFoundError('create a private parent directory before opening the ledger')
    parent = self.path.parent.stat()
    if parent.st_mode & 0o022:
      raise PermissionError('ledger parent directory must not be group/world writable')
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    try:
      descriptor = os.open(self.path, flags, 0o600)
    except FileExistsError:
      pass
    else:
      os.close(descriptor)
    info = self.path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
      raise PermissionError('ledger must be a regular, unlinked 0600 file')
    if hasattr(os, 'geteuid') and info.st_uid != os.geteuid():
      raise PermissionError('ledger must be owned by the current user')
    try:
      self._db = sqlite3.connect(str(self.path), isolation_level=None, timeout=5)
      self._db.row_factory = sqlite3.Row
      self._db.execute('PRAGMA foreign_keys = ON')
      self._db.execute('PRAGMA trusted_schema = OFF')
      self._db.execute('PRAGMA journal_mode = DELETE')
      self._db.execute('PRAGMA synchronous = FULL')
      self._initialize()
      self.recover_expired_claims()
    except BaseException:
      self.close()
      raise

  def _initialize(self):
    with self._transaction():
      version = self._db.execute('PRAGMA user_version').fetchone()[0]
      application = self._db.execute('PRAGMA application_id').fetchone()[0]
      if version == 0 and application == 0:
        if self._db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
          raise LedgerError('refusing to initialize an unrelated database')
        # executescript implicitly commits: execute complete statements ourselves.
        statement = ''
        for line in SCHEMA.splitlines():
          statement += line + '\n'
          if sqlite3.complete_statement(statement):
            self._db.execute(statement)
            statement = ''
        self._db.execute(f'PRAGMA application_id = {APPLICATION_ID}')
        self._db.execute('PRAGMA user_version = 1')
      elif version != 1 or application != APPLICATION_ID:
        raise LedgerError('unsupported ledger schema')

  @contextmanager
  def _transaction(self):
    self._db.execute('BEGIN IMMEDIATE')
    try:
      yield
      self._db.execute('COMMIT')
    except BaseException:
      if self._db.in_transaction:
        self._db.execute('ROLLBACK')
      raise

  def _now(self):
    now = self.clock()
    if type(now) not in (float, int) or not math.isfinite(now) or now < 0:
      raise ValueError('clock must return a finite nonnegative Unix timestamp')
    return now

  def close(self):
    if self._db is not None:
      self._db.close()
      self._db = None

  def __enter__(self):
    return self

  def __exit__(self, *_):
    self.close()

  def _one(self, table, identifier):
    # Table names are internal constants, never caller-supplied SQL.
    row = self._db.execute(f'SELECT * FROM {table} WHERE id = ?', (identifier,)).fetchone()
    if row is None:
      raise KeyError(f'{table} record not found')
    return dict(row)

  def get_attempt(self, attempt_id):
    return self._one('attempts', attempt_id)

  def get_effect(self, effect_id):
    return self._one('effects', effect_id)

  def list_attempts(self):
    return [dict(row) for row in self._db.execute('SELECT * FROM attempts ORDER BY created_at, id')]

  def list_effects(self, *, status=None):
    if status is not None and status not in EFFECT_STATUSES:
      raise ValueError('unknown effect status')
    return [dict(row) for row in self._db.execute(
      'SELECT * FROM effects WHERE (? IS NULL OR status = ?) ORDER BY created_at, id', (status, status))]

  def audit_events(self, attempt_id):
    return [dict(row) for row in self._db.execute(
      'SELECT * FROM audit_events WHERE attempt_id = ? ORDER BY id', (attempt_id,))]

  def _audit(self, attempt, kind, now, *, effect=None, reason_code, evidence_digest=''):
    self._db.execute('''INSERT INTO audit_events
      (at, incident_key, attempt_id, kind, revision, effect_id, effect_revision,
       fence, state, reason_code, evidence_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      (now, attempt['incident_key'], attempt['id'], kind, attempt['revision'],
       effect['id'] if effect else None, effect['revision'] if effect else None,
       effect['fence'] if effect else None, effect['status'] if effect else attempt['stage'],
       reason_code, evidence_digest))

  @staticmethod
  def _revision(record, expected_revision):
    _integer(expected_revision, 'expected_revision')
    if record['revision'] != expected_revision:
      raise RevisionConflict('record revision changed')

  def _enqueue(self, attempt, effect, now):
    _spec(effect)
    old = self._db.execute('''SELECT * FROM effects
      WHERE attempt_id = ? AND kind = ? AND candidate_sha = ? AND variant = ?''',
      (attempt['id'], effect.kind, effect.candidate_sha, effect.variant)).fetchone()
    if old is not None:
      if old['request_digest'] != effect.request_digest:
        raise EffectConflict('effect key has a different request digest')
      return dict(old)
    identifier = uuid4().hex
    self._db.execute('''INSERT INTO effects
      (id, attempt_id, kind, request_digest, candidate_sha, variant, status,
       reason_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'enqueued', ?, ?)''',
      (identifier, attempt['id'], effect.kind, effect.request_digest,
       effect.candidate_sha, effect.variant, now, now))
    record = self.get_effect(identifier)
    self._audit(attempt, 'effect_enqueued', now, effect=record, reason_code='enqueued')
    return record

  def ingest(self, *, provider, delivery_id, body_digest, incident_key):
    """Atomically deduplicate and enqueue triage; acknowledge only after return.

    The caller must restrict incoming event types to actionable incidents. A new
    delivery after a terminal attempt starts a recurrence; a duplicate delivery
    always points at its original attempt, including after later recurrences.
    """
    _token(provider, 'provider')
    _token(delivery_id, 'delivery_id')
    _digest(body_digest, 'body_digest')
    _digest(incident_key, 'incident_key')
    with self._transaction():
      now = self._now()
      old = self._db.execute('SELECT * FROM deliveries WHERE provider = ? AND delivery_id = ?',
                             (provider, delivery_id)).fetchone()
      if old is not None:
        if old['body_digest'] != body_digest or old['incident_key'] != incident_key:
          raise DeliveryConflict('delivery ID has a different digest or incident key')
        attempt = self.get_attempt(old['attempt_id'])
        return dict(duplicate=True, incident_key=incident_key, attempt_id=attempt['id'],
                    attempt_number=attempt['number'], effect_id=old['effect_id'])
      self._db.execute('INSERT OR IGNORE INTO incidents (incident_key, created_at) VALUES (?, ?)',
                       (incident_key, now))
      latest = self._db.execute('SELECT * FROM attempts WHERE incident_key = ? ORDER BY number DESC LIMIT 1',
                                (incident_key,)).fetchone()
      if latest is None or latest['stage'] in {'verified', 'rolled_back'}:
        identifier = uuid4().hex
        number = latest['number'] + 1 if latest is not None else 1
        self._db.execute('''INSERT INTO attempts
          (id, incident_key, number, stage, created_at, updated_at) VALUES (?, ?, ?, 'received', ?, ?)''',
          (identifier, incident_key, number, now, now))
        attempt = self.get_attempt(identifier)
        self._audit(attempt, 'attempt_created', now, reason_code='incident_received')
        effect = self._enqueue(attempt, EffectSpec('triage', body_digest), now)
      else:
        attempt = dict(latest)
        effect = dict(self._db.execute("SELECT * FROM effects WHERE attempt_id = ? AND kind = 'triage' AND candidate_sha = '' AND variant = ''",
                                       (attempt['id'],)).fetchone())
      self._db.execute('''INSERT INTO deliveries
        (provider, delivery_id, body_digest, incident_key, attempt_id, effect_id, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (provider, delivery_id, body_digest, incident_key, attempt['id'], effect['id'], now))
      self._audit(attempt, 'delivery_received', now, reason_code='authenticated_delivery', evidence_digest=body_digest)
      return dict(duplicate=False, incident_key=incident_key, attempt_id=attempt['id'],
                  attempt_number=attempt['number'], effect_id=effect['id'])

  def transition_attempt(self, attempt_id, *, expected_revision, stage, reason_code,
                         evidence_digest='', effect=None):
    """Persist a trusted policy result with optional outbox intent atomically.

    This verifies shape/state/CAS, not the authenticity of policy evidence.
    Deploy/verify/rollback stages require a digest of externally verified proof.
    """
    _token(reason_code, 'reason_code')
    _digest(evidence_digest, 'evidence_digest', optional=True)
    if stage not in TRANSITIONS:
      raise InvalidTransition('unknown attempt stage')
    if stage in {'deploying', 'verified', 'rolled_back'} and not evidence_digest:
      raise InvalidTransition('terminal/release transition requires evidence digest')
    if effect is not None:
      _spec(effect)
    with self._transaction():
      now = self._now()
      attempt = self.get_attempt(attempt_id)
      self._revision(attempt, expected_revision)
      if stage not in TRANSITIONS[attempt['stage']]:
        raise InvalidTransition('invalid attempt stage transition')
      self._db.execute('UPDATE attempts SET stage = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
                       (stage, now, attempt_id, expected_revision))
      attempt = self.get_attempt(attempt_id)
      self._audit(attempt, 'attempt_transition', now, reason_code=reason_code, evidence_digest=evidence_digest)
      if effect is not None:
        self._enqueue(attempt, effect, now)
      return attempt

  def enqueue_effect(self, attempt_id, *, expected_revision, effect):
    """Idempotent intent insertion. Enqueueing is not authorization to execute."""
    _spec(effect)
    with self._transaction():
      attempt = self.get_attempt(attempt_id)
      self._revision(attempt, expected_revision)
      return self._enqueue(attempt, effect, self._now())

  def claim_effect(self, effect_id, *, owner, lease_seconds=60):
    _token(owner, 'owner')
    _duration(lease_seconds)
    with self._transaction():
      now = self._now()
      effect = self.get_effect(effect_id)
      if effect['status'] != 'pending':
        raise LeaseConflict('only a pending effect can be claimed; reconcile unknown effects')
      self._db.execute('''UPDATE effects SET status = 'claimed', owner = ?, lease_until = ?,
        fence = fence + 1, revision = revision + 1, updated_at = ?, reason_code = 'claimed' WHERE id = ?''',
        (owner, now + lease_seconds, now, effect_id))
      return self._effect_event(effect_id, 'effect_claimed', now)

  def _owned(self, effect_id, owner, fence, expected_revision, now):
    _token(owner, 'owner')
    _integer(fence, 'fence')
    effect = self.get_effect(effect_id)
    self._revision(effect, expected_revision)
    if (effect['status'] != 'claimed' or effect['owner'] != owner or effect['fence'] != fence
        or effect['lease_until'] <= now):
      raise LeaseConflict('claim is stale, expired, or owned by another executor')
    return effect

  def _effect_event(self, effect_id, kind, now):
    effect = self.get_effect(effect_id)
    self._audit(self.get_attempt(effect['attempt_id']), kind, now, effect=effect,
                reason_code=effect['reason_code'], evidence_digest=effect['evidence_digest'])
    return effect

  def renew_lease(self, effect_id, *, owner, fence, expected_revision, lease_seconds=60):
    _duration(lease_seconds)
    with self._transaction():
      now = self._now()
      effect = self._owned(effect_id, owner, fence, expected_revision, now)
      self._db.execute('''UPDATE effects SET lease_until = ?, revision = revision + 1,
        updated_at = ?, reason_code = 'lease_renewed' WHERE id = ?''',
        (max(effect['lease_until'], now + lease_seconds), now, effect_id))
      return self._effect_event(effect_id, 'lease_renewed', now)

  def finish_effect(self, effect_id, *, owner, fence, expected_revision, status,
                    evidence_digest, reason_code):
    """Use unknown for timeouts/errors with uncertain side effects, never failed.

    failed means authoritative evidence the action failed without applying.
    Succeeded/failed are terminal here; retry requires a separate reviewed plan.
    """
    if status not in {'unknown', 'succeeded', 'failed'}:
      raise InvalidTransition('finish status must be unknown, succeeded or failed')
    _digest(evidence_digest, 'evidence_digest')
    _token(reason_code, 'reason_code')
    with self._transaction():
      now = self._now()
      self._owned(effect_id, owner, fence, expected_revision, now)
      self._db.execute('''UPDATE effects SET status = ?, owner = NULL, lease_until = NULL,
        revision = revision + 1, fence = fence + 1, updated_at = ?, reason_code = ?,
        evidence_digest = ? WHERE id = ?''', (status, now, reason_code, evidence_digest, effect_id))
      return self._effect_event(effect_id, 'effect_finished', now)

  def recover_expired_claims(self):
    """Safe on startup and periodically. Never requeue an uncertain operation."""
    with self._transaction():
      now = self._now()
      expired = self._db.execute("SELECT id FROM effects WHERE status = 'claimed' AND lease_until <= ?", (now,)).fetchall()
      for row in expired:
        self._db.execute('''UPDATE effects SET status = 'unknown', owner = NULL, lease_until = NULL,
          revision = revision + 1, fence = fence + 1, updated_at = ?, reason_code = 'lease_expired'
          WHERE id = ?''', (now, row['id']))
        self._effect_event(row['id'], 'effect_unknown', now)
      return len(expired)

  def reconcile_effect(self, effect_id, *, expected_revision, fence, outcome,
                       evidence_digest, prior_executor_stopped=False):
    """Record authoritative reconciliation; absence alone never permits a retry.

    ``not_applied`` can requeue ONLY when the trusted caller has also established
    prior_executor_stopped, including its remote in-flight requests. If either
    fact is unknown, leave the record unknown. A boolean/digest is not a verifier.
    """
    if outcome not in {'not_applied', 'succeeded', 'failed'}:
      raise InvalidTransition('invalid reconciliation outcome')
    _digest(evidence_digest, 'evidence_digest')
    _integer(fence, 'fence')
    with self._transaction():
      now = self._now()
      effect = self.get_effect(effect_id)
      self._revision(effect, expected_revision)
      if effect['status'] != 'unknown' or effect['fence'] != fence:
        raise LeaseConflict('only the current unknown effect may be reconciled')
      if outcome == 'not_applied' and prior_executor_stopped is not True:
        raise LeaseConflict('retry needs proof the previous executor cannot still apply the action')
      status = 'pending' if outcome == 'not_applied' else outcome
      self._db.execute('''UPDATE effects SET status = ?, revision = revision + 1,
        fence = fence + 1, updated_at = ?, evidence_digest = ?, reason_code = ? WHERE id = ?''',
        (status, now, evidence_digest, 'reconciled_' + outcome, effect_id))
      return self._effect_event(effect_id, 'effect_reconciled', now)
