#!/usr/bin/env python3
"""Print one user's Mixpanel events around a feedback submission, plus candidate diagrams.

Usage:
  python3 .claude/skills/feedback-attribution/scripts/context_window.py \
      --site <client_domain> --distinct-id <id> --at 2026-01-01T12:00:00Z --minutes 10 \
      [--json-out events.json]

Runs a JQL query through .claude/skills/mixpanel/scripts/mp_query.py (read-only).
Event times are printed in UTC. --json-out saves the rows for replay_parse.py.
"""
import argparse
import collections
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile

FEEDBACK_PREFIXES = ("csat_submitted", "feedback_report_submit", "magic_layout_feedback")
ID_PROPS = ("macro_uuid", "custom_content_id", "content_id", "page_id", "attachment_name",
            "surface", "feature_area", "report_reference", "feedback_score", "feedback_text")
SAVE_EVENTS = {"macro_save_succeeded", "macro_create_succeeded", "macro_publish_completed"}

JQL = r"""
function main() {
  var lo = Date.parse(%(lo)s), hi = Date.parse(%(hi)s);
  return Events({from_date: %(fd)s, to_date: %(td)s})
  .filter(function(e){
    return e.properties.client_domain === %(site)s && e.distinct_id === %(did)s
      && e.time >= lo && e.time <= hi && e.name !== "$mp_session_record";
  })
  .map(function(e){
    var p = e.properties, o = {t: new Date(e.time).toISOString(), n: e.name};
    var keys = %(keys)s;
    for (var i = 0; i < keys.length; i++) { if (p[keys[i]] !== undefined && p[keys[i]] !== null) o[keys[i]] = p[keys[i]]; }
    return o;
  });
}
"""

KEYS = ["macro_uuid", "custom_content_id", "content_id", "page_id", "macro_type", "surface",
        "event_category", "event_label", "session_replay_source", "session_replay_percent",
        "$mp_replay_id", "attachment_name", "feature_area", "report_reference",
        "feedback_score", "feedback_text", "app_version"]


def repo_root():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "..", ".."))


def run_query(args):
    at = dt.datetime.fromisoformat(args.at.replace("Z", "+00:00"))
    lo, hi = at - dt.timedelta(minutes=args.minutes), at + dt.timedelta(minutes=args.minutes)
    # Mixpanel from/to dates are in the project timezone (AEDT/AEST); widen by a day each side
    # and filter on e.time (epoch ms) instead.
    fd = (lo - dt.timedelta(days=1)).date().isoformat()
    td = (hi + dt.timedelta(days=1)).date().isoformat()
    script = JQL % {
        "lo": json.dumps(lo.strftime("%Y-%m-%dT%H:%M:%SZ")), "hi": json.dumps(hi.strftime("%Y-%m-%dT%H:%M:%SZ")),
        "fd": json.dumps(fd), "td": json.dumps(td), "site": json.dumps(args.site),
        "did": json.dumps(args.distinct_id), "keys": json.dumps(KEYS),
    }
    mp = os.path.join(repo_root(), ".claude", "skills", "mixpanel", "scripts", "mp_query.py")
    with tempfile.TemporaryDirectory() as tmp:
        js, out = os.path.join(tmp, "q.js"), os.path.join(tmp, "out.json")
        with open(js, "w") as f:
            f.write(script)
        r = subprocess.run([sys.executable, mp, "--file", js, "--output", out], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(out):
            sys.exit("mp_query failed (read status: failed):\n" + r.stderr[-1500:])
        with open(out) as f:
            return json.load(f)


def short(v, n=8):
    v = "" if v is None else str(v)
    return v[:n]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True, help="Mixpanel client_domain (bare subdomain)")
    ap.add_argument("--distinct-id", required=True)
    ap.add_argument("--at", required=True, help="Feedback time, ISO UTC, e.g. 2026-01-01T12:00:00Z")
    ap.add_argument("--minutes", type=int, default=10)
    ap.add_argument("--json-out", help="Save raw rows here (input for replay_parse.py --events)")
    args = ap.parse_args()

    rows = sorted(run_query(args), key=lambda r: r["t"])
    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump(rows, f, indent=1)
    print(f"read_status={'ok' if rows else 'empty'} rows={len(rows)} window=±{args.minutes}m around {args.at} (UTC)")

    fb = [r for r in rows if r["n"].startswith(FEEDBACK_PREFIXES)]
    print("\n== Feedback events and the identifiers they carry")
    if not fb:
        print("  none in window")
    for r in fb:
        ids = {k: r.get(k) for k in ID_PROPS}
        print(f"  {r['t'][11:19]} {r['n']}")
        for k, v in ids.items():
            print(f"     {k:18} {v if v is not None else 'null'}")
        if not ids.get("custom_content_id"):
            print("     -> no custom_content_id: a link to a diagram can only be 'suspected', never 'verified'")

    print("\n== Events (UTC)")
    print("  time     event                          macro    cc_id         page_id       type     surface  label                replay_src   replay_id")
    for r in rows:
        print("  {t} {n:30} {m:8} {cc:13} {pg:13} {mt:8} {s:8} {l:20} {src:12} {rid}".format(
            t=r["t"][11:19], n=r["n"][:30], m=short(r.get("macro_uuid")), cc=short(r.get("custom_content_id"), 13),
            pg=short(r.get("page_id"), 13), mt=short(r.get("macro_type")), s=short(r.get("surface")),
            l=short(r.get("event_label"), 20), src=short(r.get("session_replay_source"), 12),
            rid=short(r.get("$mp_replay_id"))))

    cand = collections.OrderedDict()
    for r in rows:
        cc = r.get("custom_content_id")
        key = (r.get("page_id") or "?", cc or ("uuid:" + short(r.get("macro_uuid")) if r.get("macro_uuid") else None))
        if key[1] is None:
            continue
        c = cand.setdefault(key, collections.Counter())
        c["events"] += 1
        if r["n"] in SAVE_EVENTS:
            c["saves"] += 1
        if r["n"] == "macro_viewed":
            c["views"] += 1
        if r["n"] == "convert_to_png" and r.get("event_category") == "error":
            c["png_fail"] += 1
        if r.get("macro_type"):
            c["type:" + r["macro_type"]] += 0
    # convert_to_png carries macro_uuid but not always custom_content_id: fold uuid rows into their cc row
    uuid_to_cc = {short(r.get("macro_uuid")): r.get("custom_content_id") for r in rows
                  if r.get("macro_uuid") and r.get("custom_content_id")}
    merged = collections.OrderedDict()
    for (pg, cc), c in cand.items():
        if cc.startswith("uuid:") and uuid_to_cc.get(cc[5:]):
            cc = uuid_to_cc[cc[5:]]
            pg = next((k[0] for k in cand if k[1] == cc), pg)
        merged.setdefault((pg, cc), collections.Counter()).update(c)

    fb_pages = {r.get("page_id") for r in fb if r.get("page_id")}
    print("\n== Candidate diagrams (page_id, custom_content_id); * = same page as a feedback event")
    print("  page_id        custom_content_id    type          events saves views png_fail")
    for (pg, cc), c in merged.items():
        types = ",".join(k[5:] for k in c if k.startswith("type:")) or "-"
        mark = "*" if pg in fb_pages else " "
        print(f" {mark}{pg:14} {cc:20} {types:13} {c['events']:6} {c['saves']:5} {c['views']:5} {c['png_fail']:8}")


if __name__ == "__main__":
    main()
