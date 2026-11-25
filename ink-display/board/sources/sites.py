"""New-sites section: install funnel, this week against the week before.

Windows (Australia/Sydney calendar days, today included): this = today-6 .. today, before = today-13 .. today-7.

A site is NEW in a window when it has an install of an app (site + app pair) that it never had before: the
first ever ForgeInstallation row of that pair (backfill rows count as earlier history) is an install made inside
the window. A reinstall of the same app is not new; a different app on a known site is (a Lite site starting a
Full trial counts). A site is counted once, with the app of its earliest such install. Sites
whose key contains an internal marker (zenuml, whimet, *-stg, diagramly, ...) are dropped.
Site key = clientDomain without ".atlassian.net", which is Mixpanel's client_domain. Install rows with a null
clientDomain are named through their cloudId in the licence export; if that fails too, the cloudId is the key
(such a site has no Mixpanel activity).

Funnel steps, counted over the window's new sites (Mixpanel project 3373228, events from window start to
window end; the "before" cohort is cut at the end of its own window):
  Installed   the new sites
  Opened      >= 1 macro_viewed
  Created     >= 1 macro_create_succeeded
  Active 3d+  macro_viewed / macro_create_succeeded / macro_save_succeeded on >= 3 distinct Sydney days
  Paid        an active COMMERCIAL licence (Marketplace export)
rows: the newest new sites of the last 60 days, newest first install first, max 7 (the funnel still uses only
  the two 7-day windows). recent = the site is new in this window (the board draws a dashed line where recent rows end).
  steps = the five funnel steps above, each True when the site reached it, counted from the site's first
  install day to today (one square per step on the board).
  product, seats, and region/country come from the licence index; without a licence the install's app name gives the product.

Every external call goes through an injectable runner: d1(sql) -> list of dicts, mixpanel(jql) -> list of
{"key": [...], "value": n}, licenses() -> raw export list. Failures raise.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
from zoneinfo import ZoneInfo

from . import marketplace

SYDNEY = ZoneInfo("Australia/Sydney")
UTC = dt.timezone.utc
CONF_APP = marketplace.CONF_APP
D1_SCRIPT = os.path.expanduser("~/.claude/skills/conf-app/scripts/d1_query.sh")
MP_QUERY = os.path.join(CONF_APP, ".claude/skills/mixpanel/scripts/mp_query.py")
MAX_ROWS = 7
ROW_DAYS = 60  # rows look back this far so the list stays full; the funnel keeps its two 7-day windows
INTERNAL = ("zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg",
            "diagramly", "danshuitaihejie", "async-prd", "unknown_atlassian_domain")
EVENTS = ("macro_viewed", "macro_create_succeeded", "macro_save_succeeded")
PRODUCT_BY_APP = {
    "ZenUML Diagrams and Open API Lite": "LITE",
    "ZenUML Diagrams for Confluence": "FULL",
    "Diagramly For Confluence": "DIAGRAMLY",
    "AsyncAPI & OpenAPI (Swagger)": "ASYNCAPI",
}
_SAFE = re.compile(r"[a-z0-9][a-z0-9._-]*")


# ---- default runners -------------------------------------------------------------------------------------
def run_d1(sql: str) -> list[dict]:
    result = subprocess.run([D1_SCRIPT, sql, "--json"], cwd=CONF_APP, capture_output=True, text=True,
                            timeout=120, check=False)
    if result.returncode:
        raise RuntimeError(f"D1 query failed: {result.stderr.strip()[-200:]}")
    rows = json.loads(result.stdout)
    if not isinstance(rows, list):
        raise RuntimeError("D1 query did not return a list")
    return rows


def run_mixpanel(script: str) -> list[dict]:
    spec = importlib.util.spec_from_file_location("mp_query", MP_QUERY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.run_jql(script, mod.load_api_secret(), pace=0)


# ---- pure logic ------------------------------------------------------------------------------------------
def _utc_iso(day: dt.date) -> str:
    """Sydney midnight of `day` as a D1 timestamp string (ISO, UTC, milliseconds)."""
    start = dt.datetime.combine(day, dt.time(), tzinfo=SYDNEY).astimezone(UTC)
    return start.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _is_install(event_type: str) -> bool:
    return "install" in event_type and "uninstall" not in event_type


def _internal(key: str) -> bool:
    return any(marker in key for marker in INTERNAL)


def site_of(row: dict, clouds: dict) -> str:
    return marketplace.site_key(row.get("clientDomain")) or clouds.get(row.get("cloudId")) or row.get("cloudId") or ""


def first_installs(rows: list[dict], prior: set[tuple], clouds: dict | None = None) -> dict:
    """{key: install row}: each site's earliest install of an app it never had before."""
    first = {}
    for r in rows:
        key = site_of(r, clouds or {})
        if not key or _internal(key) or (key, r.get("app")) in prior or not _is_install(r.get("eventType", "")):
            continue
        if key not in first or r["createdAt"] < first[key]["createdAt"]:
            first[key] = r
    return first


def new_sites(rows: list[dict], prior: set[tuple], windows: dict, clouds: dict | None = None) -> dict:
    """{"now": {key: app}, "before": {key: app}}: first-ever install inside the window."""
    first = first_installs(rows, prior, clouds)
    out = {name: {} for name in windows}
    for key, r in first.items():
        sydney_day = dt.datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00")).astimezone(SYDNEY).date()
        for name, (start, end) in windows.items():
            if start <= sydney_day <= end:
                out[name][key] = r.get("app", "")
    return out


def activity(mp_rows: list[dict]) -> dict:
    """{site_key: {event: set(sydney dates)}} from JQL rows keyed [domain, event, utc-hour-number]."""
    out = {}
    for row in mp_rows:
        domain, event, hour = row["key"]
        day = dt.datetime.fromtimestamp(int(hour) * 3600, UTC).astimezone(SYDNEY).date()
        out.setdefault(str(domain).lower(), {}).setdefault(event, set()).add(day)
    return out


def steps(key: str, act: dict, lic: dict, start: dt.date, end: dt.date) -> list[bool]:
    """[installed, opened, created, active 3d+, paid] for one site, events counted from start to end."""
    events = act.get(key, {})
    in_window = lambda ev: {d for d in events.get(ev, ()) if start <= d <= end}  # noqa: E731
    days = set().union(*(in_window(ev) for ev in EVENTS))
    return [True, bool(in_window("macro_viewed")), bool(in_window("macro_create_succeeded")), len(days) >= 3,
            bool(lic.get(key, marketplace.SiteLicenses()).paid)]


def funnel(cohort: dict, act: dict, lic: dict, start: dt.date, end: dt.date) -> list[int]:
    return [sum(col) for col in zip(*(steps(key, act, lic, start, end) for key in cohort))] or [0] * 5


def jql(domains: list[str], first_day: dt.date, last_day: dt.date) -> str:
    for d in domains:
        if not _SAFE.fullmatch(d):
            raise ValueError("unexpected site key")
    wanted = json.dumps({d: 1 for d in domains})
    events = ",".join(f'{{event:"{e}"}}' for e in EVENTS)
    pad = dt.timedelta(days=1)  # Mixpanel dates are UTC-based; Sydney days are cut in Python
    return (f'function main(){{var W={wanted};return Events({{from_date:"{first_day - pad}",to_date:"{last_day + pad}",'
            f'event_selectors:[{events}]}}).filter(function(e){{var d=(e.properties.client_domain||"").toLowerCase();'
            f'return W[d]===1;}}).groupBy([function(e){{return e.properties.client_domain.toLowerCase();}},"name",'
            f'function(e){{return Math.floor(e.time/3600000);}}],mixpanel.reducer.count());}}')


def build(installs: list[dict], prior: set[tuple], mp_rows_for, lic: dict, today: dt.date, clouds: dict | None = None) -> dict:
    windows = {"now": (today - dt.timedelta(days=6), today), "before": (today - dt.timedelta(days=13), today - dt.timedelta(days=7))}
    cohorts = new_sites(installs, prior, windows, clouds)
    first = first_installs(installs, prior, clouds)
    newest = sorted(first, key=lambda k: (first[k]["createdAt"], k), reverse=True)[:MAX_ROWS]
    domains = sorted(set(cohorts["now"]) | set(cohorts["before"]) | set(newest))
    act = activity(mp_rows_for(domains)) if domains else {}
    result = {name: funnel(cohorts[name], act, lic, *windows[name]) for name in windows}
    rows = []
    for key in newest:
        app = first[key].get("app", "")
        info = lic.get(key, marketplace.SiteLicenses())
        installed = dt.datetime.fromisoformat(first[key]["createdAt"].replace("Z", "+00:00")).astimezone(SYDNEY).date()
        rows.append((first[key]["createdAt"], key, {
            "product": info.product or PRODUCT_BY_APP.get(app, ""), "name": key,
            "place": info.place, "seats": marketplace.fmt_seats(info.seats),
            "steps": steps(key, act, lic, installed, today),
            "recent": key in cohorts["now"]}))
    rows.sort(key=lambda r: (r[0], r[1]), reverse=True)
    return {"funnel": {"now": result["now"], "before": result["before"]}, "rows": [r[2] for r in rows[:MAX_ROWS]]}


def fetch(d1=None, mixpanel=None, licenses=None, now: dt.datetime | None = None) -> dict:
    d1, mixpanel = d1 or run_d1, mixpanel or run_mixpanel
    today = (now or dt.datetime.now(SYDNEY)).astimezone(SYDNEY).date()
    since = _utc_iso(today - dt.timedelta(days=ROW_DAYS - 1))
    installs = d1("SELECT i.clientDomain, i.cloudId, a.name AS app, i.eventType, i.createdAt FROM ForgeInstallation i "
                  f"JOIN ForgeApp a ON a.appId=i.appId WHERE i.createdAt >= '{since}' AND i.eventType NOT LIKE 'backfill%'")
    records = marketplace.load_records(licenses)
    clouds = marketplace.cloud_hosts(records)
    prior = {(site_of(r, clouds), r["app"]) for r in
             d1("SELECT DISTINCT i.clientDomain, i.cloudId, a.name AS app FROM ForgeInstallation i "
                f"JOIN ForgeApp a ON a.appId=i.appId WHERE i.createdAt < '{since}'")}
    lic = marketplace.index(records)
    first_day, last_day = today - dt.timedelta(days=ROW_DAYS - 1), today
    return build(installs, prior, lambda domains: mixpanel(jql(domains, first_day, last_day)), lic, today, clouds)
