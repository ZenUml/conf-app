#!/usr/bin/env python3
"""Error radar: flag new and unusual conf-app error signatures in Mixpanel.

One run looks at one UTC day (default: yesterday) against the 30 days before
it and reports four alert kinds:

  new           signature never seen in the baseline window
  spike         count far above the median of comparable days (weekday vs weekend)
  concentrated  one tenant suddenly owns most of a signature
  spread        a signature reaching many more tenants than usual

The run is stateless: the baseline is recomputed from Mixpanel every time, and
an alert is suppressed when the same alert fired in the previous few days at a
similar volume, so a standing problem alerts on its onset and on doublings.

Usage:
    radar.py                          # yesterday, print the Slack text
    radar.py --day 2026-10-16 --post  # post to $SLACK_ERROR_RADAR_WEBHOOK
    radar.py --post --state last-day  # every day after the one in last-day, up to yesterday
    radar.py --save-data d.json       # also keep the raw Mixpanel rows
    radar.py --input d.json --backtest 2026-09-20 2026-10-16

Output names real tenants. Never write it to the public repo, a public issue,
or a CI log — the Slack channel is the only destination (see SKILL.md).
"""

import argparse
import base64
import datetime as dt
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "../../../.."))
PROJECT_ID = 3373228
JQL_URL = "https://mixpanel.com/api/query/jql"
BOARD_URL = "https://mixpanel.com/project/3373228/view/3879592/app/boards#id=11235796"

# Public baseline from the mixpanel skill (JQL has no computed properties, so
# `is_internal_client_domain` is not available here). Contains-match.
INTERNAL_DOMAINS = [
    "zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod",
    "dia-stg", "asyncapi-stg", "async-prd", "diagramly", "danshuitaihejie",
]
NO_TENANT = {"(none)", "unknown_atlassian_domain"}

BASELINE_DAYS = 30
SUPPRESS_DAYS = 3
FETCH_DAYS = BASELINE_DAYS + SUPPRESS_DAYS + 1

# Tuned by backtest over 2026-09-20..10-19 (see SKILL.md). Raw = unweighted
# events actually received; a 10%-sampled event needs real arrivals before its
# x10 extrapolation can alert.
NEW_MIN_EVENTS = 5
NEW_MIN_TENANTS = 2
NEW_MIN_RAW = 3
MIN_RAW = 10
SPIKE_RATIO = 2.5
SPIKE_MIN_DELTA = 50
CONC_MIN_EVENTS = 50
CONC_MIN_SHARE = 0.5
CONC_MIN_SHARE_GAIN = 0.25
SPREAD_RATIO = 2.5
SPREAD_MIN_TENANTS = 8
SPREAD_MIN_EVENTS = 25
REALERT_RATIO = 2.0
MAX_ALERTS_SHOWN = 12
CATCH_UP_MAX_DAYS = 7

KIND_LABEL = {
    "new": ":new: NEW",
    "spike": ":chart_with_upwards_trend: SPIKE",
    "concentrated": ":dart: CONCENTRATED",
    "spread": ":globe_with_meridians: SPREAD",
}
KIND_ORDER = ["new", "spike", "concentrated", "spread"]


# --------------------------------------------------------------------------
# Mixpanel
# --------------------------------------------------------------------------

def auth_header():
    user, secret = os.environ.get("MIXPANEL_SA_USER"), os.environ.get("MIXPANEL_SA_SECRET")
    if user and secret:
        token = f"{user}:{secret}"
    elif user or secret:
        # Half a service account is a configuration mistake, not a cue to fall
        # back to .env.mixpanel (whose FileNotFoundError hid this in CI).
        missing = "MIXPANEL_SA_USER" if not user else "MIXPANEL_SA_SECRET"
        raise SystemExit(f"{missing} is not set (the other half of the Mixpanel service account is).")
    else:
        api_secret = os.environ.get("MIXPANEL_API_SECRET")
        if not api_secret:
            sys.path.insert(0, os.path.join(REPO_ROOT, ".claude/skills/mixpanel/scripts"))
            from mp_query import load_api_secret  # noqa: E402
            api_secret = load_api_secret()
        token = f"{api_secret}:"
    return "Basic " + base64.b64encode(token.encode()).decode()


def run_jql(script, retries=5):
    data = urllib.parse.urlencode({"script": script, "project_id": PROJECT_ID}).encode()
    for attempt in range(retries):
        req = urllib.request.Request(JQL_URL, data=data, method="POST")
        req.add_header("Authorization", auth_header())
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                wait = 60 * (attempt + 1)
                print(f"rate limited, waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            body = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"JQL HTTP {e.code}: {body}") from None
    raise RuntimeError("JQL retries exhausted")


def jql_script(from_date, to_date, mode):
    with open(os.path.join(HERE, "signature.js")) as f:
        signature_js = f.read().split("if (typeof module")[0]
    internal = json.dumps(INTERNAL_DOMAINS)
    if mode == "counts":
        tail = """
    .groupBy([day, sig, domain, version], mixpanel.reducer.numeric_summary(weight));"""
    else:
        tail = """
    .groupBy([day, sig, function (e) { return e.distinct_id; }], mixpanel.reducer.null())
    .groupBy([function (r) { return r.key[0]; }, function (r) { return r.key[1]; }], mixpanel.reducer.count());"""
    return signature_js + f"""
var INTERNAL = {internal};
function domainOf(e) {{ return e.properties.client_domain || '(none)'; }}
function isInternal(d) {{
  for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true;
  return false;
}}
function day(e) {{ return new Date(e.time).toISOString().slice(0, 10); }}
function sig(e) {{ return radarSignature(e.name, e.properties); }}
function domain(e) {{ return domainOf(e); }}
function version(e) {{ return e.properties.app_version || '-'; }}
function weight(e) {{ return 1 / (Number(e.properties.sample_rate) || 1); }}
function main() {{
  return Events({{ from_date: '{from_date}', to_date: '{to_date}' }})
    .filter(function (e) {{ return radarIsErrorEvent(e.name, e.properties) && !isInternal(domainOf(e)); }})""" + tail + "\n}\n"


def fetch(first_day, last_day):
    # Project-timezone day boundaries differ from UTC; pad and re-bucket by UTC.
    from_date = (first_day - dt.timedelta(days=1)).isoformat()
    to_date = (last_day + dt.timedelta(days=1)).isoformat()
    counts = run_jql(jql_script(from_date, to_date, "counts"))
    time.sleep(5)
    users = run_jql(jql_script(from_date, to_date, "users"))
    return {"counts": counts, "users": users}


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------

class Data:
    def __init__(self, raw):
        self.total = defaultdict(float)                         # (day, sig) -> weighted events
        self.raw = defaultdict(float)                           # (day, sig) -> events received
        self.tenants = defaultdict(lambda: defaultdict(float))  # (day, sig) -> tenant -> events
        self.versions = defaultdict(lambda: defaultdict(float))
        self.users = defaultdict(int)                           # (day, sig) -> distinct users (unweighted)
        self.by_sig_days = defaultdict(set)
        for row in raw["counts"]:
            day, sig, tenant, version = row["key"]
            value = row["value"]
            n = value["sum"] if isinstance(value, dict) else float(value)
            self.total[(day, sig)] += n
            self.raw[(day, sig)] += value["count"] if isinstance(value, dict) else n
            self.tenants[(day, sig)][tenant] += n
            self.versions[(day, sig)][version] += n
            self.by_sig_days[sig].add(day)
        for row in raw["users"]:
            day, sig = row["key"]
            self.users[(day, sig)] = int(row["value"])

    def sigs_on(self, day):
        return [s for s, days in self.by_sig_days.items() if day in days]

    def real_tenants(self, day, sig):
        return {t: n for t, n in self.tenants.get((day, sig), {}).items() if t not in NO_TENANT and n > 0}


def iso(d):
    return d.isoformat()


def same_type_days(day, count):
    """The `count` previous days with the same weekday/weekend type as `day`."""
    weekend = day.weekday() >= 5
    out, d = [], day
    while len(out) < count:
        d -= dt.timedelta(days=1)
        if (d.weekday() >= 5) == weekend:
            out.append(d)
    return out


def raw_alerts(data, day):
    """{signature: (kinds, ctx)} for every alert condition true on `day`, before suppression."""
    key_day = iso(day)
    baseline = [iso(day - dt.timedelta(days=i)) for i in range(1, BASELINE_DAYS + 1)]
    comparable = [iso(d) for d in same_type_days(day, 8 if day.weekday() >= 5 else 20)]
    out = {}
    for sig in data.sigs_on(key_day):
        count = data.total[(key_day, sig)]
        raw = data.raw[(key_day, sig)]
        tenants = data.real_tenants(key_day, sig)
        base_total = sum(data.total.get((d, sig), 0.0) for d in baseline)
        ctx = {"count": count, "tenants": len(tenants)}
        kinds = []

        if base_total == 0:
            # A new signature has no baseline to spike, concentrate or spread against.
            # At least one real tenant: unresolved-context events are dev builds or boot noise.
            if raw >= NEW_MIN_RAW and tenants and (count >= NEW_MIN_EVENTS or len(tenants) >= NEW_MIN_TENANTS):
                out[sig] = (["new"], ctx)
            continue
        if raw < MIN_RAW:
            continue

        median = statistics.median([data.total.get((d, sig), 0.0) for d in comparable])
        if count > SPIKE_RATIO * max(median, 1.0) and count - median >= SPIKE_MIN_DELTA:
            kinds.append("spike")
            ctx["median"] = median

        if count >= CONC_MIN_EVENTS and tenants:
            top, top_n = max(tenants.items(), key=lambda kv: kv[1])
            share = top_n / count
            base_top = sum(data.tenants.get((d, sig), {}).get(top, 0.0) for d in baseline)
            base_share = base_top / base_total
            if share > CONC_MIN_SHARE and share - base_share >= CONC_MIN_SHARE_GAIN:
                kinds.append("concentrated")
                ctx.update(tenant=top, share=share, base_share=base_share)

        med_tenants = statistics.median([len(data.real_tenants(d, sig)) for d in comparable])
        if (count >= SPREAD_MIN_EVENTS and len(tenants) >= SPREAD_MIN_TENANTS
                and len(tenants) > SPREAD_RATIO * max(med_tenants, 1.0)):
            kinds.append("spread")
            ctx["median_tenants"] = med_tenants
        if kinds:
            out[sig] = (kinds, ctx)
    return out


def detect(data, day):
    """Alerts for `day`, one per signature, minus kinds that already fired recently at a similar size."""
    recent = {}
    for back in range(1, SUPPRESS_DAYS + 1):
        for sig, (kinds, ctx) in raw_alerts(data, day - dt.timedelta(days=back)).items():
            # A signature that alerted as new should not re-alert as a spike
            # against its own near-empty baseline the next day.
            for k in kinds + (["spike"] if "new" in kinds else []):
                recent[(k, sig)] = max(recent.get((k, sig), 0.0), ctx["count"])
    out = []
    for sig, (kinds, ctx) in raw_alerts(data, day).items():
        fresh = [k for k in kinds if not (recent.get((k, sig)) is not None and ctx["count"] < REALERT_RATIO * recent[(k, sig)])]
        if fresh:
            out.append(enrich(data, day, fresh, sig, ctx))
    out.sort(key=lambda a: (KIND_ORDER.index(a["kinds"][0]), -a["count"]))
    return out


def enrich(data, day, kinds, sig, ctx):
    key = (iso(day), sig)
    tenants = sorted(data.real_tenants(*key).items(), key=lambda kv: -kv[1])
    versions = sorted(data.versions.get(key, {}).items(), key=lambda kv: -kv[1])
    name, error_name, status, error_class, message = (sig.split(" | ", 4) + ["-"] * 5)[:5]
    return {
        "kinds": kinds, "signature": sig, "event": name, "error_name": error_name,
        "http_status": status, "confluence_error_class": error_class, "message": message,
        "users": data.users.get(key, 0),
        "top_tenants": [(t, round(n)) for t, n in tenants[:3]],
        "top_version": versions[0][0] if versions else "-",
        **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in ctx.items()},
    }


# --------------------------------------------------------------------------
# Blind spots and rendering
# --------------------------------------------------------------------------

def blind_spots(now):
    """Error-looking event names whose current sample rate is 0 (not recorded at all)."""
    path = os.path.join(REPO_ROOT, "src/utils/analytics/eventSampling.ts")
    window = os.path.join(REPO_ROOT, "src/lib/octoberBudgetWindow.js")
    try:
        src = open(path).read()
        win = open(window).read()
    except OSError:
        return None
    names = set(re.findall(r'^\s*([a-z_]+):\s*0,', src, re.M))
    dates = re.findall(r"Date\.UTC\((\d+),\s*(\d+),\s*(\d+)\)", win)
    if len(dates) >= 2:
        start, end = (dt.date(int(y), int(m) + 1, int(d)) for y, m, d in dates[:2])
        if start <= now < end:
            block = re.search(r"OCTOBER_STOP_EVENTS = new Set<string>\(\[(.*?)\]\);", src, re.S)
            if block:
                names |= set(re.findall(r'"([a-z_]+)"', block.group(1)))
    error_like = re.compile(r"(_failed|_error|_missing|_timeout|_exception|orphan_observed)$")
    return sorted(n for n in names if error_like.search(n))


def fmt_n(x):
    return f"{x:,.0f}"


def render(day, alerts, blind, signatures_seen):
    lines = [f"*Error radar — {iso(day)} (UTC)* · {len(alerts)} alert(s) across {signatures_seen} error signatures"]
    if not alerts:
        lines.append("Nothing new or unusual.")
    for a in alerts[:MAX_ALERTS_SHOWN]:
        detail = f"`{a['error_name']}` `{a['http_status']}`" if a["error_name"] != "-" or a["http_status"] != "-" else ""
        label = " + ".join(KIND_LABEL[k] for k in a["kinds"])
        lines.append(f"\n{label} · *{a['event']}* {detail}".rstrip())
        if a["message"] != "-":
            lines.append(f"> {a['message']}")
        facts = [f"{fmt_n(a['count'])} events", f"{a['tenants']} tenants", f"{a['users']} users"]
        if "spike" in a["kinds"]:
            facts.append(f"usual {fmt_n(a['median'])}/day")
        if "concentrated" in a["kinds"]:
            facts.append(f"{a['tenant']} {a['share']:.0%} (was {a['base_share']:.0%})")
        if "spread" in a["kinds"]:
            facts.append(f"usual {a['median_tenants']:.0f} tenants")
        lines.append(" · ".join(facts))
        tops = ", ".join(f"{t} ({n})" for t, n in a["top_tenants"])
        lines.append(f"top: {tops or '—'} · version {a['top_version']}")
    if len(alerts) > MAX_ALERTS_SHOWN:
        lines.append(f"\n…and {len(alerts) - MAX_ALERTS_SHOWN} more (run radar.py --day {iso(day)} for all).")
    if blind:
        lines.append(f"\n:see_no_evil: Not recorded right now (sample rate 0): {', '.join(blind)}")
    elif blind is None:
        lines.append("\n:warning: Could not read eventSampling.ts; blind spots unknown.")
    lines.append(f"Counts are extrapolated by sample_rate; internal sites excluded. <{BOARD_URL}|Board>")
    return "\n".join(lines)


def post_webhook(url, text):
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Slack webhook HTTP {resp.status}")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_day(s):
    return dt.date.fromisoformat(s)


def read_state(path):
    """The last day already posted, or None when there is no usable state."""
    try:
        with open(path) as f:
            return dt.date.fromisoformat(f.read().strip())
    except (OSError, ValueError):
        return None


def write_state(path, day):
    # Never move backwards: a manual re-run of an old day must not make the
    # next scheduled run repeat the days after it.
    last = read_state(path)
    if last is None or day > last:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w") as f:
            f.write(iso(day) + "\n")


def days_to_report(explicit, last_posted, yesterday):
    """An explicit day, else every day after the last one posted up to yesterday.

    A scheduled run that starts hours late, or not at all, then neither skips
    nor repeats a day. Without state it is yesterday alone.
    """
    if explicit:
        return [explicit]
    if last_posted is None:
        return [yesterday]
    first = max(last_posted + dt.timedelta(days=1), yesterday - dt.timedelta(days=CATCH_UP_MAX_DAYS - 1))
    out = []
    while first <= yesterday:
        out.append(first)
        first += dt.timedelta(days=1)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--day", type=parse_day, help="UTC day to examine (default: yesterday)")
    ap.add_argument("--input", help="read raw Mixpanel rows from this file instead of querying")
    ap.add_argument("--save-data", help="write the raw Mixpanel rows here (contains tenant names)")
    ap.add_argument("--backtest", nargs=2, type=parse_day, metavar=("FROM", "TO"))
    ap.add_argument("--json", action="store_true", help="print alerts as JSON instead of Slack text")
    ap.add_argument("--post", action="store_true", help="post to $SLACK_ERROR_RADAR_WEBHOOK")
    ap.add_argument("--quiet", action="store_true", help="print only a tenant-free summary (for CI logs)")
    ap.add_argument("--state", help="file holding the last day posted; without --day, report every day after it")
    args = ap.parse_args(argv)

    today = dt.datetime.now(dt.timezone.utc).date()
    if args.backtest:
        first, last = args.backtest
        days = []
    else:
        days = days_to_report(args.day, read_state(args.state) if args.state else None, today - dt.timedelta(days=1))
        if not days:
            print("error radar: every day up to yesterday is already posted", file=sys.stderr)
            return 0
        first, last = days[0], days[-1]
    if args.input:
        raw = json.load(open(args.input))
    else:
        raw = fetch(first - dt.timedelta(days=FETCH_DAYS), last)
        if args.save_data:
            json.dump(raw, open(args.save_data, "w"))
    data = Data(raw)

    if args.backtest:
        d = first
        while d <= last:
            alerts = detect(data, d)
            kinds = ",".join(f"{k}:{sum(k in a['kinds'] for a in alerts)}" for k in KIND_ORDER)
            print(f"{iso(d)} {d.strftime('%a')} alerts={len(alerts):2d} {kinds}")
            for a in alerts:
                extra = a.get("tenant") or ""
                print(f"    {'+'.join(a['kinds']):20s} {fmt_n(a['count']):>6s} t={a['tenants']:<3d} {extra:20s} {a['signature'][:110]}")
            d += dt.timedelta(days=1)
        return 0

    url = os.environ.get("SLACK_ERROR_RADAR_WEBHOOK")
    if args.post and not url:
        print("SLACK_ERROR_RADAR_WEBHOOK is not set; nothing posted", file=sys.stderr)
        return 2
    blind = blind_spots(today)
    for day in days:
        alerts = detect(data, day)
        text = render(day, alerts, blind, len(data.sigs_on(iso(day))))
        if args.quiet:
            kinds = ", ".join(f"{k}={sum(k in a['kinds'] for a in alerts)}" for k in KIND_ORDER)
            print(f"error radar {iso(day)}: {len(alerts)} alerts ({kinds})")
        elif args.json:
            print(json.dumps({"day": iso(day), "alerts": alerts}, indent=2))
        else:
            print(text)
        if args.post:
            post_webhook(url, text)
            print(f"posted {iso(day)} to Slack", file=sys.stderr)
            if args.state:
                write_state(args.state, day)
    return 0


if __name__ == "__main__":
    sys.exit(main())
