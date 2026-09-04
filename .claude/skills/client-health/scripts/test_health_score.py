#!/usr/bin/env python3
"""Unit tests for health_score.py. No network, no credentials.

Run from the repo root:
    python3 .claude/skills/client-health/scripts/test_health_score.py
or:
    python3 -m unittest discover -s .claude/skills/client-health/scripts
"""
import datetime, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import health_score  # noqa: E402


def license_rec(host, tier_users, company=None):
    return {
        "cloudSiteHostname": host,
        "tier": f"{tier_users} Users",
        "contactDetails": {"company": company or host.split(".")[0]},
    }


class BuildFleetFromLicenses(unittest.TestCase):
    def test_extracts_domain_seat_tier_and_company(self):
        lic = [license_rec("acme.atlassian.net", 250, "Acme Corp")]
        fleet = health_score.build_fleet_from_licenses(lic)
        self.assertEqual(fleet["acme"]["seat_tier"], 250)
        self.assertEqual(fleet["acme"]["company"], "Acme Corp")

    def test_skips_records_with_unparseable_tier(self):
        lic = [license_rec("acme.atlassian.net", 250),
               {"cloudSiteHostname": "broken.atlassian.net", "tier": None,
                "contactDetails": {}}]
        fleet = health_score.build_fleet_from_licenses(lic)
        self.assertIn("acme", fleet)
        self.assertNotIn("broken", fleet)

    def test_skips_records_with_no_hostname(self):
        lic = [{"cloudSiteHostname": "", "tier": "10 Users", "contactDetails": {}}]
        fleet = health_score.build_fleet_from_licenses(lic)
        self.assertEqual(fleet, {})


class ArrMonthly(unittest.TestCase):
    def test_delegates_to_mp_pricing_band_table(self):
        # 820 users: 100@0.44 + 150@0.33 + 570@0.11 = 44 + 49.5 + 62.7 = 156.2
        self.assertAlmostEqual(health_score.arr_monthly(820), 156.2, places=2)


class BuildAndParseVolumeQuery(unittest.TestCase):
    def test_query_contains_the_window_dates(self):
        today = datetime.date(2026, 9, 4)
        script = health_score.build_volume_query(days=90, today=today)
        self.assertIn("2026-06-06", script)   # today - 90 days
        self.assertIn("2026-09-04", script)   # today

    def test_query_excludes_internal_domains_and_filters_lite(self):
        script = health_score.build_volume_query()
        self.assertIn("product_type", script)
        self.assertIn("zenuml", script)   # internal-domain exclude list present

    def test_parse_sums_usage_volume_and_paywall_friction(self):
        today = datetime.date(2026, 9, 4)
        rows = [
            {"key": ["acme", "2026-09-01", "macro_viewed"], "value": 10},
            {"key": ["acme", "2026-09-02", "macro_viewed"], "value": 5},
            {"key": ["acme", "2026-09-02", "paywall_triggered"], "value": 2},
            {"key": ["acme", "2026-09-02", "paywall_blocked_create"], "value": 1},
        ]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertEqual(parsed["acme"]["usage_volume"], 15)
        self.assertEqual(parsed["acme"]["paywall_friction"], 3)

    def test_parse_splits_recent_vs_prior_30_day_windows(self):
        today = datetime.date(2026, 9, 4)
        rows = [
            {"key": ["acme", "2026-09-03", "macro_viewed"], "value": 10},  # recent (within last 30d)
            {"key": ["acme", "2026-07-20", "macro_viewed"], "value": 4},   # prior (31-60 days back)
            {"key": ["acme", "2026-06-10", "macro_viewed"], "value": 99},  # outside both windows (>60d back)
        ]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertEqual(parsed["acme"]["recent_views"], 10)
        self.assertEqual(parsed["acme"]["prior_views"], 4)

    def test_parse_tracks_the_most_recent_event_date(self):
        today = datetime.date(2026, 9, 4)
        rows = [
            {"key": ["acme", "2026-08-01", "macro_viewed"], "value": 1},
            {"key": ["acme", "2026-09-02", "macro_save_succeeded"], "value": 1},
        ]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertEqual(parsed["acme"]["last_event_date"], datetime.date(2026, 9, 2))

    def test_parse_ignores_zero_count_rows_for_last_event_date(self):
        today = datetime.date(2026, 9, 4)
        rows = [{"key": ["acme", "2026-09-02", "macro_viewed"], "value": 0}]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertIsNone(parsed["acme"]["last_event_date"])


class BuildAndParseCreatorsQuery(unittest.TestCase):
    def test_query_filters_to_create_events_only(self):
        script = health_score.build_creators_query()
        self.assertIn("macro_create_succeeded", script)
        self.assertNotIn("macro_save_succeeded", script)

    def test_parse_counts_distinct_users_per_domain(self):
        rows = [
            {"key": ["acme", "user-1"], "value": 3},
            {"key": ["acme", "user-2"], "value": 1},
            {"key": ["other", "user-1"], "value": 5},
        ]
        parsed = health_score.parse_creators_rows(rows)
        self.assertEqual(parsed["acme"], 2)
        self.assertEqual(parsed["other"], 1)


if __name__ == "__main__":
    unittest.main()
