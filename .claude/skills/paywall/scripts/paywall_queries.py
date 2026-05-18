#!/usr/bin/env python3
"""
Run the paywall daily-monitoring Mixpanel queries.

Usage:
    paywall_queries.py daily [--window-days N]
        Run Q1 (paywall_triggered), Q3 (advocacy_message_copied),
        Q4 (macro_save_succeeded, macro_save_failed,
        paywall_continued_editing, macro_create_succeeded) — all
        broken down by client_domain. (Q2/upgrade_modal_shown removed
        2026-05-12: it duplicated paywall_triggered 1:1 in practice.)

    paywall_queries.py per-space <domain> [--window-days N]
        Run Q5 for a SINGLE domain: paywall_triggered, macro_save_succeeded,
        macro_create_succeeded, paywall_continued_editing — filtered to
        <domain>, broken down by confluence_space.

    paywall_queries.py per-space-all --domains D1 D2 ... [--window-days N]
        Run Q5 for ALL listed CSS domains in ONE batch (4 JQL calls instead
        of N×4 segmentation calls). Faster than calling per-space N times.
        Output: {event: {domain: {space: count}}}

    paywall_queries.py ab-metrics [--window-days N]
        A/B analysis: macro_save_succeeded (total + unique), macro_viewed
        (total + unique), paywall_triggered (total) — all by client_domain.
        Replaces the two slow MCP unique-user queries. Default window: 7 days.
        Output keys: macro_save_succeeded, paywall_triggered, macro_viewed,
                     macro_save_succeeded__unique, macro_viewed__unique

Window defaults to last 1 day (except ab-metrics: 7 days). Measurement
defaults to `total` (segmentation API). `--measurement unique` on daily/
per-space uses JQL for true period-unique semantics.

Output is JSON to stdout:
    {"<event_name>": {"<breakdown_value>": <count>, ...}, ...}

Auth: reads API_Secret from <project_root>/.env.mixpanel.

Why this exists (read before "improving"): the Mixpanel Insights
filter shape is easy to get wrong (filters: [...] plural vs filter:
{...} singular) — wrong shape silently returns global totals. The
Insights filter shape change burned a previous run badly enough to
warrant a CRITICAL note in the skill. Centralising payload
construction here removes the footgun and saves ~12 hand-built JSON
payloads per daily run.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MIXPANEL_SEGMENTATION_URL = "https://mixpanel.com/api/2.0/segmentation/"
MIXPANEL_JQL_URL = "https://mixpanel.com/api/2.0/jql"
PROJECT_ROOT = Path(__file__).resolve().parents[4]  # conf-app project root


def load_api_secret() -> str:
    env_path = PROJECT_ROOT / ".env.mixpanel"
    if not env_path.exists():
        sys.exit(f"error: {env_path} not found")
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == "API_Secret":
            return v.strip().strip('"').strip("'")
    sys.exit("error: API_Secret not found in .env.mixpanel")


def _basic_auth(secret: str) -> str:
    return "Basic " + base64.b64encode(f"{secret}:".encode()).decode()


def _open_with_retry(
    req: urllib.request.Request,
    timeout: int,
    delays: list[float] | None = None,
) -> bytes:
    """Open with exponential backoff on 429.

    Segmentation calls use short delays (default: [2, 5, 12]s).
    JQL calls pass longer delays ([10, 30, 60]s) because the JQL endpoint
    has a stricter per-minute rate limit and callers can exhaust it quickly
    after a heavy daily run.
    """
    if delays is None:
        delays = [2.0, 5.0, 12.0]
    last_err: Exception | None = None
    for attempt, delay in enumerate([0.0, *delays]):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < len(delays):
                wait = delays[attempt] if attempt < len(delays) else delays[-1]
                print(
                    f"[rate-limit] 429 on attempt {attempt + 1}/{len(delays) + 1},"
                    f" retrying in {wait:.0f}s …",
                    file=sys.stderr,
                )
                last_err = e
                continue
            if e.code == 429:
                print(
                    "error: Mixpanel API rate limit exhausted (hourly quota)."
                    " Wait ~60 min or run again after the top of the next UTC hour.",
                    file=sys.stderr,
                )
            raise
    assert last_err is not None
    raise last_err


def call_segmentation(
    secret: str,
    event: str,
    from_date: str,
    to_date: str,
    on: str | None = None,
    where: str | None = None,
) -> dict[str, int]:
    """Event totals (segmentation type=general) returning {breakdown: count}."""
    params: dict[str, str] = {
        "event": event,
        "from_date": from_date,
        "to_date": to_date,
        "type": "general",
        "unit": "day",
    }
    if on:
        params["on"] = on
    if where:
        params["where"] = where
    url = MIXPANEL_SEGMENTATION_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": _basic_auth(secret)})
    payload = json.loads(_open_with_retry(req, timeout=60).decode())
    values = (payload.get("data") or {}).get("values") or {}
    return {bucket: sum(by_day.values()) for bucket, by_day in values.items()}


# JQL is used for `unique` because the segmentation API's type=unique returns
# *per-day* uniques. Summing those over-counts users active on multiple days,
# which doesn't match what the Insights UI / MCP reports for a multi-day
# window. JQL's groupByUser folds events to one row per user first, then
# groupBy counts users per breakdown — true period-unique semantics.
_JQL_UNIQUE_SCRIPT = """
function main() {
  var script = Events({
    from_date: params.from_date,
    to_date: params.to_date,
    event_selectors: [{event: params.event}]
  });
  if (params.where_domain) {
    script = script.filter(function(ev) {
      return ev.properties.client_domain === params.where_domain;
    });
  }
  return script
    .groupByUser([params.on_property], mixpanel.reducer.null())
    .groupBy(["key.1"], mixpanel.reducer.count());
}
"""

# JQL for per-space-all: groups by (client_domain, confluence_space) in one
# query for a list of domains. Replaces N×4 segmentation calls with 4 JQL
# calls — one per event, all domains in parallel.
_JQL_PER_SPACE_ALL = """
function main() {
  return Events({
    from_date: params.from_date,
    to_date: params.to_date,
    event_selectors: [{event: params.event}]
  })
  .filter(function(ev) {
    return params.domains.indexOf(ev.properties.client_domain) !== -1;
  })
  .groupBy(
    ["properties.client_domain", "properties.confluence_space"],
    mixpanel.reducer.count()
  );
}
"""

# JQL for ab-metrics unique users: true period-unique count per client_domain.
_JQL_UNIQUE_BY_DOMAIN = """
function main() {
  return Events({
    from_date: params.from_date,
    to_date: params.to_date,
    event_selectors: [{event: params.event}]
  })
  .groupByUser(["properties.client_domain"], mixpanel.reducer.null())
  .groupBy(["key.1"], mixpanel.reducer.count());
}
"""


def call_jql_unique(
    secret: str,
    event: str,
    from_date: str,
    to_date: str,
    on_property: str,
    where_domain: str | None = None,
) -> dict[str, int]:
    """True period-unique users per breakdown, via JQL.

    on_property is a dotted JQL path like "properties.client_domain".
    where_domain optionally restricts to one client_domain (for per-space mode).
    """
    params = {
        "from_date": from_date,
        "to_date": to_date,
        "event": event,
        "on_property": on_property,
        "where_domain": where_domain,
    }
    body = urllib.parse.urlencode(
        {"script": _JQL_UNIQUE_SCRIPT, "params": json.dumps(params)}
    ).encode()
    req = urllib.request.Request(
        MIXPANEL_JQL_URL,
        data=body,
        headers={
            "Authorization": _basic_auth(secret),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    rows = json.loads(_open_with_retry(req, timeout=120, delays=[10.0, 30.0, 60.0]).decode())
    return {(r["key"][0] if r["key"] else "<null>"): r["value"] for r in rows}


def call_jql_unique_by_domain(
    secret: str,
    event: str,
    from_date: str,
    to_date: str,
) -> dict[str, int]:
    """True period-unique users per client_domain, no domain filter.
    Used by ab-metrics for global unique-user breakdown.
    """
    params = {"from_date": from_date, "to_date": to_date, "event": event}
    body = urllib.parse.urlencode(
        {"script": _JQL_UNIQUE_BY_DOMAIN, "params": json.dumps(params)}
    ).encode()
    req = urllib.request.Request(
        MIXPANEL_JQL_URL,
        data=body,
        headers={
            "Authorization": _basic_auth(secret),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    rows = json.loads(_open_with_retry(req, timeout=120, delays=[10.0, 30.0, 60.0]).decode())
    return {(r["key"][0] if r["key"] else "<null>"): r["value"] for r in rows}


def call_jql_per_space_all(
    secret: str,
    event: str,
    from_date: str,
    to_date: str,
    domains: list[str],
) -> dict[str, dict[str, int]]:
    """Event totals grouped by (client_domain, confluence_space) for a list of
    domains in a single JQL call. Returns {domain: {space: count}}.
    """
    params = {
        "from_date": from_date,
        "to_date": to_date,
        "event": event,
        "domains": domains,
    }
    body = urllib.parse.urlencode(
        {"script": _JQL_PER_SPACE_ALL, "params": json.dumps(params)}
    ).encode()
    req = urllib.request.Request(
        MIXPANEL_JQL_URL,
        data=body,
        headers={
            "Authorization": _basic_auth(secret),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    rows = json.loads(_open_with_retry(req, timeout=120, delays=[10.0, 30.0, 60.0]).decode())
    result: dict[str, dict[str, int]] = {}
    for r in rows:
        domain = r["key"][0] or "<null>"
        space = r["key"][1] or "<null>"
        result.setdefault(domain, {})[space] = r["value"]
    return result


def call_event(
    secret: str,
    event: str,
    from_date: str,
    to_date: str,
    on_property: str,
    where_domain: str | None = None,
    measurement: str = "total",
) -> dict[str, int]:
    """Dispatch to segmentation (total) or JQL (unique) based on measurement."""
    if measurement == "total":
        on = f'properties["{on_property}"]'
        where = f'properties["client_domain"] == "{where_domain}"' if where_domain else None
        return call_segmentation(secret, event, from_date, to_date, on, where)
    if measurement == "unique":
        return call_jql_unique(
            secret, event, from_date, to_date, f"properties.{on_property}", where_domain
        )
    raise ValueError(f"unknown measurement: {measurement!r}")


def date_range(window_days: int) -> tuple[str, str]:
    # window_days=1 → today only (last ~24h rolling, includes partial day).
    # window_days=N → N days ending today inclusive.
    # Trade-off: Mixpanel ingestion lag is ~5-10min, so today's data is fresh
    # enough to monitor "as of now". Earlier behavior used yesterday-only,
    # which created a 24h blind spot for daily monitoring.
    today = dt.date.today()
    return (
        (today - dt.timedelta(days=window_days - 1)).isoformat(),
        today.isoformat(),
    )


DAILY_EVENTS = [
    "paywall_triggered",
    "advocacy_message_copied",
    "macro_save_succeeded",
    "macro_save_failed",
    "paywall_continued_editing",
    "macro_create_succeeded",
]

PER_SPACE_EVENTS = [
    "paywall_triggered",
    "macro_save_succeeded",
    "macro_create_succeeded",
    "paywall_continued_editing",
]

# Events for A/B analysis. Unique variants run via _JQL_UNIQUE_BY_DOMAIN.
AB_EVENTS_TOTAL = [
    "macro_save_succeeded",
    "paywall_triggered",
    "macro_viewed",
]
AB_EVENTS_UNIQUE = [
    "macro_save_succeeded",  # → macro_save_succeeded__unique (save_users)
    "macro_viewed",          # → macro_viewed__unique (view_users)
]


def run_daily(secret: str, window_days: int, measurement: str) -> dict[str, dict[str, int]]:
    from_date, to_date = date_range(window_days)
    results: dict[str, dict[str, int]] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(
                call_event, secret, e, from_date, to_date,
                "client_domain", None, measurement,
            ): e
            for e in DAILY_EVENTS
        }
        for fut in as_completed(futures):
            event = futures[fut]
            results[event] = fut.result()
    return results


def run_per_space(
    secret: str, domain: str, window_days: int, measurement: str
) -> dict[str, dict[str, int]]:
    from_date, to_date = date_range(window_days)
    results: dict[str, dict[str, int]] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(
                call_event, secret, e, from_date, to_date,
                "confluence_space", domain, measurement,
            ): e
            for e in PER_SPACE_EVENTS
        }
        for fut in as_completed(futures):
            event = futures[fut]
            results[event] = fut.result()
    return results


def run_per_space_all(
    secret: str, domains: list[str], window_days: int
) -> dict[str, dict[str, dict[str, int]]]:
    """Q5 for all domains in one parallel batch using the segmentation API.

    Runs all len(domains) × len(PER_SPACE_EVENTS) segmentation calls inside
    a single ThreadPoolExecutor, so wall time ≈ one slow call instead of
    N sequential batches. Returns {event: {domain: {space: count}}}.

    Uses segmentation API (not JQL) to avoid the JQL per-minute rate limit,
    which is easily exhausted when called right after a heavy daily run.
    """
    from_date, to_date = date_range(window_days)
    results: dict[str, dict[str, dict[str, int]]] = {e: {} for e in PER_SPACE_EVENTS}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures: dict = {}
        for domain in domains:
            for event in PER_SPACE_EVENTS:
                fut = pool.submit(
                    call_event, secret, event, from_date, to_date,
                    "confluence_space", domain, "total",
                )
                futures[fut] = (event, domain)
        for fut in as_completed(futures):
            event, domain = futures[fut]
            results[event][domain] = fut.result()
    return results


def run_ab_metrics(secret: str, window_days: int) -> dict[str, dict[str, int]]:
    """A/B analysis: saves/views/triggers totals + unique users by client_domain.

    Replaces two MCP unique-user queries with native JQL calls.
    Output keys: macro_save_succeeded, paywall_triggered, macro_viewed,
                 macro_save_succeeded__unique, macro_viewed__unique

    Segmentation (total) calls run in parallel; JQL (unique) calls are staggered
    to avoid rate limiting when called after a heavy daily run.
    """
    from_date, to_date = date_range(window_days)
    results: dict[str, dict[str, int]] = {}

    # Total counts — segmentation API is more permissive; run in parallel
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures: dict = {}
        for event in AB_EVENTS_TOTAL:
            fut = pool.submit(
                call_event, secret, event, from_date, to_date,
                "client_domain", None, "total",
            )
            futures[fut] = event
        for fut in as_completed(futures):
            results[futures[fut]] = fut.result()

    # Unique users via JQL — stagger to avoid rate limiting
    for i, event in enumerate(AB_EVENTS_UNIQUE):
        if i > 0:
            time.sleep(1.5)
        results[f"{event}__unique"] = call_jql_unique_by_domain(secret, event, from_date, to_date)

    return results



def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    daily = sub.add_parser("daily", help="Q1–Q4 daily monitoring queries")
    daily.add_argument("--window-days", type=int, default=1)
    daily.add_argument(
        "--measurement", choices=["total", "unique"], default="total",
        help="total = event counts (segmentation API); unique = period-unique users (JQL)",
    )

    per_space = sub.add_parser("per-space", help="Q5 per-space breakdown for one domain")
    per_space.add_argument("domain")
    per_space.add_argument("--window-days", type=int, default=1)
    per_space.add_argument(
        "--measurement", choices=["total", "unique"], default="total",
    )

    per_space_all = sub.add_parser(
        "per-space-all",
        help="Q5 for all listed CSS domains in one batch (faster than N × per-space)",
    )
    per_space_all.add_argument(
        "--domains", nargs="+", required=True,
        metavar="DOMAIN",
        help="CSS customer domain prefixes, e.g. --domains example-one example-two example-three",
    )
    per_space_all.add_argument("--window-days", type=int, default=1)

    ab = sub.add_parser(
        "ab-metrics",
        help="A/B analysis: saves/views (total+unique) + triggers by client_domain",
    )
    ab.add_argument("--window-days", type=int, default=7)

    args = parser.parse_args(argv)
    secret = load_api_secret()

    if args.cmd == "daily":
        out = run_daily(secret, args.window_days, args.measurement)
    elif args.cmd == "per-space":
        out = run_per_space(secret, args.domain, args.window_days, args.measurement)
    elif args.cmd == "per-space-all":
        out = run_per_space_all(secret, args.domains, args.window_days)
    elif args.cmd == "ab-metrics":
        out = run_ab_metrics(secret, args.window_days)
    else:
        parser.print_help()
        return 1

    json.dump(out, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
