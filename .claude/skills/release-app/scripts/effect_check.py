#!/usr/bin/env python3
"""Before/after check of a fix's effect on one site after a production release.

Read-only. Release time from `gh release view <tag>`, events from Mixpanel via the mixpanel
skill's mp_query.py. Counts attempts (successes + failures), not just failures.

    python3 effect_check.py --site <client_domain> --variant full --tag v2026.11.052206-full
    options: --event convert_to_png --fail-label toPng_failed[,toPng_timeout] --ok-label toPng
             --ok-sample-rate 0.1 --days-before 7 --to YYYY-MM-DD --keep-raw DIR
"""

import argparse
import collections
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MP_QUERY = os.path.normpath(os.path.join(HERE, "..", "..", "mixpanel", "scripts", "mp_query.py"))


def published_at(tag):
    out = subprocess.run(["gh", "release", "view", tag, "--repo", "ZenUml/conf-app", "--json", "publishedAt,isDraft"],
                         check=True, capture_output=True, text=True).stdout
    info = json.loads(out)
    if info.get("isDraft") or not info.get("publishedAt"):
        sys.exit(f"{tag} is not published; nothing to compare")
    return datetime.fromisoformat(info["publishedAt"].replace("Z", "+00:00"))


def jql(script, tmpdir):
    js, out = os.path.join(tmpdir, "effect.js"), os.path.join(tmpdir, "effect.json")
    with open(js, "w") as f:
        f.write(script)
    subprocess.run([sys.executable, MP_QUERY, "--file", js, "--output", out, "--pace", "2"], check=True)
    with open(out) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True, help="Mixpanel client_domain (bare subdomain)")
    ap.add_argument("--variant", required=True, choices=["lite", "full", "diagramly", "asyncapi"])
    ap.add_argument("--tag", required=True, help="published release tag, e.g. v2026.11.052206-full")
    ap.add_argument("--event", default="convert_to_png")
    ap.add_argument("--fail-label", default="toPng_failed,toPng_timeout")
    ap.add_argument("--ok-label", default="toPng")
    ap.add_argument("--ok-sample-rate", type=float, default=0.1,
                    help="sampling rate of the success label (convert_to_png success = 0.1; errors are never sampled)")
    ap.add_argument("--days-before", type=int, default=7)
    ap.add_argument("--to", help="end date (default today UTC)")
    ap.add_argument("--keep-raw", help="directory to keep the JQL script and raw result")
    a = ap.parse_args()

    fail_labels = [s for s in a.fail_label.split(",") if s]
    rel = published_at(a.tag)
    rel_ms = rel.timestamp() * 1000
    frm = (rel - timedelta(days=a.days_before)).strftime("%Y-%m-%d")
    to = a.to or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tmpdir = a.keep_raw or tempfile.mkdtemp(prefix="effect-check-")
    os.makedirs(tmpdir, exist_ok=True)

    # Variant filter: product_type when present, else the app_version suffix.
    script = """function main() {
  return Events({from_date:%s,to_date:%s,event_selectors:[{event:%s},{event:"macro_viewed"}]})
  .filter(function(e){var p=e.properties; if (p.client_domain!==%s) return false;
     var pt=p.product_type, v=String(p.app_version||'');
     return pt ? pt===%s : v.slice(-%d)===%s;})
  .map(function(e){var p=e.properties;return {t:e.time,n:e.name,l:p.event_label||'',m:p.macro_uuid||'',v:p.app_version||'',u:e.distinct_id,sr:p.sample_rate||null};});
}""" % (json.dumps(frm), json.dumps(to), json.dumps(a.event), json.dumps(a.site), json.dumps(a.variant),
        len(a.variant) + 1, json.dumps("-" + a.variant))
    rows = jql(script, tmpdir)

    def period(after):
        return [r for r in rows if (r["t"] >= rel_ms) == after]

    def stats(rs):
        ev = [r for r in rs if r["n"] == a.event]
        fails = [r for r in ev if r["l"] in fail_labels]
        oks = [r for r in ev if r["l"] == a.ok_label]
        # src/utils/window.ts stamps `sample_rate` on each kept non-error event when < 1;
        # budget windows lower it further, so weight per event and use the flag only as fallback.
        est_ok = sum(1 / (r.get("sr") or a.ok_sample_rate) for r in oks)
        return {
            "events": len(ev),
            "users": len({r["u"] for r in ev}),
            "failures": len(fails),
            "successes_raw": len(oks),
            "successes_est": round(est_ok),
            "attempts_est": round(len(fails) + est_ok),
            "failure_rate_est": (len(fails) / (len(fails) + est_ok)) if (fails or oks) else None,
            "views": len([r for r in rs if r["n"] == "macro_viewed"]),
            "versions": dict(collections.Counter(r["v"] for r in ev)),
        }

    pre, post = stats(period(False)), stats(period(True))
    hours_after = (min(datetime.now(timezone.utc), datetime.fromisoformat(to + "T23:59:59+00:00")) - rel).total_seconds() / 3600
    print(f"site={a.site} variant={a.variant} tag={a.tag} published={rel.isoformat()} window={frm}..{to} "
          f"(before {a.days_before} d, after {hours_after:.1f} h)")
    print(f"event={a.event} fail={fail_labels} ok={a.ok_label} (ok weighted by each event's sample_rate; fallback {a.ok_sample_rate})")
    print(f"{'':10}{'events':>8}{'users':>7}{'fails':>7}{'ok_raw':>8}{'ok_est':>8}{'attempts':>10}{'fail%':>8}{'views':>7}")
    for name, s in (("before", pre), ("after", post)):
        rate = "-" if s["failure_rate_est"] is None else f"{100 * s['failure_rate_est']:.0f}%"
        print(f"{name:10}{s['events']:>8}{s['users']:>7}{s['failures']:>7}{s['successes_raw']:>8}{s['successes_est']:>8}"
              f"{s['attempts_est']:>10}{rate:>8}{s['views']:>7}")
    print(f"after, on {a.tag}: {post['versions'].get(a.tag, 0)} events; versions after release {post['versions']}")

    failing = sorted({r["m"] for r in period(False) if r["n"] == a.event and r["l"] in fail_labels and r["m"]})
    print(f"\npreviously failing macros: {len(failing)}")
    unattempted_views = 0
    for i, m in enumerate(failing, 1):
        rs = [r for r in period(True) if r["m"] == m]
        v = len([r for r in rs if r["n"] == "macro_viewed"])
        f = len([r for r in rs if r["n"] == a.event and r["l"] in fail_labels])
        o = len([r for r in rs if r["n"] == a.event and r["l"] == a.ok_label])
        pre_f = len([r for r in period(False) if r["m"] == m and r["n"] == a.event and r["l"] in fail_labels])
        note = "no capture attempt seen" if v and not (f or o) else ""
        if note:
            unattempted_views += v
        print(f"  #{i} {m[:8]}… before fails={pre_f}  after views={v} fails={f} ok_raw={o} {note}")

    if post["failures"] == 0 and post["successes_raw"] == 0:
        verdict = "NO ATTEMPTS YET (unproven): zero failures but also zero capture attempts after the release"
    elif pre["failure_rate_est"] is not None and post["failure_rate_est"] is not None \
            and post["failure_rate_est"] < pre["failure_rate_est"]:
        verdict = "IMPROVED" + (" (failures remain)" if post["failures"] else "")
    elif pre["failure_rate_est"] is None:
        verdict = "NO BASELINE: no attempts before the release"
    else:
        verdict = "REGRESSED / NOT FIXED: failure rate did not drop"
    print(f"\nverdict: {verdict}")
    if unattempted_views:
        print(f"note: previously failing macros were viewed {unattempted_views}x after release with no capture event; "
              "capture runs only when the page attachment is missing or stale, and successes are sampled, "
              "so check the attachment or wait for an edit before calling it fixed.")


if __name__ == "__main__":
    main()
