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
import argparse, contextlib, datetime, io, json, os, sys, unittest
from unittest.mock import patch

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


class PurchaseVerification(unittest.TestCase):
    """Synthetic records exercise scoped purchase evidence without credentials or network."""

    def setUp(self):
        self.old_local = mp_report.LOCAL["db"]
        mp_report.LOCAL["db"] = None
        self.today = datetime.datetime.now(datetime.timezone.utc).date()

    def tearDown(self):
        mp_report.LOCAL["db"] = self.old_local

    def args(self, order_id=None):
        return argparse.Namespace(domain="example.atlassian.net", app="full", order_id=order_id,
                                  no_kv=True, json=True)

    def license(self, host="example.atlassian.net", kind="EVALUATION"):
        return {"cloudId": "site-1", "cloudSiteHostname": host, "addonKey": FULL,
                "licenseType": kind, "status": "active", "tier": "10 Users"}

    def tx(self, id="order-1", cloud="site-1", app=FULL, amount=10, status="Open"):
        future = self.today + datetime.timedelta(days=30)
        return {"transactionId": id, "transactionLineItemId": id + "-line",
                "cloudId": cloud, "addonKey": app, "paymentStatus": status,
                "purchaseDetails": {"saleType": "New", "saleDate": str(self.today),
                                    "vendorAmount": amount,
                                    "maintenanceStartDate": str(future),
                                    "maintenanceEndDate": str(future + datetime.timedelta(days=365))}}

    def run_whois(self, args, lics, txs, edge=None):
        def fake_export(kind, auth, **filters):
            if kind == "licenses": return lics
            return txs
        output = io.StringIO()
        with patch.object(mp_report, "export", side_effect=fake_export), \
             patch.object(mp_report, "_tenant_info_cloudid", return_value=edge), \
             patch.object(mp_report, "_fuzzy_hosts", return_value=[]), \
             contextlib.redirect_stdout(output):
            mp_report.cmd_whois(args, "unused")
        return json.loads(output.getvalue())

    def test_evaluation_future_open_order_is_purchase_found(self):
        result = self.run_whois(self.args(), [self.license()], [self.tx()])
        v = result["verification"]
        self.assertEqual(v["conclusion"], "PURCHASE_FOUND")
        self.assertEqual(v["records"][0]["coverage"], "future")
        self.assertEqual(v["records"][0]["paymentStatus"], "Open")
        self.assertEqual(result["total_lifetime_vendor"], 10)

    def test_text_false_match_then_edge_identity_finds_transaction(self):
        queries = []
        def fake_export(kind, auth, **filters):
            queries.append((kind, filters.get("text")))
            if kind == "licenses": return [self.license("other.atlassian.net")]
            return [self.tx()] if filters.get("text") == "site-1" else []
        out = io.StringIO()
        with patch.object(mp_report, "export", side_effect=fake_export), \
             patch.object(mp_report, "_tenant_info_cloudid", return_value="site-1"), \
             contextlib.redirect_stdout(out):
            mp_report.cmd_whois(self.args(), "unused")
        result = json.loads(out.getvalue())
        self.assertEqual(result["verification"]["conclusion"], "PURCHASE_FOUND")
        self.assertEqual(result["apps"], [])
        self.assertIn(("sales/transactions", "site-1"), queries)

    def test_complete_identity_scoped_zero_is_no_match(self):
        result = self.run_whois(self.args(), [self.license()], [])
        self.assertEqual(result["verification"]["conclusion"], "NO_MATCHING_PURCHASE")

    def test_exact_order_wrong_product_or_identity(self):
        for wrong in (self.tx(app=LITE), self.tx(cloud="site-2")):
            with self.subTest(wrong=wrong):
                result = self.run_whois(self.args("order-1"), [self.license()], [wrong])
                self.assertEqual(result["verification"]["conclusion"], "NO_MATCHING_PURCHASE")

    def test_unresolved_identity_is_unverified(self):
        result = self.run_whois(self.args(), [], [])
        self.assertEqual(result["verification"]["conclusion"], "UNVERIFIED")

    def test_entitlement_only_identity_matches_exact_order(self):
        lic = self.license()
        lic["cloudId"] = None
        lic["appEntitlementNumber"] = "ent-1"
        tx = self.tx(cloud=None)
        tx["appEntitlementNumber"] = "ent-1"
        queries = []
        def fake_export(kind, auth, **filters):
            queries.append((kind, filters.get("text")))
            return [lic] if kind == "licenses" else [tx]
        out = io.StringIO()
        with patch.object(mp_report, "export", side_effect=fake_export), \
             patch.object(mp_report, "_tenant_info_cloudid", return_value=None), \
             contextlib.redirect_stdout(out):
            mp_report.cmd_whois(self.args("order-1"), "unused")
        self.assertEqual(json.loads(out.getvalue())["verification"]["conclusion"], "PURCHASE_FOUND")
        self.assertIn(("sales/transactions", "order-1"), queries)

    def test_license_cloudid_and_entitlement_finds_transaction_without_cloudid(self):
        lic = self.license()
        lic["appEntitlementNumber"] = "ent-1"
        tx = self.tx(cloud=None)
        tx["appEntitlementNumber"] = "ent-1"
        queries = []
        def fake_export(kind, auth, **filters):
            query = filters.get("text")
            queries.append((kind, query))
            if kind == "licenses": return [lic]
            return [tx] if query == "ent-1" else []
        out = io.StringIO()
        with patch.object(mp_report, "export", side_effect=fake_export), \
             contextlib.redirect_stdout(out):
            mp_report.cmd_whois(self.args(), "unused")
        self.assertEqual(json.loads(out.getvalue())["verification"]["conclusion"], "PURCHASE_FOUND")
        self.assertIn(("sales/transactions", "site-1"), queries)
        self.assertIn(("sales/transactions", "ent-1"), queries)

    def test_refunded_and_zero_rows_are_not_purchase(self):
        for tx in (self.tx(status="Refunded"), self.tx(amount=0)):
            with self.subTest(tx=tx):
                result = self.run_whois(self.args(), [self.license()], [tx])
                self.assertEqual(result["verification"]["conclusion"], "NO_MATCHING_PURCHASE")

    def test_unknown_payment_status_kept_without_settlement_claim(self):
        result = self.run_whois(self.args(), [self.license()], [self.tx(status="Unexpected")])
        self.assertEqual(result["verification"]["conclusion"], "PURCHASE_FOUND")
        self.assertEqual(result["verification"]["records"][0]["paymentStatus"], "Unexpected")

    def test_incomplete_transaction_cannot_prove_absence(self):
        tx = self.tx()
        del tx["purchaseDetails"]["saleType"]
        result = self.run_whois(self.args(), [self.license()], [tx])
        self.assertEqual(result["verification"]["conclusion"], "UNVERIFIED")

    def test_malformed_export_payload_fails_closed(self):
        with patch.object(mp_report.urllib.request, "urlopen") as urlopen:
            urlopen.return_value.read.return_value = b'{"error":"bad"}'
            urlopen.return_value.headers = {}
            with self.assertRaisesRegex(ValueError, "Unexpected licenses export shape"):
                mp_report.export("licenses", "unused")

    def test_missing_credentials_produce_structured_unverified_exit(self):
        out = io.StringIO()
        with patch.object(mp_report, "load_creds", side_effect=SystemExit("missing credentials")), \
             patch.object(sys, "argv", ["mp_report.py", "whois", "example.atlassian.net", "--json"]), \
             contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as cm:
            mp_report.main()
        self.assertEqual(cm.exception.code, 1)
        self.assertEqual(json.loads(out.getvalue())["verification"]["conclusion"], "UNVERIFIED")

    def test_http_failure_produces_structured_unverified_exit(self):
        out = io.StringIO()
        with patch.object(mp_report, "load_creds", return_value=("a", "b")), \
             patch.object(mp_report, "export", side_effect=SystemExit("ERROR 403")), \
             patch.object(sys, "argv", ["mp_report.py", "whois", "example.atlassian.net", "--json"]), \
             contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as cm:
            mp_report.main()
        self.assertEqual(cm.exception.code, 1)
        self.assertEqual(json.loads(out.getvalue())["verification"]["conclusion"], "UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
