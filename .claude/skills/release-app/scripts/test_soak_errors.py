"""Run: python3 -m unittest discover -s .claude/skills/release-app/scripts -p 'test_*.py'"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import soak_errors  # noqa: E402

SIG = "load_custom_content_v2_missing | - | 404 | - | <n>"


def rows(spec):
    """spec: (window, sig, tenant count, weighted events per tenant, received per tenant)."""
    out = []
    for win, sig, n_tenants, events, received in spec:
        for t in range(n_tenants):
            out.append({"key": [win, sig, f"tenant-{t}"], "value": {"sum": float(events), "count": received}})
    return out


class Decide(unittest.TestCase):
    def test_steady_errors_pass(self):
        blocked, _, _ = soak_errors.decide(rows([(w, SIG, 4, 10, 10) for w in range(5)]))
        self.assertFalse(blocked)

    def test_spike_on_three_tenants_blocks(self):
        spec = [(w, SIG, 3, 10, 10) for w in range(1, 5)] + [(0, SIG, 3, 40, 40)]
        blocked, _, findings = soak_errors.decide(rows(spec))
        self.assertTrue(blocked)
        self.assertIn("spike", findings[0])

    def test_same_spike_on_two_tenants_passes(self):
        # One or two sites' bursts are not a release-wide regression.
        spec = [(w, SIG, 2, 15, 15) for w in range(1, 5)] + [(0, SIG, 2, 60, 60)]
        self.assertFalse(soak_errors.decide(rows(spec))[0])

    def test_new_signature_needs_three_tenants_and_twenty_events(self):
        self.assertTrue(soak_errors.decide(rows([(0, SIG, 3, 7, 7)]))[0])
        self.assertFalse(soak_errors.decide(rows([(0, SIG, 3, 6, 6)]))[0])
        self.assertFalse(soak_errors.decide(rows([(0, SIG, 2, 30, 30)]))[0])

    def test_signature_seen_only_three_weeks_ago_is_not_new(self):
        # Week 3 is outside the growth baseline but inside the "new" lookback.
        spec = [(3, SIG, 3, 10, 10), (0, SIG, 3, 10, 10)]
        self.assertFalse(soak_errors.decide(rows(spec))[0])

    def test_growth_compares_with_recent_weeks_not_old_highs(self):
        # Errors fell from 400 to 100 a week; a return to 300 is growth.
        spec = [(1, SIG, 1, 100, 100), (2, SIG, 1, 100, 100), (3, SIG, 1, 400, 400), (4, SIG, 1, 400, 400),
                (0, SIG, 1, 300, 300)]
        blocked, _, findings = soak_errors.decide(rows(spec))
        self.assertTrue(blocked)
        self.assertIn("all errors", findings[0])


if __name__ == "__main__":
    unittest.main()
