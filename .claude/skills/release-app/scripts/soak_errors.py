#!/usr/bin/env python3
"""Full's soak check: did Lite's errors grow since the Lite release?

Window: from the Lite release's publishedAt (--since) to now. Baseline: the
same clock window 7 and 14 days earlier for growth, 7..28 days earlier for
new signatures (same weekday and hours, so daily and weekly cycles cancel). Counts Lite (`product_type=lite`)
error events from real tenants, grouped by the error radar's signature and
weighted by 1/sample_rate, exactly as the radar does.

BLOCK when either is true:
  - all errors together > TOTAL_RATIO x the baseline median and >= TOTAL_MIN_DELTA above it;
  - one signature on >= MIN_TENANTS tenants is new, or spikes by the radar's
    ratio and delta.

Prints one line starting `OK:` or `BLOCK:` (no tenant names) and exits 0 / 1.
Exits 2 when Mixpanel cannot be queried; the caller treats that as BLOCK.
"""
import argparse
import datetime as dt
import json
import os
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../error-radar/scripts"))
import radar  # noqa: E402

BASELINE_WEEKS = 4   # a signature absent from all of these weeks is new
GROWTH_WEEKS = 2     # growth compares with these most recent weeks only: Lite's
                     # error volume fell week on week in 2026-11 (sampling, fixes),
                     # so older weeks would hide a return to the old level
TOTAL_RATIO = 1.5
TOTAL_MIN_DELTA = 100
# Per signature, stricter than the radar's daily thresholds: an 8-hour window is
# small, and a backtest of 13 Lite releases (2026-11-19..25) with the radar's
# NEW_MIN_TENANTS=2 blocked 9 of them, mostly on one tenant's network errors.
# A release-wide regression shows up on several tenants.
MIN_TENANTS = 3
NEW_MIN_EVENTS = 20
MAX_LISTED = 5


def parse_time(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def windows(since, now):
    """[(start_ms, end_ms)]: index 0 is the soak window, 1..N the weeks before it."""
    out = []
    for week in range(BASELINE_WEEKS + 1):
        shift = dt.timedelta(weeks=week)
        out.append((int((since - shift).timestamp() * 1000), int((now - shift).timestamp() * 1000)))
    return out


def jql_script(variant, wins):
    with open(os.path.join(radar.HERE, "signature.js")) as f:
        signature_js = f.read().split("if (typeof module")[0]
    first = dt.datetime.fromtimestamp(wins[-1][0] / 1000, dt.timezone.utc).date() - dt.timedelta(days=1)
    last = dt.datetime.fromtimestamp(wins[0][1] / 1000, dt.timezone.utc).date() + dt.timedelta(days=1)
    return signature_js + f"""
var INTERNAL = {json.dumps(radar.INTERNAL_DOMAINS)};
var WINDOWS = {json.dumps(wins)};
function domainOf(e) {{ return e.properties.client_domain || '(none)'; }}
function isInternal(d) {{
  for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true;
  return false;
}}
function windowOf(e) {{
  for (var i = 0; i < WINDOWS.length; i++) if (e.time >= WINDOWS[i][0] && e.time < WINDOWS[i][1]) return i;
  return -1;
}}
function main() {{
  return Events({{ from_date: '{first.isoformat()}', to_date: '{last.isoformat()}' }})
    .filter(function (e) {{
      return e.properties.product_type === {json.dumps(variant)} && windowOf(e) >= 0
        && radarIsErrorEvent(e.name, e.properties) && !isInternal(domainOf(e));
    }})
    .groupBy([windowOf, function (e) {{ return radarSignature(e.name, e.properties); }}, domainOf],
      mixpanel.reducer.numeric_summary(function (e) {{ return 1 / (Number(e.properties.sample_rate) || 1); }}));
}}
"""


def aggregate(rows):
    """-> total[(win, sig)], raw[(win, sig)], tenants[(win, sig)] = set of real tenants."""
    total, raw, tenants = defaultdict(float), defaultdict(float), defaultdict(set)
    for row in rows:
        win, sig, tenant = row["key"]
        value = row["value"]
        total[(win, sig)] += value["sum"]
        raw[(win, sig)] += value["count"]
        if tenant not in radar.NO_TENANT:
            tenants[(win, sig)].add(tenant)
    return total, raw, tenants


def decide(rows):
    """(blocked, summary, findings) for rows keyed [window, signature, tenant]."""
    total, raw, tenants = aggregate(rows)
    weeks = range(1, GROWTH_WEEKS + 1)
    now_total = sum(n for (w, _), n in total.items() if w == 0)
    base_totals = [sum(n for (w, _), n in total.items() if w == week) for week in weeks]
    base_median = statistics.median(base_totals)
    findings = []
    if now_total > TOTAL_RATIO * max(base_median, 1.0) and now_total - base_median >= TOTAL_MIN_DELTA:
        findings.append(f"all errors {now_total:.0f} vs median {base_median:.0f}")

    for sig in sorted({s for (w, s) in total if w == 0}, key=lambda s: -total[(0, s)]):
        count, received, n_tenants = total[(0, sig)], raw[(0, sig)], len(tenants[(0, sig)])
        history = [total.get((week, sig), 0.0) for week in weeks]
        if not any(total.get((week, sig)) for week in range(1, BASELINE_WEEKS + 1)):
            if received >= radar.NEW_MIN_RAW and n_tenants >= MIN_TENANTS and count >= NEW_MIN_EVENTS:
                findings.append(f"new `{sig}` {count:.0f} events, {n_tenants} tenants")
            continue
        median = statistics.median(history)
        if (received >= radar.MIN_RAW and n_tenants >= MIN_TENANTS and count > radar.SPIKE_RATIO * max(median, 1.0)
                and count - median >= radar.SPIKE_MIN_DELTA):
            findings.append(f"spike `{sig}` {count:.0f} vs median {median:.0f}, {n_tenants} tenants")

    summary = f"{now_total:.0f} errors in the soak window, baseline median {base_median:.0f} (weeks: {', '.join(f'{n:.0f}' for n in base_totals)})"
    return bool(findings), summary, findings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", required=True, help="soak start, ISO 8601 (the Lite release's publishedAt)")
    ap.add_argument("--now", help="soak end, ISO 8601 (default: now)")
    ap.add_argument("--variant", default="lite", help="product_type to check (default: lite)")
    ap.add_argument("--input", help="read Mixpanel rows from this file instead of querying")
    args = ap.parse_args(argv)
    since = parse_time(args.since)
    now = parse_time(args.now) if args.now else dt.datetime.now(dt.timezone.utc)

    try:
        if args.input:
            with open(args.input) as f:
                rows = json.load(f)
        else:
            rows = radar.run_jql(jql_script(args.variant, windows(since, now)))
    except (Exception, SystemExit) as e:  # noqa: BLE001 - any failure means "not checked"
        print(f"BLOCK: {args.variant} error check could not query Mixpanel: {e}")
        return 2

    hours = (now - since).total_seconds() / 3600
    blocked, summary, findings = decide(rows)
    if blocked:
        listed = "; ".join(findings[:MAX_LISTED]) + (f"; +{len(findings) - MAX_LISTED} more" if len(findings) > MAX_LISTED else "")
        print(f"BLOCK: {args.variant} errors grew during the {hours:.1f} h soak: {listed}. {summary}")
        return 1
    print(f"OK: no {args.variant} error growth in the {hours:.1f} h soak; {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
