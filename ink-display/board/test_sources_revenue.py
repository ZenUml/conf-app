import datetime as dt
import unittest

from sources import revenue

TODAY = dt.date(2026, 11, 9)


def tx(day, amount, sale="Renewal", tier="Per Unit Pricing (40 Users)", cloud="c1", tid="AT-1", key="com.zenuml.confluence-addon"):
    return {"addonKey": key, "cloudId": cloud, "transactionId": tid, "customerDetails": {"company": "Acme Pty"},
            "purchaseDetails": {"saleDate": day, "vendorAmount": amount, "saleType": sale, "tier": tier}}


class RevenueTest(unittest.TestCase):
    def test_totals_are_net_of_refunds_and_include_both_window_edges(self):
        rows = [tx("2026-11-09", 100.4), tx("2026-10-11", 10), tx("2026-10-10", 1000), tx("2026-08-12", 5),
                tx("2026-08-11", 7777), tx("2026-11-01", -50.0, sale="Refund")]
        out = revenue.build(rows, TODAY, {})
        self.assertEqual(out["d30"], "$60")
        self.assertEqual(out["d90"], "$1,065")

    def test_rows_are_the_ten_newest_with_site_name_and_seats(self):
        rows = [tx(f"2026-10-{d:02d}", d, tid=f"AT-{d}") for d in range(10, 25)]
        out = revenue.build(rows, TODAY, {"c1": "acme"})
        self.assertEqual(len(out["rows"]), 10)
        self.assertEqual(out["rows"][0], {"product": "FULL", "name": "acme", "amount": "$24.00", "date": "24 Oct",
                                          "type": "Renewal", "seats": "40 users"})
        self.assertEqual(out["rows"][-1]["date"], "15 Oct")

    def test_refund_amount_and_company_fallback_and_singular_tier(self):
        row = revenue.build([tx("2026-11-08", -5, sale="Refund", tier="1 User", cloud="unknown")], TODAY, {})["rows"][0]
        self.assertEqual((row["amount"], row["name"], row["seats"]), ("-$5.00", "Acme Pty", "1 user"))

    def test_year_to_date_starts_on_1_january(self):
        rows = [tx("2026-01-01", 10, tid="AT-1"), tx("2025-12-31", 1000, tid="AT-2"), tx("2026-11-09", 5.6, tid="AT-3")]
        self.assertEqual(revenue.build(rows, TODAY, {})["ytd"], "$16")

    def test_internal_sites_are_dropped_from_rows_and_totals(self):
        rows = [tx("2026-11-08", 7, cloud="c1", tid="AT-1"), tx("2026-11-07", 100, cloud="w6", tid="AT-2"),
                tx("2026-11-06", 50, cloud="stg", tid="AT-3")]
        out = revenue.build(rows, TODAY, {"c1": "acme", "w6": "whimet6", "stg": "lite-stg"})
        self.assertEqual([r["name"] for r in out["rows"]], ["acme"])
        self.assertEqual((out["d30"], out["d90"]), ("$7", "$7"))

    def test_fetch_uses_injected_runners(self):
        out = revenue.fetch(transactions=lambda: [tx("2026-11-08", 3)], licenses=lambda: [],
                            now=dt.datetime(2026, 11, 9, 12, tzinfo=dt.timezone.utc))
        self.assertEqual(out["d30"], "$3")


if __name__ == "__main__":
    unittest.main()
