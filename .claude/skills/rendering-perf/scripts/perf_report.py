#!/usr/bin/env python3
"""Macro view loading-time report — the headless twin of the Mixpanel board.

Mixpanel has no public API for creating boards (verified 2026-07-25: the
documented API surface is ingestion/query/export/pipelines/lexicon/GDPR/
warehouse/flags only, and the undocumented app endpoints
`/api/app/projects/<id>/{boards,dashboards}` return 401 "Invalid service
account credentials" for a project API secret). So the board itself is built
by hand from docs/analytics/rendering-perf-board.md — and this script exists so
the *numbers* can be tracked without opening a browser: cron it, diff it, or
run it in CI after a perf change.

Emits the same cuts as the board's cards, on the same pinned population:
  surface=viewer, tab_hidden!=true, duration_ms>0, internal domains excluded.

Usage:
    python3 perf_report.py                      # last 7 days, text report
    python3 perf_report.py --days 14
    python3 perf_report.py --end 2026-07-24 --days 1
    python3 perf_report.py --json out.json      # machine-readable too

Auth: API_Secret from .env.mixpanel (cwd, then repo root), else the
MIXPANEL_API_SECRET env var. The secret is never printed.
"""

import argparse
import base64
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

PROJECT_ID = 3373228

# Canonical internal/staging exclude list — keep in sync with the mixpanel skill.
# JQL cannot see the `is_internal_client_domain` computed property that the
# Mixpanel UI uses, so the board and this script exclude via different
# mechanisms; they have been verified equivalent as of 2026-07-25.
INTERNAL = [
    "zenuml", "whimet", "full-stg", "lite-stg", "lite-dev",
    "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie",
]

# Renders slower than this count against the SLO card. 3s is not arbitrary:
# it sat just above the pooled p75 at the 2026-07-25 baseline, so it tracks the
# genuinely-slow tail without flapping on ordinary variance.
SLOW_MS = 3000

PERCENTILES = [50, 75, 90, 95, 99]
PHASES = [
    "bootstrap_ms", "context_ms", "fetch_ms", "render_ms",
    "custom_content_fetch_ms", "page_adf_fetch_ms", "measured_sum_ms",
]


def load_secret():
    for path in (".env.mixpanel",
                 os.path.join(os.path.dirname(__file__), "../../../../.env.mixpanel")):
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    if line.startswith("API_Secret="):
                        return line.strip().split("=", 1)[1]
    env = os.environ.get("MIXPANEL_API_SECRET")
    if env:
        return env
    sys.exit("No credentials: need .env.mixpanel with API_Secret= or $MIXPANEL_API_SECRET")


def run_jql(script, secret, timeout=180, retries=5, pace=8):
    """POST one JQL query, with back-off on Mixpanel's throttles.

    Mixpanel answers 412 Precondition Failed when too many JQL queries are in
    flight and 429 when the hourly quota is hit. Both are transient and both
    need a real pause, not an immediate retry — hitting this report's five
    queries back-to-back reliably trips the 412. `pace` sleeps after every
    successful query so a full run stays under the concurrency limit.
    """
    data = urllib.parse.urlencode({"script": script}).encode()
    auth = base64.b64encode(f"{secret}:".encode()).decode()
    for attempt in range(retries):
        req = urllib.request.Request("https://mixpanel.com/api/2.0/jql", data=data, method="POST")
        req.add_header("Authorization", f"Basic {auth}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode())
            time.sleep(pace)
            return result
        except urllib.error.HTTPError as e:
            transient = e.code in (412, 429, 500, 502, 503, 504)
            if not transient or attempt == retries - 1:
                raise
            wait = 15 * (attempt + 1)
            print(f"  [{e.code}] throttled, retrying in {wait}s…", file=sys.stderr)
            time.sleep(wait)


def js_prelude(frm, to):
    """Shared filter: the pinned population, as JQL."""
    return f"""
var INTERNAL = {json.dumps(INTERNAL)};
function base() {{
  return Events({{
    from_date: "{frm}", to_date: "{to}",
    event_selectors: [{{event: "macro_viewed"}}]
  }}).filter(function (e) {{
    var p = e.properties;
    if (p.surface !== "viewer") return false;
    if (p.tab_hidden === true) return false;
    if (typeof p.duration_ms !== "number" || p.duration_ms <= 0) return false;
    var d = p.client_domain;
    if (!d) return false;
    d = String(d).toLowerCase();
    for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return false;
    return true;
  }});
}}
"""


def q_by_type(frm, to):
    return js_prelude(frm, to) + f"""
function main() {{
  return base().groupBy([function (e) {{ return e.properties.macro_type || "unset"; }}], [
    mixpanel.reducer.count(),
    mixpanel.reducer.numeric_percentiles("properties.duration_ms", {PERCENTILES})
  ]);
}}
"""


def q_phases(frm, to):
    """Phase attribution, split out from q_by_type because **JQL rejects more
    than 8 reducers per groupBy** (412 UserVisiblePreconditionFailedError).
    count + duration + 7 phases would be 9, so the phases get their own call."""
    reducers = ",\n    ".join(
        f'mixpanel.reducer.numeric_percentiles("properties.{p}", [50, 90])' for p in PHASES
    )
    return js_prelude(frm, to) + f"""
function main() {{
  return base().groupBy([function (e) {{ return e.properties.macro_type || "unset"; }}], [
    {reducers}
  ]);
}}
"""


def q_overall(frm, to):
    return js_prelude(frm, to) + f"""
function main() {{
  return base().groupBy([function () {{ return "all"; }}], [
    mixpanel.reducer.count(),
    mixpanel.reducer.numeric_percentiles("properties.duration_ms", {PERCENTILES})
  ]);
}}
"""


def q_daily(frm, to):
    return js_prelude(frm, to) + f"""
function main() {{
  return base().groupBy([
    function (e) {{ return new Date(e.time).toISOString().slice(0, 10); }}
  ], [
    mixpanel.reducer.count(),
    mixpanel.reducer.numeric_percentiles("properties.duration_ms", [50, 90]),
    mixpanel.reducer.sum(function (e) {{
      return e.properties.duration_ms > {SLOW_MS} ? 1 : 0;
    }}),
    mixpanel.reducer.sum(function (e) {{
      return e.properties.content_source === "swr_cache" ? 1 : 0;
    }}),
    mixpanel.reducer.sum(function (e) {{
      return e.properties.cache_state === "cold" ? 1 : 0;
    }})
  ]);
}}
"""


def q_content_source(frm, to):
    return js_prelude(frm, to) + f"""
function main() {{
  return base().groupBy([
    function (e) {{ return e.properties.content_source || "unset"; }}
  ], [
    mixpanel.reducer.count(),
    mixpanel.reducer.numeric_percentiles("properties.duration_ms", [50, 90, 99])
  ]);
}}
"""


def pv(val):
    """numeric_percentiles → {percentile: value}. [] means NOT INSTRUMENTED."""
    if not isinstance(val, list) or not val:
        return {}
    return {p["percentile"]: p["value"] for p in val}


def fmt(ms):
    return "  —  " if ms is None else f"{ms:>5.0f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7, help="window length (default 7)")
    ap.add_argument("--end", help="last day, YYYY-MM-DD (default today UTC)")
    ap.add_argument("--json", help="also write raw results here")
    args = ap.parse_args()

    to = dt.date.fromisoformat(args.end) if args.end else dt.datetime.now(dt.timezone.utc).date()
    frm = to - dt.timedelta(days=args.days - 1)
    frm_s, to_s = frm.isoformat(), to.isoformat()

    secret = load_secret()
    out = {"project_id": PROJECT_ID, "from": frm_s, "to": to_s, "slow_ms": SLOW_MS,
           "population": "surface=viewer, tab_hidden!=true, duration_ms>0, internal excluded"}

    print(f"\nMacro view loading time — {frm_s} → {to_s}  (project {PROJECT_ID})")
    print(f"population: viewer surface, visible tab, timed, internal domains excluded\n")

    # ---- overall ----------------------------------------------------------
    overall = run_jql(q_overall(frm_s, to_s), secret)
    if not overall:
        sys.exit("No events matched — check the window (tracking starts 2026-04-18).")
    n = overall[0]["value"][0]
    o = pv(overall[0]["value"][1])
    out["overall"] = {"n": n, "percentiles": o}
    print(f"OVERALL  n={n:,}")
    print(f"  p50 {fmt(o.get(50))}ms   p75 {fmt(o.get(75))}ms   "
          f"p90 {fmt(o.get(90))}ms   p95 {fmt(o.get(95))}ms   p99 {fmt(o.get(99))}ms\n")

    # ---- per macro type ---------------------------------------------------
    rows = run_jql(q_by_type(frm_s, to_s), secret)
    rows.sort(key=lambda r: -r["value"][0])
    out["by_macro_type"] = {}
    print(f"{'macro_type':<10} {'n':>7}  {'p50':>6} {'p90':>6} {'p99':>7}")
    for r in rows:
        d = pv(r["value"][1])
        print(f"{r['key'][0]:<10} {r['value'][0]:>7,}  "
              f"{fmt(d.get(50))} {fmt(d.get(90))} {fmt(d.get(99)):>7}")
        out["by_macro_type"][r["key"][0]] = {"n": r["value"][0], "percentiles": d}

    # ---- phase attribution (separate query — 8-reducer cap) ---------------
    ph = {r["key"][0]: r["value"] for r in run_jql(q_phases(frm_s, to_s), secret)}
    print(f"\nPHASE ATTRIBUTION (p50 ms; '—' = phase not instrumented for that type)")
    hdr = ["boot", "ctx", "fetch", "render", "cc_get", "adf", "sum"]
    print(f"{'macro_type':<10} " + " ".join(f"{h:>6}" for h in hdr))
    for r in rows:
        mt = r["key"][0]
        vals = ph.get(mt, [])
        phases = {p: pv(vals[i]) if i < len(vals) else {} for i, p in enumerate(PHASES)}
        out["by_macro_type"][mt]["phases"] = phases
        print(f"{mt:<10} " + " ".join(fmt(phases[p].get(50)) for p in PHASES))
        if not phases["render_ms"]:
            out["by_macro_type"][mt]["render_not_instrumented"] = True

    # ---- content_source (the SWR lever) ----------------------------------
    cs = run_jql(q_content_source(frm_s, to_s), secret)
    cs.sort(key=lambda r: -r["value"][0])
    total_cs = sum(r["value"][0] for r in cs)
    out["by_content_source"] = {}
    print(f"\nCONTENT SOURCE (the SWR lever)")
    print(f"{'source':<11} {'n':>7} {'share':>7}  {'p50':>6} {'p90':>6}")
    for r in cs:
        d = pv(r["value"][1])
        share = 100.0 * r["value"][0] / total_cs if total_cs else 0
        print(f"{r['key'][0]:<11} {r['value'][0]:>7,} {share:>6.1f}%  "
              f"{fmt(d.get(50))} {fmt(d.get(90))}")
        out["by_content_source"][r["key"][0]] = {
            "n": r["value"][0], "share_pct": round(share, 1), "percentiles": d}

    # ---- daily trend + SLO ----------------------------------------------
    daily = run_jql(q_daily(frm_s, to_s), secret)
    daily.sort(key=lambda r: r["key"][0])
    out["daily"] = []
    print(f"\nDAILY  (slow = duration_ms > {SLOW_MS})")
    print(f"{'date':<12} {'n':>7}  {'p50':>6} {'p90':>6}  {'slow%':>6} {'swr%':>6} {'cold%':>6}")
    for r in daily:
        cnt, d = r["value"][0], pv(r["value"][1])
        slow, swr, cold = r["value"][2], r["value"][3], r["value"][4]
        pct = lambda x: 100.0 * x / cnt if cnt else 0
        print(f"{r['key'][0]:<12} {cnt:>7,}  {fmt(d.get(50))} {fmt(d.get(90))}  "
              f"{pct(slow):>5.1f}% {pct(swr):>5.1f}% {pct(cold):>5.1f}%")
        out["daily"].append({
            "date": r["key"][0], "n": cnt, "p50": d.get(50), "p90": d.get(90),
            "slow_pct": round(pct(slow), 1), "swr_pct": round(pct(swr), 1),
            "cold_pct": round(pct(cold), 1)})

    # ---- read the result for the operator -------------------------------
    print("\nREAD THIS BEFORE CALLING A REGRESSION:")
    swr_share = out["by_content_source"].get("swr_cache", {}).get("share_pct", 0)
    print(f"  · SWR hit share is {swr_share:.1f}%. A pooled p50 rise with every phase flat is"
          f" a hit-rate drop or a mix shift, not slower code.")
    missing = [t for t, v in out["by_macro_type"].items() if v.get("render_not_instrumented")]
    if missing:
        print(f"  · render_ms not instrumented for: {', '.join(missing)} — their render time"
              f" hides in duration_ms − measured_sum_ms.")
    if len(out["daily"]) >= 2:
        last = out["daily"][-1]
        prior = [d for d in out["daily"][:-1] if d["n"] > 0]
        if prior and last["n"] < 0.3 * (sum(d["n"] for d in prior) / len(prior)):
            print(f"  · {last['date']} has only {last['n']:,} events — a partial day."
                  f" Do not read its percentiles as a trend.")
    print()

    if args.json:
        with open(args.json, "w") as f:
            json.dump(out, f, indent=2)
        print(f"wrote {args.json}\n")


if __name__ == "__main__":
    main()
