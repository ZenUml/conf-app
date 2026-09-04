#!/usr/bin/env python3
"""
health_score.py — Opportunity + Risk scoring for active ZenUML Lite tenants.

Two independent 0-100 percentile scores per tenant:
  - Opportunity: how strong an upsell (Lite->Full) candidate, from seat
    tier, ARR potential, adoption breadth, usage volume, growth trend,
    and paywall friction.
  - Risk: how likely to disengage, from declining trend, recency of last
    activity, and thin adoption breadth.

See docs/superpowers/specs/2026-09-04-client-health-scoring-design.md for
the full design and the reasoning behind each signal (and which signals
were considered and excluded).

Reuses marketplace/scripts/mp_report.py (license fetch + tier parsing),
marketplace/scripts/mp_pricing.py (Full-plan band pricing), and
mixpanel/scripts/mp_query.py (JQL runner) rather than re-implementing
auth, pagination, or pricing math.

Scope: Lite only, active tenants only (macro_viewed > 0 in the 90-day
window). See the design doc for why.
"""
import argparse, datetime, json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "..", "marketplace", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "..", "mixpanel", "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp_report    # noqa: E402
import mp_pricing   # noqa: E402
import mp_query      # noqa: E402
import percentile    # noqa: E402


# ----- Marketplace: seat tier + ARR potential -----------------------------
def fetch_lite_licenses(auth):
    lic, _ = mp_report.load("lite", auth, with_tx=False)
    return lic


def build_fleet_from_licenses(lic):
    """domain -> {cloud_id, seat_tier, company}. Skips records with no
    hostname or an unparseable tier (`mp_report._tier_users` returns None
    for those, e.g. non-numeric tiers) rather than crashing on one bad
    record."""
    fleet = {}
    for r in lic:
        host = r.get("cloudSiteHostname") or ""
        domain = host.split(".")[0]
        if not domain:
            continue
        tier = mp_report._tier_users(r.get("tier"))
        if tier is None:
            continue
        fleet[domain] = {
            "cloud_id": r.get("cloudId"),
            "seat_tier": tier,
            "company": mp_report.company_of(r),
        }
    return fleet


def arr_monthly(seat_tier):
    """Full-plan monthly list price for this seat tier. Uses the banded
    list price only (mp_pricing.monthly_list_price) — deliberately not
    net-to-vendor, so this stays insulated from the Atlassian take-rate
    caveat documented in the marketplace skill."""
    return mp_pricing.monthly_list_price(seat_tier)


if __name__ == "__main__":
    pass  # CLI entrypoint added in Task 5
