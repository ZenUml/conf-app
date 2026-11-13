import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mp_quota import project  # noqa: E402


def d(day):
    return dt.date(2026, 11, day)


class ProjectTest(unittest.TestCase):
    def test_splits_weekday_and_weekend_rates(self):
        # 2026-11-02 is a Monday. Days 2-6 weekdays at 100, 7-8 weekend at 10,
        # 9 (Monday) partial at 3.
        daily = {d(n): 100 for n in range(2, 7)}
        daily.update({d(7): 10, d(8): 10, d(9): 3})
        est = project(daily, d(30))
        self.assertEqual(est["used_complete_days"], 520)
        self.assertEqual((est["weekday_mean"], est["weekend_mean"]), (100, 10))
        # 9..30 holds 16 weekdays and 6 weekend days; the partial day counts in full.
        self.assertEqual((est["remaining_weekdays"], est["remaining_weekend_days"]), (16, 6))
        self.assertEqual(est["projected_total"], 520 + 16 * 100 + 6 * 10)

    def test_run_rate_uses_only_the_recent_window(self):
        # A step change: old weekdays at 100, the last two at 200.
        daily = {d(2): 100, d(3): 100, d(4): 100, d(5): 200, d(6): 200, d(7): 10, d(8): 10, d(9): 0}
        est = project(daily, d(30), window=4)  # complete days 5, 6, 7, 8
        self.assertEqual(est["weekday_mean"], 200)

    def test_borrows_the_other_rate_when_no_weekend_seen(self):
        daily = {d(2): 100, d(3): 100, d(4): 5}
        est = project(daily, d(8))  # remaining 4..8: 3 weekdays, 2 weekend days
        self.assertEqual(est["weekend_mean"], 100)
        self.assertEqual(est["projected_total"], 200 + 5 * 100)

    def test_needs_a_complete_day(self):
        with self.assertRaises(ValueError):
            project({d(1): 5}, d(30))


if __name__ == "__main__":
    unittest.main()
