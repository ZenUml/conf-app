import datetime as dt
import json
import os
import tempfile
import unittest

from sources import customers, marketplace

SYDNEY = customers.SYDNEY
NOW = dt.datetime(2026, 11, 6, 9, 0, tzinfo=SYDNEY)  # a Friday
LITE, FULL = "com.zenuml.confluence-addon-lite", "com.zenuml.confluence-addon"
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "customers.example.json")


def lic(host, key=LITE, tier="10 Users", kind="COMMERCIAL", status="active", end=None):
    rec = {"addonKey": key, "cloudSiteHostname": host, "tier": tier, "licenseType": kind, "status": status,
           "maintenanceStartDate": "2026-01-01"}
    if end:
        rec["maintenanceEndDate"] = end
    return rec


def note(site, name, status="", text=""):
    return {"site": site, "name": name, "status": status, "note": text}


def build(notes, records):
    return customers.build(notes, marketplace.index(records), NOW.date())["rows"]


class SeatsAndProduct(unittest.TestCase):
    def test_seats_are_the_largest_user_tier_formatted(self):
        rows = build([note("big.atlassian.net", "Big")], [
            lic("big.atlassian.net", tier="1010 Users"), lic("big.atlassian.net", FULL, tier="25 Users")])
        self.assertEqual((rows[0]["product"], rows[0]["seats"]), ("BOTH", "1,010"))

    def test_evaluation_and_unlimited_tiers_carry_no_seats(self):
        rows = build([note("a.atlassian.net", "A"), note("b.atlassian.net", "B")], [
            lic("a.atlassian.net", FULL, tier="Evaluation", kind="EVALUATION"),
            lic("b.atlassian.net", tier="Unlimited Users")])
        self.assertEqual([r["seats"] for r in rows], ["", ""])
        self.assertEqual(sorted(r["product"] for r in rows), ["FULL", "LITE"])

    def test_other_vendor_apps_are_ignored_and_unknown_site_is_blank(self):
        rows = build([note("a.atlassian.net", "A"), note("nobody.atlassian.net", "Nobody")],
                     [lic("a.atlassian.net", key="com.other.addon", tier="99 Users")])
        self.assertEqual([(r["product"], r["seats"]) for r in rows], [("", ""), ("", "")])

    def test_inactive_licence_still_gives_product_and_seats_when_nothing_is_active(self):
        rows = build([note("a.atlassian.net", "A")], [lic("a.atlassian.net", tier="40 Users", status="inactive")])
        self.assertEqual((rows[0]["product"], rows[0]["seats"]), ("LITE", "40"))

    def test_diagramly_and_asyncapi(self):
        rows = build([note("d.atlassian.net", "D"), note("s.atlassian.net", "S")], [
            lic("d.atlassian.net", "gptdock-confluence", "7 Users"), lic("s.atlassian.net", "my-api", "3 Users")])
        self.assertEqual({r["name"]: r["product"] for r in rows}, {"D": "DIAGRAMLY", "S": "ASYNCAPI"})

    def test_site_match_ignores_case_and_suffix(self):
        rows = build([note("Acme", "Acme")], [lic("acme.atlassian.net", tier="5 Users")])
        self.assertEqual(rows[0]["seats"], "5")

    def test_place_is_region_then_country_from_the_largest_tier(self):
        small = lic("big.atlassian.net", tier="10 Users")
        small["contactDetails"] = {"region": "EMEA", "country": "Germany"}
        large = lic("big.atlassian.net", FULL, tier="1010 Users")
        large["contactDetails"] = {"region": "Americas", "country": "United States of America"}
        rows = build([note("big.atlassian.net", "Big")], [small, large])
        self.assertEqual(rows[0]["place"], "Americas / US")

    def test_country_is_the_two_letter_shortcode(self):
        cases = [
            ("United Kingdom", "UK"), ("Germany", "DE"), ("Korea (South)", "KR"),
            ("Australia", "AU"), ("Japan", "JP"),
        ]
        notes, recs = [], []
        for i, (country, code) in enumerate(cases):
            host = f"c{i}.atlassian.net"
            rec = lic(host, tier="10 Users")
            rec["contactDetails"] = {"region": "EMEA", "country": country}
            notes.append(note(host, country))
            recs.append(rec)
        by_name = {r["name"]: r["place"] for r in build(notes, recs)}
        self.assertEqual(by_name["United Kingdom"], "EMEA / UK")
        self.assertEqual(by_name["Germany"], "EMEA / DE")
        self.assertEqual(by_name["Korea (South)"], "EMEA / KR")
        self.assertEqual(by_name["Australia"], "EMEA / AU")
        self.assertEqual(by_name["Japan"], "EMEA / JP")

    def test_unknown_place_is_omitted(self):
        rec = lic("a.atlassian.net", tier="10 Users")
        rec["contactDetails"] = {"region": "Unknown", "country": "Unknown"}
        rows = build([note("a.atlassian.net", "A")], [rec])
        self.assertEqual(rows[0]["place"], "")


class Ordering(unittest.TestCase):
    def test_largest_first_no_seats_last_then_name(self):
        notes = [note("z.atlassian.net", "Zed"), note("a.atlassian.net", "Able"), note("m.atlassian.net", "Mid"),
                 note("n.atlassian.net", "None")]
        recs = [lic("z.atlassian.net", tier="9 Users"), lic("a.atlassian.net", tier="2000 Users"),
                lic("m.atlassian.net", tier="9 Users")]
        self.assertEqual([r["name"] for r in build(notes, recs)], ["Able", "Mid", "Zed", "None"])

    def test_cut_to_ten(self):
        notes = [note(f"s{i}.atlassian.net", f"S{i}") for i in range(14)]
        recs = [lic(f"s{i}.atlassian.net", tier=f"{i + 1} Users") for i in range(14)]
        rows = build(notes, recs)
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0]["name"], "S13")

    def test_note_and_manual_status_pass_through(self):
        rows = build([note("a.atlassian.net", "A", "due Wed", "Send the quote")], [])
        self.assertEqual((rows[0]["status"], rows[0]["note"]), ("due Wed", "Send the quote"))


class AutoStatus(unittest.TestCase):
    def status(self, *records):
        return build([note("a.atlassian.net", "A", "auto")], list(records))[0]["status"]

    def test_trial_ends(self):
        self.assertEqual(self.status(lic("a.atlassian.net", FULL, "Evaluation", "EVALUATION", end="2026-12-03")),
                         "trial ends 3 Dec")

    def test_renews_weekday_within_a_week(self):
        self.assertEqual(self.status(lic("a.atlassian.net", end="2026-11-08")), "renews Sun")  # 2 days ahead

    def test_renews_date_beyond_a_week(self):
        self.assertEqual(self.status(lic("a.atlassian.net", end="2026-11-13")), "renews 13 Nov")  # 7 days ahead

    def test_overdue_counts_calendar_days(self):
        self.assertEqual(self.status(lic("a.atlassian.net", status="inactive", end="2026-10-25")), "12d overdue")

    def test_ending_today_is_not_overdue(self):
        self.assertEqual(self.status(lic("a.atlassian.net", end="2026-11-06")), "renews Fri")

    def test_active_licence_wins_over_an_older_inactive_one(self):
        self.assertEqual(self.status(lic("a.atlassian.net", status="inactive", end="2026-09-01"),
                                     lic("a.atlassian.net", end="2026-12-24")), "renews 24 Dec")

    def test_free_licence_without_end_date_gives_empty_status(self):
        self.assertEqual(self.status(lic("a.atlassian.net", kind="FREE")), "")


class Fetch(unittest.TestCase):
    def write(self, data):
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh)
        self.addCleanup(os.remove, path)
        return path

    def test_fetch_reads_notes_and_injected_export(self):
        path = self.write([note("big.atlassian.net", "Big", "auto", "Call")])
        out = customers.fetch(notes_path=path, now=NOW,
                              licenses=lambda: [lic("big.atlassian.net", tier="300 Users", end="2026-11-30")])
        self.assertEqual(out, {"rows": [{"product": "LITE", "name": "Big", "place": "", "seats": "300",
                                         "status": "renews 30 Nov", "note": "Call"}]})

    def test_example_fixture_is_valid(self):
        out = customers.fetch(notes_path=FIXTURE, now=NOW, licenses=lambda: [
            lic("northwind-demo.atlassian.net", tier="50 Users", end="2026-11-03", status="inactive")])
        self.assertEqual(out["rows"][0]["name"], "Northwind")
        self.assertEqual(out["rows"][0]["status"], "3d overdue")
        self.assertEqual(len(out["rows"]), 3)

    def test_missing_notes_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            customers.fetch(notes_path="/nonexistent/customers.json", now=NOW, licenses=lambda: [])

    def test_malformed_notes_raise(self):
        with self.assertRaises(ValueError):
            customers.fetch(notes_path=self.write({"site": "x"}), now=NOW, licenses=lambda: [])
        with self.assertRaises(ValueError):
            customers.fetch(notes_path=self.write([{"name": "No site"}]), now=NOW, licenses=lambda: [])

    def test_export_failure_propagates(self):
        def boom():
            raise RuntimeError("export down")
        with self.assertRaises(RuntimeError):
            customers.fetch(notes_path=self.write([note("a.atlassian.net", "A")]), now=NOW, licenses=boom)


if __name__ == "__main__":
    unittest.main()
