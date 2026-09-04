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


if __name__ == "__main__":
    unittest.main()
