#!/usr/bin/env python3
"""Unit tests for percentile.py's percentile_rank. No network, no credentials.

Run from the repo root:
    python3 .claude/skills/client-health/scripts/test_percentile.py
or:
    python3 -m unittest discover -s .claude/skills/client-health/scripts
"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import percentile  # noqa: E402


class PercentileRank(unittest.TestCase):
    def test_higher_is_better_middle_value(self):
        # [1,2,3,4,5], value=3: 2 below, 1 equal -> rank 2.5/5 = 50.0
        self.assertEqual(percentile.percentile_rank(3, [1, 2, 3, 4, 5]), 50.0)

    def test_higher_is_better_top_value(self):
        # [1,2,3,4,5], value=5: 4 below, 1 equal -> rank 4.5/5 = 90.0
        self.assertEqual(percentile.percentile_rank(5, [1, 2, 3, 4, 5]), 90.0)

    def test_higher_is_better_bottom_value(self):
        # [1,2,3,4,5], value=1: 0 below, 1 equal -> rank 0.5/5 = 10.0
        self.assertEqual(percentile.percentile_rank(1, [1, 2, 3, 4, 5]), 10.0)

    def test_lower_is_better_inverts_the_ranking(self):
        # same fleet, value=1, but 1 is now the BEST value -> should rank high
        self.assertEqual(
            percentile.percentile_rank(1, [1, 2, 3, 4, 5], direction="lower_is_better"),
            90.0,
        )

    def test_ties_get_average_rank(self):
        # [1,1,1,4,5], value=1: 0 below, 3 equal -> rank 1.5/5 = 30.0
        self.assertEqual(percentile.percentile_rank(1, [1, 1, 1, 4, 5]), 30.0)

    def test_empty_fleet_returns_zero(self):
        self.assertEqual(percentile.percentile_rank(3, []), 0.0)

    def test_unknown_direction_raises(self):
        with self.assertRaises(ValueError):
            percentile.percentile_rank(3, [1, 2, 3], direction="sideways")


if __name__ == "__main__":
    unittest.main()
