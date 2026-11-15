#!/usr/bin/env python3
"""Month-end projection of billable Mixpanel events against the plan allowance.

Usage (from the conf-app root, so .env.mixpanel is found):
    python3 mp_quota.py                         # current UTC month
    python3 mp_quota.py --event title_draft_requested
    python3 mp_quota.py --month 2026-11 --cap 1000000 --top 20 --json

Billable = every event whose name does not start with `$` (see
docs/ops/mixpanel-quota-check.md). The numbers are an estimate from event data;
the exact counter is Settings > Org > Plan Details & Billing > Data Usage.

The projection uses the mean of the last `--window` complete days, split by
weekday and weekend, because weekend volume is about a fifth of a weekday's.
The newest day in the data is treated as partial and replaced by a full day of
its type.
"""

import argparse
import calendar
import datetime as dt
import json
import sys

from mp_query import load_api_secret, run_jql

OVERAGE_USD_PER_1000 = 0.28

JQL = """
function main() {
  return Events({from_date: '%(start)s', to_date: '%(end)s'})
    .filter(function (e) { return e.name.charAt(0) !== '$'; })
    .groupBy(
      [function (e) { return new Date(e.time).toISOString().slice(0, 10); }, 'name'],
      [mixpanel.reducer.count(),
       mixpanel.reducer.sum(function (e) { return 1 / (Number(e.properties.sample_rate) || 1); })]);
}
"""


def is_weekend(day):
    return day.weekday() >= 5


def project(daily, month_end, window=7):
    """Project the month total from complete daily counts.

    daily: {date: billable count}, including the newest (partial) day.
    Returns a dict with the pieces of the estimate.
    """
    days = sorted(daily)
    if len(days) < 2:
        raise ValueError("need at least one complete day and one partial day")
    partial, complete = days[-1], days[:-1]
    recent = complete[-window:]

    def mean(want_weekend):
        pool = [daily[d] for d in recent if is_weekend(d) == want_weekend]
        if not pool:  # no such day in the window: fall back to the whole month
            pool = [daily[d] for d in complete if is_weekend(d) == want_weekend]
        return sum(pool) / len(pool) if pool else None

    weekday_mean, weekend_mean = mean(False), mean(True)
    # A month with no complete weekend (or weekday) yet borrows the other rate.
    if weekday_mean is None:
        weekday_mean = weekend_mean
    if weekend_mean is None:
        weekend_mean = weekday_mean

    used = sum(daily[d] for d in complete)
    remaining = [partial + dt.timedelta(days=i) for i in range((month_end - partial).days + 1)]
    rest = sum(weekend_mean if is_weekend(d) else weekday_mean for d in remaining)
    return {
        "used_complete_days": used,
        "last_complete_day": complete[-1].isoformat(),
        "weekday_mean": round(weekday_mean),
        "weekend_mean": round(weekend_mean),
        "remaining_weekdays": sum(1 for d in remaining if not is_weekend(d)),
        "remaining_weekend_days": sum(1 for d in remaining if is_weekend(d)),
        "projected_total": round(used + rest),
    }


def fetch(month, today):
    start = dt.date(month.year, month.month, 1)
    end = min(today, dt.date(month.year, month.month, calendar.monthrange(month.year, month.month)[1]))
    rows = run_jql(JQL % {"start": start, "end": end}, load_api_secret(), pace=0)
    out = []
    for r in rows:
        day = dt.date.fromisoformat(r["key"][0])
        if day.month == month.month and day.year == month.year:
            out.append((day, r["key"][1], r["value"][0], r["value"][1]))
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--month", help="YYYY-MM (default: current UTC month)")
    p.add_argument("--cap", type=int, default=1_000_000, help="monthly allowance (default 1,000,000)")
    p.add_argument("--top", type=int, default=15, help="top events to list (default 15)")
    p.add_argument("--window", type=int, default=7, help="complete days used for the run rate (default 7)")
    p.add_argument("--event", help="also show this event per day: raw count and count / sample_rate")
    p.add_argument("--json", action="store_true", help="print JSON instead of tables")
    a = p.parse_args()

    today = dt.datetime.now(dt.timezone.utc).date()
    month = dt.date.fromisoformat(a.month + "-01") if a.month else today.replace(day=1)
    month_end = dt.date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])
    rows = fetch(month, today)

    daily, by_event, focus = {}, {}, {}
    for day, name, count, extrapolated in rows:
        daily[day] = daily.get(day, 0) + count
        if name == a.event:
            focus[day] = (count, round(extrapolated))
    days = sorted(daily)
    recent = set(days[:-1][-a.window:])
    for day, name, count, _ in rows:
        if day in recent:
            by_event[name] = by_event.get(name, 0) + count
    recent_total = sum(by_event.values()) or 1
    top = sorted(by_event.items(), key=lambda kv: -kv[1])[: a.top]

    est = project(daily, month_end, a.window)
    over = est["projected_total"] - a.cap
    est.update(cap=a.cap, over_by=over, overage_usd=round(max(over, 0) / 1000 * OVERAGE_USD_PER_1000, 2))

    if a.json:
        print(json.dumps({
            "estimate": est,
            "daily": {d.isoformat(): daily[d] for d in days},
            "top_events_recent_window": top,
            "event": {d.isoformat(): v for d, v in sorted(focus.items())},
        }, indent=2))
        return

    print(f"Billable events, {month:%Y-%m} (names not starting with $). Newest day is partial.")
    for d in days:
        extra = ""
        if a.event:
            raw, ext = focus.get(d, (0, 0))
            extra = f"   {a.event}: {raw:>7,} raw  {ext:>7,} / sample_rate"
        print(f"  {d} {d:%a} {daily[d]:>9,}{extra}")
    print()
    print(f"Used to {est['last_complete_day']}: {est['used_complete_days']:,} ({est['used_complete_days'] / a.cap:.0%} of {a.cap:,})")
    print(f"Run rate (last {a.window} complete days): weekday {est['weekday_mean']:,}, weekend {est['weekend_mean']:,}")
    print(f"Remaining: {est['remaining_weekdays']} weekdays, {est['remaining_weekend_days']} weekend days (newest day counted in full)")
    verdict = f"OVER by {over:,} (about ${est['overage_usd']})" if over > 0 else f"under by {-over:,}"
    print(f"Projected month total: {est['projected_total']:,} -> {verdict}")
    print()
    print(f"Top events, last {a.window} complete days:")
    for name, count in top:
        print(f"  {count:>9,}  {count / recent_total:>5.1%}  {name}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # keep the secret out of tracebacks
        print(f"mp_quota: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
