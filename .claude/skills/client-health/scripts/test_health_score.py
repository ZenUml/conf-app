#!/usr/bin/env python3
"""Unit tests for health_score.py. No network, no credentials.

Run from the repo root:
    python3 .claude/skills/client-health/scripts/test_health_score.py
or:
    python3 -m unittest discover -s .claude/skills/client-health/scripts
"""
import datetime, json, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import health_score  # noqa: E402
import mp_report      # noqa: E402
import mp_query       # noqa: E402


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


class ComputeRawSignals(unittest.TestCase):
    def setUp(self):
        self.fleet = {
            "acme": {"cloud_id": "c1", "seat_tier": 100, "company": "Acme"},
            "quiet": {"cloud_id": "c2", "seat_tier": 100, "company": "Quiet Co"},
        }
        self.today = datetime.date(2026, 9, 4)

    def test_excludes_domains_with_zero_usage_volume(self):
        volume = {"acme": {"usage_volume": 10, "paywall_friction": 0,
                            "recent_views": 5, "prior_views": 5,
                            "last_event_date": self.today}}
        raw = health_score.compute_raw_signals(self.fleet, volume, {}, today=self.today)
        self.assertIn("acme", raw)
        self.assertNotIn("quiet", raw)   # not in `volume` at all -> inactive, excluded

    def test_growth_trend_and_adoption_breadth(self):
        volume = {"acme": {"usage_volume": 100, "paywall_friction": 2,
                            "recent_views": 60, "prior_views": 40,
                            "last_event_date": self.today}}
        raw = health_score.compute_raw_signals(self.fleet, volume, {"acme": 20}, today=self.today)
        self.assertAlmostEqual(raw["acme"]["growth_trend"], 0.5)          # (60-40)/40
        self.assertAlmostEqual(raw["acme"]["adoption_breadth"], 0.2)      # 20/100
        self.assertEqual(raw["acme"]["days_since_last_event"], 0)

    def test_recency_days_since_last_event(self):
        volume = {"acme": {"usage_volume": 5, "paywall_friction": 0,
                            "recent_views": 5, "prior_views": 0,
                            "last_event_date": datetime.date(2026, 8, 25)}}
        raw = health_score.compute_raw_signals(self.fleet, volume, {}, today=self.today)
        self.assertEqual(raw["acme"]["days_since_last_event"], 10)


class ScoreFleet(unittest.TestCase):
    def test_broad_adopter_outranks_thin_adopter_on_opportunity_and_risk(self):
        # Mirrors this session's tenant-a (broad) vs tenant-b (thin) finding:
        # near-identical seat tier and usage volume, very different
        # adoption breadth and growth.
        raw = {
            "broad": {"seat_tier": 800, "arr_monthly": 150.0, "adoption_breadth": 0.015,
                       "usage_volume": 3000, "growth_trend": 0.1, "paywall_friction": 0,
                       "days_since_last_event": 0, "unique_creators": 12},
            "thin": {"seat_tier": 800, "arr_monthly": 150.0, "adoption_breadth": 0.005,
                      "usage_volume": 3000, "growth_trend": -0.3, "paywall_friction": 0,
                      "days_since_last_event": 5, "unique_creators": 4},
            "small": {"seat_tier": 20, "arr_monthly": 8.8, "adoption_breadth": 0.01,
                       "usage_volume": 50, "growth_trend": 0.0, "paywall_friction": 0,
                       "days_since_last_event": 20, "unique_creators": 1},
        }
        scored = health_score.score_fleet(raw)
        self.assertGreater(scored["broad"]["opportunity_score"], scored["thin"]["opportunity_score"])
        self.assertGreater(scored["thin"]["risk_score"], scored["broad"]["risk_score"])

    def test_scores_are_bounded_0_to_100(self):
        raw = {
            "a": {"seat_tier": 10, "arr_monthly": 4.4, "adoption_breadth": 0.1,
                   "usage_volume": 5, "growth_trend": 0.0, "paywall_friction": 0,
                   "days_since_last_event": 1, "unique_creators": 1},
            "b": {"seat_tier": 1000, "arr_monthly": 400.0, "adoption_breadth": 0.5,
                   "usage_volume": 5000, "growth_trend": 2.0, "paywall_friction": 10,
                   "days_since_last_event": 0, "unique_creators": 100},
        }
        scored = health_score.score_fleet(raw)
        for s in scored.values():
            self.assertGreaterEqual(s["opportunity_score"], 0)
            self.assertLessEqual(s["opportunity_score"], 100)
            self.assertGreaterEqual(s["risk_score"], 0)
            self.assertLessEqual(s["risk_score"], 100)


class MainCli(unittest.TestCase):
    """Monkeypatches the two network-touching fetchers so main() runs with
    zero credentials and zero network calls — same pattern
    test_mp_report.py uses for its --app resolution tests."""

    def setUp(self):
        self.fleet = {
            "broad": {"cloud_id": "c1", "seat_tier": 800, "company": "Broad Co"},
            "thin": {"cloud_id": "c2", "seat_tier": 800, "company": "Thin Co"},
        }
        self.volume = {
            "broad": {"usage_volume": 3000, "paywall_friction": 0,
                       "recent_views": 1600, "prior_views": 1400,
                       "last_event_date": datetime.date.today()},
            "thin": {"usage_volume": 3000, "paywall_friction": 0,
                      "recent_views": 1000, "prior_views": 2000,
                      "last_event_date": datetime.date.today()},
        }
        self.creators = {"broad": 12, "thin": 4}

    def _run_main(self, argv):
        import contextlib, io
        buf = io.StringIO()
        old_argv = sys.argv
        sys.argv = ["health_score.py"] + argv
        health_score.fetch_lite_licenses = lambda auth: []
        health_score.build_fleet_from_licenses = lambda lic: self.fleet
        health_score.fetch_mixpanel_signals = lambda api_secret, days=90: (self.volume, self.creators)
        mp_report.load_creds = lambda env_path: ("fake@example.com", "fake-token")
        mp_query.load_api_secret = lambda: "fake-secret"
        try:
            with contextlib.redirect_stdout(buf):
                health_score.main()
        finally:
            sys.argv = old_argv
        return buf.getvalue()

    def test_prints_both_tenants_sorted_by_opportunity_by_default(self):
        out = self._run_main(["--top", "10"])
        self.assertIn("broad", out)
        self.assertIn("thin", out)
        self.assertLess(out.index("broad"), out.index("thin"))  # broad ranks first

    def test_sort_by_risk_flag_reorders(self):
        out = self._run_main(["--sort", "risk", "--top", "10"])
        self.assertLess(out.index("thin"), out.index("broad"))  # thin is riskier

    def test_json_flag_produces_parseable_json(self):
        out = self._run_main(["--json", "--top", "10"])
        rows = json.loads(out)
        domains = {r["domain"] for r in rows}
        self.assertEqual(domains, {"broad", "thin"})


if __name__ == "__main__":
    unittest.main()
