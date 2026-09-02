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


if __name__ == "__main__":
    unittest.main()
