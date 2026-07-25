#!/usr/bin/env python3
"""Create the "⏱️ Macro Loading Time" board in Mixpanel from the design in
docs/analytics/rendering-perf-board.md.

Needs SERVICE-ACCOUNT credentials with a project role that can write
(MIXPANEL_SA_USER / MIXPANEL_SA_SECRET in .env.mixpanel, gitignored).

The whole app API used here is UNDOCUMENTED — it was reverse-engineered on
2026-07-25 by reading an existing board. What was established, so the next person
does not repeat the probing:

  create board    POST  /api/app/projects/<p>/dashboards        {"title": ...}
  board identity  PATCH /api/app/projects/<p>/dashboards/<b>    {"description":…, "filters":[…]}
  create card     POST  /api/app/projects/<p>/bookmarks
                        {"name":…, "type":"insights", "params": "<JSON STRING>",
                         "dashboard_id": <b>}
  register card   PATCH /api/app/projects/<p>/bookmarks/<r>     {"dashboard_id": <b>}
  read board      GET   /api/app/projects/<p>/dashboards/<b>
  verify a card   GET   /api/query/insights?project_id=<p>&bookmark_id=<r>   (documented)

Sharp edges, each one paid for:
  · `params` must be a JSON-ENCODED STRING. Passing a nested object returns
    400 "... is not of type 'string'".
  · A freshly POSTed card does not appear in the board's `contents` until the
    PATCH above re-asserts its dashboard_id. Until then the board looks empty.
  · `POST /boards` is 405 — the resource is spelled `dashboards` for writes even
    though the UI and the read path both call them boards.
WHY CARDS ARE NOT CREATED HERE
------------------------------
`POST /bookmarks` happily creates cards, and they compute correctly — but a card
that is not placed in the board's `layout` **does not render at all**. The board
shows Mixpanel's "Looking a little empty…" empty state, plus a "Something went
wrong" banner, because `contents` lists reports that `layout` does not. There is
nothing to drag: the cards are invisible, not merely unpositioned.

And placement cannot be expressed anywhere in this API. Verified 2026-07-25:

  · `PATCH …/dashboards/<b>` accepts `{"layout": {"rows": {}}}` (200) but returns
    403 INVALID_LAYOUT for ANY non-empty `rows`, whatever the shape — list, dict,
    extra keys, garbage keys, valid or bogus `content_id`. The check is semantic,
    not schema-based, so no error message ever names the expected form.
  · It also refuses the `order` and `version` keys that the stored layout itself
    contains ("extra keys not allowed"), i.e. the write validator cannot express
    the 2.0.0 layout format these boards use.
  · No layout endpoint exists: `/layout`, `/contents`, `/dashboard-contents`,
    `/reorder`, `/add-content`, `/copy`, `/duplicate` are all 404.
  · `POST /bookmarks` rejects every placement-ish key as "extra keys not allowed":
    position, layout, row, width, cell_id, include_in_dashboard, is_visible.
  · A card cannot be detached to become a standalone saved report either —
    `dashboard_id` must be a valid int, so null/0 are refused.
  · `DELETE /bookmarks/<r>` returns **500**, so a mis-created card cannot be
    removed individually. Deleting the whole board removes its cards.

Net: the API can create and scope a BOARD, and that is what this script does.
Cards are a UI job. The checklist it prints is the build order.
  · `time_filter` at board level rejects the same shape the cards accept, so the
    board-wide date range is left unset and each card carries its own.

Usage:
    python3 build_board.py --dry-run        # print what would be created
    python3 build_board.py                  # create it
    python3 build_board.py --verify <id>    # re-check an existing board's cards
    python3 build_board.py --delete <id>    # remove a board (cleanup)
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_ID = 3373228
EVENT = "macro_viewed"
SLOW_MS = 3000
BASE = f"https://mixpanel.com/api/app/projects/{PROJECT_ID}"

TITLE = "⏱️ Macro Loading Time"
# Hard limit: 400 characters. Exceeding it fails the whole PATCH, which is why
# description and filters are sent as SEPARATE calls below — bundling them meant
# an over-long description silently took the board filters down with it.
DESCRIPTION = (
    "How long a macro takes to render. Population is pinned by the board filters "
    "(surface=viewer, duration_ms>0, internal domains excluded) plus a per-card "
    "tab_hidden=false; see docs/analytics/rendering-perf-board.md before changing "
    "them. Comparable only within one instrumentation era: phase timers and "
    "tab_hidden start 2026-07-17, content_source 2026-07-22."
)
assert len(DESCRIPTION) <= 400, f"description is {len(DESCRIPTION)} chars, limit 400"


# ---------------------------------------------------------------- transport ---

def _auth():
    vals = {}
    for path in (".env.mixpanel",
                 os.path.join(os.path.dirname(__file__), "../../../../.env.mixpanel")):
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.strip().split("=", 1)
                        vals.setdefault(k, v)
    user = os.environ.get("MIXPANEL_SA_USER") or vals.get("MIXPANEL_SA_USER")
    secret = os.environ.get("MIXPANEL_SA_SECRET") or vals.get("MIXPANEL_SA_SECRET")
    if not user or not secret:
        sys.exit("Need MIXPANEL_SA_USER / MIXPANEL_SA_SECRET (service account, "
                 "not the project API secret).")
    return base64.b64encode(f"{user}:{secret}".encode()).decode()


def call(method, path, body=None, auth=None, full_url=None):
    url = full_url or f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw, status = r.read().decode(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode(errors="replace"), e.code
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw[:1000]


def err_of(body):
    if isinstance(body, dict):
        e = body.get("error")
        if isinstance(e, dict):
            return e.get("type", json.dumps(e)[:120])
        if e:
            return str(e)[:200]
    return str(body)[:200]


# ------------------------------------------------------------- card pieces ---

def num_filter(prop, op, val):
    return {"dataset": "$mixpanel", "value": prop, "resourceType": "events",
            "filterType": "number", "defaultType": "number",
            "filterOperator": op, "filterValue": val, "determiner": "all"}


def str_filter(prop, op, vals):
    f = {"dataset": "$mixpanel", "value": prop, "resourceType": "events",
         "filterType": "string", "defaultType": "string", "filterOperator": op}
    if vals is not None:
        f["filterValue"] = vals
    return f


def bool_filter(prop, op):
    """`is false` takes no filterValue. NOTE: it matches only events that CARRY
    the property, so it drops builds older than the property itself."""
    return {"dataset": "$mixpanel", "value": prop, "resourceType": "events",
            "filterType": "boolean", "defaultType": "boolean", "filterOperator": op}


def breakdown(prop):
    return {"dataset": "$mixpanel", "value": prop, "resourceType": "events",
            "propertyType": "string", "typeCast": None, "unit": None}


def metric(label, math, prop=None):
    m = {"math": math}
    if prop:
        m["property"] = {"dataset": "mixpanel", "defaultType": "number",
                         "name": prop, "resourceType": "events", "type": "number"}
    return {
        "name": label, "type": "metric", "isHidden": False,
        "behavior": {"type": "simple", "name": EVENT, "hasUnsavedChanges": False,
                     "resourceType": "events", "dataGroupId": None, "filters": [],
                     "behaviors": [{"type": "event", "id": None, "name": EVENT,
                                    "filters": [], "filtersDeterminer": "all"}]},
        "measurement": m,
    }


def params(shows, *, days, chart, group=None, filters=None, unit="day"):
    return {
        "displayOptions": {"chartType": chart, "plotStyle": "standard",
                           "value": "absolute",
                           "primaryYAxisOptions": {"min": 0, "useSoftMinMax": True}},
        "sections": {
            "time": [{"dateRangeType": "in the last", "unit": unit,
                      "window": {"unit": "day", "value": days}}],
            "filter": filters or [],
            "group": group or [],
            "show": shows,
        },
        "sorting": {},
    }


# Applied to every card except the tab-hidden guard, which must see both values.
VISIBLE_ONLY = [bool_filter("tab_hidden", "is false")]

P50 = metric("Median of duration_ms", "median", "duration_ms")
P90 = metric("P90 of duration_ms", "p90", "duration_ms")
TOTAL = metric("Total renders", "total")


def cards():
    return [
        ("1 · Loading time p50 / p90 (daily)",
         params([P50, P90], days=14, chart="line", filters=VISIBLE_ONLY)),

        (f"2 · SLO — slow renders over {SLOW_MS}ms (read with card 8)",
         params([metric("Slow renders", "total")], days=14, chart="line",
                filters=VISIBLE_ONLY + [num_filter("duration_ms", "is greater than", SLOW_MS)])),

        ("3 · By macro type",
         params([P50, P90], days=7, chart="bar", group=[breakdown("macro_type")],
                filters=VISIBLE_ONLY)),

        ("4 · Phase attribution (p50) — fetch is the dominant phase",
         params([metric("bootstrap_ms", "median", "bootstrap_ms"),
                 metric("context_ms", "median", "context_ms"),
                 metric("fetch_ms", "median", "fetch_ms"),
                 metric("render_ms (absent for graph/openapi)", "median", "render_ms"),
                 metric("measured_sum_ms", "median", "measured_sum_ms")],
                days=14, chart="line", filters=VISIBLE_ONLY)),

        ("5 · Content-SWR hit rate — check before blaming code",
         params([TOTAL], days=14, chart="line", group=[breakdown("content_source")],
                filters=VISIBLE_ONLY)),

        ("6 · SWR effect — p50 by content_source",
         params([P50, P90], days=7, chart="bar",
                group=[breakdown("content_source")], filters=VISIBLE_ONLY)),

        ("7 · Cold vs warm cache — p50 by cache_state",
         params([P50, TOTAL], days=7, chart="bar",
                group=[breakdown("cache_state")], filters=VISIBLE_ONLY)),

        ("8 · Volume — the denominator for every card above",
         params([TOTAL], days=14, chart="line", filters=VISIBLE_ONLY)),

        ("9 · GUARD: tab_hidden share (no tab_hidden filter — by design)",
         params([TOTAL], days=14, chart="line", group=[breakdown("tab_hidden")])),

        ("10 · Worst tenants — p90 (check the render count before acting)",
         params([P90, TOTAL], days=7, chart="table",
                group=[breakdown("client_domain")], filters=VISIBLE_ONLY)),
    ]


BOARD_FILTERS = [
    str_filter("surface", "equals", ["viewer"]),
    num_filter("duration_ms", "is greater than", 0),
    bool_filter("is_internal_client_domain", "is false"),
]


# ------------------------------------------------------------------ actions ---

def apply_board_settings(board_id, auth):
    """Set description and filters as INDEPENDENT calls.

    They were originally one PATCH, and a 407-char description blew the 400-char
    limit — which failed the whole request and left the board with zero filters
    while every card reported success. An unfiltered board is not a cosmetic
    problem: it silently pools editor renders, untimed events and our own
    staging tenants into every number.
    """
    ok = True
    for label, body in (("description", {"description": DESCRIPTION}),
                        (f"{len(BOARD_FILTERS)} board filters", {"filters": BOARD_FILTERS})):
        s, b = call("PATCH", f"/dashboards/{board_id}", body, auth=auth)
        print(f"  {label:<18} → {s} {'' if s == 200 else err_of(b)}")
        ok = ok and s == 200
    if not ok:
        print("  ⚠ board settings incomplete — the cards' numbers are NOT the "
              "pinned population until this succeeds.")
    return ok


def verify(board_id, auth):
    status, body = call("GET", f"/dashboards/{board_id}", auth=auth)
    if status != 200:
        sys.exit(f"cannot read board {board_id}: {status} {err_of(body)}")
    res = body["results"]
    reports = res["contents"]["report"]
    print(f"\nboard {board_id} — {res['title']!r}")
    print(f"  cards registered : {len(reports)}")
    print(f"  board filters    : {len(res['filters'])}")
    print(f"  layout rows      : {len(res['layout'].get('rows', {}))} "
          f"(0 is expected — layout is not settable via the API)")
    print(f"\nverifying each card computes (documented query endpoint):")
    ok = 0
    for rid, rep in sorted(reports.items(), key=lambda kv: kv[1].get("name", "")):
        s, b = call("GET", None, auth=auth,
                    full_url=f"https://mixpanel.com/api/query/insights"
                             f"?project_id={PROJECT_ID}&bookmark_id={rid}")
        series = b.get("series", {}) if isinstance(b, dict) else {}
        n = sum(len(v) for v in series.values() if isinstance(v, dict))
        mark = "✓" if s == 200 and series else ("~" if s == 200 else "✗")
        if s == 200 and series:
            ok += 1
        print(f"  {mark} {rid}  {rep.get('name', '?')[:58]:<58} {n} points")
    print(f"\n{ok}/{len(reports)} cards returned data.")
    return res


def build(auth, dry_run=False):
    plan = cards()
    if dry_run:
        print(f"would create board {TITLE!r} with {len(plan)} cards:")
        for name, p in plan:
            sec = p["sections"]
            print(f"  · {name}")
            print(f"      {p['displayOptions']['chartType']:<5} "
                  f"{sec['time'][0]['window']['value']}d  "
                  f"metrics={[m['measurement']['math'] for m in sec['show']]}  "
                  f"group={[g['value'] for g in sec['group']] or '—'}  "
                  f"filters={[f['value'] for f in sec['filter']] or '—'}")
        print(f"\nboard-level filters: {[f['value'] for f in BOARD_FILTERS]}")
        return

    status, body = call("POST", "/dashboards", {"title": TITLE}, auth=auth)
    if status not in (200, 201):
        sys.exit(f"create board failed: {status} {err_of(body)}")
    bid = body["results"]["id"]
    print(f"created board {bid}")

    apply_board_settings(bid, auth)

    print(f"\nhttps://mixpanel.com/project/{PROJECT_ID}/view/3879592/app/boards#id={bid}")
    print("\nBoard shell is ready and correctly scoped. Cards must be added in the UI —\n"
          "see WHY CARDS ARE NOT CREATED HERE at the top of this file. Build each card\n"
          "with '+ Add to Board', using this checklist:\n")
    checklist(plan)
    return bid


def checklist(plan):
    """Print the cards as a build checklist for the UI."""
    for name, p in plan:
        sec = p["sections"]
        metrics = [m["name"] for m in sec["show"]]
        print(f"  [ ] {name}")
        print(f"        chart    {p['displayOptions']['chartType']}, "
              f"last {sec['time'][0]['window']['value']} days, daily")
        print(f"        metrics  {', '.join(metrics)}")
        if sec["group"]:
            print(f"        break by {', '.join(g['value'] for g in sec['group'])}")
        if sec["filter"]:
            desc = ", ".join(
                f"{f['value']} {f['filterOperator']}"
                + (f" {f['filterValue']}" if "filterValue" in f else "")
                for f in sec["filter"])
            print(f"        filter   {desc}")
        print()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verify", type=int, metavar="BOARD_ID")
    ap.add_argument("--delete", type=int, metavar="BOARD_ID")
    ap.add_argument("--fix-settings", type=int, metavar="BOARD_ID",
                    help="re-apply description + board filters to an existing board")
    args = ap.parse_args()

    if args.dry_run:
        return build(None, dry_run=True)
    auth = _auth()
    if args.fix_settings:
        return apply_board_settings(args.fix_settings, auth)
    if args.verify:
        return verify(args.verify, auth)
    if args.delete:
        s, b = call("DELETE", f"/dashboards/{args.delete}", auth=auth)
        print(f"delete board {args.delete} → {s} {'' if s in (200, 204) else err_of(b)}")
        return
    build(auth)


if __name__ == "__main__":
    main()
