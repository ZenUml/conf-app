#!/usr/bin/env python3
"""Unit checks for mp_report.py's --app resolution. No network, no credentials.

Run from the repo root:
    python3 .claude/skills/marketplace/scripts/test_mp_report.py
or:
    python3 -m unittest discover -s .claude/skills/marketplace/scripts
(`python3 -m unittest <path>` fails with "Empty module name" on a path under `.claude/`.)

Regression (2026-09-02): `--app gptdock-confluence` and `--app my-api` (the Diagramly and
AsyncAPI addon keys, which do not start with `com.`) fell through addon_filter/keep_addon to
the ALL-apps result while the header still printed app=<value> — `revenue --app
gptdock-confluence` reported the vendor-wide total as Diagramly's.
"""
import argparse, contextlib, io, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp_report  # noqa: E402

FULL, LITE = "com.zenuml.confluence-addon", "com.zenuml.confluence-addon-lite"
DIA, ASYNC = "gptdock-confluence", "my-api"


def rec(key):
    return {"addonKey": key}


class AppAliases(unittest.TestCase):
    def test_diagramly_alias_maps_to_its_addon_key(self):
        self.assertEqual(mp_report.addon_filter("diagramly"), DIA)
        self.assertTrue(mp_report.keep_addon(rec(DIA), "diagramly"))
        self.assertFalse(mp_report.keep_addon(rec(FULL), "diagramly"))

    def test_asyncapi_alias_maps_to_its_addon_key(self):
        self.assertEqual(mp_report.addon_filter("asyncapi"), ASYNC)
        self.assertTrue(mp_report.keep_addon(rec(ASYNC), "asyncapi"))
        self.assertFalse(mp_report.keep_addon(rec(FULL), "asyncapi"))

    def test_full_and_lite_aliases_unchanged(self):
        self.assertEqual(mp_report.addon_filter("full"), FULL)
        self.assertEqual(mp_report.addon_filter("lite"), LITE)
        self.assertTrue(mp_report.keep_addon(rec(LITE), "lite"))
        self.assertFalse(mp_report.keep_addon(rec(FULL), "lite"))

    def test_sync_covers_every_alias_target(self):
        self.assertEqual(set(mp_report.APP_KEYS_ALL), set(mp_report.APPS.values()))


class ExplicitAddonKeys(unittest.TestCase):
    """The regression: a non-`com.` addon key must scope to that key, never to ALL apps."""

    def test_diagramly_key_filters_server_side(self):
        self.assertEqual(mp_report.addon_filter(DIA), DIA)

    def test_diagramly_key_filters_client_side(self):
        self.assertTrue(mp_report.keep_addon(rec(DIA), DIA))
        self.assertFalse(mp_report.keep_addon(rec(FULL), DIA))

    def test_asyncapi_key_filters_both_ways(self):
        self.assertEqual(mp_report.addon_filter(ASYNC), ASYNC)
        self.assertTrue(mp_report.keep_addon(rec(ASYNC), ASYNC))
        self.assertFalse(mp_report.keep_addon(rec(LITE), ASYNC))

    def test_com_key_still_passes_through(self):
        self.assertEqual(mp_report.addon_filter(FULL), FULL)
        self.assertTrue(mp_report.keep_addon(rec(FULL), FULL))
        self.assertFalse(mp_report.keep_addon(rec(LITE), FULL))


class VendorWideModes(unittest.TestCase):
    def test_both_is_full_plus_lite_only(self):
        self.assertIsNone(mp_report.addon_filter("both"))
        self.assertTrue(mp_report.keep_addon(rec(FULL), "both"))
        self.assertTrue(mp_report.keep_addon(rec(LITE), "both"))
        self.assertFalse(mp_report.keep_addon(rec(DIA), "both"))
        self.assertFalse(mp_report.keep_addon(rec(ASYNC), "both"))

    def test_all_keeps_everything(self):
        self.assertIsNone(mp_report.addon_filter("all"))
        for k in (FULL, LITE, DIA, ASYNC, "com.other.vendor-app"):
            self.assertTrue(mp_report.keep_addon(rec(k), "all"))


class UnknownApp(unittest.TestCase):
    def setUp(self):
        # An unknown --app must die in argparse. If it ever falls through again, fail here
        # instead of loading credentials and hitting the live Marketplace API.
        self._creds, self._export = mp_report.load_creds, mp_report.export
        mp_report.load_creds = lambda *_: self.fail("unknown --app reached load_creds")
        mp_report.export = lambda *_, **__: self.fail("unknown --app reached export")

    def tearDown(self):
        mp_report.load_creds, mp_report.export = self._creds, self._export

    def test_addon_filter_rejects_unknown(self):
        with self.assertRaises(ValueError) as cm:
            mp_report.addon_filter("gptdock")
        self.assertIn("gptdock", str(cm.exception))
        self.assertIn("diagramly", str(cm.exception))   # message lists the accepted values

    def test_keep_addon_rejects_unknown(self):
        with self.assertRaises(ValueError):
            mp_report.keep_addon(rec(FULL), "asyncapi-for-confluence")

    def test_cli_rejects_unknown_before_any_fetch(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            sys.argv = ["mp_report.py", "--app", "nope", "revenue"]
            mp_report.main()
        self.assertEqual(cm.exception.code, 2)          # argparse usage error, not a traceback
        self.assertIn("nope", err.getvalue())
        self.assertIn("asyncapi", err.getvalue())

    def test_cli_rejects_unknown_after_subcommand_too(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            sys.argv = ["mp_report.py", "revenue", "--app", "nope"]
            mp_report.main()
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("nope", err.getvalue())


class RadarGracePeriod(unittest.TestCase):
    """Regression (2026-10-17): an annual Diagramly renewal whose paid coverage ended 10-15
    showed in MISSED as "2 days late, $911 at risk", but its license was active, inGracePeriod=Yes,
    maintenanceEndDate 11-14. A license in grace has not missed anything yet; it belongs in its
    own IN GRACE section with the grace deadline, kept out of the MISSED total."""
    ASOF = "2026-10-17"

    def lic(self, cid, grace, mend, status="active"):
        return {"cloudId": cid, "addonKey": DIA, "cloudSiteHostname": f"{cid}.atlassian.net",
                "inGracePeriod": grace, "maintenanceEndDate": mend, "status": status,
                "tier": "300 Users", "appEntitlementNumber": f"E-{cid}"}

    def tx(self, cid, mend, amt):
        return {"cloudId": cid, "addonKey": DIA, "customerDetails": {"company": cid},
                "purchaseDetails": {"vendorAmount": amt, "saleDate": "2025-10-31",
                                    "billingPeriod": "Annual", "maintenanceEndDate": mend,
                                    "tier": "300 Users"}}

    def run_radar(self, lics, txs):
        data = {"licenses": lics, "sales/transactions": txs}
        orig = mp_report.export
        mp_report.export = lambda kind, *_, **__: data[kind]
        try:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                mp_report.cmd_radar(argparse.Namespace(asof=self.ASOF, days=7, json=True), None)
        finally:
            mp_report.export = orig
        import json
        return json.loads(out.getvalue())

    def test_grace_license_goes_to_in_grace_not_missed(self):
        r = self.run_radar([self.lic("gracey", "Yes", "2026-11-14")],
                           [self.tx("gracey", "2026-10-15", 911.33)])
        self.assertEqual(r["missed"]["count"], 0)
        self.assertEqual(r["missed"]["total"], 0)
        self.assertEqual(r["in_grace"]["count"], 1)
        self.assertEqual(r["in_grace"]["total"], 911.33)
        row = r["in_grace"]["rows"][0]
        self.assertEqual(row["paid_thru"], "2026-10-15")
        self.assertEqual(row["grace_until"], "2026-11-14")
        self.assertEqual(row["days_left"], 28)

    def test_grace_older_than_window_still_listed(self):
        # paid coverage ended 20 days ago, grace still open: the renewal is still pending
        r = self.run_radar([self.lic("old", "Yes", "2026-10-27")],
                           [self.tx("old", "2026-09-27", 100.0)])
        self.assertEqual(r["in_grace"]["count"], 1)
        self.assertEqual(r["missed"]["count"], 0)

    def test_lapsed_without_grace_stays_missed(self):
        r = self.run_radar([self.lic("gone", "No", "2026-10-15")],
                           [self.tx("gone", "2026-10-15", 43.5)])
        self.assertEqual(r["missed"]["count"], 1)
        self.assertEqual(r["in_grace"]["count"], 0)


if __name__ == "__main__":
    unittest.main()
