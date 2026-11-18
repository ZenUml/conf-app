#!/usr/bin/env python3
"""
mp_listing.py — Marketplace search demand and listing visibility for the ZenUML apps.

Subcommands:
  keywords   search appearances of our apps (by week, by term, by period) and the
             share of chosen terms in all Marketplace searches (by month, by source)
  rank       position of our apps in the public Marketplace website search, per term

Sources (read-only):
  * Marketplace reporting API **v3**: https://api.atlassian.com/marketplace/rest/3
    /reporting/developer-space/<developerId>/...  (basic auth, FORGE_EMAIL / FORGE_API_TOKEN)
    The v2 paths /rest/2/vendors/<vendorId>/reporting/search-keywords answer 410
    ("legacy API has been deprecated and disabled for your account") since 2026-11.
    `developerId` is a UUID: GET /rest/3/developer-space/vendor/<vendorId>.
  * Public website search: https://marketplace.atlassian.com/rest/2/addons?text=... (no auth).

Traps this script encodes (all hit in the direction E research, 2026-11-17..19):
  1. Weeks in the search report are labelled by their SUNDAY. Install series elsewhere use
     Monday weeks; keep the label, do not shift it silently.
  2. The per-term report lists one term more than once (hostingFilter "cloud" and None).
     Terms are merged by lower-cased text.
  3. 2026-06-12: Atlassian turned analytics cookies off by default for regulated regions.
     The search reports are built from browser analytics, so every series steps down there
     (Lite fell 70% that week while installs did not move). A window that crosses this date
     is flagged.
  4. `search-keywords-v2` counts all users, but only from 2026-09-25; for earlier dates it
     returns the same numbers as v1. The per-app reports have no v2.
  5. The top-500 lists carry junk terms (a random 30-character string held ~21% of the
     in-product share in 2026). Terms that look random are dropped before shares are summed.
  6. The brand/generic split (`--brand-regex`) is a lens, not a finding. In the 2026-11
     research it was chosen after the data was seen.
"""
import argparse, base64, datetime, json, os, re, sys, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mp_report import APPS, VENDOR, load_creds, find_env  # noqa: E402

V3 = "https://api.atlassian.com/marketplace/rest/3"
PUBLIC = "https://marketplace.atlassian.com/rest/2"
COOKIE_BREAK = datetime.date(2026, 6, 12)
V2_FROM = datetime.date(2026, 9, 25)
JUNK = re.compile(r"[a-z0-9]{20,}")
DEFAULT_BRAND = r"zen ?-?uml"
DEFAULT_DEMAND = (r"diagram|uml|mermaid|flow ?chart|draw\.?io|gliffy|lucid|whiteboard|"
                  r"mind ?map|bpmn|excalidraw|\bmiro\b")
SOURCES = ("marketplace", "embedded-marketplace")   # website, in-product search


# ----- pure helpers (tested) ----------------------------------------------------
def d(s):
    return datetime.date.fromisoformat(s[:10])


def merge_terms(details):
    """Per-term report rows -> {term_lower: {date: count}}. Duplicates (hostingFilter
    'cloud' / None) are summed."""
    out = {}
    for row in details:
        t = (row.get("searchKeyword") or "").strip().lower()
        if not t:
            continue
        dst = out.setdefault(t, {})
        for e in row.get("elements") or []:
            dst[e["date"]] = dst.get(e["date"], 0) + int(e.get("count") or 0)
    return out


def sum_window(series, start, end):
    """series: {date_str: count}; inclusive window on the Sunday week label."""
    return sum(c for k, c in series.items() if start <= d(k) <= end)


def weeks_in(start, end):
    """Number of Sunday labels in [start, end]."""
    n, x = 0, start
    while x.weekday() != 6:
        x += datetime.timedelta(1)
    while x <= end:
        n += 1
        x += datetime.timedelta(7)
    return n


def crosses_break(start, end):
    return start < COOKIE_BREAK <= end


def demand_share(details, pattern):
    """Top-500 list -> (share %, matched terms, junk %) for terms that match `pattern`."""
    rx = re.compile(pattern, re.I)
    junk = sum(r["percentage"] for r in details if JUNK.fullmatch(r["searchKeyword"].lower()))
    hit = [r for r in details if rx.search(r["searchKeyword"]) and not JUNK.fullmatch(r["searchKeyword"].lower())]
    return round(sum(r["percentage"] for r in hit), 2), hit, round(junk, 2)


def rank_of(details, term):
    for i, r in enumerate(details, 1):
        if r["searchKeyword"].lower() == term.lower():
            return i, r["percentage"]
    return None, None


def select_apps(apps, app):
    """'' = all apps; an alias of mp_report (lite, full, diagramly, asyncapi) = that addonKey;
    otherwise a case-insensitive substring of addonKey or addonName."""
    if not app:
        return list(apps)
    if app in APPS:
        return [a for a in apps if a["addonKey"] == APPS[app]]
    q = app.lower()
    return [a for a in apps if q in a["addonKey"].lower() or q in a["addonName"].lower()]


def is_vendor(addon, vendor_id):
    """Public search item -> True when the vendor link ends in /vendors/<vendor_id>."""
    href = addon.get("_embedded", {}).get("vendor", {}).get("_links", {}).get("self", {}).get("href", "")
    return href.rstrip("/").endswith(f"/vendors/{vendor_id}")


def month_windows(start, end):
    out, y, m = [], start.year, start.month
    while datetime.date(y, m, 1) <= end:
        s = datetime.date(y, m, 1)
        nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
        out.append((s, min(nxt - datetime.timedelta(1), end)))
        y, m = nxt.year, nxt.month
    return out


# ----- fetch ----------------------------------------------------------------------
def _get(url, auth=None, timeout=60):
    h = {"Accept": "application/json"}
    if auth:
        h["Authorization"] = auth
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read()[:300]
        hint = ""
        if e.code == 410:
            hint = " (a v2 reporting path; use the v3 base " + V3 + ")"
        sys.exit(f"ERROR {e.code} {url}{hint}: {body!r}")


def developer_id(auth):
    return _get(f"{V3}/developer-space/vendor/{VENDOR}", auth)["developerId"]


def rep(dev, path, auth, **q):
    qs = urllib.parse.urlencode({k: v for k, v in q.items() if v})
    return _get(f"{V3}/reporting/developer-space/{dev}/{path}" + (f"?{qs}" if qs else ""), auth)


# ----- keywords -------------------------------------------------------------------
def parse_period(s):
    a, b = s.split("..")
    return d(a), d(b)


def cmd_keywords(args):
    email, tok = load_creds(args.env or find_env())
    auth = "Basic " + base64.b64encode(f"{email}:{tok}".encode()).decode()
    dev = developer_id(auth)
    apps = rep(dev, "search-keywords", auth)["addons"]
    want = select_apps(apps, args.app)
    if not want:
        sys.exit("no app matches --app; apps: " + ", ".join(a["addonKey"] for a in apps))
    periods = [parse_period(p) for p in args.period] if args.period else []
    brand = re.compile(args.brand_regex, re.I)
    out = {"developerId": dev, "week_label": "Sunday", "apps": [], "demand": []}

    for a in want:
        weekly = {e["date"]: e["count"] for e in a["elements"]}
        rec = {"addonKey": a["addonKey"], "addonName": a["addonName"], "productId": a["productId"],
               "searchAppearances": a["searchAppearances"], "periods": []}
        terms = merge_terms(rep(dev, f"products/{a['productId']}/search-keywords", auth)["details"]) if periods else {}
        for s, e in periods:
            w = weeks_in(s, e)
            b = {k: v for k, v in terms.items() if brand.search(k)}
            g = {k: v for k, v in terms.items() if not brand.search(k)}
            row = {"from": s.isoformat(), "to": e.isoformat(), "weeks": w,
                   "all": sum_window(weekly, s, e),
                   "brand": sum(sum_window(v, s, e) for v in b.values()),
                   "generic": sum(sum_window(v, s, e) for v in g.values()),
                   "crosses_cookie_break": crosses_break(s, e)}
            if args.term:
                row["terms"] = {t: sum(sum_window(v, s, e) for k, v in terms.items() if t.lower() in k)
                                for t in args.term}
            rec["periods"].append(row)
        if args.weekly:
            rec["weekly"] = {k: v for k, v in sorted(weekly.items()) if not args.since or d(k) >= d(args.since)}
        out["apps"].append(rec)

    if args.demand_from:
        s0, e0 = d(args.demand_from), d(args.demand_to) if args.demand_to else datetime.date.today()
        for ms, me in month_windows(s0, e0):
            for src in SOURCES:
                for ver in ("search-keywords",) + (("search-keywords-v2",) if me >= V2_FROM else ()):
                    det = rep(dev, f"{ver}/source/{src}", auth, startDate=ms.isoformat(), endDate=me.isoformat())["details"]
                    share, hits, junk = demand_share(det, args.demand_regex)
                    row = {"month": ms.isoformat()[:7], "to": me.isoformat(), "source": src, "report": ver,
                           "share": share, "terms_matched": len(hits), "junk_share": junk}
                    for t in args.term or []:
                        row["rank_" + t] = rank_of(det, t)
                    out["demand"].append(row)

    if args.json:
        print(json.dumps(out, indent=1))
        return
    print(f"developerId {dev}; weeks are labelled by Sunday; brand regex {args.brand_regex!r}")
    for r in out["apps"]:
        print(f"\n## {r['addonName']} ({r['addonKey']}) — {r['searchAppearances']} appearances since 2022")
        for p in r["periods"]:
            flag = "  !! crosses cookie break 2026-06-12" if p["crosses_cookie_break"] else ""
            extra = "  " + " ".join(f"{t}={c}" for t, c in p.get("terms", {}).items()) if p.get("terms") else ""
            w = p["weeks"] or 1
            print(f"  {p['from']}..{p['to']} ({p['weeks']} wk): all {p['all']} ({p['all']/w:.1f}/wk)  "
                  f"brand {p['brand']} ({p['brand']/w:.1f}/wk)  generic {p['generic']} ({p['generic']/w:.1f}/wk){extra}{flag}")
        if "weekly" in r:
            print("  weekly: " + " ".join(f"{k[5:]}:{v}" for k, v in r["weekly"].items()))
    if out["demand"]:
        print(f"\n## Share of all Marketplace searches matching {args.demand_regex!r} (top 500 terms, junk removed)")
        for r in out["demand"]:
            ranks = " ".join(f"{k[5:]}={v[0]}/{v[1]}" for k, v in r.items() if k.startswith("rank_") and v[0])
            print(f"  {r['month']} {r['source']:<21} {r['report']:<18} {r['share']:5.2f}%  "
                  f"({r['terms_matched']} terms, junk {r['junk_share']}%) {ranks}")
        print("  note: v2 differs from v1 only from 2026-09-25; marketplace = website, embedded-marketplace = in-product")


# ----- rank -----------------------------------------------------------------------
def cmd_rank(args):
    rows = []
    for t in args.term:
        q = urllib.parse.urlencode({"text": t, "application": "confluence", "hosting": "cloud", "limit": 50,
                                    "offset": 0})
        data = _get(f"{PUBLIC}/addons?{q}")
        items = data.get("_embedded", {}).get("addons", [])
        hits = [(i, x["key"], x["name"]) for i, x in enumerate(items, 1) if is_vendor(x, args.vendor)]
        rows.append({"term": t, "results": len(items), "ours": [{"rank": i, "key": k, "name": n} for i, k, n in hits]})
    if args.json:
        print(json.dumps({"date": datetime.date.today().isoformat(), "rows": rows}, indent=1))
        return
    print(f"website search rank, {datetime.date.today()} (first 50 results; vendor {args.vendor})")
    for r in rows:
        ours = ", ".join(f"{o['rank']} {o['name']}" for o in r["ours"]) or "not in first 50"
        print(f"  {r['term']:<20} {ours}")
    print("in-product rank is not in any API: read /wiki/marketplace/discover?q=<term>&page=N as a site admin (SKILL.md)")


def main():
    ap = argparse.ArgumentParser(description="Marketplace search demand and listing visibility.")
    ap.add_argument("--env", default=None)
    ap.add_argument("--json", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("keywords", help="search appearances of our apps + demand share of terms")
    p.add_argument("--app", default="lite", help="text matched against addonKey/name (default: lite); '' = all")
    p.add_argument("--period", action="append", help="YYYY-MM-DD..YYYY-MM-DD; repeat for a before/after compare")
    p.add_argument("--term", action="append", help="term to count inside --period and to rank in --demand-*")
    p.add_argument("--brand-regex", default=DEFAULT_BRAND)
    p.add_argument("--weekly", action="store_true", help="print the weekly series")
    p.add_argument("--since", default=None, help="with --weekly: first date shown")
    p.add_argument("--demand-from", default=None, help="YYYY-MM-DD: monthly demand share from this date")
    p.add_argument("--demand-to", default=None)
    p.add_argument("--demand-regex", default=DEFAULT_DEMAND)
    p.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    p.set_defaults(func=cmd_keywords)

    p = sub.add_parser("rank", help="website search rank of our apps for terms (public API, no auth)")
    p.add_argument("term", nargs="+")
    p.add_argument("--vendor", default=VENDOR, help=f"vendor id (default {VENDOR})")
    p.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    p.set_defaults(func=cmd_rank)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
