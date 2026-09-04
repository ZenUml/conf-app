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


# ----- Mixpanel: usage volume, growth trend, recency, paywall friction ----
INTERNAL_DOMAINS = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev",
                     "dia-stg", "diagramly"]
VOLUME_EVENTS = ["macro_viewed", "macro_create_succeeded", "macro_save_succeeded",
                  "paywall_triggered", "paywall_blocked_create", "paywall_blocked_edit"]


def _domain_filter_js(internal_domains):
    """The JS filter body shared by both JQL scripts below: product_type
    must be 'lite', client_domain must be set and not start with any
    internal-domain prefix (mirrors the mixpanel skill's minimal exclude
    list — see reference_mixpanel_internal_filter)."""
    return f"""
    var p = e.properties;
    if (p.product_type !== 'lite') return false;
    var d = p.client_domain || '';
    if (!d) return false;
    for (var i = 0; i < internal.length; i++) {{
      if (d.indexOf(internal[i]) === 0) return false;
    }}
    return true;
"""


def build_volume_query(days=90, today=None):
    today = today or datetime.date.today()
    from_date = today - datetime.timedelta(days=days)
    return f"""
function main() {{
  var internal = {json.dumps(INTERNAL_DOMAINS)};
  var events = {json.dumps(VOLUME_EVENTS)};
  return Events({{
    from_date: '{from_date.isoformat()}', to_date: '{today.isoformat()}',
    event_selectors: events.map(function(n){{ return {{event: n}}; }})
  }})
  .filter(function(e){{{_domain_filter_js(INTERNAL_DOMAINS)}}})
  .groupBy([
    function(e){{ return e.properties.client_domain; }},
    function(e){{ return new Date(e.time).toISOString().slice(0,10); }},
    'name'
  ], mixpanel.reducer.count());
}}
"""


def parse_volume_rows(rows, today=None):
    today = today or datetime.date.today()
    recent_cut = today - datetime.timedelta(days=29)     # last 30 days: [today-29, today]
    prior_start = today - datetime.timedelta(days=59)     # prior 30 days: [today-59, today-30]
    prior_end = today - datetime.timedelta(days=30)
    paywall_events = {"paywall_triggered", "paywall_blocked_create", "paywall_blocked_edit"}

    per_domain = defaultdict(lambda: {
        "usage_volume": 0, "paywall_friction": 0,
        "recent_views": 0, "prior_views": 0, "last_event_date": None,
    })
    for row in rows:
        domain, date_str, event_name = row["key"]
        count = row["value"]
        d = per_domain[domain]
        date = datetime.date.fromisoformat(date_str)
        if event_name == "macro_viewed":
            d["usage_volume"] += count
            if date >= recent_cut:
                d["recent_views"] += count
            elif prior_start <= date <= prior_end:
                d["prior_views"] += count
        if event_name in paywall_events:
            d["paywall_friction"] += count
        if count > 0 and (d["last_event_date"] is None or date > d["last_event_date"]):
            d["last_event_date"] = date
    return dict(per_domain)


def build_creators_query(days=90, today=None):
    today = today or datetime.date.today()
    from_date = today - datetime.timedelta(days=days)
    return f"""
function main() {{
  var internal = {json.dumps(INTERNAL_DOMAINS)};
  return Events({{
    from_date: '{from_date.isoformat()}', to_date: '{today.isoformat()}',
    event_selectors: [{{event: 'macro_create_succeeded'}}]
  }})
  .filter(function(e){{{_domain_filter_js(INTERNAL_DOMAINS)}}})
  .groupBy([
    function(e){{ return e.properties.client_domain; }},
    function(e){{ return e.properties.user_account_id; }}
  ], mixpanel.reducer.count());
}}
"""


def parse_creators_rows(rows):
    per_domain = defaultdict(set)
    for row in rows:
        domain, user_id = row["key"]
        if user_id:
            per_domain[domain].add(user_id)
    return {domain: len(users) for domain, users in per_domain.items()}


def fetch_mixpanel_signals(api_secret, days=90):
    today = datetime.date.today()
    volume_rows = mp_query.run_jql(build_volume_query(days=days, today=today), api_secret, pace=5)
    creators_rows = mp_query.run_jql(build_creators_query(days=days, today=today), api_secret, pace=5)
    return parse_volume_rows(volume_rows, today=today), parse_creators_rows(creators_rows)


if __name__ == "__main__":
    pass  # CLI entrypoint added in Task 5
