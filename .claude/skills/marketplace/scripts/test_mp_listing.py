#!/usr/bin/env python3
"""Unit checks for mp_listing.py. No network, no credentials.

Run from the repo root:
    python3 -m unittest discover -s .claude/skills/marketplace/scripts -p 'test_mp_listing.py'
"""
import datetime, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp_listing as m  # noqa: E402

D = datetime.date


class MergeTerms(unittest.TestCase):
    def test_duplicate_term_with_and_without_hosting_filter_is_summed(self):
        # The per-term report lists "mermaid" twice: hostingFilter "cloud" and None.
        # Sorting on that None crashed the first hand-written analysis (2026-11-19).
        rows = [
            {"searchKeyword": "mermaid", "hostingFilter": "cloud",
             "elements": [{"date": "2026-06-14", "count": 2}, {"date": "2026-09-06", "count": 1}]},
            {"searchKeyword": "Mermaid", "elements": [{"date": "2026-06-14", "count": 3}]},
            {"searchKeyword": "zenuml", "hostingFilter": None, "elements": [{"date": "2026-09-06", "count": 4}]},
        ]
        t = m.merge_terms(rows)
        self.assertEqual(set(t), {"mermaid", "zenuml"})
        self.assertEqual(t["mermaid"], {"2026-06-14": 5, "2026-09-06": 1})


class Windows(unittest.TestCase):
    def test_weeks_count_sunday_labels(self):
        # 2026-06-14 and 2026-08-30 are Sundays: 12 labels.
        self.assertEqual(m.weeks_in(D(2026, 6, 14), D(2026, 8, 30)), 12)
        self.assertEqual(m.weeks_in(D(2026, 9, 6), D(2026, 11, 15)), 11)
        # A Monday start skips to the next Sunday.
        self.assertEqual(m.weeks_in(D(2026, 9, 7), D(2026, 9, 13)), 1)

    def test_sum_window_is_inclusive_on_week_labels(self):
        s = {"2026-06-07": 10, "2026-06-14": 3, "2026-08-30": 1, "2026-09-06": 2}
        self.assertEqual(m.sum_window(s, D(2026, 6, 14), D(2026, 8, 30)), 4)

    def test_cookie_break_flag(self):
        self.assertTrue(m.crosses_break(D(2026, 3, 1), D(2026, 8, 30)))
        self.assertFalse(m.crosses_break(D(2026, 6, 14), D(2026, 8, 30)))
        self.assertFalse(m.crosses_break(D(2026, 3, 1), D(2026, 6, 7)))

    def test_month_windows_clip_to_end(self):
        self.assertEqual(m.month_windows(D(2026, 11, 1), D(2026, 11, 15)), [(D(2026, 11, 1), D(2026, 11, 15))])
        self.assertEqual(len(m.month_windows(D(2026, 12, 1), D(2027, 1, 31))), 2)


class Demand(unittest.TestCase):
    DET = [
        {"searchKeyword": "wvhryidmyf58glzlkiwjnh8pt6cqvg", "percentage": 21.33},
        {"searchKeyword": "scriptrunner", "percentage": 1.2},
        {"searchKeyword": "mermaid", "percentage": 0.9},
        {"searchKeyword": "draw.io", "percentage": 0.5},
        {"searchKeyword": "miroslav tools", "percentage": 0.3},
    ]

    def test_junk_term_is_excluded_and_reported(self):
        share, hits, junk = m.demand_share(self.DET, m.DEFAULT_DEMAND)
        self.assertEqual(share, 1.4)
        self.assertEqual(junk, 21.33)
        self.assertEqual([h["searchKeyword"] for h in hits], ["mermaid", "draw.io"])

    def test_rank_of(self):
        self.assertEqual(m.rank_of(self.DET, "Mermaid"), (3, 0.9))
        self.assertEqual(m.rank_of(self.DET, "uml"), (None, None))


class Apps(unittest.TestCase):
    APPS = [
        {"addonKey": "com.zenuml.confluence-addon", "addonName": "ZenUML Diagrams for Confluence"},
        {"addonKey": "com.zenuml.confluence-addon-lite", "addonName": "ZenUML Diagrams Lite"},
        {"addonKey": "my-api", "addonName": "Async API"},
    ]

    def test_alias_selects_exact_key(self):
        # "confluence-addon" is a substring of both Full and Lite: aliases must not use substrings.
        self.assertEqual([a["addonKey"] for a in m.select_apps(self.APPS, "full")], ["com.zenuml.confluence-addon"])
        self.assertEqual([a["addonKey"] for a in m.select_apps(self.APPS, "lite")], ["com.zenuml.confluence-addon-lite"])

    def test_empty_selects_all_and_substring_matches_name(self):
        self.assertEqual(len(m.select_apps(self.APPS, "")), 3)
        self.assertEqual([a["addonKey"] for a in m.select_apps(self.APPS, "async")], ["my-api"])

    def test_vendor_match_uses_vendor_link(self):
        ours = {"_embedded": {"vendor": {"_links": {"self": {"href": "/rest/2/vendors/1215266"}}}}}
        other = {"_embedded": {"vendor": {"_links": {"self": {"href": "/rest/2/vendors/12152661"}}}}}
        self.assertTrue(m.is_vendor(ours, "1215266"))
        self.assertFalse(m.is_vendor(other, "1215266"))


if __name__ == "__main__":
    unittest.main()
