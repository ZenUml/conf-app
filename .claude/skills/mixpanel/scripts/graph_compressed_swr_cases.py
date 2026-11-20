#!/usr/bin/env python3
"""Find Graph macros hit by the "compressed body + content SWR cache" crash.

Bug: a legacy Graph body (`compressed: true`, LZUTF8 Base64 graphXml) renders on a
fresh fetch, but on a revisit the content-SWR cache mounts the RAW cached doc before
publishLoadedDiagram decompresses it, so GraphViewer sees Base64 and throws
"Not a diagram file" (viewer_load_failed, failure_stage=render_crash). Introduced
2026-07-29 (cc15fc846 / 07aef1335).

Deterministic, Mixpanel-only, no model needed. Two modes:

  find   -- list every case since --from (default 2026-07-29)
  check  -- after a release, re-read the case list and report per macro whether the
            crash still happens on app versions >= --fixed-version

Signals (per client_domain + custom_content_id):
  crash         viewer_load_failed, macro_type=graph, failure_reason="Not a diagram file"
  compressed    a `load` event with event_label compressed_field_viewer /
                compressed_content_viewer on one of the macro's macro_uuids
                (sampled 0.1 from 2026-11, so absence is weak evidence)
  in_load_recov a macro_viewed in the SAME iframe load as the crash
                (same distinct_id + analytics_init_ms): the crash-then-recover shape
  fetch_ok      a macro_viewed with content_source=fetch on the same content: the live
                body renders, so the crash is cache-only

Verdict:
  confirmed  crash + compressed
  likely     crash + (in_load_recov or fetch_ok), no compressed evidence
  other      crash with neither: probably a different cause (e.g. a plain SVG body)
  at_risk    compressed evidence, no crash yet (will crash on the first cached revisit)

Usage:
  python3 graph_compressed_swr_cases.py find --out cases.json
  python3 graph_compressed_swr_cases.py check --cases cases.json --fixed-version v2026.11.21xxxx

Output holds tenant names: write it under private/ or a scratch dir, never the public repo.
"""
import argparse
import collections
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mp_query import load_api_secret, run_jql  # noqa: E402

REASON = "Not a diagram file"
LABELS = ("compressed_field_viewer", "compressed_content_viewer")


def jql(script):
    return run_jql(script, load_api_secret(), pace=1)


def today():
    return dt.date.today().isoformat()


def fetch_crashes(frm, to):
    return jql("""
function main(){return Events({from_date:"%s",to_date:"%s",event_selectors:[{event:"viewer_load_failed"}]})
.filter(function(e){var p=e.properties;return p.failure_reason==="%s"&&p.macro_type==="graph";})
.map(function(e){var p=e.properties;return {t:e.time,u:e.distinct_id,d:p.client_domain,cc:p.custom_content_id||p.content_id,
 m:p.macro_uuid,pg:p.page_id,v:p.app_version,pt:p.product_type,ai:p.analytics_init_ms,os:p.$os};});}
""" % (frm, to, REASON))


def fetch_compressed(frm, to):
    return jql("""
function main(){return Events({from_date:"%s",to_date:"%s",event_selectors:[{event:"load"}]})
.filter(function(e){var l=e.properties.event_label;return (l==="%s"||l==="%s")&&e.properties.macro_uuid;})
.groupBy(["properties.client_domain","properties.macro_uuid"],mixpanel.reducer.count())
.map(function(r){return {d:r.key[0],m:r.key[1],n:r.value};});}
""" % (frm, to, LABELS[0], LABELS[1]))


def fetch_views(frm, to, ids):
    idset = json.dumps({i: 1 for i in ids})
    return jql("""
function main(){var S=%s;return Events({from_date:"%s",to_date:"%s",event_selectors:[{event:"macro_viewed"}]})
.filter(function(e){var p=e.properties;return p.macro_type==="graph"&&S[p.custom_content_id||p.content_id];})
.map(function(e){var p=e.properties;return {t:e.time,u:e.distinct_id,d:p.client_domain,cc:p.custom_content_id||p.content_id,
 m:p.macro_uuid,v:p.app_version,ai:p.analytics_init_ms,src:p.content_source,sr:p.sample_rate};});}
""" % (idset, frm, to))


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).isoformat(timespec="seconds")


def find(args):
    to = args.to or today()
    crashes = fetch_crashes(args.frm, to)
    compressed = fetch_compressed(args.compressed_from, to)
    comp_keys = {(r["d"], r["m"]) for r in compressed}
    ids = sorted({str(c["cc"]) for c in crashes if c.get("cc")})
    views = fetch_views(args.frm, to, ids) if ids else []

    loads_with_view = {(v["u"], v["ai"]) for v in views if v.get("ai") is not None}
    by = collections.defaultdict(lambda: {"crashes": [], "views": []})
    for c in crashes:
        by[(c.get("d"), str(c.get("cc")))]["crashes"].append(c)
    for v in views:
        key = (v.get("d"), str(v.get("cc")))
        if key in by:
            by[key]["views"].append(v)

    cases = []
    seen_uuids = set()
    for (d, cc), g in by.items():
        cr, vw = g["crashes"], g["views"]
        uuids = sorted({c["m"] for c in cr if c.get("m")} | {v["m"] for v in vw if v.get("m")})
        seen_uuids |= {(d, u) for u in uuids}
        compressed_hit = any((d, u) in comp_keys for u in uuids)
        recov = sum(1 for c in cr if (c["u"], c.get("ai")) in loads_with_view)
        fetch_ok = sum(1 for v in vw if v.get("src") == "fetch")
        verdict = ("confirmed" if compressed_hit else
                   "likely" if (recov or fetch_ok) else "other")
        cases.append({
            "verdict": verdict, "client_domain": d, "custom_content_id": cc,
            "page_ids": sorted({str(c["pg"]) for c in cr if c.get("pg")}),
            "macro_uuids": uuids, "product_type": cr[0].get("pt"),
            "crashes": len(cr), "users": len({c["u"] for c in cr}),
            "first_crash": iso(min(c["t"] for c in cr)), "last_crash": iso(max(c["t"] for c in cr)),
            "crash_versions": sorted({c.get("v") for c in cr if c.get("v")}),
            "compressed_evidence": compressed_hit, "in_load_recoveries": recov,
            "fetch_ok_views": fetch_ok,
            "swr_views": sum(1 for v in vw if v.get("src") == "swr_cache"),
        })
    # Compressed macros never seen crashing: they will on their first cached revisit.
    for r in compressed:
        if (r["d"], r["m"]) not in seen_uuids:
            cases.append({"verdict": "at_risk", "client_domain": r["d"], "custom_content_id": None,
                          "macro_uuids": [r["m"]], "compressed_events": r["n"]})
    order = {"confirmed": 0, "likely": 1, "other": 2, "at_risk": 3}
    cases.sort(key=lambda c: (order[c["verdict"]], -(c.get("crashes") or 0)))
    out = {"generated": today(), "from": args.frm, "to": to, "reason": REASON, "cases": cases}
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    cnt = collections.Counter(c["verdict"] for c in cases)
    print(f"wrote {args.out}: {dict(cnt)}")
    for c in cases:
        if c["verdict"] != "at_risk":
            print(f'{c["verdict"]:9} {c["client_domain"]:28} cc={c["custom_content_id"]:>12} crashes={c["crashes"]:>3} '
                  f'users={c["users"]} compressed={int(c["compressed_evidence"])} recov={c["in_load_recoveries"]} '
                  f'fetch_ok={c["fetch_ok_views"]} last={c["last_crash"][:10]}')


def vkey(v):
    return v or ""


def check(args):
    data = json.load(open(args.cases))
    cases = [c for c in data["cases"] if c["verdict"] in args.verdicts.split(",")]
    frm, to = args.frm, args.to or today()
    crashes = fetch_crashes(frm, to)
    ids = sorted({c["custom_content_id"] for c in cases if c.get("custom_content_id")})
    views = fetch_views(frm, to, ids) if ids else []
    uuid_keys = {(c["client_domain"], u): c for c in cases for u in c["macro_uuids"]}
    fixed = lambda v: vkey(v) >= args.fixed_version  # app_version strings sort by build time

    rows = []
    for c in cases:
        key_cc = c.get("custom_content_id")
        mine = lambda e: e.get("d") == c["client_domain"] and (
            (key_cc and str(e.get("cc")) == key_cc) or e.get("m") in c["macro_uuids"])
        cr_new = [e for e in crashes if mine(e) and fixed(e.get("v"))]
        vw_new = [e for e in views if mine(e) and fixed(e.get("v"))]
        status = ("STILL_FAILING" if cr_new else
                  "fixed_seen" if vw_new else "not_viewed_since_fix")
        rows.append((status, c["verdict"], c["client_domain"], key_cc or "-", len(cr_new), len(vw_new)))
    rows.sort()
    print(f"fixed-version >= {args.fixed_version}, window {frm}..{to}")
    for r in rows:
        print("%-21s %-9s %-28s cc=%-12s crashes=%d views=%d" % r)
    print(dict(collections.Counter(r[0] for r in rows)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("find")
    f.add_argument("--from", dest="frm", default="2026-07-29")
    f.add_argument("--to")
    f.add_argument("--compressed-from", default="2026-06-01")
    f.add_argument("--out", required=True)
    c = sub.add_parser("check")
    c.add_argument("--cases", required=True)
    c.add_argument("--fixed-version", required=True, help="first app_version with the fix, e.g. v2026.11.211200-lite")
    c.add_argument("--from", dest="frm", required=True, help="release date, YYYY-MM-DD")
    c.add_argument("--to")
    c.add_argument("--verdicts", default="confirmed,likely,at_risk")
    a = ap.parse_args()
    find(a) if a.cmd == "find" else check(a)


if __name__ == "__main__":
    main()
