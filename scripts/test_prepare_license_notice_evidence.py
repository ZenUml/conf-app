import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('prepare-license-notice-evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)
NOW = dt.datetime(2026, 11, 11, tzinfo=dt.timezone.utc)


def row(**overrides):
    return dict(addonKey=evidence.FULL_ADDON, cloudSiteHostname='example.atlassian.net',
                cloudId='example-cloud', licenseType='LEGACY_FREE', status='active',
                appEntitlementId='example-entitlement', lastUpdated='2026-11-10T00:00:00Z', **overrides)


class EvidenceTests(unittest.TestCase):
    def test_key_record_and_expiry(self):
        entry = evidence.build_entry([row()], 'EXAMPLE.atlassian.net', 'staging', NOW)
        self.assertEqual(entry['key'], f'license-notice:{evidence.FULL_APP_ID}:staging:example-cloud')
        record = json.loads(entry['value'])
        self.assertEqual(record, dict(schemaVersion=1, licenseType='LEGACY_FREE', source='atlassian_marketplace',
                                    checkedAt='2026-11-11T00:00:00.000Z', expiresAt='2026-11-12T00:00:00.000Z',
                                    entitlementId='example-entitlement'))
        self.assertEqual(entry['expiration'], int(NOW.timestamp()) + 86400)

    def test_validity_window_defaults_to_24_hours_and_allows_up_to_7_days(self):
        default = json.loads(evidence.build_entry([row()], 'example', 'production', NOW)['value'])
        self.assertEqual(default['expiresAt'], '2026-11-12T00:00:00.000Z')
        week = evidence.build_entry([row()], 'example', 'production', NOW, valid_hours=168)
        self.assertEqual(json.loads(week['value'])['expiresAt'], '2026-11-18T00:00:00.000Z')
        self.assertEqual(week['expiration'], int(NOW.timestamp()) + 168 * 3600)

    def test_validity_window_over_7_days_or_not_positive_is_rejected(self):
        for hours in (169, 0, -1):
            with self.subTest(hours=hours), self.assertRaises(ValueError):
                evidence.build_entry([row()], 'example', 'production', NOW, valid_hours=hours)

    def test_normalizes_domain(self):
        self.assertEqual(evidence.normalize_domain('example'), 'example.atlassian.net')
        self.assertEqual(evidence.normalize_domain('https://EXAMPLE.atlassian.net/wiki'), 'example.atlassian.net')

    def test_latest_entitlement_selected(self):
        latest = row(); latest.update(appEntitlementId='latest-example', lastUpdated='2026-11-10T12:00:00+00:00')
        value = evidence.build_entry([row(), latest], 'example', 'production', NOW)
        self.assertEqual(json.loads(value['value'])['entitlementId'], 'latest-example')

    def test_active_other_entitlements_block_even_alias_hostname(self):
        for license_type in ['COMMERCIAL', 'EVALUATION', 'UNKNOWN']:
            conflict = row(); conflict.update(cloudSiteHostname='alias.atlassian.net', licenseType=license_type)
            with self.subTest(license_type=license_type), self.assertRaises(ValueError):
                evidence.build_entry([row(), conflict], 'example', 'production', NOW)

    def test_inactive_paid_does_not_block(self):
        conflict = row(); conflict.update(licenseType='COMMERCIAL', status='inactive')
        evidence.build_entry([row(), conflict], 'example', 'production', NOW)

    def test_missing_or_ambiguous_evidence_rejected(self):
        invalid_sets = [[], [dict(row(), licenseType='COMMERCIAL')], [dict(row(), cloudId='')],
                        [dict(row(), appEntitlementId='')], [dict(row(), addonKey='other-addon')],
                        [row(), dict(row(), cloudId='another-example-cloud')]]
        for rows in invalid_sets:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                evidence.build_entry(rows, 'example', 'production', NOW)

    def test_legacy_identifier_does_not_replace_app_entitlement_id(self):
        missing = row()
        del missing['appEntitlementId']
        missing['entitlementId'] = 'legacy-example'
        with self.assertRaises(ValueError):
            evidence.build_entry([missing], 'example', 'production', NOW)

    def test_other_product_paid_license_does_not_block_full(self):
        evidence.build_entry([row(), dict(row(), licenseType='COMMERCIAL', addonKey='other-addon')], 'example', 'production', NOW)

    def test_invalid_environment_and_domain_rejected(self):
        with self.assertRaises(ValueError):
            evidence.build_entry([row()], 'example', 'preview', NOW)
        for domain in ['', 'example.com', 'example.atlassian.net.attacker.com', 'example@evil.atlassian.net']:
            with self.subTest(domain=domain), self.assertRaises(ValueError):
                evidence.normalize_domain(domain)


if __name__ == '__main__':
    unittest.main()
