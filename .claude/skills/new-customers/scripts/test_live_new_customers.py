"""Offline checks: no credentials, external calls, or business writes."""
import contextlib
import datetime as dt
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('new_customers', Path(__file__).with_name('new_customers.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class LiveCustomersTests(unittest.TestCase):
    def test_default_day_uses_melbourne_date_across_utc_midnight(self):
        now = dt.datetime(2026, 10, 31, 14, tzinfo=dt.timezone.utc)
        self.assertEqual(mod.recent_window(now=now), ('2026-10-31', '2026-11-01'))

    def test_seven_days_and_dst_use_calendar_dates(self):
        now = dt.datetime(2026, 10, 4, 2, tzinfo=dt.timezone.utc)
        self.assertEqual(mod.recent_window(7, now=now), ('2026-09-27', '2026-10-04'))

    def test_explicit_and_invalid_ranges(self):
        self.assertEqual(mod.recent_window(d_from='2026-10-31', d_to='2026-11-01'),
                         ('2026-10-31', '2026-11-01'))
        for kwargs in ({'days': 0}, {'days': -1}, {'d_from': '2026-10-31'},
                       {'d_from': '2026-11-01', 'd_to': '2026-10-31'}):
            with self.assertRaises(ValueError):
                mod.recent_window(**kwargs)

    def test_three_independent_start_examples_and_site_deduplication(self):
        addon = mod.LIVE_APPS['full']
        rows = [
            # Old maintenance period, new trial: trial candidate only.
            {'addonKey': addon, 'cloudSiteHostname': 'trial-only.atlassian.net',
             'maintenanceStartDate': '2026-10-30', 'latestEvaluationStartDate': '2026-10-31',
             'appEntitlementId': 'trial-a', 'licenseType': 'EVALUATION'},
            # New maintenance period, old trial: license candidate only (could be renewal).
            {'addonKey': addon, 'cloudSiteHostname': 'example.atlassian.net',
             'maintenanceStartDate': '2026-11-01', 'latestEvaluationStartDate': '2026-10-01',
             'appEntitlementId': 'license-b', 'licenseType': 'COMMERCIAL'},
            # Future dates: neither candidate.
            {'addonKey': addon, 'cloudSiteHostname': 'other.atlassian.net',
             'maintenanceStartDate': '2026-11-02', 'latestEvaluationStartDate': '2026-11-02'},
        ]
        result = mod.license_candidates(rows, addon, '2026-10-31', '2026-11-01')
        self.assertEqual([r['source_id'] for r in result['license_start_candidates']], ['license-b'])
        self.assertEqual([r['source_id'] for r in result['evaluation_start_candidates']], ['trial-a'])
        self.assertEqual(result['unique_candidate_sites'], ['example.atlassian.net'])
        self.assertTrue(all(r['classification'] == 'CANDIDATE'
                            for r in result['license_start_candidates']))

    def test_free_start_needs_no_trial_date_or_coverage_warning(self):
        addon = mod.LIVE_APPS['aws-widgets']
        row = {'addonKey': addon, 'licenseType': 'FREE',
               'cloudSiteHostname': 'example.atlassian.net',
               'maintenanceStartDate': '2026-10-31'}
        result = mod.live_report('aws-widgets', '2026-10-31', '2026-11-01', 'UTC',
                                 reader=lambda _: [row])
        product = result['products']['aws-widgets']
        self.assertEqual(len(product['license_start_candidates']), 1)
        self.assertEqual(product['evaluation_start_candidates'], [])
        self.assertNotIn('evaluation_date_coverage', product)
        self.assertFalse(any('missing' in text.lower() or 'coverage' in text.lower()
                             for text in result['unknowns']))

    def test_last_updated_and_free_trial_field_do_not_create_new_candidates(self):
        addon = mod.LIVE_APPS['whiteboard']
        row = {'addonKey': addon, 'licenseType': 'FREE',
               'cloudSiteHostname': 'example.atlassian.net',
               'maintenanceStartDate': '2026-10-01', 'lastUpdated': '2026-11-01',
               'latestEvaluationStartDate': '2026-10-31'}
        result = mod.license_candidates([row], addon, '2026-10-31', '2026-11-01')
        self.assertEqual(result['license_start_candidates'], [])
        self.assertEqual(result['evaluation_start_candidates'], [])
        self.assertEqual(result['unique_candidate_sites'], [])

    def test_invalid_product_or_date_cannot_be_successfully_empty(self):
        addon = mod.LIVE_APPS['lite']
        for row in ({'addonKey': 'wrong'}, {'addonKey': addon, 'maintenanceStartDate': 'invalid'}):
            with self.assertRaises(ValueError):
                mod.license_candidates([row], addon, '2026-10-31', '2026-11-01')

    def test_all_reads_exactly_seven_registered_license_keys(self):
        calls = []
        def reader(addon):
            calls.append(addon)
            return []
        result = mod.live_report('all', '2026-10-31', '2026-11-01', 'Australia/Melbourne', reader=reader)
        self.assertEqual(set(result['products']),
                         {'lite', 'full', 'diagramly', 'asyncapi', 'aws-widgets', 'whiteboard', 'mini-sites'})
        self.assertEqual(calls, list(mod.LIVE_APPS.values()))
        self.assertTrue(all(p['read_status'] == 'empty' for p in result['products'].values()))

    def test_failed_read_propagates_without_empty_report(self):
        with self.assertRaises(PermissionError):
            mod.live_report('lite', '2026-10-31', '2026-11-01', 'UTC',
                            reader=lambda addon: (_ for _ in ()).throw(PermissionError('denied')))

    def test_cli_routes_live_defaults_and_rejects_sync_before_any_query(self):
        with patch.object(mod, 'live_report', return_value={}) as live:
            with patch.object(sys, 'argv', ['new_customers.py', '--live']), contextlib.redirect_stdout(io.StringIO()):
                mod.main()
            self.assertEqual(live.call_args.args[0], 'all')
            self.assertEqual(live.call_args.args[3], 'Australia/Melbourne')
            live.reset_mock()
            with patch.object(sys, 'argv', ['new_customers.py', '--live', '--sync']), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    mod.main()
            self.assertEqual(raised.exception.code, 2)
            live.assert_not_called()


if __name__ == '__main__':
    unittest.main()
