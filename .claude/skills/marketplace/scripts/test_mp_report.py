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


class KvAuth(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.orig = mp_report.subprocess.run

    def tearDown(self):
        mp_report.subprocess.run = self.orig

    def script(self, results):
        pending = list(results)

        def run(cmd, **kwargs):
            self.calls.append(cmd)
            return pending.pop(0)

        mp_report.subprocess.run = run

    def test_401_then_success_retries_once(self):
        self.script([
            subprocess_result(1, "", "Authentication error [code: 10000]"),
            subprocess_result(0, "[]\n", ""),
        ])
        self.assertEqual(mp_report._kv_run("key", "list", "--prefix", "license:x:"), "[]\n")
        self.assertEqual(len(self.calls), 2)

    def test_second_401_raises_the_login_fix(self):
        self.script([
            subprocess_result(1, "", "✘ [ERROR] Authentication error [code: 10000]"),
            subprocess_result(1, "", "Unauthorized 401"),
        ])
        with self.assertRaises(mp_report.KvAuthError) as caught:
            mp_report._kv_run("key", "list", "--prefix", "license:x:")
        self.assertEqual(str(caught.exception), "npx wrangler login")
        self.assertEqual(len(self.calls), 2)

    def test_non_auth_failure_does_not_retry(self):
        self.script([subprocess_result(1, "", "network down")])
        with self.assertRaises(RuntimeError) as caught:
            mp_report._kv_run("key", "list")
        self.assertNotIsInstance(caught.exception, mp_report.KvAuthError)
        self.assertEqual(len(self.calls), 1)


class WhoisByEntitlement(unittest.TestCase):
    """`whois E-…` resolves an entitlement number to its site before building the card.

    The Marketplace licence page links by the HOST entitlement number (the Confluence site's),
    which is neither the hostname nor the app's own entitlement number. Before 2026-11-28 `whois`
    printed "(no Marketplace license found)" for it, and the site had to be dug out of the
    snapshot by hand."""

    HOST_ENT, APP_ENT, CLOUD = "E-111-AAA-222-BBB", "E-333-CCC-444-DDD", "cloud-0001"

    def setUp(self):
        self.license = {
            "addonKey": DIA, "cloudId": self.CLOUD, "cloudSiteHostname": "example-tenant.atlassian.net",
            "appEntitlementNumber": self.APP_ENT, "hostEntitlementNumber": self.HOST_ENT,
            "licenseType": "COMMERCIAL", "status": "active", "tier": "58 Users",
            "maintenanceEndDate": "2099-12-19",
        }
        self.tx = {
            "addonKey": DIA, "cloudId": self.CLOUD, "transactionId": "IN-000-000-001",
            "appEntitlementNumber": self.APP_ENT, "hostEntitlementNumber": self.HOST_ENT,
            "purchaseDetails": {"vendorAmount": 25.79, "billingPeriod": "Monthly", "saleType": "New",
                                "saleDate": "2099-11-27", "maintenanceStartDate": "2099-11-26",
                                "maintenanceEndDate": "2099-12-19"},
        }
        self.licenses, self.transactions = [self.license], [self.tx]
        self._export, self._edge = mp_report.export, mp_report._tenant_info_cloudid
        mp_report._tenant_info_cloudid = lambda *_: None      # never reach the network
        mp_report.export = self.fake_export

    def tearDown(self):
        mp_report.export, mp_report._tenant_info_cloudid = self._export, self._edge

    def fake_export(self, kind, auth, **filters):
        """Same broad substring match the real `text=` filter and `--local` snapshot apply."""
        import json as _json
        rows = self.transactions if kind.startswith("sales") else self.licenses
        text = str(filters.get("text") or "").lower()
        return [r for r in rows if text in _json.dumps(r).lower()]

    def whois(self, query):
        args = argparse.Namespace(domain=query, json=True, no_kv=True, app="all")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            mp_report.cmd_whois(args, auth=None)
        import json as _json
        return _json.loads(buf.getvalue())

    def test_host_entitlement_number_resolves_to_the_site(self):
        out = self.whois(self.HOST_ENT)
        self.assertEqual(out["domain"], "example-tenant.atlassian.net")
        self.assertEqual(out["cloudIds"], [self.CLOUD])
        self.assertEqual(out["entitlement"], {"number": self.HOST_ENT, "kind": "host",
                                              "host": "example-tenant.atlassian.net", "cloudId": self.CLOUD})
        self.assertEqual([a["users"] for a in out["apps"]], [58])
        self.assertEqual(out["total_lifetime_vendor"], 25.79)

    def test_app_entitlement_number_resolves_too(self):
        out = self.whois(self.APP_ENT.lower())                # the number is matched case-insensitively
        self.assertEqual(out["domain"], "example-tenant.atlassian.net")
        self.assertEqual(out["entitlement"]["kind"], "app")

    def test_number_known_only_to_a_transaction_resolves_through_cloud_id(self):
        # A transaction has cloudId but no hostname; the licence row may carry an older number.
        self.license = dict(self.license, hostEntitlementNumber="E-999-ZZZ-999-ZZZ")
        self.licenses = [self.license]
        out = self.whois(self.HOST_ENT)
        self.assertEqual(out["domain"], "example-tenant.atlassian.net")
        self.assertEqual(out["cloudIds"], [self.CLOUD])

    def test_unknown_entitlement_number_stops_with_a_clear_message(self):
        with self.assertRaises(SystemExit) as cm:
            self.whois("E-000-NOP-000-NOP")
        self.assertIn("E-000-NOP-000-NOP", str(cm.exception))
        self.assertIn("no license or transaction", str(cm.exception))

    def test_a_number_that_only_appears_inside_another_field_does_not_match(self):
        # text= is a substring search over the whole record: a hit is not yet a match.
        self.license = dict(self.license, hostEntitlementNumber="E-999-ZZZ-999-ZZZ",
                            appEntitlementNumber="E-888-YYY-888-YYY", note=self.HOST_ENT)
        self.licenses, self.transactions = [self.license], []
        with self.assertRaises(SystemExit):
            self.whois(self.HOST_ENT)

    def test_a_plain_domain_is_not_treated_as_an_entitlement(self):
        out = self.whois("example-tenant")
        self.assertEqual(out["domain"], "example-tenant")
        self.assertNotIn("entitlement", out)


def subprocess_result(code, stdout, stderr):
    return type("R", (), {"returncode": code, "stdout": stdout, "stderr": stderr})()


if __name__ == "__main__":
    unittest.main()
