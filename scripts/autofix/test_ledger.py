"""Offline fault/regression tests. All databases and identifiers are synthetic."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from threading import Barrier
import unittest

from ledger import (
  DeliveryConflict, EffectConflict, EffectSpec, InvalidTransition, Ledger,
  LeaseConflict, RevisionConflict,
)


KEY = hashlib.sha256(b'synthetic-incident').hexdigest()
BODY = hashlib.sha256(b'synthetic-body').hexdigest()
OTHER = hashlib.sha256(b'other-synthetic-body').hexdigest()
SHA = 'a' * 40


class LedgerTest(unittest.TestCase):
  def setUp(self):
    self.directory = tempfile.TemporaryDirectory()
    self.path = Path(self.directory.name) / 'private.sqlite3'
    self.now = 1000.0
    self.db = Ledger(self.path, clock=lambda: self.now)

  def tearDown(self):
    self.db.close()
    self.directory.cleanup()

  def ingest(self, **overrides):
    values = dict(provider='sentry', delivery_id='synthetic-delivery',
                  body_digest=BODY, incident_key=KEY)
    values.update(overrides)
    return self.db.ingest(**values)

  def claim(self, effect_id, owner='worker-1'):
    return self.db.claim_effect(effect_id, owner=owner, lease_seconds=10)

  def finish(self, effect, status='succeeded'):
    return self.db.finish_effect(
      effect['id'], owner=effect['owner'], fence=effect['fence'],
      expected_revision=effect['revision'], status=status,
      evidence_digest=OTHER, reason_code='synthetic_result')

  def test_ingest_is_durable_and_duplicate_is_side_effect_free(self):
    first = self.ingest()
    before = self.db.audit_events(first['attempt_id'])
    again = self.ingest()
    self.assertFalse(first['duplicate'])
    self.assertEqual(again, dict(first, duplicate=True))
    self.assertEqual(before, self.db.audit_events(first['attempt_id']))
    self.assertEqual(len(self.db.list_effects()), 1)
    self.db.close()
    self.db = Ledger(self.path, clock=lambda: self.now)
    self.assertEqual(self.ingest(), again)
    self.assertEqual(self.db.get_effect(first['effect_id'])['status'], 'pending')

  def test_duplicate_body_or_correlation_mismatch_is_rejected(self):
    first = self.ingest()
    before = self.db.audit_events(first['attempt_id'])
    with self.assertRaises(DeliveryConflict):
      self.ingest(body_digest=OTHER)
    with self.assertRaises(DeliveryConflict):
      self.ingest(incident_key=OTHER)
    self.assertEqual(before, self.db.audit_events(first['attempt_id']))
    self.assertEqual(len(self.db.list_attempts()), 1)

  def test_delivery_ids_are_scoped_by_provider(self):
    first = self.ingest()
    second = self.ingest(provider='synthetic', body_digest=OTHER)
    self.assertFalse(second['duplicate'])
    self.assertEqual(first['attempt_id'], second['attempt_id'])
    self.assertEqual(first['effect_id'], second['effect_id'])

  def test_ingest_rolls_back_if_outbox_insert_fails(self):
    # Inject a durable-outbox failure without modifying application logic.
    with sqlite3.connect(self.path) as db:
      db.execute("CREATE TRIGGER fail_effect BEFORE INSERT ON effects "
                 "BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
    with self.assertRaises(sqlite3.IntegrityError):
      self.ingest()
    self.assertEqual(self.db.list_attempts(), [])
    with sqlite3.connect(self.path) as db:
      self.assertEqual(db.execute('SELECT count(*) FROM deliveries').fetchone()[0], 0)
      self.assertEqual(db.execute('SELECT count(*) FROM audit_events').fetchone()[0], 0)

  def test_attempt_transition_has_compare_and_swap_and_atomic_outbox(self):
    first = self.ingest()
    attempt = self.db.transition_attempt(
      first['attempt_id'], expected_revision=0, stage='fixing',
      reason_code='triage_passed', effect=EffectSpec('create_issue', OTHER))
    self.assertEqual(attempt['revision'], 1)
    self.assertEqual(attempt['stage'], 'fixing')
    with self.assertRaises(RevisionConflict):
      self.db.transition_attempt(first['attempt_id'], expected_revision=0,
                                 stage='blocked', reason_code='stale_worker')
    with self.assertRaises(InvalidTransition):
      self.db.transition_attempt(first['attempt_id'], expected_revision=1,
                                 stage='verified', reason_code='invalid_jump')
    self.assertEqual(len(self.db.list_effects()), 2)
    # Existing unique key with different input must roll back the transition.
    with self.assertRaises(EffectConflict):
      self.db.transition_attempt(
        first['attempt_id'], expected_revision=1, stage='testing',
        reason_code='tests_requested', effect=EffectSpec('create_issue', BODY))
    self.assertEqual(self.db.get_attempt(first['attempt_id']), attempt)

  def test_effect_unique_key_includes_candidate_and_variant(self):
    first = self.ingest()
    args = dict(attempt_id=first['attempt_id'], expected_revision=0)
    spec = EffectSpec('publish_release', OTHER, SHA, 'diagramly')
    effect = self.db.enqueue_effect(**args, effect=spec)
    self.assertEqual(effect, self.db.enqueue_effect(**args, effect=spec))
    with self.assertRaises(EffectConflict):
      self.db.enqueue_effect(**args, effect=EffectSpec('publish_release', BODY, SHA, 'diagramly'))
    other = self.db.enqueue_effect(**args, effect=EffectSpec('publish_release', OTHER, SHA, 'lite'))
    self.assertNotEqual(effect['id'], other['id'])

  def test_stale_owner_fence_revision_and_expired_lease_are_rejected(self):
    first = self.ingest()
    effect = self.claim(first['effect_id'])
    for overrides in ({'owner': 'worker-2'}, {'fence': effect['fence'] - 1},
                      {'expected_revision': effect['revision'] - 1}):
      args = dict(owner=effect['owner'], fence=effect['fence'],
                  expected_revision=effect['revision'], status='succeeded',
                  evidence_digest=OTHER, reason_code='synthetic_result')
      args.update(overrides)
      with self.assertRaises((LeaseConflict, RevisionConflict)):
        self.db.finish_effect(effect['id'], **args)
    with self.assertRaises(LeaseConflict):
      self.claim(effect['id'], owner='worker-2')
    self.now += 10
    with self.assertRaises(LeaseConflict):
      self.finish(effect)
    self.assertEqual(self.db.recover_expired_claims(), 1)
    self.assertEqual(self.db.get_effect(effect['id'])['status'], 'unknown')

  def test_restart_does_not_steal_live_claim_or_blindly_retry_expired_claim(self):
    first = self.ingest()
    effect = self.claim(first['effect_id'])
    self.db.close()
    self.db = Ledger(self.path, clock=lambda: self.now)
    self.assertEqual(self.db.get_effect(effect['id'])['status'], 'claimed')
    self.db.close()
    self.now += 11
    self.db = Ledger(self.path, clock=lambda: self.now)
    unknown = self.db.get_effect(effect['id'])
    self.assertEqual(unknown['status'], 'unknown')
    self.assertGreater(unknown['fence'], effect['fence'])
    with self.assertRaises(LeaseConflict):
      self.claim(effect['id'])
    with self.assertRaises((LeaseConflict, RevisionConflict)):
      self.finish(effect)

  def test_real_process_crash_after_claim_requires_reconciliation(self):
    first = self.ingest()
    self.db.close()
    script = ("import os; from ledger import Ledger; "
              "db = Ledger(os.environ['TEST_DB'], clock=lambda: 1000); "
              "db.claim_effect(os.environ['TEST_EFFECT'], owner='crashed', lease_seconds=10); "
              "os._exit(17)")
    env = dict(os.environ, TEST_DB=str(self.path), TEST_EFFECT=first['effect_id'],
               PYTHONDONTWRITEBYTECODE='1')
    result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parent,
                            env=env, check=False, capture_output=True)
    self.assertEqual(result.returncode, 17, result.stderr)
    self.now += 11
    self.db = Ledger(self.path, clock=lambda: self.now)
    self.assertEqual(self.db.get_effect(first['effect_id'])['status'], 'unknown')
    self.assertEqual(self.db.list_effects(status='pending'), [])

  def test_unknown_only_retries_after_verified_absence_and_executor_fencing(self):
    first = self.ingest()
    old = self.claim(first['effect_id'])
    unknown = self.finish(old, status='unknown')
    args = dict(expected_revision=unknown['revision'], fence=unknown['fence'],
                outcome='not_applied', evidence_digest=OTHER)
    with self.assertRaises(LeaseConflict):
      self.db.reconcile_effect(unknown['id'], **args)
    pending = self.db.reconcile_effect(unknown['id'], **args, prior_executor_stopped=True)
    self.assertEqual(pending['status'], 'pending')
    new = self.claim(unknown['id'], owner='worker-2')
    self.assertGreater(new['fence'], old['fence'])
    with self.assertRaises((LeaseConflict, RevisionConflict)):
      self.finish(old)
    self.assertEqual(self.finish(new)['status'], 'succeeded')
    with self.assertRaises(LeaseConflict):
      self.claim(new['id'])

  def test_reconcile_success_does_not_execute_again_and_uses_cas(self):
    first = self.ingest()
    unknown = self.finish(self.claim(first['effect_id']), status='unknown')
    args = dict(expected_revision=unknown['revision'], fence=unknown['fence'],
                outcome='succeeded', evidence_digest=OTHER)
    result = self.db.reconcile_effect(unknown['id'], **args)
    self.assertEqual(result['status'], 'succeeded')
    with self.assertRaises(RevisionConflict):
      self.db.reconcile_effect(unknown['id'], **args)
    self.assertEqual(self.db.list_effects(status='pending'), [])

  def test_renewal_is_fenced_and_expiry_cannot_be_revived(self):
    first = self.ingest()
    old = self.claim(first['effect_id'])
    self.now += 2
    renewed = self.db.renew_lease(old['id'], owner=old['owner'], fence=old['fence'],
                                expected_revision=old['revision'], lease_seconds=20)
    self.assertEqual(renewed['lease_until'], self.now + 20)
    with self.assertRaises(RevisionConflict):
      self.finish(old)
    self.now += 20
    with self.assertRaises(LeaseConflict):
      self.db.renew_lease(renewed['id'], owner=renewed['owner'], fence=renewed['fence'],
                         expected_revision=renewed['revision'], lease_seconds=20)

  def test_audit_is_append_only_in_sql_and_has_no_payload_field(self):
    first = self.ingest()
    with sqlite3.connect(self.path) as db:
      with self.assertRaises(sqlite3.IntegrityError):
        db.execute('UPDATE audit_events SET reason_code = ?', ('tampered',))
      with self.assertRaises(sqlite3.IntegrityError):
        db.execute('DELETE FROM audit_events')
    events = self.db.audit_events(first['attempt_id'])
    self.assertGreater(len(events), 0)
    self.assertFalse(any('payload' in name or 'body' in name for name in events[0]))
    with self.assertRaises(TypeError):
      self.ingest(payload={'customer': 'must-not-be-stored'})
    with self.assertRaises(ValueError):
      self.ingest(delivery_id='a customer domain or message')

  def test_database_is_private_and_insecure_existing_paths_are_rejected(self):
    self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
    self.db.close()
    self.path.chmod(0o644)
    with self.assertRaises(PermissionError):
      Ledger(self.path)
    self.path.chmod(0o600)
    link = self.path.parent / 'link.sqlite3'
    link.symlink_to(self.path)
    with self.assertRaises((PermissionError, OSError)):
      Ledger(link)

  def test_cross_connection_dedupe_and_claim_are_exclusive(self):
    first = self.ingest()
    with Ledger(self.path, clock=lambda: self.now) as second:
      duplicate = second.ingest(provider='sentry', delivery_id='synthetic-delivery',
                                body_digest=BODY, incident_key=KEY)
      self.assertTrue(duplicate['duplicate'])
      self.claim(first['effect_id'])
      with self.assertRaises(LeaseConflict):
        second.claim_effect(first['effect_id'], owner='other', lease_seconds=10)

  def test_simultaneous_deliveries_and_claims_have_one_winner(self):
    barrier = Barrier(2)

    def deliver(_):
      with Ledger(self.path, clock=lambda: self.now) as db:
        barrier.wait(timeout=5)
        return db.ingest(provider='sentry', delivery_id='race-delivery',
                         body_digest=BODY, incident_key=KEY)

    with ThreadPoolExecutor(max_workers=2) as pool:
      results = list(pool.map(deliver, range(2)))
    self.assertEqual(sum(not result['duplicate'] for result in results), 1)
    self.assertEqual(len(self.db.list_attempts()), 1)
    self.assertEqual(len(self.db.list_effects()), 1)
    effect_id = results[0]['effect_id']

    def claim(worker):
      with Ledger(self.path, clock=lambda: self.now) as db:
        barrier.wait(timeout=5)
        try:
          db.claim_effect(effect_id, owner=f'worker-{worker}', lease_seconds=10)
          return True
        except LeaseConflict:
          return False

    with ThreadPoolExecutor(max_workers=2) as pool:
      results = list(pool.map(claim, range(2)))
    self.assertEqual(sum(results), 1)

  def test_recurrence_creates_new_attempt_but_old_delivery_stays_deduplicated(self):
    first = self.ingest()
    stages = ('fixing', 'testing', 'deploying', 'monitoring', 'verified')
    for revision, stage in enumerate(stages):
      self.db.transition_attempt(first['attempt_id'], expected_revision=revision,
                                 stage=stage, reason_code='synthetic_proof', evidence_digest=OTHER)
    second = self.ingest(delivery_id='regressed-delivery', body_digest=OTHER)
    self.assertNotEqual(second['attempt_id'], first['attempt_id'])
    self.assertEqual(second['attempt_number'], 2)
    self.assertEqual(self.ingest(), dict(first, duplicate=True))
    self.assertEqual(len(self.db.list_effects()), 2)

  def test_failure_is_terminal_and_release_transition_requires_evidence(self):
    first = self.ingest()
    failed = self.finish(self.claim(first['effect_id']), status='failed')
    with self.assertRaises(LeaseConflict):
      self.claim(failed['id'])
    with self.assertRaises(LeaseConflict):
      self.db.reconcile_effect(failed['id'], expected_revision=failed['revision'],
                               fence=failed['fence'], outcome='not_applied',
                               evidence_digest=OTHER, prior_executor_stopped=True)
    for revision, stage in enumerate(('fixing', 'testing')):
      self.db.transition_attempt(first['attempt_id'], expected_revision=revision,
                                 stage=stage, reason_code='synthetic')
    with self.assertRaises(InvalidTransition):
      self.db.transition_attempt(first['attempt_id'], expected_revision=2,
                                 stage='deploying', reason_code='missing_evidence')

  def test_invalid_hash_clock_and_lease_are_rejected(self):
    for value in ('raw customer payload', '', 'a' * 63):
      with self.assertRaises(ValueError):
        self.ingest(body_digest=value)
    first = self.ingest()
    for value in (0, -1, float('inf'), float('nan'), True):
      with self.assertRaises(ValueError):
        self.db.claim_effect(first['effect_id'], owner='worker', lease_seconds=value)
    self.now = float('nan')
    with self.assertRaises(ValueError):
      self.ingest(delivery_id='different')


if __name__ == '__main__':
  unittest.main()
