#!/usr/bin/env python3
"""Summarise Mixpanel session replays saved from the Get-User-Replays-Data MCP tool.

Usage:
  python3 .claude/skills/replay-forensics/scripts/replay_parse.py RESULT.txt [RESULT2.txt ...] \
      [--events events.json] [--compare-urls urls.json] [--burst-min 5]

RESULT.txt   the file the MCP tool saved ({"data": [{replay_id, replay_url, replay_analysis, replay_events}]})
--events     JSON list of {t: ISO UTC, n: event name, event_label?, macro_uuid?} rows, e.g. from
             feedback-attribution/scripts/context_window.py --json-out; matched to bursts by second
--compare-urls JSON list of URL strings or paths (e.g. image hrefs from a diagram) to overlap with the
             failed-fetch URLs

Prints, per replay: id, url (only as returned by the tool), time span (UTC), line kinds with counts,
failed-fetch bursts per second by host, user actions, and same-second alignment with --events.
stdlib only; reads files, makes no network call.
"""
import argparse
import ast
import collections
import datetime as dt
import json
import re
import sys
from urllib.parse import urlparse

FETCH_FAIL = re.compile(r"Error recording fetch request to (\S+?):? (TypeError: .*|Error: .*)?$")
URL = re.compile(r"https?://\S+")
ACTION = re.compile(r"^(Navigated to|Clicked|Focused|Typed|Scrolled|Pressed)")


def utc(ts):
    return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_replays(paths):
    out = []
    for p in paths:
        with open(p) as f:
            d = json.load(f)
        if isinstance(d, list) and d and isinstance(d[0], dict) and "text" in d[0]:
            d = json.loads(d[0]["text"])  # raw MCP content-block form
        out.extend(d.get("data", []) if isinstance(d, dict) else d)
    return out


def parse_events_field(v):
    if not v:
        return []
    if isinstance(v, list):
        return v
    try:
        return json.loads(v)
    except ValueError:
        return ast.literal_eval(v)  # the tool returns a Python repr (single quotes, None)


def parse_lines(analysis):
    rows = []
    for line in (analysis or "").splitlines():
        m = re.match(r"^(\d{9,11}): (.*)$", line)
        if m:
            rows.append((int(m.group(1)), m.group(2)))
        elif rows:
            rows[-1] = (rows[-1][0], rows[-1][1] + " " + line)
    return rows


def kind(text):
    k = URL.sub("<URL>", text)
    k = re.sub(r"\d{3,}", "<N>", k)
    return k[:110]


def to_epoch(iso):
    return int(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--events")
    ap.add_argument("--compare-urls")
    ap.add_argument("--burst-min", type=int, default=5, help="min failed fetches in one second to call a burst")
    args = ap.parse_args()

    ext = []
    if args.events:
        with open(args.events) as f:
            ext = [dict(r, _s=to_epoch(r["t"])) for r in json.load(f)]
    compare = None
    if args.compare_urls:
        with open(args.compare_urls) as f:
            compare = {urlparse(u).path if u.startswith("http") else "/" + u.lstrip("/") for u in json.load(f)}

    replays = load_replays(args.files)
    print(f"replays={len(replays)}")
    all_failed = set()
    for r in replays:
        rows = parse_lines(r.get("replay_analysis"))
        evs = parse_events_field(r.get("replay_events"))
        ts = [t for t, _ in rows] + [e.get("event_time") for e in evs if e.get("event_time")]
        print("\n" + "=" * 100)
        print(f"replay_id  {r.get('replay_id')}")
        print(f"replay_url {r.get('replay_url') or 'NOT RETURNED - re-query by distinct_id + dates; never build one'}")
        if ts:
            print(f"span       {utc(min(ts))} .. {utc(max(ts))}  ({max(ts) - min(ts)} s)")
        print(f"lines={len(rows)} replay_events={len(evs)}" + ("  (replay_events empty: use Mixpanel events instead)" if not evs else ""))

        kinds = collections.Counter(kind(t) for _, t in rows)
        print("\n  line kinds")
        for k, n in kinds.most_common(12):
            print(f"   {n:4}  {k}")

        fails = collections.defaultdict(collections.Counter)
        reasons = collections.Counter()
        for t, text in rows:
            m = FETCH_FAIL.search(text)
            if m:
                u = m.group(1)
                all_failed.add(u)
                fails[t][urlparse(u).netloc or "?"] += 1
                reasons[(m.group(2) or "?").strip()] += 1
        if fails:
            print("\n  failed fetch() calls by the page (Mixpanel network plugin). Reasons:", dict(reasons))
            print("   'TypeError: Failed to fetch' cannot separate CSP, CORS and network failure.")
            print("   second (UTC)          total  by host")
            for t in sorted(fails):
                tot = sum(fails[t].values())
                mark = " BURST" if tot >= args.burst_min else ""
                print(f"   {utc(t)}  {tot:5}  {dict(fails[t])}{mark}")

        acts = [(t, x) for t, x in rows if ACTION.match(x)]
        if acts:
            print("\n  user actions")
            for t, x in acts:
                print(f"   {utc(t)}  {URL.sub(lambda m: urlparse(m.group(0)).netloc + '/…', x)[:100]}")

        if evs:
            print("\n  replay_events (embedded, names only)")
            print("   " + ", ".join(f"{utc(e['event_time'])[11:19]} {e['event_name']}" for e in evs))

        bursts = [t for t in fails if sum(fails[t].values()) >= args.burst_min]
        if ext and bursts:
            print("\n  burst alignment with --events (same second = 0 s, else nearest within 5 s)")
            for b in sorted(bursts):
                near = sorted(ext, key=lambda e: abs(e["_s"] - b))
                hits = [e for e in near if abs(e["_s"] - b) <= 5][:3]
                desc = "; ".join(f"{e['n']}/{e.get('event_label') or '-'} {e['_s'] - b:+d}s" for e in hits) or "none within 5 s"
                print(f"   {utc(b)}  {desc}")

    if compare is not None:
        paths = {urlparse(u).path for u in all_failed}
        both = paths & compare
        print("\n" + "=" * 100)
        print(f"compare-urls: failed unique paths={len(paths)} reference paths={len(compare)} overlap={len(both)}")
        print(f"   failed but not in reference: {len(paths - compare)}; reference not seen failing: {len(compare - paths)}")


if __name__ == "__main__":
    sys.exit(main())
