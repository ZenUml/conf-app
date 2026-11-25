import json
import tempfile
import unittest
from pathlib import Path
from sources import credits, FETCHERS


class CreditsTest(unittest.TestCase):
    def test_registered_independently(self):
        self.assertIs(FETCHERS['credits'], credits.fetch)

    def test_snapshot_preserves_observation_time_and_has_no_invented_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'snapshot.json'
            data = {'status': 'pending', 'checked_at': '2026-11-13T07:30:00+11:00'}
            path.write_text(json.dumps(data))
            self.assertEqual(credits.fetch(path), dict(data, status='PENDING'))

    def test_optional_verified_details_are_formatted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'snapshot.json'
            path.write_text(json.dumps({'status': 'PENDING', 'checked_at': '2026-11-13T07:36:00+11:00',
                                        'requested_amount': '$10,000', 'applied_date': '2026-11-12'}))
            result = credits.fetch(path)
            self.assertEqual(result['requested_amount'], '$10,000')
            self.assertEqual(result['applied_date'], '12 Nov 2026')

    def test_missing_or_invalid_snapshot_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'snapshot.json'
            for text in (None, '{', '[]', '{}', '{"status":"PENDING","checked_at":"bad"}'):
                if text is not None:
                    path.write_text(text)
                self.assertEqual(credits.fetch(path), {'status': 'UNAVAILABLE', 'checked_at': None})
