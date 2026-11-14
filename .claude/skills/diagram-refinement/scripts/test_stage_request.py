#!/usr/bin/env python3
"""Offline regression tests; all identities and artifacts below are synthetic.

Run with: python3 scripts/test_stage_request.py
No credentials, network, customer data, model calls, or production writes.
"""
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('stage_request', Path(__file__).with_name('stage_request.py'))
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)


class StageRequestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='diagram-refinement-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = b'flowchart LR\n  Alpha --> Beta\n'
        self.reviewed = b'<svg xmlns="http://www.w3.org/2000/svg"><text>Alpha to Beta</text></svg>'
        self.prepared = '<svg xmlns="http://www.w3.org/2000/svg"><text data-node="Alpha">Alpha to Beta</text></svg>'
        self.handoff = {
            'target': {'clientDomain': 'synthetic-tenant', 'productType': 'lite', 'environmentType': 'PRODUCTION',
                       'contentId': 'synthetic-content', 'macroUuid': 'synthetic-macro',
                       'pageId': 'synthetic-page', 'customContentType': 'synthetic-content-type'},
            'connection': {'accountId': 'synthetic-account', 'databaseId': 'synthetic-database'},
            'scope': {'cloudId': 'synthetic-cloud', 'appId': 'synthetic-app',
                      'environmentId': 'synthetic-production-env', 'installationId': 'synthetic-installation'},
            'snapshotPath': 'current-content.json', 'sourcePath': 'source.mmd',
            'reviewedSvgPath': 'reviewed.svg', 'reviewPath': 'review.json',
            'artifactPath': 'artifact.json', 'compatibilityPath': 'compatibility.json',
        }
        self.expected_target = {key: self.handoff['target'][key] for key in stage.TARGET_FIELDS}
        self.snapshot = {
            **{k: self.handoff['scope'][k] for k in ('cloudId', 'appId')},
            **{k: self.handoff['target'][k] for k in ('contentId', 'macroUuid', 'pageId')},
            'status': 'current', 'diagramType': 'mermaid',
            'type': self.handoff['target']['customContentType'], 'latestVersionNumber': 3,
            'body': self.body(self.source.decode()),
        }
        self.artifact = {'sourceHash': stage.digest(self.source), 'svg': self.prepared,
                         'rulesVersion': 'magic-v1', 'outcome': 'validated',
                         'generatedAt': '2030-01-01T00:00:00Z'}
        self.review = {'status': 'ACCEPTED', 'sourceHash': stage.digest(self.source),
                       'svgHash': stage.digest(self.reviewed)}
        self.compatibility = {'sourceHash': stage.digest(self.source),
                              'reviewedSvgHash': stage.digest(self.reviewed),
                              'svgHash': stage.digest(self.prepared.encode()),
                              'displayValidation': 'PASS', 'highlightBinding': 'PASS',
                              'paintGeometryTextAttributesPreserved': True}
        self.write_json('handoff.json', self.handoff)
        self.write_json('current-content.json', self.snapshot)
        self.write_json('artifact.json', self.artifact)
        self.write_json('review.json', self.review)
        self.write_json('compatibility.json', self.compatibility)
        (self.root / 'source.mmd').write_bytes(self.source)
        (self.root / 'reviewed.svg').write_bytes(self.reviewed)
        self.request_path = self.root / 'frozen.json'
        self.readback_path = self.root / 'readback.json'

    @staticmethod
    def body(source, magic=None):
        document = {'diagramType': 'mermaid', 'mermaidCode': source}
        if magic is not None:
            document['magic'] = magic
        return json.dumps({'raw': {'value': json.dumps(document)}})

    def write_json(self, filename, value):
        (self.root / filename).write_text(json.dumps(value), encoding='utf-8')

    def freeze(self):
        receipt = stage.freeze(self.root / 'handoff.json', self.request_path, expected_target=self.expected_target)
        return receipt, stage.read_json(self.request_path)

    def reject_freeze(self, reason):
        with self.assertRaisesRegex(stage.InvalidEvidence, '^' + reason + '$'):
            self.freeze()
        self.assertFalse(self.request_path.exists())

    def row(self, plan):
        return {'id': plan['deliveryId'], **plan['scope'], 'contentId': plan['target']['contentId'],
                'sourceHash': plan['sourceHash'], 'artifact': json.dumps(plan['artifact']),
                'createdAt': plan['createdAt'], 'expiresAt': plan['expiresAt']}

    def verify(self, rows):
        self.write_json('readback.json', rows)
        return stage.verify(self.request_path, self.readback_path)

    def database(self):
        connection = sqlite3.connect(':memory:')
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        connection.executescript('''
            CREATE TABLE MagicWriteback (
                id TEXT PRIMARY KEY, cloudId TEXT, appId TEXT, environmentId TEXT,
                installationId TEXT, contentId TEXT, sourceHash TEXT, artifact TEXT,
                createdAt INTEGER, expiresAt INTEGER, claimToken TEXT
            );
            CREATE TABLE CustomContent (
                contentId TEXT, appId TEXT, cloudId TEXT, macroUuid TEXT, pageId TEXT,
                latestVersionNumber INTEGER, status TEXT, type TEXT, diagramType TEXT, body TEXT
            );
        ''')
        columns = ('contentId', 'appId', 'cloudId', 'macroUuid', 'pageId', 'latestVersionNumber',
                   'status', 'type', 'diagramType', 'body')
        connection.execute('INSERT INTO CustomContent VALUES (?,?,?,?,?,?,?,?,?,?)',
                           [self.snapshot[key] for key in columns])
        return connection

    def execute(self, connection, plan):
        return [dict(row) for row in connection.execute(plan['d1Request']['sql'], plan['d1Request']['params'])]

    def test_success_freeze_and_exact_pending_and_leased_readback(self):
        receipt, plan = self.freeze()
        self.assertEqual(receipt['status'], 'FROZEN_NOT_SENT')
        self.assertEqual(receipt['requestSha256'], stage.digest(self.request_path.read_bytes()))
        self.assertNotEqual(plan['reviewedSvgHash'], plan['svgHash'])
        self.assertEqual(plan['expiresAt'] - plan['createdAt'], 30 * 24 * 60 * 60 * 1000)
        self.assertEqual(plan['sendBy'] - plan['createdAt'], 120_000)
        self.assertEqual(receipt['sendBy'], plan['sendBy'])
        self.assertEqual(len(plan['d1Request']['params']), 26)
        self.assertEqual(plan['d1RequestSha256'], stage.json_digest(plan['d1Request']))
        self.assertEqual(self.request_path.stat().st_mode & 0o777, 0o600)
        row = self.row(plan)
        result = self.verify([row])
        self.assertEqual(result['status'], 'EXACT_QUEUE_READBACK_PASS')
        self.assertEqual(result['queue'], 'PENDING')
        self.assertEqual(result['customerWriteOrDisplay'], 'NOT_CONFIRMED')
        row['claimToken'] = 'synthetic-lease'
        self.assertEqual(self.verify([row])['queue'], 'LEASED')

    def test_freeze_never_overwrites_original_delivery_or_timestamps(self):
        self.freeze()
        original = self.request_path.read_bytes()
        with self.assertRaisesRegex(stage.InvalidEvidence, 'FROZEN_REQUEST_EXISTS_READ_ONLY'):
            self.freeze()
        self.assertEqual(self.request_path.read_bytes(), original)

    def test_accepted_disclosed_tradeoffs(self):
        self.review['status'] = 'ACCEPTED_WITH_DISCLOSED_TRADEOFFS'
        self.write_json('review.json', self.review)
        self.assertEqual(self.freeze()[0]['status'], 'FROZEN_NOT_SENT')

    def test_changed_current_source_requires_new_evidence(self):
        self.snapshot['body'] = self.body('flowchart LR\n  Alpha --> Gamma\n')
        self.write_json('current-content.json', self.snapshot)
        self.reject_freeze('CURRENT_SOURCE_MISMATCH')

    def test_source_file_bytes_are_exact_including_newline(self):
        (self.root / 'source.mmd').write_bytes(self.source.rstrip(b'\n'))
        self.reject_freeze('CURRENT_SOURCE_MISMATCH')

    def test_existing_refined_requires_replacement_decision(self):
        self.snapshot['body'] = self.body(self.source.decode(), {'svg': 'synthetic-previous-svg'})
        self.write_json('current-content.json', self.snapshot)
        self.reject_freeze('EXISTING_REFINED_REQUIRES_REPLACEMENT_DECISION')

    def test_stale_or_unaccepted_review_rejected(self):
        original = copy.deepcopy(self.review)
        for field, value, reason in [('status', 'REJECTED', 'REVIEW_NOT_ACCEPTED'),
                                     ('sourceHash', 'stale', 'STALE_REVIEW'),
                                     ('svgHash', 'stale', 'STALE_REVIEW')]:
            with self.subTest(field=field):
                changed = {**original, field: value}
                self.write_json('review.json', changed)
                self.reject_freeze(reason)

    def test_prepared_artifact_contract_and_timestamp(self):
        original = copy.deepcopy(self.artifact)
        for field, value, reason in [('svg', ' ', 'EMPTY_PREPARED_SVG'),
                                     ('sourceHash', 'stale', 'ARTIFACT_CONTRACT_MISMATCH'),
                                     ('rulesVersion', 'magic-v2', 'ARTIFACT_CONTRACT_MISMATCH'),
                                     ('outcome', 'draft', 'ARTIFACT_CONTRACT_MISMATCH'),
                                     ('generatedAt', '2030-01-01T00:00:00', 'ARTIFACT_TIMESTAMP_NEEDS_TIMEZONE')]:
            with self.subTest(field=field):
                self.write_json('artifact.json', {**original, field: value})
                self.reject_freeze(reason)

    def test_compatibility_requires_exact_hashes_and_passed_checks(self):
        original = copy.deepcopy(self.compatibility)
        for field in ('sourceHash', 'reviewedSvgHash', 'svgHash', 'displayValidation',
                      'highlightBinding', 'paintGeometryTextAttributesPreserved'):
            with self.subTest(field=field):
                value = False if field == 'paintGeometryTextAttributesPreserved' else 'FAIL'
                self.write_json('compatibility.json', {**original, field: value})
                reason = 'STALE_COMPATIBILITY' if field.endswith('Hash') else 'COMPATIBILITY_NOT_PASSED'
                self.reject_freeze(reason)

    def test_wrong_target_product_environment_and_tenant(self):
        original = copy.deepcopy(self.handoff)
        for field, value in [('clientDomain', 'synthetic-other'), ('productType', 'full'),
                             ('environmentType', 'STAGING')]:
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                changed['target'][field] = value
                self.write_json('handoff.json', changed)
                self.reject_freeze('TARGET_SCOPE_MISMATCH')

    def test_explicit_second_tenant_product_and_environment(self):
        self.handoff['target'].update(clientDomain='synthetic-second-tenant',
                                      productType='asyncapi', environmentType='STAGING')
        self.expected_target = {key: self.handoff['target'][key] for key in stage.TARGET_FIELDS}
        self.write_json('handoff.json', self.handoff)
        _, plan = self.freeze()
        self.assertEqual(plan['target']['clientDomain'], 'synthetic-second-tenant')
        self.assertEqual(plan['target']['productType'], 'asyncapi')
        self.assertEqual(plan['target']['environmentType'], 'STAGING')

    def test_expected_target_required(self):
        with self.assertRaises(TypeError):
            stage.freeze(self.root / 'handoff.json', self.request_path)

    def test_invalid_target_values(self):
        for field, value, reason in [
            ('clientDomain', '', 'MISSING_TARGET_clientDomain'),
            ('productType', 'unknown', 'INVALID_TARGET_PRODUCT'),
            ('environmentType', 'unknown', 'INVALID_TARGET_ENVIRONMENT'),
        ]:
            with self.subTest(field=field):
                original = copy.deepcopy(self.expected_target)
                self.expected_target[field] = value
                self.reject_freeze(reason)
                self.expected_target = original

    def test_cli_requires_explicit_target_flags_and_valid_choices(self):
        base = [sys.executable, str(Path(stage.__file__)), 'freeze',
                '--handoff', str(self.root / 'handoff.json'), '--out', str(self.request_path)]
        flags = ['--client-domain', 'synthetic-tenant', '--product-type', 'lite',
                 '--environment', 'PRODUCTION']
        for index in (0, 2, 4):
            with self.subTest(missing=flags[index]):
                result = subprocess.run(base + flags[:index] + flags[index+2:], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.request_path.exists())
        result = subprocess.run(base + flags, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)['status'], 'FROZEN_NOT_SENT')

    def test_wrong_snapshot_scope_and_identity(self):
        original = copy.deepcopy(self.snapshot)
        for field in ('cloudId', 'appId', 'contentId', 'macroUuid', 'pageId'):
            with self.subTest(field=field):
                self.write_json('current-content.json', {**original, field: 'synthetic-other'})
                category = 'CONTENT_SCOPE_MISMATCH_' if field in ('cloudId', 'appId') else 'CONTENT_IDENTITY_MISMATCH_'
                self.reject_freeze(category + field)

    def test_missing_scope_and_placeholder_rejected(self):
        original = copy.deepcopy(self.handoff)
        for field in stage.SCOPE_FIELDS:
            for value in ('', '<not-verified>'):
                with self.subTest(field=field, value=value):
                    changed = copy.deepcopy(original)
                    changed['scope'][field] = value
                    self.write_json('handoff.json', changed)
                    self.reject_freeze('MISSING_SCOPE_' + field)

    def test_invalid_version_and_content_type_status(self):
        original = copy.deepcopy(self.snapshot)
        cases = [('latestVersionNumber', value, 'INVALID_CONTENT_VERSION') for value in (0, True, '3')]
        cases += [(field, 'synthetic-wrong', 'CONTENT_TYPE_OR_STATUS_MISMATCH')
                  for field in ('status', 'type', 'diagramType')]
        for field, value, reason in cases:
            with self.subTest(field=field, value=value):
                self.write_json('current-content.json', {**original, field: value})
                self.reject_freeze(reason)

    def test_guarded_insert_actually_succeeds_and_readback_verifies(self):
        _, plan = self.freeze()
        connection = self.database()
        returned = self.execute(connection, plan)
        self.assertEqual(returned, [{'id': plan['deliveryId'], 'contentId': plan['target']['contentId']}])
        rows = [dict(row) for row in connection.execute('SELECT * FROM MagicWriteback')]
        self.assertEqual(self.verify(rows)['status'], 'EXACT_QUEUE_READBACK_PASS')
        self.assertEqual(rows[0]['expiresAt'] - rows[0]['createdAt'], stage.TTL_MS)

    def test_guarded_insert_duplicate_scoped_content_rejected(self):
        _, plan = self.freeze()
        connection = self.database()
        self.assertEqual(len(self.execute(connection, plan)), 1)
        original = dict(connection.execute('SELECT * FROM MagicWriteback').fetchone())
        alternate = copy.deepcopy(plan)
        alternate['d1Request']['params'][0] = 'synthetic-second-delivery'
        self.assertEqual(self.execute(connection, alternate), [])
        self.assertEqual(dict(connection.execute('SELECT * FROM MagicWriteback').fetchone()), original)

    def test_guarded_insert_all_current_content_drift_rejected(self):
        _, plan = self.freeze()
        cases = [('body', self.body('flowchart LR\n  Alpha --> Gamma\n')),
                 ('latestVersionNumber', 4), ('macroUuid', 'synthetic-other-macro'),
                 ('pageId', 'synthetic-other-page'), ('type', 'synthetic-other-type'),
                 ('diagramType', 'sequence'), ('status', 'deleted'),
                 ('cloudId', 'synthetic-other-cloud'), ('appId', 'synthetic-other-app'),
                 ('contentId', 'synthetic-other-content')]
        for field, value in cases:
            with self.subTest(field=field):
                connection = self.database()
                connection.execute('UPDATE CustomContent SET ' + field + '=?', (value,))
                self.assertEqual(self.execute(connection, plan), [])
                self.assertEqual(connection.execute('SELECT count(*) FROM MagicWriteback').fetchone()[0], 0)

    def test_guarded_insert_missing_content_rejected(self):
        _, plan = self.freeze()
        connection = self.database()
        connection.execute('DELETE FROM CustomContent')
        self.assertEqual(self.execute(connection, plan), [])

    def test_bound_delivery_body_and_send_by_tampering_rejected(self):
        _, original = self.freeze()
        cases = [(0, 'synthetic-tampered-delivery'),
                 (25, self.body('flowchart LR\n  Alpha --> Gamma\n')),
                 (10, original['sendBy'] + 60_000)]
        for index, value in cases:
            with self.subTest(param_index=index):
                changed = copy.deepcopy(original)
                changed['d1Request']['params'][index] = value
                self.write_json('frozen.json', changed)
                with self.assertRaisesRegex(stage.InvalidEvidence, '^REQUEST_PARAMETERS_CHANGED$'):
                    self.verify([self.row(original)])

    def test_updated_checksum_still_requires_insert_scope_and_identity_consistency(self):
        _, original = self.freeze()
        # Mutate the insert delivery/target, duplicate queue guard scope, and current-content identity.
        cases = [(0, 'synthetic-other-delivery'), (5, 'synthetic-other-content'),
                 (10, original['sendBy'] + 60_000), (11, 'synthetic-other-cloud'),
                 (14, 'synthetic-other-installation'), (15, 'synthetic-other-content'),
                 (16, 'synthetic-other-content'), (17, 'synthetic-other-app'),
                 (18, 'synthetic-other-cloud'), (19, 'synthetic-other-macro'),
                 (20, 'synthetic-other-page')]
        for index, value in cases:
            with self.subTest(param_index=index):
                changed = copy.deepcopy(original)
                changed['d1Request']['params'][index] = value
                changed['d1RequestSha256'] = stage.json_digest(changed['d1Request'])
                self.write_json('frozen.json', changed)
                with self.assertRaisesRegex(stage.InvalidEvidence, '^REQUEST_PARAMETERS_INCONSISTENT$'):
                    self.verify([self.row(original)])

    def test_send_window_metadata_cannot_be_extended(self):
        _, original = self.freeze()
        changed = copy.deepcopy(original)
        changed['sendBy'] += 60_000
        changed['d1Request']['params'][10] = changed['sendBy']
        changed['d1RequestSha256'] = stage.json_digest(changed['d1Request'])
        self.write_json('frozen.json', changed)
        with self.assertRaisesRegex(stage.InvalidEvidence, '^REQUEST_SEND_WINDOW_CHANGED$'):
            self.verify([self.row(original)])

    def test_expired_send_window_inserts_zero_rows_using_sqlite_clock(self):
        _, plan = self.freeze()
        connection = self.database()
        database_now = connection.execute("SELECT CAST(strftime('%s','now') AS INTEGER)*1000").fetchone()[0]
        # Backdate the entire request coherently; no sleeps or clock mocks hide the SQL predicate.
        plan['createdAt'] = database_now - stage.SEND_WINDOW_MS - 1
        plan['sendBy'] = plan['createdAt'] + stage.SEND_WINDOW_MS
        plan['expiresAt'] = plan['createdAt'] + stage.TTL_MS
        plan['d1Request']['params'][8:11] = [plan['createdAt'], plan['expiresAt'], plan['sendBy']]
        plan['d1RequestSha256'] = stage.json_digest(plan['d1Request'])
        self.write_json('frozen.json', plan)
        self.assertEqual(self.execute(connection, plan), [])
        self.assertEqual(connection.execute('SELECT count(*) FROM MagicWriteback').fetchone()[0], 0)
        with self.assertRaisesRegex(stage.InvalidEvidence, '^READBACK_MISSING_OR_AMBIGUOUS$'):
            self.verify([])

    def test_readback_missing_ambiguous_or_wrong_shape_rejected(self):
        _, plan = self.freeze()
        row = self.row(plan)
        for rows in ([], [row, row], {'row': row}):
            with self.subTest(rows_type=type(rows).__name__, count=len(rows)):
                with self.assertRaisesRegex(stage.InvalidEvidence, 'READBACK_MISSING_OR_AMBIGUOUS'):
                    self.verify(rows)

    def test_readback_exact_scope_identity_hash_and_time_tampering_rejected(self):
        _, plan = self.freeze()
        original = self.row(plan)
        for field in (*stage.SCOPE_FIELDS, 'id', 'contentId', 'sourceHash', 'createdAt', 'expiresAt'):
            with self.subTest(field=field):
                value = original[field] + 1 if isinstance(original[field], int) else 'synthetic-tampered'
                row = {**original, field: value}
                reason = 'READBACK_SCOPE_MISMATCH_' if field in stage.SCOPE_FIELDS else 'READBACK_MISMATCH_'
                with self.assertRaisesRegex(stage.InvalidEvidence, reason + field):
                    self.verify([row])

    def test_readback_artifact_tampering_rejected(self):
        _, plan = self.freeze()
        original = self.row(plan)
        for field in ('svg', 'sourceHash', 'outcome', 'rulesVersion', 'generatedAt'):
            with self.subTest(field=field):
                artifact = {**plan['artifact'], field: 'synthetic-tampered'}
                with self.assertRaisesRegex(stage.InvalidEvidence, 'READBACK_ARTIFACT_MISMATCH'):
                    self.verify([{**original, 'artifact': json.dumps(artifact)}])

    def test_request_format_ttl_and_artifact_tampering_rejected(self):
        _, original = self.freeze()
        cases = [('formatVersion', 2, 'REQUEST_FORMAT_CHANGED'),
                 ('expiresAt', original['expiresAt'] + 1, 'REQUEST_TTL_CHANGED')]
        for field, value, reason in cases:
            with self.subTest(field=field):
                plan = copy.deepcopy(original)
                plan[field] = value
                self.write_json('frozen.json', plan)
                with self.assertRaisesRegex(stage.InvalidEvidence, reason):
                    self.verify([self.row(original)])
        for field in ('svg', 'sourceHash'):
            with self.subTest(artifact_field=field):
                plan = copy.deepcopy(original)
                plan['artifact'][field] = 'synthetic-tampered'
                self.write_json('frozen.json', plan)
                with self.assertRaisesRegex(stage.InvalidEvidence, 'REQUEST_ARTIFACT_CHANGED'):
                    self.verify([self.row(original)])
        plan = copy.deepcopy(original)
        plan['d1Request']['sql'] += ' -- changed'
        self.write_json('frozen.json', plan)
        with self.assertRaisesRegex(stage.InvalidEvidence, 'REQUEST_FORMAT_CHANGED'):
            self.verify([self.row(original)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
