import datetime as dt
import unittest
from unittest import mock

from sources import marketplace, sites

SYDNEY = sites.SYDNEY
NOW = dt.datetime(2026, 11, 6, 20, 0, tzinfo=SYDNEY)
TODAY = NOW.date()  # this window 31 Oct..6 Nov, before 24..30 Oct (Sydney days)
LITE_APP, FULL_APP = "ZenUML Diagrams and Open API Lite", "ZenUML Diagrams for Confluence"
LITE, FULL = "com.zenuml.confluence-addon-lite", "com.zenuml.confluence-addon"


def inst(host, at, app=LITE_APP, cloud=None, event="avi:forge:installed:app"):
    return {"clientDomain": host, "cloudId": cloud or f"cloud-{host}", "app": app, "eventType": event, "createdAt": at}


def lic(host, key=LITE, tier="10 Users", kind="FREE", status="active", cloud=None):
    return {"addonKey": key, "cloudSiteHostname": host, "cloudId": cloud or f"cloud-{host.split('.')[0]}",
            "tier": tier, "licenseType": kind, "status": status}


def events(domain, **by_event):
    """JQL rows: by_event = {"macro_viewed": ["2026-11-02T01:00", ...]} (UTC timestamps)."""
    out = []
    for name, stamps in by_event.items():
        for s in stamps:
            hour = int(dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp() // 3600)
            out.append({"key": [domain, name, hour], "value": 1})
    return out


def run(installs, prior=(), mp=(), licences=()):
    index = marketplace.index(list(licences))
    clouds = marketplace.cloud_hosts(list(licences))
    return sites.build(installs, set(prior), lambda domains: list(mp), index, TODAY, clouds)


class NewSites(unittest.TestCase):
    def cohorts(self, installs, prior=(), clouds=None):
        windows = {"now": (TODAY - dt.timedelta(6), TODAY), "before": (TODAY - dt.timedelta(13), TODAY - dt.timedelta(7))}
        return sites.new_sites(installs, set(prior), windows, clouds)

    def test_window_edges_use_sydney_days(self):
        c = self.cohorts([
            inst("edge-in.atlassian.net", "2026-10-30T13:00:00.000Z"),    # 31 Oct 00:00 Sydney: this week
            inst("edge-out.atlassian.net", "2026-10-30T12:59:00.000Z"),   # 30 Oct 23:59 Sydney: week before
            inst("early.atlassian.net", "2026-10-23T13:30:00.000Z"),      # 24 Oct 00:30 Sydney: week before
        ])
        self.assertEqual(sorted(c["now"]), ["edge-in"])
        self.assertEqual(sorted(c["before"]), ["early", "edge-out"])

    def test_reinstall_of_same_app_is_not_new_but_other_app_is(self):
        c = self.cohorts([inst("old.atlassian.net", "2026-11-02T00:00:00.000Z"),
                          inst("grow.atlassian.net", "2026-11-02T00:00:00.000Z", FULL_APP)],
                         prior=[("old", LITE_APP), ("grow", LITE_APP)])
        self.assertEqual(c["now"], {"grow": FULL_APP})

    def test_internal_sites_and_uninstalls_are_dropped(self):
        c = self.cohorts([inst("zenuml-test.atlassian.net", "2026-11-02T00:00:00.000Z"),
                          inst("lite-stg-1.atlassian.net", "2026-11-02T00:00:00.000Z"),
                          inst("gone.atlassian.net", "2026-11-02T00:00:00.000Z", event="avi:forge:uninstalled:app"),
                          inst("real.atlassian.net", "2026-11-02T00:00:00.000Z")])
        self.assertEqual(list(c["now"]), ["real"])

    def test_null_domain_is_named_through_its_cloud_id(self):
        c = self.cohorts([inst(None, "2026-11-02T00:00:00.000Z", cloud="c-1"),
                          inst(None, "2026-11-02T00:00:00.000Z", cloud="c-unknown")], clouds={"c-1": "named"})
        self.assertEqual(sorted(c["now"]), ["c-unknown", "named"])

    def test_site_counted_once_with_earliest_install(self):
        c = self.cohorts([inst("two.atlassian.net", "2026-11-03T00:00:00.000Z", FULL_APP),
                          inst("two.atlassian.net", "2026-11-02T00:00:00.000Z", LITE_APP)])
        self.assertEqual(c["now"], {"two": LITE_APP})


class Funnel(unittest.TestCase):
    def setUp(self):
        self.installs = [inst(f"{n}.atlassian.net", "2026-11-01T00:00:00.000Z") for n in ("alpha", "beta", "gamma", "delta")]
        self.installs.append(inst("old.atlassian.net", "2026-10-26T00:00:00.000Z"))
        self.mp = (
            # alpha: views and a create on 4 distinct Sydney days
            events("alpha", macro_viewed=["2026-11-01T01:00", "2026-11-02T01:00", "2026-11-03T01:00"],
                   macro_create_succeeded=["2026-11-04T01:00"])
            # beta: views on one Sydney day (two timestamps either side of UTC midnight, same Sydney day)
            + events("beta", macro_viewed=["2026-11-02T14:00", "2026-11-02T20:00"])
            # gamma: only a save, on 3 days -> not opened, not created, but active 3d
            + events("gamma", macro_save_succeeded=["2026-11-01T01:00", "2026-11-02T01:00", "2026-11-03T01:00"])
            # old (week before): viewed after its own window ended -> not counted for it
            + events("old", macro_viewed=["2026-11-03T01:00"]))
        self.lic = [lic("alpha.atlassian.net", tier="85 Users", kind="COMMERCIAL"), lic("beta.atlassian.net", tier="9 Users"),
                    lic("gamma.atlassian.net", FULL, "Evaluation", "EVALUATION"),
                    lic("old.atlassian.net", kind="COMMERCIAL", status="inactive")]

    def test_funnel_counts(self):
        out = run(self.installs, mp=self.mp, licences=self.lic)
        self.assertEqual(out["funnel"]["now"], [4, 2, 1, 2, 1])   # alpha+gamma active 3d+; alpha paid
        self.assertEqual(out["funnel"]["before"], [1, 0, 0, 0, 0])  # old: later views fall outside its window; inactive licence is not paid

    def test_row_fields(self):
        out = run(self.installs, mp=self.mp, licences=self.lic)
        by = {r["name"]: r for r in out["rows"]}
        self.assertEqual((by["alpha"]["seats"], by["alpha"]["product"]), ("85", "LITE"))
        self.assertEqual((by["gamma"]["product"], by["gamma"]["seats"]), ("FULL", ""))
        self.assertEqual(by["delta"]["product"], "LITE")  # product from the install's app
        self.assertFalse(by["old"]["recent"])

    def test_row_steps_are_the_funnel_steps_each_site_reached_since_install(self):
        out = run(self.installs, mp=self.mp, licences=self.lic)
        steps = {r["name"]: r["steps"] for r in out["rows"]}
        T, F = True, False
        self.assertEqual(steps["alpha"], [T, T, T, T, T])  # views + create on 4 days, commercial licence
        self.assertEqual(steps["beta"], [T, T, F, F, F])
        self.assertEqual(steps["gamma"], [T, F, F, T, F])  # saves only, on 3 days
        self.assertEqual(steps["delta"], [T, F, F, F, F])
        self.assertEqual(steps["old"], [T, T, F, F, F])    # a later view counts for the row; inactive licence is not paid

    def test_rows_are_the_newest_sites_first_with_a_recent_flag(self):
        installs = [inst("c.atlassian.net", "2026-10-30T13:00:00.000Z"),   # 31 Oct 00:00 Sydney: first day of the window
                    inst("a.atlassian.net", "2026-11-05T00:00:00.000Z"),
                    inst("d.atlassian.net", "2026-10-30T12:00:00.000Z"),   # 30 Oct 23:00 Sydney: week before
                    inst("b.atlassian.net", "2026-11-03T00:00:00.000Z"),
                    inst("e.atlassian.net", "2026-10-25T00:00:00.000Z")]
        out = run(installs, licences=[lic("e.atlassian.net", tier="999 Users")])
        self.assertEqual([(r["name"], r["recent"]) for r in out["rows"]],
                         [("a", True), ("b", True), ("c", True), ("d", False), ("e", False)])

    def test_row_limit_is_seven(self):
        days = [f"2026-11-0{d}T01:00" for d in range(1, 7)]
        installs = [inst(f"s{i}.atlassian.net", f"2026-11-01T{10 + i:02d}:00:00.000Z") for i in range(9)]
        out = run(installs, mp=events("s8", macro_viewed=days))
        self.assertEqual([r["name"] for r in out["rows"]], ["s8", "s7", "s6", "s5", "s4", "s3", "s2"])

    def test_rows_reach_back_past_the_two_weeks_but_the_funnel_does_not(self):
        installs = [inst("new.atlassian.net", "2026-11-03T00:00:00.000Z"),
                    inst("old1.atlassian.net", "2026-10-10T00:00:00.000Z"),
                    inst("old2.atlassian.net", "2026-09-20T00:00:00.000Z")]
        out = run(installs)
        self.assertEqual([(r["name"], r["recent"]) for r in out["rows"]],
                         [("new", True), ("old1", False), ("old2", False)])
        self.assertEqual((out["funnel"]["now"][0], out["funnel"]["before"][0]), (1, 0))

    def test_no_installs_gives_zero_funnel_and_skips_mixpanel(self):
        out = sites.build([], set(), mock.Mock(side_effect=AssertionError("must not query")), {}, TODAY)
        self.assertEqual(out, {"funnel": {"now": [0] * 5, "before": [0] * 5}, "rows": []})


class Fetch(unittest.TestCase):
    def d1(self, installs, prior):
        calls = []

        def d1(sql):
            calls.append(sql)
            return installs if "NOT LIKE 'backfill%'" in sql else prior
        return d1, calls

    def test_fetch_wires_runners_and_windows(self):
        d1, calls = self.d1([inst("new.atlassian.net", "2026-11-02T00:00:00.000Z")], [])
        scripts = []
        out = sites.fetch(d1=d1, mixpanel=lambda s: scripts.append(s) or events("new", macro_viewed=["2026-11-03T01:00"]),
                          licenses=lambda: [lic("new.atlassian.net", tier="12 Users")], now=NOW)
        self.assertEqual(out["funnel"]["now"], [1, 1, 0, 0, 0])
        self.assertEqual(out["rows"], [{"product": "LITE", "name": "new", "place": "", "seats": "12", "steps": [True, True, False, False, False], "recent": True}])
        self.assertIn("createdAt >= '2026-09-07T14:00:00.000Z'", calls[0])  # 8 Sep 00:00 Sydney (AEST, UTC+10): 60 days of rows
        self.assertIn("createdAt < '2026-09-07T14:00:00.000Z'", calls[1])
        self.assertEqual(len(scripts), 1)
        self.assertIn('{"new": 1}', scripts[0])
        self.assertIn("macro_create_succeeded", scripts[0])

    def test_runner_failures_raise(self):
        def boom(_):
            raise RuntimeError("down")
        d1, _ = self.d1([inst("new.atlassian.net", "2026-11-02T00:00:00.000Z")], [])
        with self.assertRaises(RuntimeError):
            sites.fetch(d1=boom, mixpanel=lambda s: [], licenses=lambda: [], now=NOW)
        with self.assertRaises(RuntimeError):
            sites.fetch(d1=d1, mixpanel=boom, licenses=lambda: [], now=NOW)
        with self.assertRaises(RuntimeError):
            sites.fetch(d1=d1, mixpanel=lambda s: [], licenses=lambda: boom(0), now=NOW)

    def test_unsafe_site_key_is_refused_in_jql(self):
        with self.assertRaises(ValueError):
            sites.jql(['x"});alert(1);//'], TODAY, TODAY)


if __name__ == "__main__":
    unittest.main()
