#!/usr/bin/env python3
"""What a tenant pays, and what we actually receive.

Two numbers answer any pricing question, and they behave differently:

  LIST PRICE  — a cumulative per-user band table. Stable, but the bands are
                constants in this file, so `validate` re-checks them against
                real renewal transactions on every run.
  TAKE RATE   — Atlassian's cut. NOT a constant and never written down here:
                it moved 15% -> 20% -> 0% inside 19 months. `takerate` derives
                it from `vendorAmount / purchasePrice` in the transaction data.

Writing either number into prose is how a pricing answer goes wrong. On
2026-08-11 a reply quoted "Atlassian takes 25%, so ~$45.87/month net". No
transaction has ever settled at 75%. Ask this script instead.

Usage:
    python3 mp_pricing.py quote <users> [--annual]   # list price + net for a user tier
    python3 mp_pricing.py takerate [--months N]      # derive the take-rate timeline
    python3 mp_pricing.py validate [--months N]      # band table vs real renewals
    python3 mp_pricing.py tiers                      # the band table

Data source: the local snapshot at scripts/marketplace.db. Refresh it with
    python3 mp_report.py sync
"""

import argparse
import collections
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import urllib.request

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "marketplace.db")

FULL_ADDON = "com.zenuml.confluence-addon"

# Cumulative per-user-per-MONTH bands for the Full plan. Annual list = 10x
# monthly (Atlassian's cloud convention: two months free).
#   Verified 2026-08-11: 82 of 102 Full monthly renewals in the preceding two
#   months matched to the cent. The 20 that did not were all 1-3 user sites
#   settling a mid-cycle tier change pro rata, which is not a band question.
# Re-check with `validate` before quoting; if the match rate drops, Atlassian
# changed the price list and these constants are stale.
BANDS = [(100, 0.44), (250, 0.33), (1000, 0.11), (None, 0.05)]
FLAT_SMALL_TIER_USERS = 10
FLAT_SMALL_TIER_ANNUAL = 40.0

# Per space per year, flat, billed by us through Stripe (not the Marketplace),
# so no Atlassian take rate applies to it at all.
ENTERPRISE_BUNDLE_ANNUAL = 299.0


# Live published price list. The BANDS above are per-user-per-MONTH and annual is NOT
# 10x them: Atlassian bills annual at the FLAT price of the band containing the user
# count (801-1000, 2751-3000, ...). The two agree only AT a band boundary. Measured
# 2026-09-01 at 902 users: 10x gave $1,652.20, the published annual is $1,760.00 — 6.1%
# low. Same endpoint and same algorithm as
# .claude/skills/extend-space-license/scripts/grant_extension.py; keep them in step.
MARKETPLACE_PRICING_URL = (
    "https://marketplace.atlassian.com/rest/2/addons/"
    + FULL_ADDON + "/pricing/cloud/live"
)

_PRICING_CACHE = {}


def _pricing_payload():
    """One fetch per process. Raises if unreachable — a wrong price in a customer quote is
    worse than no quote, so there is no local fallback (same contract as grant_extension.py)."""
    if "data" not in _PRICING_CACHE:
        req = urllib.request.Request(MARKETPLACE_PRICING_URL,
                                     headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            _PRICING_CACHE["data"] = json.loads(r.read().decode("utf-8"))
    return _PRICING_CACHE["data"]


def live_list_price(users):
    """(monthly, annual) published list price for `users`, read from the Marketplace."""
    data = _pricing_payload()

    # unitCount == -1 is the "Unlimited users" sentinel, not a band. It sorts first and
    # would shift every band boundary by one user (902 users quoted 165.66, not 165.22).
    per_unit = sorted(
        (i for i in data.get("perUnitItems", [])
         if i.get("licenseType") == "COMMERCIAL" and i.get("unitCount", 0) > 0),
        key=lambda i: i["unitCount"],
    )
    annual_items = sorted(
        (i for i in data.get("items", [])
         if i.get("licenseType") == "COMMERCIAL" and i.get("monthsValid") == 12
         and i.get("unitCount", 0) > 0),
        key=lambda i: i["unitCount"],
    )
    if not per_unit or not annual_items:
        raise RuntimeError("Marketplace pricing payload missing perUnitItems/items")

    monthly, prev_top = 0.0, 0
    for item in per_unit:
        top = item["unitCount"]
        monthly += max(0, min(users, top) - prev_top) * item["amount"]
        prev_top = top
        if users <= top:
            break
    else:
        monthly += max(0, users - prev_top) * per_unit[-1]["amount"]

    band = next((i for i in annual_items if i["unitCount"] >= users), annual_items[-1])
    annual = band["amount"]

    # Below the first per-unit band the app is flat-rated; the annual band price is
    # authoritative and the monthly one is derived from it.
    if users <= FLAT_SMALL_TIER_USERS:
        monthly = annual / 12.0
    return monthly, annual


def monthly_list_price(users):
    """Cumulative band price, USD per month."""
    if users <= FLAT_SMALL_TIER_USERS:
        return FLAT_SMALL_TIER_ANNUAL / 10
    total, lower = 0.0, 0
    for upper, rate in BANDS:
        if upper is None:
            total += max(0, users - lower) * rate
            break
        total += max(0, min(users, upper) - lower) * rate
        lower = upper
    return total


def band_breakdown(users):
    """[(label, count, rate, subtotal)] for the bands a tier spans."""
    if users <= FLAT_SMALL_TIER_USERS:
        return [("1-{} (flat)".format(FLAT_SMALL_TIER_USERS), users, None,
                 FLAT_SMALL_TIER_ANNUAL / 10)]
    out, lower = [], 0
    for upper, rate in BANDS:
        n = max(0, users - lower) if upper is None else max(0, min(users, upper) - lower)
        if n:
            label = "{}+".format(lower + 1) if upper is None else "{}-{}".format(lower + 1, upper)
            out.append((label, n, rate, n * rate))
        if upper is None or users <= upper:
            break
        lower = upper
    return out


# --------------------------------------------------------------------------
# Transaction data
# --------------------------------------------------------------------------

def load_transactions():
    if not os.path.exists(DB):
        raise SystemExit(
            "No snapshot at {}.\nRun: python3 mp_report.py sync".format(DB))
    db = sqlite3.connect(DB)
    rows = []
    for (raw,) in db.execute("SELECT raw FROM transactions"):
        rows.append(json.loads(raw))
    try:
        stamp = db.execute("SELECT * FROM sync_meta").fetchone()
    except sqlite3.Error:
        stamp = None
    return rows, stamp


def snapshot_age_note(stamp):
    if not stamp:
        return "snapshot age unknown"
    return "snapshot: {}".format(" ".join(str(x) for x in stamp))


def take_rate_timeline(months):
    """Observed vendorAmount/purchasePrice by month. Never hardcoded."""
    rows, stamp = load_transactions()
    cutoff = (dt.date.today() - dt.timedelta(days=31 * months)).isoformat()
    by_month = collections.defaultdict(lambda: {"n": 0, "gross": 0.0, "net": 0.0, "zero": 0})
    for t in rows:
        p = t.get("purchaseDetails", {})
        gp, va, d = p.get("purchasePrice"), p.get("vendorAmount"), p.get("saleDate", "")
        if gp is None or va is None or not d or gp <= 0 or d < cutoff:
            continue
        b = by_month[d[:7]]
        b["n"] += 1
        b["gross"] += gp
        b["net"] += va
        if abs(gp - va) < 0.005:
            b["zero"] += 1
    return by_month, stamp


def current_take_rate(days=30):
    """The rate a NEW transaction settles at today.

    Uses the most common per-transaction ratio over the window, not a
    gross-weighted average. During a cutover the two coexist, and averaging
    them invents a rate that no transaction ever settled at (2026-08 blends
    18 zero-cut and 2 residual 80% txns into a fictional 98.6%).
    """
    rows, _ = load_transactions()
    cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    ratios = []
    for t in rows:
        p = t.get("purchaseDetails", {})
        gp, va, d = p.get("purchasePrice"), p.get("vendorAmount"), p.get("saleDate", "")
        if gp is None or va is None or not d or gp <= 0 or d < cutoff:
            continue
        ratios.append((round(va / gp, 2), d))
    if not ratios:
        return None, None, 0, 0
    counts = collections.Counter(r for r, _ in ratios)
    share, n = counts.most_common(1)[0]
    latest = max(d for _, d in ratios)
    return share, latest, n, len(ratios)


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def cmd_quote(args):
    users = args.users
    band_monthly = monthly_list_price(users)
    monthly, annual = live_list_price(users)
    share, latest, n_mode, n_total = current_take_rate()

    print("user tier      : {}".format(users))
    print()
    for label, n, rate, sub in band_breakdown(users):
        rate_s = "flat" if rate is None else "${:.2f}/user".format(rate)
        print("  band {:<10} {:>6} x {:<12} = ${:>8.2f}".format(label, n, rate_s, sub))
    print("  " + " " * 32 + "-" * 12)
    print("  monthly list price{:>22}${:>8.2f}".format("", monthly))
    print()
    print("monthly billing: ${:,.2f}/month  (${:,.2f}/year)".format(monthly, monthly * 12))
    print("annual billing : ${:,.2f}/year   (published flat price of the band containing"
          .format(annual))
    print("                 {} users, NOT 10 x monthly — those agree only at a band"
          .format(users))
    print("                 boundary)")
    # Below FLAT_SMALL_TIER_USERS the local constant is annual/10 while the Marketplace
    # bills annual/12, so the two differ by construction there — comparing would fire a
    # false staleness warning on every small-tier quote.
    if users > FLAT_SMALL_TIER_USERS and abs(band_monthly - monthly) >= 0.01:
        print()
        print("NOTE: the local BANDS table gives ${:,.2f}/month, the Marketplace ${:,.2f}."
              .format(band_monthly, monthly))
        print("      Atlassian changed the price list — re-run `validate` and update BANDS.")

    print()
    if share is None:
        print("net to vendor  : unknown — no transactions in the last 30 days")
    else:
        cut = (1 - share) * 100
        print("net to vendor  : ${:,.2f}/month   Atlassian cut {:.0f}%".format(
            monthly * share, cut))
        print("                 {} of {} transactions in the last 30 days settled at".format(
            n_mode, n_total))
        print("                 this rate (latest {}). Derived, not a constant.".format(latest))
        if n_total > n_mode:
            print("                 The other {} settled at a different rate — transactions".format(
                n_total - n_mode))
            print("                 dated before a rate change keep arriving for weeks.")
        if cut < 0.5:
            print("                 The cut is currently ZERO. Treat that as temporary and")
            print("                 re-run `takerate` before quoting a net figure again.")

    print()
    print("Enterprise Bundle alternative: ${:,.0f}/space/year, unlimited macros and".format(
        ENTERPRISE_BUNDLE_ANNUAL))
    print("users in that ONE space, billed by us through Stripe (no Atlassian cut).")
    print("Below {} users the Full plan costs less per year than a single Bundle;".format(
        _bundle_breakeven()))
    print("above it, a Bundle is cheaper when only one space is over the limit.")
    return 0


def _bundle_breakeven():
    """User tier at which annual Full list price passes the single-space Bundle."""
    n = 1
    while n < 20000:
        if live_list_price(n)[1] >= ENTERPRISE_BUNDLE_ANNUAL:
            return n
        n += 1
    return float("nan")


def cmd_takerate(args):
    by_month, stamp = take_rate_timeline(args.months)
    if not by_month:
        print("No transactions in the window.")
        return 1
    print(snapshot_age_note(stamp))
    print()
    print("{:<9}{:>6}{:>8}{:>12}{:>12}{:>10}".format(
        "month", "txns", "zero", "gross", "net", "vendor%"))
    print("-" * 57)
    prev = None
    for m in sorted(by_month):
        b = by_month[m]
        share = b["net"] / b["gross"] if b["gross"] else 0
        mark = ""
        if prev is not None and abs(share - prev) > 0.005:
            mark = "  <- rate changed"
        prev = share
        print("{:<9}{:>6}{:>8}{:>12,.2f}{:>12,.2f}{:>9.1f}%{}".format(
            m, b["n"], b["zero"], b["gross"], b["net"], share * 100, mark))
    print()
    print("`zero` counts transactions that settled with no cut at all.")
    print("A month with a mixed rate is a cutover month: transactions dated before")
    print("the change keep settling at the old rate for a few weeks after it.")
    return 0


def cmd_validate(args):
    rows, stamp = load_transactions()
    cutoff = (dt.date.today() - dt.timedelta(days=31 * args.months)).isoformat()
    checked = []
    for t in rows:
        if t.get("addonKey") != FULL_ADDON:
            continue
        p = t.get("purchaseDetails", {})
        if p.get("billingPeriod") != "Monthly" or p.get("licenseType") != "COMMERCIAL":
            continue
        if p.get("saleType") != "Renewal":
            continue
        d = p.get("saleDate", "")
        if not d or d < cutoff:
            continue
        m = re.search(r"\((\d+)\s*Users?\)", p.get("tier", "") or "")
        gp = p.get("purchasePrice")
        if not m or not gp or gp <= 0:
            continue
        n = int(m.group(1))
        checked.append((n, gp, monthly_list_price(n), d))

    if not checked:
        print("No Full monthly renewals in the window. Widen --months or run `mp_report.py sync`.")
        return 1

    checked.sort()
    match = [r for r in checked if abs(r[1] - r[2]) < 0.02]
    miss = [r for r in checked if abs(r[1] - r[2]) >= 0.02]
    rate = len(match) / len(checked) * 100

    print(snapshot_age_note(stamp))
    print("Full monthly renewals checked: {}".format(len(checked)))
    print("matched the band table to the cent: {} ({:.0f}%)".format(len(match), rate))
    print()
    if miss:
        print("{:>6}{:>10}{:>10}{:>9}  date".format("users", "actual", "model", "diff"))
        print("-" * 44)
        for n, actual, model, d in miss[:20]:
            print("{:>6}{:>10.2f}{:>10.2f}{:>9.2f}  {}".format(n, actual, model, actual - model, d))
        small = [r for r in miss if r[0] <= 10]
        print()
        print("{} of {} mismatches are <=10-user sites settling a mid-cycle tier".format(
            len(small), len(miss)))
        print("change pro rata. Those are not evidence the bands are wrong.")
    print()
    if rate >= 75:
        print("VERDICT: band table holds. Safe to quote.")
        return 0
    print("VERDICT: band table does NOT hold. Atlassian likely changed the price")
    print("list. Re-derive the bands from recent renewals before quoting anything.")
    return 1


def cmd_tiers(args):
    print("Full plan — cumulative per-user bands, USD per user per MONTH")
    print()
    lower = 0
    for upper, rate in BANDS:
        label = "{}+".format(lower + 1) if upper is None else "{}-{}".format(lower + 1, upper)
        print("  {:<12} ${:.2f}".format(label, rate))
        if upper is None:
            break
        lower = upper
    print()
    print("  1-{} users: flat ${:.0f}/year (${:.2f}/month)".format(
        FLAT_SMALL_TIER_USERS, FLAT_SMALL_TIER_ANNUAL, FLAT_SMALL_TIER_ANNUAL / 10))
    print("  annual list price = 10 x monthly")
    print()
    print("Enterprise Bundle: ${:.0f}/space/year, flat, our own Stripe billing.".format(
        ENTERPRISE_BUNDLE_ANNUAL))
    print()
    print("These constants can go stale. Run `validate` to check them against")
    print("real renewals before quoting.")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("quote"); p.add_argument("users", type=int); p.set_defaults(fn=cmd_quote)
    p = sub.add_parser("takerate"); p.add_argument("--months", type=int, default=20); p.set_defaults(fn=cmd_takerate)
    p = sub.add_parser("validate"); p.add_argument("--months", type=int, default=2); p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("tiers"); p.set_defaults(fn=cmd_tiers)

    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
