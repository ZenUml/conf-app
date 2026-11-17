#!/usr/bin/env python3
"""Unit checks for timeline.py. Synthetic fixtures only: no network, no credentials, no real tenant.

Run from the repo root:
    python3 .claude/skills/customer-timeline/scripts/test_timeline.py
or:
    python3 -m unittest discover -s .claude/skills/customer-timeline/scripts
(`python3 -m unittest <path>` fails with "Empty module name" on a path under `.claude/`.)
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as t  # noqa: E402

UTC = timezone.utc
T0 = datetime(2026, 11, 10, 1, 0, 0, tzinfo=UTC)
CID = "11111111-2222-3333-4444-555555555555"


def at(minutes, base=T0):
    return base + timedelta(minutes=minutes)


def mrow(minutes, event, **props):
    return t.mk(at(minutes), "mixpanel", event, props)


class TimeParsing(unittest.TestCase):
    def test_every_format_seen_in_the_sources(self):
        want = datetime(2026, 11, 15, 0, 0, 2, 101000, tzinfo=UTC)
        self.assertEqual(t.parse_ts("2026-11-15T00:00:02.101Z"), want)
        self.assertEqual(t.parse_ts("2026-09-10 21:20:05"), datetime(2026, 9, 10, 21, 20, 5, tzinfo=UTC))
        self.assertEqual(t.parse_ts("2026-04-05"), datetime(2026, 4, 5, tzinfo=UTC))
        self.assertEqual(t.parse_ts(1794187305007), datetime.fromtimestamp(1794187305.007, UTC))
        self.assertEqual(t.parse_ts(1794187305), datetime.fromtimestamp(1794187305, UTC))
        self.assertEqual(t.parse_ts("1794187305007"), datetime.fromtimestamp(1794187305.007, UTC))
        self.assertEqual(t.parse_ts("2026-11-15T10:00:00+10:00"), datetime(2026, 11, 15, 0, 0, tzinfo=UTC))

    def test_unparseable_values_are_none_not_exceptions(self):
        for bad in (None, "", "yesterday", True, {}, []):
            self.assertIsNone(t.parse_ts(bad))

    def test_to_date_means_end_of_that_day(self):
        self.assertEqual(t.parse_bound("2026-11-17", end=True), datetime(2026, 11, 17, 23, 59, 59, 999000, tzinfo=UTC))
        self.assertEqual(t.parse_bound("2026-11-17"), datetime(2026, 11, 17, tzinfo=UTC))
        with self.assertRaises(ValueError):
            t.parse_bound("nonsense")


class MergeAndSort(unittest.TestCase):
    def test_sorted_deduplicated_and_windowed(self):
        a = [mrow(5, "b"), mrow(1, "a")]
        b = [mrow(1, "a"), mrow(30, "late"), mrow(-30, "early")]
        out = t.merge_rows([a, b], start=at(0), end=at(10))
        self.assertEqual([r["event"] for r in out], ["a", "b"])

    def test_same_instant_orders_by_source_then_event(self):
        rows = [t.mk(T0, "mixpanel", "z"), t.mk(T0, "d1:X", "y"), t.mk(T0, "d1:X", "a")]
        out = t.merge_rows([rows])
        self.assertEqual([(r["source"], r["event"]) for r in out], [("d1:X", "a"), ("d1:X", "y"), ("mixpanel", "z")])

    def test_same_row_with_different_props_is_kept(self):
        out = t.merge_rows([[t.mk(T0, "mixpanel", "e", {"x": 1}), t.mk(T0, "mixpanel", "e", {"x": 2})]])
        self.assertEqual(len(out), 2)

    def test_empty_props_are_dropped_and_certainty_validated(self):
        self.assertEqual(t.mk(T0, "s", "e", {"a": None, "b": "", "c": 0})["props"], {"c": 0})
        with self.assertRaises(ValueError):
            t.mk(T0, "s", "e", certainty="guess")

    def test_public_row_adds_each_timezone(self):
        from zoneinfo import ZoneInfo
        row = t.public_row(t.mk(T0, "s", "e"), [("local", ZoneInfo("America/New_York")), ("Melbourne", ZoneInfo("Australia/Melbourne"))])
        self.assertEqual(row["ts_utc"], "2026-11-10T01:00:00.000Z")
        self.assertTrue(row["ts_local"].startswith("2026-11-09 20:00:00"))
        self.assertTrue(row["ts_Melbourne"].startswith("2026-11-10 12:00:00"))


class ExtraRows(unittest.TestCase):
    def test_extra_rows_are_normalised_and_bad_rows_counted(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "tickets.json")
            p.write_text(json.dumps({"rows": [
                {"time": "2026-11-10T02:00:00Z", "event": "ticket_opened", "ticket": "T-1"},
                {"ts_utc": "2026-11-10 03:00:00", "name": "reply", "source": "desk", "certainty": "derived"},
                {"event": "no time"}, "junk"]}))
            rows, dropped = t.load_extra(p)
        self.assertEqual(dropped, 2)
        self.assertEqual(rows[0]["source"], "extra:tickets")
        self.assertEqual(rows[0]["props"], {"ticket": "T-1"})
        self.assertEqual((rows[1]["source"], rows[1]["certainty"]), ("desk", "derived"))

    def test_wrong_shape_raises_value_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "x.json")
            p.write_text('{"rows": 3}')
            with self.assertRaises(ValueError):
                t.load_extra(p)


class CoverageClassification(unittest.TestCase):
    def test_each_class(self):
        self.assertEqual(t.classify_result("s", n=3)["status"], "found")
        self.assertEqual(t.classify_result("s", n=0)["status"], "empty")
        self.assertEqual(t.classify_result("s", error="boom")["status"], "unavailable")
        self.assertEqual(t.classify_result("s", skipped="flag")["status"], "not_queried")
        self.assertEqual(t.classify_result("s", missing="gone")["status"], "missing")

    def test_an_error_is_never_reported_as_empty(self):
        c = t.classify_result("s", n=0, error="timeout")
        self.assertEqual(c["status"], "unavailable")
        self.assertNotIn("empty", t.coverage_label(c))

    def test_missing_table_is_not_empty(self):
        label = t.coverage_label(t.classify_result("d1:Gone", n=0, missing="table not in prod schema"))
        self.assertTrue(label.startswith("missing"))

    def test_labels(self):
        self.assertEqual(t.coverage_label(t.classify_result("s", n=4)), "rows found (4)")
        self.assertEqual(t.coverage_label(t.classify_result("s", n=0)), "queried, empty")
        self.assertEqual(t.coverage_label(t.classify_result("s", skipped="why")), "not queried (why)")
        self.assertEqual(t.coverage_label(t.classify_result("s", error="e")), "unavailable (e)")

    def test_queried_ok_needs_every_row_to_have_run(self):
        ok = [t.coverage("d1:A", "found", 1), t.coverage("d1:B", "empty")]
        self.assertTrue(t.queried_ok(ok, "d1:A"))
        self.assertFalse(t.queried_ok([t.coverage("mixpanel", "unavailable", 0, "x")], "mixpanel"))
        self.assertFalse(t.queried_ok([], "mixpanel"))


class Identity(unittest.TestCase):
    def test_identifier_forms(self):
        self.assertEqual(t.parse_identifier("Example-Tenant"), ("subdomain", "example-tenant"))
        self.assertEqual(t.parse_identifier("example-tenant.atlassian.net"), ("subdomain", "example-tenant"))
        self.assertEqual(t.parse_identifier("https://example-tenant.atlassian.net/wiki/x"), ("subdomain", "example-tenant"))
        self.assertEqual(t.parse_identifier(CID.upper()), ("cloud_id", CID))
        self.assertEqual(t.parse_identifier("e-abc-def-ghi-jkl"), ("entitlement", "E-ABC-DEF-GHI-JKL"))
        self.assertEqual(t.parse_identifier("https://marketplace.example/license/details/E-ABC-DEF-GHI-JKL?x=1"),
                         ("entitlement", "E-ABC-DEF-GHI-JKL"))

    def test_hostile_identifiers_are_rejected_before_any_sql(self):
        for bad in ("a'; DROP TABLE x;--", "a b", "", "x.y.z", "a/b"):
            with self.assertRaises(ValueError):
                t.parse_identifier(bad)
        with self.assertRaises(ValueError):
            t.sql_in(["ok", "x') OR 1=1 --"])

    def _db(self):
        con = sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.executescript("CREATE TABLE licenses(addonKey TEXT, cloudId TEXT, raw TEXT);"
                          "CREATE TABLE transactions(addonKey TEXT, cloudId TEXT, raw TEXT);")
        lic = {"addonKey": "app-lite", "cloudId": CID, "cloudSiteHostname": "example-tenant.atlassian.net",
               "appEntitlementNumber": "E-AAA-BBB-CCC-DDD", "hostEntitlementNumber": "E-HHH-III-JJJ-KKK",
               "appEntitlementId": "aaaaaaaa-0000-0000-0000-000000000001", "licenseType": "EVALUATION", "status": "active",
               "maintenanceStartDate": "2026-11-01", "latestMaintenanceStartDate": "2026-11-01",
               "latestEvaluationStartDate": "2026-10-30", "maintenanceEndDate": "2026-12-01", "lastUpdated": "2026-11-05",
               "contactDetails": {"email": "nobody@example.invalid"}}
        tx = {"addonKey": "app-lite", "cloudId": CID, "paymentStatus": "PAID", "purchaseDetails": {
              "saleDate": "2026-11-03", "saleType": "Renewal", "tier": "10", "purchasePrice": 10.0, "vendorAmount": 8.0}}
        con.execute("INSERT INTO licenses VALUES(?,?,?)", ("app-lite", CID, json.dumps(lic)))
        con.execute("INSERT INTO transactions VALUES(?,?,?)", ("app-lite", CID, json.dumps(tx)))
        return con

    def test_every_identifier_form_resolves_to_the_same_tenant(self):
        con = self._db()
        for kind, value in (("subdomain", "example-tenant"), ("cloud_id", CID), ("entitlement", "E-AAA-BBB-CCC-DDD"),
                            ("entitlement", "E-HHH-III-JJJ-KKK"), ("cloud_id", "aaaaaaaa-0000-0000-0000-000000000001")):
            ident = t.identity_from_licenses(t.snapshot_lookup(con, kind, value))
            self.assertEqual(ident["subdomains"], ["example-tenant"], (kind, value))
            self.assertEqual(ident["cloud_ids"], [CID])

    def test_unknown_identifier_matches_nothing(self):
        self.assertEqual(t.snapshot_lookup(self._db(), "subdomain", "nobody"), [])

    def test_marketplace_rows_skip_contacts_and_repeated_dates(self):
        con = self._db()
        lic = t.snapshot_lookup(con, "subdomain", "example-tenant")
        rows = t.marketplace_rows(lic, t.snapshot_transactions(con, [CID]))
        events = [r["event"] for r in rows]
        self.assertEqual(sorted(events), ["license_latest_evaluation_start", "license_maintenance_end", "license_record_updated",
                                          "license_start", "transaction_renewal"])
        self.assertNotIn("email", json.dumps([r["props"] for r in rows]))
        self.assertTrue(all(r["certainty"] == "fact" for r in rows))


class OutputGuard(unittest.TestCase):
    def test_inside_repo_is_refused_except_private(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "private").mkdir()
            self.assertFalse(t.out_dir_allowed(root / "out", [root]))
            self.assertFalse(t.out_dir_allowed(root, [root]))
            self.assertTrue(t.out_dir_allowed(root / "private" / "x", [root]))
        with tempfile.TemporaryDirectory() as other, tempfile.TemporaryDirectory() as d:
            self.assertTrue(t.out_dir_allowed(Path(other) / "x", [Path(d)]))


# ---- D1 ------------------------------------------------------------------

def schema_rows(**tables):
    """tables: name -> (columns dict name->type, leading index columns)."""
    out = []
    for name, (cols, lead) in tables.items():
        out += [{"k": "c", "t": name, "c": c, "ty": ty} for c, ty in cols.items()]
        out += [{"k": "i", "t": name, "c": c, "ty": ""} for c in lead]
    return out


class FakeD1:
    def __init__(self, schema, results):
        self.schema, self.results, self.sql = schema, results, []

    def query(self, sql):
        self.sql.append(sql)
        if "pragma_table_info" in sql:
            if isinstance(self.schema, Exception):
                raise self.schema
            return self.schema
        for table, res in self.results.items():
            if f"FROM {table} " in sql:
                if isinstance(res, Exception):
                    raise res
                return res
        return []


IDS = {"cloud": [CID], "domain": ["example-tenant", "example-tenant.atlassian.net"]}
EVT_SPEC = [s for s in t.TABLE_SPECS if s["table"] in ("AnalyticsEventFact", "CustomContent", "title_draft", "FeedbackReport",
                                                       "lifecycle_touchpoint", "lifecycle_contact", "DiagramLikes")]


class D1Strategy(unittest.TestCase):
    def spec(self, name):
        return next(s for s in t.TABLE_SPECS if s["table"] == name)

    def entry(self, cols, lead):
        return {"cols": {c: "TEXT" for c in cols}, "lead": set(lead)}

    def test_prefers_an_indexed_key_even_when_it_is_not_the_first_candidate(self):
        e = self.entry(["eventTime", "eventDate", "clientDomain", "cloudId", "event"], ["clientDomain", "eventDate"])
        self.assertEqual(t.choose_strategy(self.spec("AnalyticsEventFact"), e, IDS)[:3], ("key", "clientDomain", "domain"))

    def test_unindexed_key_on_a_big_table_falls_back_to_a_time_bounded_scan(self):
        e = self.entry(["cloudId", "createdAt", "description"], ["createdAt"])
        self.assertEqual(t.choose_strategy(self.spec("FeedbackReport"), e, IDS)[:2], ("time_scan", "cloudId"))

    def test_unindexed_big_table_without_time_index_is_not_queried(self):
        e = self.entry(["cloudId", "createdAt"], [])
        strategy, _, _, reason = t.choose_strategy(self.spec("FeedbackReport"), e, IDS)
        self.assertIsNone(strategy)
        self.assertIn("--allow-scan", reason)
        self.assertEqual(t.choose_strategy(self.spec("FeedbackReport"), e, IDS, allow_scan=True)[0], "scan")

    def test_small_tables_may_scan(self):
        e = self.entry(["clientDomain", "createdAt"], [])
        self.assertEqual(t.choose_strategy(self.spec("DiagramLikes"), e, IDS)[0], "scan")

    def test_domain_only_table_without_a_domain_is_not_queried(self):
        e = self.entry(["clientDomain", "createdAt"], ["clientDomain"])
        strategy, _, _, reason = t.choose_strategy(self.spec("DiagramLikes"), e, {"cloud": [CID], "domain": []})
        self.assertIsNone(strategy)
        self.assertIn("domain", reason)

    def test_table_with_no_tenant_column_says_so(self):
        e = self.entry(["x", "createdAt"], [])
        self.assertIn("no tenant column", t.choose_strategy(self.spec("DiagramLikes"), e, IDS)[3])


class D1Queries(unittest.TestCase):
    def test_text_window_uses_date_prefixes(self):
        pred = t._time_predicate("createdAt", "TEXT", (datetime(2026, 11, 1, 5, tzinfo=UTC), datetime(2026, 11, 3, 5, tzinfo=UTC)))
        self.assertEqual(pred, "createdAt >= '2026-11-01' AND createdAt < '2026-11-04'")

    def test_integer_window_normalises_seconds_and_milliseconds(self):
        pred = t._time_predicate("requested_at", "INTEGER", (datetime(2026, 11, 1, tzinfo=UTC), None))
        self.assertIn("CASE WHEN requested_at > 100000000000", pred)
        self.assertIn(str(int(datetime(2026, 11, 1, tzinfo=UTC).timestamp() * 1000)), pred)

    def test_query_selects_only_allowed_columns_and_never_bodies(self):
        spec = next(s for s in t.TABLE_SPECS if s["table"] == "CustomContent")
        entry = {"cols": {"contentId": "", "title": "", "body": "", "createdAt": "", "cloudId": "", "diagramType": ""}, "lead": {"cloudId"}}
        sql = t.build_query(spec, entry, "key", "cloudId", "cloud", IDS, (T0, None))
        self.assertNotIn("body", sql)
        self.assertNotIn("*", sql)
        self.assertIn(f"cloudId IN ('{CID}')", sql)
        self.assertNotIn("createdAt >=", sql)  # CustomContent is read in full for the cross-check
        self.assertIn("LIMIT 2000", sql)

    def test_via_query_links_through_the_contact_table(self):
        spec = next(s for s in t.TABLE_SPECS if s["table"] == "lifecycle_touchpoint")
        entry = {"cols": {"kind": "", "step": "", "created_at": "", "contact_email": "", "meta": "", "app": ""}, "lead": set()}
        sql = t.build_query(spec, entry, "via", None, None, IDS, (None, None))
        self.assertIn("SELECT contact_email FROM lifecycle_contact WHERE cloud_id IN", sql)
        self.assertEqual(sql.split(" FROM ")[0].count("contact_email"), 0)  # the address is never selected

    def test_rows_from_d1_handles_every_time_format_and_multiple_time_columns(self):
        spec = next(s for s in t.TABLE_SPECS if s["table"] == "title_draft")
        recs = [{"requested_at": 1794187305007, "generated_at": 1794187309007, "status": "ready", "kind": "k", "page_id": "9"}]
        rows = t.rows_from_d1(spec, None, recs)
        self.assertEqual([r["event"] for r in rows], ["title_draft_requested", "title_draft_generated"])
        self.assertEqual(rows[0]["source"], "d1:title_draft")
        self.assertEqual(rows[0]["props"]["status"], "ready")

    def test_event_column_with_and_without_prefix(self):
        fact = next(s for s in t.TABLE_SPECS if s["table"] == "AnalyticsEventFact")
        rows = t.rows_from_d1(fact, None, [{"eventTime": "2026-11-15T00:00:02.101Z", "event": "page_updated", "userAccountId": "abcdef0123456789"}])
        self.assertEqual(rows[0]["event"], "page_updated")
        self.assertEqual(rows[0]["props"]["user"], "…23456789")
        counter = next(s for s in t.TABLE_SPECS if s["table"] == "DailyBehaviorCounter")
        rows = t.rows_from_d1(counter, None, [{"date": "2026-04-05", "action": "view", "eventCount": 3}])
        self.assertEqual((rows[0]["event"], rows[0]["props"]["granularity"]), ("daily_counter_view", "day"))

    def test_long_free_text_is_cut(self):
        spec = next(s for s in t.TABLE_SPECS if s["table"] == "FeedbackReport")
        rows = t.rows_from_d1(spec, None, [{"createdAt": "2026-09-10 21:20:05", "description": "x" * 1000}])
        self.assertLess(len(rows[0]["props"]["description"]), 300)


class D1Collection(unittest.TestCase):
    def run_collect(self, schema, results, specs=EVT_SPEC):
        client = FakeD1(schema, results)
        rows, covs, content = t.collect_d1(client, IDS, (T0, T0 + timedelta(days=3)), specs=specs, workers=1)
        return client, rows, {c["source"]: c for c in covs}, content

    def test_found_empty_missing_unavailable_and_skipped_are_told_apart(self):
        schema = schema_rows(
            AnalyticsEventFact=({"eventTime": "TEXT", "eventDate": "TEXT", "event": "TEXT", "clientDomain": "TEXT"}, ["clientDomain", "eventDate"]),
            CustomContent=({"contentId": "TEXT", "createdAt": "TEXT", "cloudId": "TEXT", "title": "TEXT"}, ["cloudId"]),
            FeedbackReport=({"cloudId": "TEXT", "createdAt": "TEXT"}, []),
            DiagramLikes=({"clientDomain": "TEXT", "createdAt": "TEXT"}, ["clientDomain"]),
            lifecycle_contact=({"cloud_id": "TEXT", "first_seen_at": "TEXT"}, []),
        )
        results = {
            "AnalyticsEventFact": [{"eventTime": "2026-11-10T01:00:00Z", "event": "page_updated"}],
            "CustomContent": [],
            "DiagramLikes": t.D1Error("wrangler failed: boom"),
        }
        _, rows, cov, content = self.run_collect(schema, results)
        self.assertEqual(cov["d1:AnalyticsEventFact"]["status"], "found")
        self.assertEqual(cov["d1:CustomContent"]["status"], "empty")
        self.assertEqual(cov["d1:DiagramLikes"]["status"], "unavailable")
        self.assertEqual(cov["d1:title_draft"]["status"], "missing")
        self.assertEqual(cov["d1:FeedbackReport"]["status"], "not_queried")
        self.assertEqual(cov["d1:lifecycle_touchpoint"]["status"], "missing")
        self.assertEqual(len(rows), 1)
        self.assertEqual(content, [])  # CustomContent queried and empty: an empty list, not None

    def test_a_failing_table_does_not_hide_the_others(self):
        schema = schema_rows(
            AnalyticsEventFact=({"eventTime": "TEXT", "eventDate": "TEXT", "event": "TEXT", "clientDomain": "TEXT"}, ["clientDomain"]),
            CustomContent=({"contentId": "TEXT", "createdAt": "TEXT", "cloudId": "TEXT"}, ["cloudId"]))
        results = {"AnalyticsEventFact": t.D1Error("boom"), "CustomContent": [{"contentId": 7, "createdAt": "2026-11-10T00:00:00Z"}]}
        _, rows, cov, content = self.run_collect(schema, results, [s for s in EVT_SPEC if s["table"] in ("AnalyticsEventFact", "CustomContent")])
        self.assertEqual(cov["d1:AnalyticsEventFact"]["status"], "unavailable")
        self.assertEqual(cov["d1:CustomContent"]["status"], "found")
        self.assertEqual(content, ["7"])

    def test_discovery_failure_marks_every_table_unavailable_not_empty(self):
        _, rows, cov, content = self.run_collect(t.D1Error("auth failed"), {})
        self.assertEqual(rows, [])
        self.assertTrue(all(c["status"] == "unavailable" for c in cov.values()))
        self.assertIsNone(content)

    def test_truncation_is_reported(self):
        schema = schema_rows(CustomContent=({"contentId": "TEXT", "createdAt": "TEXT", "cloudId": "TEXT"}, ["cloudId"]))
        spec = [s for s in EVT_SPEC if s["table"] == "CustomContent"]
        client = FakeD1(schema, {"CustomContent": [{"contentId": str(i), "createdAt": "2026-11-10T00:00:00Z"} for i in range(3)]})
        _, covs, _ = t.collect_d1(client, IDS, (None, None), specs=spec, workers=1, cap=3)[0:3]
        self.assertIn("TRUNCATED", covs[0]["detail"])

    def test_wrangler_banner_lines_before_the_json_are_ignored(self):
        out = ' ⛅️ wrangler 4.0\n[WARNING] something\n[\n  {"results": [{"a": 1}], "success": true}\n]\n'
        self.assertEqual(t.parse_wrangler_json(out)[0]["results"], [{"a": 1}])
        self.assertIsNone(t.parse_wrangler_json("no json here"))

    def test_via_table_without_a_cloud_id_is_not_queried(self):
        schema = schema_rows(lifecycle_contact=({"cloud_id": "TEXT"}, []),
                             lifecycle_touchpoint=({"kind": "TEXT", "created_at": "TEXT", "contact_email": "TEXT"}, ["contact_email"]))
        spec = [s for s in t.TABLE_SPECS if s["table"] == "lifecycle_touchpoint"]
        client = FakeD1(schema, {})
        _, covs, _ = t.collect_d1(client, {"cloud": [], "domain": ["example-tenant"]}, (None, None), specs=spec, workers=1)
        self.assertEqual(covs[0]["status"], "not_queried")

    def test_via_table_needs_its_linking_table(self):
        schema = schema_rows(lifecycle_touchpoint=({"kind": "TEXT", "created_at": "TEXT", "contact_email": "TEXT"}, ["contact_email"]))
        spec = [s for s in t.TABLE_SPECS if s["table"] == "lifecycle_touchpoint"]
        _, _, cov, _ = self.run_collect(schema, {}, spec)
        self.assertEqual(cov["d1:lifecycle_touchpoint"]["status"], "missing")


# ---- Mixpanel -------------------------------------------------------------

class MixpanelCollection(unittest.TestCase):
    W = (datetime(2026, 11, 1, tzinfo=UTC), datetime(2026, 11, 20, tzinfo=UTC))
    TODAY = datetime(2026, 11, 20, tzinfo=UTC).date()

    def test_jql_filters_by_domain_and_keeps_a_property_subset(self):
        js = t.jql_script(["example-tenant"], datetime(2026, 11, 1).date(), datetime(2026, 11, 3).date())
        self.assertIn('var DOMAINS = ["example-tenant"]', js)
        self.assertIn("from_date: '2026-11-01'", js)
        self.assertIn("to_date: '2026-11-03'", js)
        for key in ("sample_rate", "session_replay_source", "creation_origin", "macro_type"):
            self.assertIn(f'"{key}"', js)
        with self.assertRaises(ValueError):
            t.jql_script(["x'];alert(1);//"], datetime(2026, 11, 1).date(), datetime(2026, 11, 3).date())

    def test_range_is_chunked_inclusively(self):
        chunks = t.split_range(datetime(2026, 11, 1).date(), datetime(2026, 11, 30).date(), 14)
        self.assertEqual([(a.day, b.day) for a, b in chunks], [(1, 14), (15, 28), (29, 30)])

    def test_rows_and_anonymous_identity(self):
        recs = [{"n": "macro_viewed", "t": 1794187305007, "d": "abc", "u": "0123456789abcdef01234567", "p": {"macro_type": "mermaid", "render_ms": 120}},
                {"n": "x", "t": 1794187306007, "d": "$device:zzz", "u": None, "p": {}},
                {"n": "bad", "t": None}]
        rows = t.rows_from_mixpanel(recs)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["props"]["user"], t.short_id("0123456789abcdef01234567"))
        self.assertNotIn("user", rows[1]["props"])

    def test_pre_tracking_window_is_not_queried(self):
        rows, cov = t.collect_mixpanel(["example-tenant"], (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 3, 1, tzinfo=UTC)),
                                       lambda s: self.fail("must not run"), self.TODAY)
        self.assertEqual(cov["status"], "not_queried")

    def test_no_subdomain_is_not_queried(self):
        self.assertEqual(t.collect_mixpanel([], self.W, lambda s: [], self.TODAY)[1]["status"], "not_queried")

    def test_all_chunks_failing_is_unavailable_never_empty(self):
        def boom(script):
            raise t.MPError("Cannot find .env.mixpanel")
        rows, cov = t.collect_mixpanel(["example-tenant"], self.W, boom, self.TODAY)
        self.assertEqual((rows, cov["status"]), ([], "unavailable"))
        self.assertIn(".env.mixpanel", cov["detail"])

    def test_partial_failure_is_flagged_incomplete(self):
        calls = []

        def flaky(script):
            calls.append(1)
            if len(calls) == 2:
                raise t.MPError("HTTP Error 429")
            return [{"n": "macro_viewed", "t": 1794187305007, "d": "a", "p": {}}]
        rows, cov = t.collect_mixpanel(["example-tenant"], (datetime(2026, 11, 1, tzinfo=UTC), datetime(2026, 11, 30, tzinfo=UTC)), flaky,
                                       datetime(2026, 11, 30).date())
        self.assertEqual(cov["status"], "found")
        self.assertIn("INCOMPLETE: 1 of 3", cov["detail"])

    def test_zero_rows_on_success_is_empty(self):
        self.assertEqual(t.collect_mixpanel(["example-tenant"], self.W, lambda s: [], self.TODAY)[1]["status"], "empty")


# ---- Sampling parser ------------------------------------------------------

SAMPLING_TS = """
import { isEventBudgetActive } from "@/lib/octoberBudgetWindow.js";
export const EVENT_SAMPLE_RATES: Record<string, number> = {
  // a comment with a fake_event: 0.5 in it
  convert_to_png: 0.1, // trailing comment 0.9
  png_export_state_changed: 0.1,
};
export const MACRO_VIEWED_REPEAT_SAMPLE_RATE = 0.1;
export const TITLE_DRAFT_LOOKUP_MISS_SAMPLE_RATE = 0.25;
const PREFIX_RULES: ReadonlyArray<readonly [string, number]> = [
  ["create_attachment", 0.1],
];
export const OCTOBER_STOP_EVENTS = new Set<string>([
  "cohorts_refreshed",
]);
export const OCTOBER_RETAINED_EVENTS = new Set<string>([
  "macro_create_started",
  "macro_authoring_ended",
]);
export const OCTOBER_REDUCED_EVENTS = new Set<string>([
  "fullscreen_opened",
  "convert_to_png",
]);
"""
WINDOW_JS = "const OCTOBER_START_UTC = Date.UTC(2026, 9, 1);\n"


class SamplingParser(unittest.TestCase):
    def setUp(self):
        self.m = t.parse_sampling(SAMPLING_TS, WINDOW_JS)

    def test_parses_each_table_and_ignores_comments(self):
        self.assertEqual(self.m["rates"], {"convert_to_png": 0.1, "png_export_state_changed": 0.1})
        self.assertEqual(self.m["prefix"], [("create_attachment", 0.1)])
        self.assertEqual(self.m["stop"], {"cohorts_refreshed"})
        self.assertEqual(self.m["retained"], {"macro_create_started", "macro_authoring_ended"})
        self.assertEqual(self.m["reduced"], {"fullscreen_opened", "convert_to_png"})
        self.assertEqual(self.m["constants"], {"MACRO_VIEWED_REPEAT_SAMPLE_RATE": 0.1, "TITLE_DRAFT_LOOKUP_MISS_SAMPLE_RATE": 0.25})
        self.assertEqual(self.m["budget_start"], datetime(2026, 10, 1, tzinfo=UTC))  # JS month 9 is October

    def test_keep_rate_mirrors_the_typescript(self):
        now = datetime(2026, 11, 17, tzinfo=UTC)
        k = lambda n: t.keep_rate(self.m, n, now)  # noqa: E731
        self.assertEqual(k("macro_create_started"), 1.0)      # retained
        self.assertEqual(k("cohorts_refreshed"), 0.0)         # stopped
        self.assertAlmostEqual(k("fullscreen_opened"), 0.1)   # reduced /10
        self.assertAlmostEqual(k("convert_to_png"), 0.01)     # 0.1 base, reduced /10
        self.assertAlmostEqual(k("create_attachmentmermaid"), 0.01)  # prefix 0.1, then /10
        self.assertEqual(k("something_else"), 1.0)
        self.assertEqual(t.keep_rate(self.m, "cohorts_refreshed", datetime(2026, 9, 1, tzinfo=UTC)), 1.0)  # before the budget
        self.assertAlmostEqual(t.keep_rate(self.m, "fullscreen_opened", datetime(2026, 9, 1, tzinfo=UTC)), 1.0)

    def test_sampled_event_flag_lists_seen_and_watched_events(self):
        rows = [mrow(0, "fullscreen_opened"), mrow(1, "macro_create_started"), mrow(2, "cohorts_refreshed", sample_rate=0.1)]
        flag = t.flag_sampled_events(rows, self.m, datetime(2026, 11, 17, tzinfo=UTC), watch=("macro_create_started", "fullscreen_opened"))
        by = {i["event"]: i for i in flag["items"]}
        self.assertEqual(set(by), {"fullscreen_opened", "cohorts_refreshed"})
        self.assertTrue(by["fullscreen_opened"]["seen"])
        self.assertEqual(flag["stamped_sample_rate_events"], ["cohorts_refreshed"])
        self.assertIn("not evidence", flag["note"])

    def test_per_occurrence_constants_are_listed_for_events_seen(self):
        flag = t.flag_sampled_events([mrow(0, "title_draft_requested")], self.m, datetime(2026, 11, 17, tzinfo=UTC), watch=())
        self.assertEqual(flag["items"][0]["keep_rate"], 0.25)
        self.assertIn("TITLE_DRAFT_LOOKUP_MISS_SAMPLE_RATE", flag["items"][0]["note"])

    def test_unparseable_source_does_not_crash(self):
        m = t.parse_sampling("not typescript", None)
        self.assertEqual(t.keep_rate(m, "anything"), 1.0)


# ---- Gap flags ------------------------------------------------------------

U1, U2 = "…user0001", "…user0002"


class AuthoringGaps(unittest.TestCase):
    def test_start_with_terminal_joined_by_key(self):
        rows = [mrow(0, "macro_create_started", user=U1, creation_flow_id="f1"), mrow(3, "macro_create_succeeded", user=U1, creation_flow_id="f1")]
        pairs = t.pair_authoring(rows)
        self.assertEqual(pairs[0]["via"], "join_key")
        self.assertEqual(t.flag_unterminated(pairs, at(60))["items"], [])

    def test_two_overlapping_journeys_by_one_user_pair_by_key_not_order(self):
        rows = [mrow(0, "macro_edit_started", user=U1, journey_id="a"), mrow(1, "macro_edit_started", user=U1, journey_id="b"),
                mrow(5, "macro_authoring_ended", user=U1, journey_id="a", authoring_outcome="saved")]
        pairs = t.pair_authoring(rows)
        self.assertIsNotNone(pairs[0]["end"])
        self.assertIsNone(pairs[1]["end"])
        items = t.flag_unterminated(pairs, at(600))["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["ts_utc"], t.iso_z(at(1)))

    def test_start_without_terminal_is_flagged_and_recent_ones_marked_open(self):
        rows = [mrow(0, "macro_create_started", user=U1, macro_type="mermaid"), mrow(500, "macro_create_started", user=U2)]
        items = t.flag_unterminated(t.pair_authoring(rows), at(510))["items"]
        self.assertEqual([i["possibly_still_open"] for i in items], [False, True])

    def test_user_order_fallback_stops_at_the_users_next_start(self):
        rows = [mrow(0, "macro_create_started", user=U1), mrow(10, "macro_create_started", user=U1), mrow(12, "macro_create_cancelled", user=U1)]
        pairs = t.pair_authoring(rows)
        self.assertIsNone(pairs[0]["end"])      # the cancel belongs to the second start
        self.assertEqual(pairs[1]["via"], "user_order")

    def test_other_users_terminal_does_not_close_a_start(self):
        rows = [mrow(0, "macro_create_started", user=U1), mrow(2, "macro_create_succeeded", user=U2)]
        self.assertIsNone(t.pair_authoring(rows)[0]["end"])

    def test_silent_stretch_between_start_and_save(self):
        rows = [mrow(0, "macro_edit_started", user=U1, journey_id="a"), mrow(2, "editor_code_panel_toggled", user=U1),
                mrow(25, "macro_save_succeeded", user=U1, journey_id="a")]
        flag = t.flag_silent_stretch(rows, t.pair_authoring(rows))
        self.assertEqual(flag["items"][0]["longest_silence_minutes"], 23.0)
        self.assertEqual(flag["items"][0]["silence_began_utc"], t.iso_z(at(2)))

    def test_silence_boundary_and_other_users_activity(self):
        ok = [mrow(0, "macro_edit_started", user=U1, journey_id="a"), mrow(15, "macro_save_succeeded", user=U1, journey_id="a")]
        self.assertEqual(t.flag_silent_stretch(ok, t.pair_authoring(ok))["items"], [])  # exactly 15 minutes is not over the limit
        busy = ok[:1] + [mrow(10, "other", user=U2)] + [mrow(20, "macro_save_succeeded", user=U1, journey_id="a")]
        self.assertEqual(len(t.flag_silent_stretch(busy, t.pair_authoring(busy))["items"]), 1)  # U2's activity does not count

    def test_cancel_is_terminal_but_not_a_save(self):
        rows = [mrow(0, "macro_create_started", user=U1, creation_flow_id="f"), mrow(40, "macro_create_cancelled", user=U1, creation_flow_id="f")]
        pairs = t.pair_authoring(rows)
        self.assertEqual(t.flag_unterminated(pairs, at(100))["items"], [])
        self.assertEqual(t.flag_silent_stretch(rows, pairs)["items"], [])


class ReplayAndPlacement(unittest.TestCase):
    def test_replay_off_or_sampled_out_is_flagged_and_absent_property_is_counted_apart(self):
        rows = [mrow(0, "macro_create_started", session_replay_source="off"),
                mrow(1, "macro_edit_started", session_replay_source="authoring", session_replay_start_call_outcome="skipped_sampled"),
                mrow(2, "macro_save_succeeded", session_replay_source="authoring", session_replay_start_call_outcome="returned"),
                mrow(3, "macro_authoring_ended"),
                mrow(4, "macro_viewed", session_replay_source="off")]  # not an authoring event
        flag = t.flag_replay_missing(rows)
        self.assertEqual(flag["count"], 2)
        self.assertEqual((flag["authoring_events"], flag["property_absent"]), (4, 1))

    def test_replay_listing_is_capped_but_counted(self):
        rows = [mrow(i, "macro_create_started", session_replay_source="off") for i in range(40)]
        flag = t.flag_replay_missing(rows, limit=10)
        self.assertEqual((flag["count"], len(flag["items"]), flag["truncated"]), (40, 10, True))

    def test_unplaced_write_without_placement_and_with_delay(self):
        rows = [mrow(0, "unplaced_property_write", custom_content_id="c1", user=U1), mrow(7, "diagram_added_to_page", custom_content_id="c1", user=U1),
                mrow(10, "unplaced_property_write", custom_content_id="c2", user=U1), mrow(12, "diagram_added_to_page", custom_content_id="c3", user=U1),
                mrow(20, "unplaced_property_write", user=U2)]
        flag = t.flag_unplaced_writes(rows)
        by = [(i["placed"], i["delay_seconds"]) for i in flag["items"]]
        self.assertEqual(by, [(True, 420.0), (False, None), (False, None)])
        self.assertEqual(flag["unplaced"], 2)

    def test_unplaced_matches_by_user_when_content_id_is_missing(self):
        rows = [mrow(0, "unplaced_property_write", user=U1), mrow(1, "diagram_added_to_page", user=U1)]
        self.assertEqual(t.flag_unplaced_writes(rows)["items"][0]["delay_seconds"], 60.0)

    def test_placement_before_the_write_does_not_count(self):
        rows = [mrow(0, "diagram_added_to_page", user=U1), mrow(5, "unplaced_property_write", user=U1)]
        self.assertFalse(t.flag_unplaced_writes(rows)["items"][0]["placed"])


def d1row(minutes, content_id, event="custom_content_created"):
    return t.mk(at(minutes), "d1:CustomContent", event, {"content_id": content_id})


class D1VersusMixpanel(unittest.TestCase):
    W = (T0 - timedelta(days=1), T0 + timedelta(days=1))

    def test_both_directions(self):
        rows = [d1row(0, "100"), d1row(1, "200"),
                mrow(0, "macro_create_succeeded", custom_content_id="100"), mrow(5, "macro_create_succeeded", custom_content_id="300"),
                mrow(6, "macro_viewed", custom_content_id="999")]
        flag = t.flag_d1_vs_mixpanel(rows, ["100", "200", "400"], self.W)
        self.assertEqual(flag["d1_content_without_mixpanel_create"], ["200"])
        self.assertEqual(flag["mixpanel_create_without_d1_content"], ["300"])
        self.assertEqual(flag["certainty"], "derived")

    def test_truncated_d1_read_does_not_judge_the_reverse_direction(self):
        rows = [d1row(0, "100"), mrow(0, "macro_create_succeeded", custom_content_id="300")]
        flag = t.flag_d1_vs_mixpanel(rows, ["100"], self.W, d1_truncated=True)
        self.assertIsNone(flag["mixpanel_create_without_d1_content"])
        self.assertEqual(flag["d1_content_without_mixpanel_create"], ["100"])
        meta = {"label": "x", "from": "a", "to": "b", "generated": "c", "identity": t.new_identity()}
        from zoneinfo import ZoneInfo
        self.assertIn("not judged", t.render_markdown(meta, rows, [], [flag], [("Melbourne", ZoneInfo("UTC"))]))

    def test_content_outside_the_window_is_not_reported(self):
        rows = [d1row(-60 * 24 * 5, "old")]
        flag = t.flag_d1_vs_mixpanel(rows, ["old"], self.W)
        self.assertEqual(flag["d1_content_without_mixpanel_create"], [])

    def test_legacy_create_event_names_count_as_create_events(self):
        rows = [mrow(0, "create_macro_end", custom_content_id="1"), mrow(1, "byline_diagram_created", custom_content_id="2")]
        flag = t.flag_d1_vs_mixpanel(rows, ["1", "2"], self.W)
        self.assertEqual(flag["mixpanel_create_events"], 2)


class ComputeGaps(unittest.TestCase):
    MODEL = t.parse_sampling(SAMPLING_TS, WINDOW_JS)
    OK = [t.coverage("mixpanel", "found", 3), t.coverage("d1:CustomContent", "found", 1)]

    def names(self, gaps):
        return {g["flag"]: g for g in gaps}

    def test_everything_runs_when_sources_were_queried(self):
        rows = [mrow(0, "macro_create_started", user=U1)]
        g = self.names(t.compute_gaps(rows, self.OK, self.MODEL, ["1"], (None, None), None, at(600)))
        self.assertTrue(all("not_computed" not in v for v in g.values()))
        self.assertEqual(set(g), {"sampled_events", "start_without_terminal", "silent_stretch", "authoring_without_replay",
                                  "unplaced_property_write", "d1_vs_mixpanel_content"})

    def test_unavailable_mixpanel_yields_not_computed_flags_not_empty_ones(self):
        cov = [t.coverage("mixpanel", "unavailable", 0, "no credential")]
        g = self.names(t.compute_gaps([], cov, self.MODEL, None, (None, None)))
        for name in ("sampled_events", "start_without_terminal", "silent_stretch", "authoring_without_replay", "unplaced_property_write",
                     "d1_vs_mixpanel_content"):
            self.assertIn("not_computed", g[name])

    def test_missing_d1_content_disables_only_the_content_comparison(self):
        cov = [t.coverage("mixpanel", "found", 1), t.coverage("d1:CustomContent", "unavailable", 0, "x")]
        g = self.names(t.compute_gaps([mrow(0, "macro_viewed")], cov, self.MODEL, None, (None, None)))
        self.assertIn("not_computed", g["d1_vs_mixpanel_content"])
        self.assertNotIn("not_computed", g["start_without_terminal"])

    def test_missing_sampling_source_is_named(self):
        g = self.names(t.compute_gaps([], self.OK, None, [], (None, None)))
        self.assertEqual(g["sampled_events"]["not_computed"], "eventSampling.ts not found")

    def test_config_drift_when_a_lifecycle_name_leaves_the_catalog(self):
        catalog = '"macro_create_started" "macro_edit_started" "macro_create_succeeded" "macro_save_succeeded" "macro_create_cancelled" ' \
                  '"macro_edit_cancelled" "macro_authoring_ended" "unplaced_property_write" "diagram_added_to_page"'
        self.assertIsNone(t.config_drift(catalog))
        drift = t.config_drift(catalog.replace('"macro_edit_cancelled"', ""))
        self.assertEqual(drift["missing_from_catalog"], ["macro_edit_cancelled"])
        self.assertIsNone(t.config_drift(None))


class Rendering(unittest.TestCase):
    def test_markdown_has_coverage_gaps_and_every_timezone_column(self):
        from zoneinfo import ZoneInfo
        rows = [t.mk(T0, "mixpanel", "macro_viewed", {"a": "x|y"})]
        covs = [t.coverage("mixpanel", "found", 1), t.coverage("d1:Gone", "missing", 0, "table not in prod schema")]
        gaps = [{"flag": "silent_stretch", "items": [], "note": "n"}, {"flag": "start_without_terminal", "not_computed": "Mixpanel rows unavailable"}]
        meta = {"label": "example-tenant", "from": "a", "to": "b", "generated": "c", "identity": t.new_identity()}
        md = t.render_markdown(meta, rows, covs, gaps, [("local (UTC)", ZoneInfo("UTC")), ("Melbourne", ZoneInfo("Australia/Melbourne"))])
        self.assertIn("| d1:Gone | missing (table not in prod schema) |", md)
        self.assertIn("not computed (Mixpanel rows unavailable)", md)
        self.assertIn("| UTC | local (UTC) | Melbourne |", md)
        self.assertIn("x\\|y", md)
        js = json.loads(t.to_json(meta, rows, covs, gaps, []))
        self.assertEqual(js["rows"][0]["certainty"], "fact")
        self.assertEqual(js["coverage"][1]["label"], "missing (table not in prod schema)")


if __name__ == "__main__":
    unittest.main()
