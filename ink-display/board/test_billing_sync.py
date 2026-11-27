import contextlib
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import billing_sync as sync

NOW = datetime(2026, 11, 14, 0, 0, tzinfo=timezone.utc)
TEXT = '''Settings
Org
Project
Profile
Diagramly.Ai
Plan Details
My Plan
Data Usage
Billing Info
Event Volume
Your plan provides up to 1M tracked events. Additional events are billed at $0.28 per thousand events.
485,043 Events Tracked
48.5%
Period ends Nov 30, 2026
View Historical Usage
Adjust Plan Volume
Session Replay
Your plan provides up to 20K session replays, which are retained for 30 days.
15,966 Replays
79.8%
Period ends Nov 30, 2026
View Historical Usage
Adjust Plan Volume
Experiments
Your plan provides 5K MEUs.
0 Users
0%
Period ends Nov 30, 2026'''

def envelope(text=TEXT, observed=NOW.isoformat()):
    return {'source_url': sync.SOURCE_URL, 'text': text, 'observed_at': observed}

class BillingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.path = self.home / 'mixpanel-usage.json'

    def save(self, body=None, start='2026-11-01'):
        return sync.ingest(body or envelope(), self.home, start, NOW)

    def test_exact_counts_limits_and_permissions(self):
        data, changed = self.save()
        self.assertTrue(changed)
        self.assertEqual(data['events'], {'used': 485043, 'limit': 1000000})
        self.assertEqual(data['session_replay'], {'used': 15966, 'limit': 20000})
        self.assertEqual(data['period_end'], '2026-12-01')
        self.assertTrue(data['checked_at'].endswith('+11:00'))
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.save()[1])

    def test_snapshot_schema_and_fresh_unchanged_observation(self):
        data, _ = self.save(envelope(observed='2026-11-13T23:59:00+00:00'))
        self.assertEqual(set(data), {'organization', 'source_url', 'checked_at', 'period_start', 'period_end', 'events', 'session_replay'})
        self.assertEqual(data['organization'], 'Diagramly.Ai')
        self.assertEqual(data['source_url'], sync.SOURCE_URL)
        later, changed = self.save()
        self.assertFalse(changed)
        self.assertNotEqual(data['checked_at'], later['checked_at'])
        self.assertEqual(json.loads(self.path.read_text()), later)
        self.assertFalse(self.save()[1])

    def test_unrelated_feature_period_can_differ(self):
        text = TEXT.rsplit('Period ends Nov 30, 2026', 1)
        data, _ = self.save(envelope('Period ends Dec 31, 2026'.join(text)))
        self.assertEqual(data['period_end'], '2026-12-01')

    def test_rejections_preserve_bytes(self):
        self.save()
        before = self.path.read_bytes()
        bad = [envelope(TEXT.replace('485,043', '485,04')),
               envelope(TEXT.replace('485,043', '485K')),
               envelope(TEXT.replace('20K', '0K')),
               envelope(TEXT.replace('Diagramly.Ai', 'Other')),
               envelope(TEXT.replace('15,966 Replays', '')),
               envelope(TEXT.replace('Event Volume', 'Event Volume\nEvent Volume')),
               envelope(TEXT.replace('Period ends Nov 30, 2026', 'Period ends Dec 31, 2026', 1)),
               envelope(observed='2026-11-13T23:49:59+00:00'),
               envelope(observed='2026-11-14T00:00:01+00:00')]
        bad.append({**envelope(), 'source_url': sync.SOURCE_URL + '?x=1'})
        for body in bad:
            with self.subTest(body=body), self.assertRaises(sync.Invalid):
                self.save(body)
            self.assertEqual(self.path.read_bytes(), before)

    def test_decrease_allowed_and_older_race_rejected(self):
        self.save(envelope(observed='2026-11-13T23:59:00+00:00'))
        data, _ = self.save(envelope(TEXT.replace('485,043', '400,000')))
        self.assertEqual(data['events']['used'], 400000)
        with self.assertRaises(sync.Invalid):
            self.save(envelope(observed='2026-11-13T23:59:30+00:00'))
        with self.assertRaises(sync.Invalid):
            self.save(envelope())  # same timestamp cannot carry conflicting facts

    def test_cycle_start_requires_evidence_and_matching_cycle_reuses_start(self):
        with self.assertRaises(sync.Invalid):
            sync.ingest(envelope(), self.home, now=NOW)
        self.save()
        self.assertFalse(sync.ingest(envelope(), self.home, now=NOW)[1])
        self.path.write_text(json.dumps({**json.loads(self.path.read_text()), 'period_end': '2026-11-30'}))
        with self.assertRaises(sync.Invalid):
            sync.ingest(envelope(), self.home, now=NOW)

    def test_verification_errors_are_private(self):
        data, _ = self.save()
        cache = self.home / 'cache'
        cache.mkdir()
        (cache / 'mixpanel.json').write_text(json.dumps({'data': data}))
        (self.home / 'config.json').write_text(json.dumps({'token': 'SECRET_TOKEN'}))
        with patch('billing_sync.urlopen', side_effect=RuntimeError('http://SECRET_TOKEN')):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                flags = sync.verify(data, self.home, timeout=0)
        self.assertEqual(flags, {'cache_verified': True, 'served_crop_verified': False})
        self.assertNotIn('SECRET_TOKEN', output.getvalue())

    def test_verify_command_is_read_only_for_pending_and_success(self):
        self.save()
        before = self.path.read_bytes()
        for success in (False, True):
            flags = {'cache_verified': success, 'served_crop_verified': success}
            out = io.StringIO()
            with patch('billing_sync.verify', return_value=flags) as verify, contextlib.redirect_stdout(out):
                code = sync.main(['verify', '--home', str(self.home), '--timeout', '45'])
            self.assertEqual(code, 0)
            result = json.loads(out.getvalue())
            self.assertEqual(result['status'], 'verified' if success else 'pending')
            self.assertFalse(result['changed'])
            self.assertEqual(result['cache_verified'], success)
            self.assertEqual(result['served_crop_verified'], success)
            self.assertEqual(verify.call_args.args[2], 45)
            self.assertEqual(self.path.read_bytes(), before)

    def test_verify_command_storage_error_is_sanitized(self):
        self.path.write_text('SECRET_TOKEN')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = sync.main(['verify', '--home', str(self.home), '--timeout', '0'])
        self.assertEqual(code, 1)
        self.assertNotIn('SECRET_TOKEN', out.getvalue())
        self.assertEqual(self.path.read_text(), 'SECRET_TOKEN')

    def test_served_image_crop_verification_positive(self):
        from layout import Canvas, draw_mixpanel
        data, _ = self.save()
        cached = {**data, 'history': []}
        for key in ('events', 'session_replay'):
            cached[key] = {**data[key], 'remaining': 100 * (1 - data[key]['used'] / data[key]['limit'])}
        cache = self.home / 'cache'
        cache.mkdir()
        (cache / 'mixpanel.json').write_text(json.dumps({'data': cached}))
        (self.home / 'config.json').write_text(json.dumps({'token': 'SECRET_TOKEN'}))
        canvas = Canvas()
        draw_mixpanel(canvas, cached, 210, datetime.now())
        image_bytes = io.BytesIO()
        canvas.image.save(image_bytes, format='PNG')
        with patch('billing_sync.urlopen', return_value=io.BytesIO(image_bytes.getvalue())):
            self.assertEqual(sync.verify(data, self.home, timeout=0),
                             {'cache_verified': True, 'served_crop_verified': True})

    def test_browser_capture_checks_profile_and_closes_only_owned_resources(self):
        import subprocess
        calls = []
        def fake(args, **kwargs):
            calls.append(args)
            command = args[6:]
            if command[:3] == ['get', 'text', '#profile_path']:
                data = {'text': '/Users/test/Chrome/Profile 8'}
            elif command[:1] == ['eval']:
                data = {'result': {'source_url': sync.SOURCE_URL, 'text': TEXT}}
            else:
                data = {}
            return subprocess.CompletedProcess(args, 0, json.dumps({'success': True, 'data': data}), '')
        with patch('billing_sync.subprocess.run', side_effect=fake):
            captured = sync.browser_capture()
        self.assertEqual(calls[0][6:9], ['tab', 'new', '--label'])
        self.assertEqual(calls[0][-1], 'chrome://version')
        self.assertEqual(captured['text'], TEXT)
        self.assertTrue(captured['observed_at'])
        self.assertEqual(calls[-2][6:8], ['tab', 'close'])
        self.assertEqual(calls[-2][8], calls[0][9])
        self.assertEqual(calls[-1][6:], ['close'])
        self.assertTrue(all('--pin-tab' in command for command in calls))
        self.assertEqual(len({command[2] for command in calls}), 1)
        self.assertFalse(self.path.exists())

    def test_wrong_browser_profile_rejects_and_cleans_up(self):
        import subprocess
        calls = []
        def fake(args, **kwargs):
            calls.append(args)
            data = {'text': '/Chrome/Default'} if 'get' in args else {}
            return subprocess.CompletedProcess(args, 0, json.dumps({'success': True, 'data': data}), '')
        with patch('billing_sync.subprocess.run', side_effect=fake), self.assertRaises(sync.Invalid):
            sync.browser_capture()
        self.assertFalse(any(sync.SOURCE_URL in call for call in calls))
        self.assertEqual(calls[-2][6:8], ['tab', 'close'])
        self.assertEqual(calls[-2][8], calls[0][9])
        self.assertEqual(calls[-1][6:], ['close'])
        self.assertFalse(self.path.exists())

    def test_browser_attach_failure_is_bounded_and_private(self):
        import subprocess
        with patch('billing_sync.subprocess.run', side_effect=subprocess.TimeoutExpired('SECRET_TOKEN', 8)) as run:
            with self.assertRaisesRegex(sync.Invalid, '^needs_browser$'):
                sync.browser_capture()
        self.assertEqual(run.call_count, 2)  # one attach attempt, one session close

    def test_cli_sanitizes_input_errors_and_sync_requests_browser(self):
        out = io.StringIO()
        with patch('sys.stdin', io.StringIO('SECRET_TOKEN')), contextlib.redirect_stdout(out):
            self.assertEqual(sync.main(['ingest', '--stdin']), 1)
        self.assertNotIn('SECRET_TOKEN', out.getvalue())
        out = io.StringIO()
        with patch('billing_sync.browser_capture', side_effect=sync.Invalid('needs_browser')), contextlib.redirect_stdout(out):
            self.assertEqual(sync.main(['sync']), 2)
        self.assertEqual(json.loads(out.getvalue())['status'], 'needs_browser')

if __name__ == '__main__':
    unittest.main()
