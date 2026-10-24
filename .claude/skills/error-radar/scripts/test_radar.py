"""Run: python3 -m unittest discover -s .claude/skills/error-radar/scripts -p 'test_*.py'"""
import datetime as dt
import os
import sys
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import radar  # noqa: E402

DAY = dt.date(2026, 10, 14)  # a Wednesday
SIG = "attachment_upload_failed | SyntaxError | - | none | <html…>"
OTHER = "load_custom_content_v2_missing | - | - | - | <n>"


def rows(spec):
    """spec: list of (day, sig, tenant, events, raw). Users = events // 5 + 1."""
    counts, users = [], {}
    for day, sig, tenant, n, raw in spec:
        counts.append({"key": [day.isoformat(), sig, tenant, "v1"], "value": {"count": raw, "sum": float(n)}})
        users[(day.isoformat(), sig)] = users.get((day.isoformat(), sig), 0) + n // 5 + 1
    return radar.Data({"counts": counts, "users": [{"key": list(k), "value": v} for k, v in users.items()]})


def history(sig, per_day, tenants=("tenant-a",), days=40, end=DAY):
    out = []
    for i in range(1, days + 1):
        d = end - dt.timedelta(days=i)
        for t in tenants:
            out.append((d, sig, t, per_day, per_day))
    return out


def kinds(alerts, sig):
    return next((a["kinds"] for a in alerts if a["signature"] == sig), [])


class RadarTest(unittest.TestCase):
    def test_steady_signature_does_not_alert(self):
        data = rows(history(SIG, 40) + [(DAY, SIG, "tenant-a", 40, 40)])
        self.assertEqual(radar.detect(data, DAY), [])

    def test_new_signature_alerts(self):
        data = rows(history(OTHER, 40) + [(DAY, SIG, "tenant-a", 6, 6)])
        self.assertEqual(kinds(radar.detect(data, DAY), SIG), ["new"])

    def test_new_signature_needs_a_real_tenant(self):
        data = rows(history(OTHER, 40) + [(DAY, SIG, "unknown_atlassian_domain", 50, 50)])
        self.assertEqual(kinds(radar.detect(data, DAY), SIG), [])

    def test_new_signature_is_not_a_spike_the_next_day(self):
        nxt = DAY + dt.timedelta(days=1)
        data = rows(history(OTHER, 40, end=nxt) + [(DAY, SIG, "tenant-a", 60, 60), (nxt, SIG, "tenant-a", 70, 70)])
        self.assertEqual(kinds(radar.detect(data, DAY), SIG), ["new"])
        self.assertEqual(kinds(radar.detect(data, nxt), SIG), [])

    def test_spike_alerts_once_then_again_on_doubling(self):
        d1, d2, d3 = DAY, DAY + dt.timedelta(days=1), DAY + dt.timedelta(days=2)
        spec = history(SIG, 20, end=d3)
        spec = [r for r in spec if r[0] not in (d1, d2)]
        spec += [(d1, SIG, "tenant-a", 200, 200), (d2, SIG, "tenant-a", 220, 220), (d3, SIG, "tenant-a", 500, 500)]
        data = rows(spec)
        self.assertIn("spike", kinds(radar.detect(data, d1), SIG))
        self.assertNotIn("spike", kinds(radar.detect(data, d2), SIG))
        self.assertIn("spike", kinds(radar.detect(data, d3), SIG))

    def test_sampled_signature_needs_real_arrivals(self):
        # 5 arrivals at rate 0.1 extrapolate to 50 — below the raw floor, so no spike.
        data = rows(history(SIG, 5) + [(DAY, SIG, "tenant-a", 300, 5)])
        self.assertEqual(kinds(radar.detect(data, DAY), SIG), [])

    def test_concentration_on_one_tenant(self):
        base = history(SIG, 10, tenants=("tenant-a", "tenant-b", "tenant-c", "tenant-d"))
        today = [(DAY, SIG, "tenant-a", 90, 90), (DAY, SIG, "tenant-b", 10, 10)]
        alerts = radar.detect(rows(base + today), DAY)
        self.assertIn("concentrated", kinds(alerts, SIG))
        alert = next(a for a in alerts if a["signature"] == SIG)
        self.assertEqual(alert["tenant"], "tenant-a")
        self.assertAlmostEqual(alert["share"], 0.9)

    def test_spread_to_many_tenants(self):
        base = history(SIG, 15, tenants=("tenant-a",))
        today = [(DAY, SIG, f"tenant-{i}", 2, 2) for i in range(10)]
        self.assertIn("spread", kinds(radar.detect(rows(base + today), DAY), SIG))

    def test_weekend_compares_with_weekends(self):
        saturday = dt.date(2026, 10, 17)
        spec = []
        for i in range(1, 41):
            d = saturday - dt.timedelta(days=i)
            n = 5 if d.weekday() >= 5 else 200
            spec.append((d, SIG, "tenant-a", n, n))
        spec.append((saturday, SIG, "tenant-a", 150, 150))
        # 150 is below a weekday's 200 but 30x a usual Saturday.
        self.assertIn("spike", kinds(radar.detect(rows(spec), saturday), SIG))

    def test_half_a_service_account_names_the_missing_half(self):
        env = {"MIXPANEL_SA_SECRET": "x"}
        with unittest.mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                radar.auth_header()
        self.assertIn("MIXPANEL_SA_USER is not set", str(ctx.exception))

    def test_render_quiet_day_and_alert_text(self):
        self.assertIn("Nothing new or unusual", radar.render(DAY, [], [], 0))
        data = rows(history(OTHER, 40) + [(DAY, SIG, "tenant-a", 6, 6)])
        text = radar.render(DAY, radar.detect(data, DAY), ["save_failed"], 2)
        self.assertIn(":new: NEW", text)
        self.assertIn("*attachment_upload_failed*", text)
        self.assertIn("Not recorded right now (sample rate 0): save_failed", text)


if __name__ == "__main__":
    unittest.main()
