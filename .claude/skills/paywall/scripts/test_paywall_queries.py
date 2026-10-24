"""Run directly: python3 .claude/skills/paywall/scripts/test_paywall_queries.py
(`python3 -m unittest <path>` fails under .claude/ with "Empty module name".)"""
import sys, unittest, urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import paywall_queries as pq


class SegmentationLimitTest(unittest.TestCase):
    def _capture_url(self, **kwargs):
        seen = {}
        def fake_open(req, timeout=60):
            seen["url"] = req.full_url
            return b'{"data":{"values":{}}}'
        original = pq._open_with_retry
        pq._open_with_retry = fake_open
        try:
            pq.call_segmentation("secret", "macro_viewed", "2026-08-07", "2026-09-06", **kwargs)
        finally:
            pq._open_with_retry = original
        return urllib.parse.parse_qs(urllib.parse.urlparse(seen["url"]).query)

    def test_breakdown_query_carries_a_limit_above_mixpanels_default_60(self):
        # 2026-09-06: without `limit`, Mixpanel returns only its default top-60
        # buckets and every other domain silently reads as zero (SKILL.md Guard #3).
        q = self._capture_url(on='properties["client_domain"]')
        self.assertIn("limit", q, "breakdown query sent no limit -> truncated to top 60")
        self.assertGreaterEqual(int(q["limit"][0]), 1000)

    def test_where_scoped_breakdown_also_carries_the_limit(self):
        q = self._capture_url(on='properties["confluence_space"]',
                              where='properties["client_domain"] == "example-tenant"')
        self.assertIn("limit", q)


if __name__ == "__main__":
    unittest.main(verbosity=2)
