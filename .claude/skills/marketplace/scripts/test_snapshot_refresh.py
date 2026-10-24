"""Offline regressions: a failed refresh must not replace usable customer evidence."""
import contextlib
import io
import os
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import mp_report


class SnapshotRefresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "snapshot.db")
        self.args = SimpleNamespace(db=self.path)

    def refresh(self, exporter):
        with patch.object(mp_report, "APP_KEYS_ALL", ["example-app"]), \
                patch.object(mp_report, "export", side_effect=exporter), \
                contextlib.redirect_stdout(io.StringIO()):
            mp_report.cmd_sync(self.args, "unused")

    @staticmethod
    def successful(kind, auth, **filters):
        return [{"addonKey": "example-app", "cloudId": "example-site", "marker": "old"}]

    def test_interrupted_refresh_preserves_previous_data_and_timestamp(self):
        self.refresh(self.successful)
        with open(self.path, "rb") as f:
            before = f.read()
        def interrupted(kind, auth, **filters):
            if kind == "sales/transactions":
                raise TimeoutError("fixture timeout after licenses")
            return [{"addonKey": "example-app", "cloudId": "new-site"}]
        with self.assertRaises(TimeoutError):
            self.refresh(interrupted)
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(os.listdir(self.tmp.name), ["snapshot.db"])

    def test_failed_first_refresh_does_not_publish_an_empty_database(self):
        with self.assertRaises(TimeoutError):
            self.refresh(lambda *a, **kw: (_ for _ in ()).throw(TimeoutError("fixture")))
        self.assertFalse(os.path.exists(self.path))
        self.assertEqual(os.listdir(self.tmp.name), [])

    def test_success_replaces_snapshot_and_matching_metadata(self):
        self.refresh(self.successful)
        self.refresh(lambda *a, **kw: [{"addonKey": "example-app", "cloudId": "new-site"}])
        with sqlite3.connect(self.path) as con:
            self.assertEqual(con.execute("SELECT cloudId FROM licenses").fetchall(), [("new-site",)])
            self.assertEqual(con.execute("SELECT license_rows, tx_rows FROM sync_meta").fetchall(), [(1, 1)])

    def test_successful_empty_export_is_a_valid_snapshot(self):
        self.refresh(lambda *a, **kw: [])
        with sqlite3.connect(self.path) as con:
            self.assertEqual(con.execute("SELECT license_rows, tx_rows FROM sync_meta").fetchall(), [(0, 0)])

    def test_legacy_interrupted_database_is_not_read_as_no_customers(self):
        with sqlite3.connect(self.path) as con:
            con.executescript("CREATE TABLE licenses(raw TEXT); CREATE TABLE sync_meta(synced_at TEXT);")
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            mp_report._snapshot_age_note(self.path)
        with patch.dict(mp_report.LOCAL, {"db": self.path}):
            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                mp_report._local_export("licenses", {})


if __name__ == "__main__":
    unittest.main()
