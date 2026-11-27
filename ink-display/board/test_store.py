import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from store import INTERVALS, Store

T0 = datetime(2026, 11, 6, 12, 0)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name) / "cache")

    def test_mixpanel_source_update_bypasses_interval_and_retry_is_preserved(self):
        import os
        self.store.save("mixpanel", {}, T0)
        source = self.store.dir.parent / "mixpanel-usage.json"
        source.write_text("{}")
        cache_time = self.store._path("mixpanel").stat().st_mtime_ns
        os.utime(source, ns=(cache_time + 1000000, cache_time + 1000000))
        self.assertTrue(self.store.due("mixpanel", T0))
        calls = []
        def fail():
            calls.append(1)
            raise ValueError("invalid")
        self.store.refresh_due({"mixpanel": fail}, T0)
        self.store.refresh_due({"mixpanel": fail}, T0 + timedelta(seconds=30))
        self.assertEqual(len(calls), 1)
        self.store.refresh_due({"mixpanel": fail}, T0 + timedelta(seconds=60))
        self.assertEqual(len(calls), 2)

    def test_missing_or_unchanged_source_keeps_interval(self):
        self.store.save("mixpanel", {}, T0)
        self.assertFalse(self.store.due("mixpanel", T0))
        source = self.store.dir.parent / "mixpanel-usage.json"
        source.write_text("corrupt")
        import os
        os.utime(source, (1, 1))
        self.assertFalse(self.store.due("mixpanel", T0))

    def test_intervals(self):
        self.assertEqual(INTERVALS, {"tokens": 300, "revenue": 3600, "gcp": 300, "customers": 43200, "sites": 86400, "credits": 300, "fullscreen": 300, "mixpanel": 300})

    def test_save_and_load_round_trip(self):
        self.assertIsNone(self.store.load("revenue"))
        self.store.save("revenue", {"rows": []}, T0)
        self.assertEqual(self.store.load("revenue"), {"rows": []})

    def test_timezone_aware_timestamp_is_read_as_local_time(self):
        aware = (T0 - timedelta(seconds=60)).astimezone()
        self.store.save("revenue", {"rows": []}, aware)
        self.assertFalse(self.store.due("revenue", T0))
        self.assertFalse(self.store.stale("revenue", T0))

    def test_due_and_stale_boundaries(self):
        self.assertTrue(self.store.due("tokens", T0))
        self.store.save("tokens", {}, T0)
        self.assertFalse(self.store.due("tokens", T0 + timedelta(seconds=299)))
        self.assertTrue(self.store.due("tokens", T0 + timedelta(seconds=300)))
        self.assertFalse(self.store.stale("tokens", T0 + timedelta(seconds=900)))
        self.assertTrue(self.store.stale("tokens", T0 + timedelta(seconds=901)))

    def test_refresh_calls_only_due_fetchers_and_reports_changes(self):
        calls = []
        self.store.save("revenue", {"v": 1}, T0)
        fetchers = {"revenue": lambda: calls.append("revenue") or {"v": 1},
                    "gcp": lambda: calls.append("gcp") or {"v": 2}}
        changed = self.store.refresh_due(fetchers, T0 + timedelta(seconds=10))
        self.assertEqual(calls, ["gcp"])
        self.assertEqual(changed, {"gcp"})
        self.assertEqual(self.store.load("gcp"), {"v": 2})

    def test_failed_fetch_keeps_old_file_and_records_error(self):
        self.store.save("gcp", {"v": 1}, T0)

        def boom():
            raise RuntimeError("no network")
        changed = self.store.refresh_due({"gcp": boom}, T0 + timedelta(seconds=400))
        self.assertEqual(changed, set())
        self.assertEqual(self.store.load("gcp"), {"v": 1})
        self.assertIn("no network", self.store.errors["gcp"])

    def test_failed_fetch_is_not_retried_every_loop(self):
        calls = []

        def boom():
            calls.append(1)
            raise RuntimeError("x")
        self.store.refresh_due({"gcp": boom}, T0)
        self.store.refresh_due({"gcp": boom}, T0 + timedelta(seconds=30))
        self.assertEqual(len(calls), 1)
        self.store.refresh_due({"gcp": boom}, T0 + timedelta(seconds=61))
        self.assertEqual(len(calls), 2)

    def test_success_clears_the_error(self):
        self.store.errors["gcp"] = "old"
        self.store.refresh_due({"gcp": lambda: {}}, T0)
        self.assertNotIn("gcp", self.store.errors)

    def test_corrupt_file_counts_as_missing(self):
        self.store.save("revenue", {}, T0)
        (self.store.dir / "revenue.json").write_text("{nope")
        self.assertIsNone(self.store.load("revenue"))
        self.assertTrue(self.store.due("revenue", T0))


if __name__ == "__main__":
    unittest.main()
