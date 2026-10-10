import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stage_magic', Path(__file__).with_name('stage.py'))
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class StageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.body = root / 'body.json'
        self.svg = root / 'diagram.svg'
        self.body.write_text(json.dumps({'diagramType': 'mermaid', 'mermaidCode': 'flowchart LR\nA-->B'}))
        self.svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
        self.args = argparse.Namespace(cloud_id='tenant-a', app_id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', environment_id='11111111-2222-4333-8444-555555555555', installation_id='66666666-7777-4888-8999-000000000000', content_id='123', body=str(self.body), svg=str(self.svg), ttl_hours=24, reviewed=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_source_hash_and_no_source_body_in_delivery(self):
        plan = stage.prepare(self.args)
        self.assertEqual(plan['artifact']['sourceHash'], '68c902c781f04249845e5eec43ea52ee1908a6d4ddca74a5db71ca9cf8f6f031')
        self.assertNotIn('mermaidCode', json.dumps(plan))
        self.assertEqual(plan['expiresAt'] - plan['createdAt'], 86400000)

    def test_review_and_bounded_inputs_required(self):
        self.args.reviewed = False
        with self.assertRaises(ValueError): stage.prepare(self.args)
        self.args.reviewed = True
        self.args.ttl_hours = 169
        with self.assertRaises(ValueError): stage.prepare(self.args)

    @patch.object(stage.urllib.request, 'urlopen', side_effect=AssertionError('network not allowed'))
    def test_dry_run_has_no_network_or_credential_requirement(self, _):
        result = stage.main(['--database-id', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'stage', '--cloud-id', 'tenant-a', '--app-id', self.args.app_id, '--environment-id', self.args.environment_id, '--installation-id', self.args.installation_id, '--content-id', '123', '--body', str(self.body), '--svg', str(self.svg), '--reviewed'])
        self.assertEqual(result, 0)

    def test_normalizes_operator_uuids_to_exact_remote_fit_aris(self):
        plan = stage.prepare(self.args)
        expected = [self.args.cloud_id, self.args.app_id,
                    f'ari:cloud:ecosystem::environment/{self.args.app_id}/{self.args.environment_id}',
                    f'ari:cloud:ecosystem::installation/{self.args.installation_id}']
        self.assertEqual(plan['scope'], expected)
        self.args.environment_id, self.args.installation_id = expected[2:]
        self.assertEqual(stage.prepare(self.args)['scope'], expected)

    def test_rejects_malformed_and_cross_app_scope_inputs(self):
        original = self.args.environment_id
        for value in ['dev-a', f'ari:cloud:ecosystem::environment/99999999-2222-4333-8444-555555555555/{original}',
                      f'ari:cloud:ecosystem::environment/{self.args.app_id}/{original}/extra']:
            self.args.environment_id = value
            with self.assertRaises(ValueError): stage.prepare(self.args)
        self.args.environment_id = original
        self.args.installation_id = 'ari:cloud:ecosystem::installation/invalid'
        with self.assertRaises(ValueError): stage.prepare(self.args)
