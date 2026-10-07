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
        self.args = argparse.Namespace(cloud_id='tenant-a', app_id='app-a', environment_id='dev-a', installation_id='install-a', content_id='123', body=str(self.body), svg=str(self.svg), ttl_hours=24, reviewed=True)

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
        result = stage.main(['--database-id', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'stage', '--cloud-id', 'tenant-a', '--app-id', 'app-a', '--environment-id', 'dev-a', '--installation-id', 'install-a', '--content-id', '123', '--body', str(self.body), '--svg', str(self.svg), '--reviewed'])
        self.assertEqual(result, 0)
