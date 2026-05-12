#!/usr/bin/env python3
"""
Run the paywall daily-monitoring Mixpanel queries.

Usage:
    paywall_queries.py daily [--window-days N] [--measurement total|unique]
        Run Q1 (paywall_triggered), Q3 (advocacy_message_copied),
        Q4 (macro_save_succeeded, macro_save_failed,
        paywall_continued_editing, macro_create_succeeded) — all
        broken down by client_domain. (Q2/upgrade_modal_shown removed
        2026-05-12: it duplicated paywall_triggered 1:1 in practice.)

    paywall_queries.py per-space <domain> [--window-days N] [--measurement total|unique]
        Run Q5: paywall_triggered, macro_save_succeeded,
        macro_create_succeeded, paywall_continued_editing — all
        filtered to <domain>, broken down by confluence_space.

Window defaults to last 1 day. Measurement defaults to `total` (event counts
via segmentation API). `--measurement unique` returns period-unique users via
JQL — needed for A/B analysis columns like save_users / view_users.

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


def _open_with_retry(req: urllib.request.Request, timeout: int) -> bytes:
    """Open with exponential backoff on 429. Mixpanel throttles aggressive
    parallel callers; the daily run fans out 7+ requests at once, which
    sometimes triggers a short cool-off. Three retries cover this."""
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
                last_err = e
                continue
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
    rows = json.loads(_open_with_retry(req, timeout=120).decode())
    # Each row is {"key": [breakdown_or_null], "value": <count>}
    return {(r["key"][0] if r["key"] else "<null>"): r["value"] for r in rows}


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
    today = dt.date.today()
    return (
        (today - dt.timedelta(days=window_days)).isoformat(),
        (today - dt.timedelta(days=1)).isoformat(),
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


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
        help="total = event counts (segmentation API); unique = period-unique users (JQL)",
    )

    args = parser.parse_args(argv)
    secret = load_api_secret()

    if args.cmd == "daily":
        out = run_daily(secret, args.window_days, args.measurement)
    else:
        out = run_per_space(secret, args.domain, args.window_days, args.measurement)

    json.dump(out, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
