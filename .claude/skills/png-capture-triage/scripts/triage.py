#!/usr/bin/env python3
"""Classify viewer PNG-capture failures (convert_to_png toPng_failed / toPng_timeout) per macro.

Read-only. Uses the mixpanel skill's mp_query.py (JQL) and, for failures the event chain does not
explain, graph-content-scan's scan.mjs (D1 mirror). See ../SKILL.md.

    python3 triage.py --site <client_domain> --from 2026-10-29 --to 2026-11-06 [--split-at 2026-11-05T12:32:00Z]
    options: --no-scan  --window-s 15  --json out.json  --keep-raw DIR
"""

import argparse
import collections
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.normpath(os.path.join(HERE, "..", ".."))
MP_QUERY = os.path.join(SKILLS, "mixpanel", "scripts", "mp_query.py")
SCAN = os.path.join(SKILLS, "graph-content-scan", "scripts", "scan.mjs")

FAIL_LABELS = ("toPng_failed", "toPng_timeout")
ORPHAN_EVENTS = ("load_custom_content_v2_missing", "customcontent_orphan_observed", "load_failed_shown")


def jql(script, tmpdir, name):
    js = os.path.join(tmpdir, name + ".js")
    out = os.path.join(tmpdir, name + ".json")
    with open(js, "w") as f:
        f.write(script)
    subprocess.run([sys.executable, MP_QUERY, "--file", js, "--output", out, "--pace", "2"], check=True)
    with open(out) as f:
        return json.load(f)


def iso_ms(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000


def failing_macros(site, frm, to, tmpdir):
    script = """function main() {
  return Events({from_date:%s,to_date:%s,event_selectors:[{event:"convert_to_png"}]})
  .filter(function(e){return e.properties.client_domain===%s;})
  .map(function(e){var p=e.properties;return {t:e.time,l:p.event_label||'',m:p.macro_uuid||'',v:p.app_version||''};});
}""" % (json.dumps(frm), json.dumps(to), json.dumps(site))
    rows = jql(script, tmpdir, "png")
    return rows, sorted({r["m"] for r in rows if r["l"] in FAIL_LABELS and r["m"]})


def macro_events(site, frm, to, uuids, tmpdir):
    script = """var U=%s;
function main() {
  return Events({from_date:%s,to_date:%s})
  .filter(function(e){return e.properties.client_domain===%s && U.indexOf(e.properties.macro_uuid)>=0 && e.name!=="$mp_session_record";})
  .map(function(e){var p=e.properties;return {t:e.time,n:e.name,l:String(p.event_label||'').slice(0,60),m:p.macro_uuid,
    v:p.app_version||'',u:e.distinct_id,stage:p.capture_failure_stage||'',err:String(p.capture_error||'').slice(0,120),
    mt:p.macro_type||p.diagram_type||''};});
}""" % (json.dumps(uuids), json.dumps(frm), json.dumps(to), json.dumps(site))
    return jql(script, tmpdir, "chain")


def scan(uuids):
    try:
        out = subprocess.run(["node", SCAN, "--json", "--macro-uuids", ",".join(uuids)],
                             check=True, capture_output=True, text=True, timeout=180).stdout
        return {r["macroUuid"]: r for r in json.loads(out)}
    except Exception as e:  # scan is best-effort enrichment
        print(f"scan failed ({e}); external-icon category stays unverified", file=sys.stderr)
        return None


def classify_fail(fail, chain, window_ms):
    """Category for one failure event from events of the same macro just before it."""
    if fail["l"] == "toPng_timeout":
        return "timeout", "event_label=toPng_timeout"
    if fail.get("stage"):
        if fail["stage"] == "external_icons":
            return "external_icons", "capture_failure_stage=external_icons"
        return "stage:" + fail["stage"], "capture_failure_stage=%s %s" % (fail["stage"], fail.get("err", ""))
    # The capture runs after the load, so look back further than ahead. Some of these names arrive
    # as event_label on a generic event (load_failed_shown is label of event `view`).
    near = [e for e in chain if -window_ms <= e["t"] - fail["t"] <= 2000 and e is not fail]
    names = {e["n"] for e in near} | {e["l"] for e in near}
    orphan = [n for n in ORPHAN_EVENTS if n in names]
    if orphan:
        return "orphan_404", "preceding " + "+".join(orphan)
    if "graph_math_not_ready" in names:
        return "math_not_ready", "preceding graph_math_not_ready"
    return "unexplained", "no load-failure or math event in the preceding window"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True, help="Mixpanel client_domain (bare subdomain)")
    ap.add_argument("--from", dest="frm", required=True)
    ap.add_argument("--to", required=True)
    ap.add_argument("--split-at", help="ISO time, e.g. a release publishedAt; splits counts before/after")
    ap.add_argument("--window-s", type=int, default=15, help="look-back seconds before each failure")
    ap.add_argument("--no-scan", action="store_true")
    ap.add_argument("--json", help="write per-macro result JSON here")
    ap.add_argument("--keep-raw", help="directory to keep JQL scripts and raw results")
    a = ap.parse_args()

    tmpdir = a.keep_raw or tempfile.mkdtemp(prefix="png-triage-")
    os.makedirs(tmpdir, exist_ok=True)
    split = parse_iso(a.split_at) if a.split_at else None

    png, uuids = failing_macros(a.site, a.frm, a.to, tmpdir)
    labels = collections.Counter(r["l"] for r in png)
    print(f"site={a.site} window={a.frm}..{a.to} convert_to_png events={len(png)} {dict(labels)}")
    if not uuids:
        print("no macro with toPng_failed/toPng_timeout in window (read_status=empty for this scope)")
        print("note: zero failures is not proof of health; count toPng successes too (see SKILL.md)")
        return

    chain = macro_events(a.site, a.frm, a.to, uuids, tmpdir)
    by_macro = collections.defaultdict(list)
    for e in chain:
        by_macro[e["m"]].append(e)

    results = []
    for m in uuids:
        ev = sorted(by_macro.get(m, []), key=lambda e: e["t"])
        fails = [e for e in ev if e["n"] == "convert_to_png" and e["l"] in FAIL_LABELS]
        cats = collections.Counter()
        evidence = {}
        for f in fails:
            c, why = classify_fail(f, ev, a.window_s * 1000)
            cats[c] += 1
            evidence.setdefault(c, why)

        def count(pred, after=None):
            sel = [e for e in ev if pred(e)]
            if split is None or after is None:
                return len(sel)
            return len([e for e in sel if (e["t"] >= split) == after])

        is_view = lambda e: e["n"] == "macro_viewed"
        is_ok = lambda e: e["n"] == "convert_to_png" and e["l"] == "toPng"
        is_fail = lambda e: e["n"] == "convert_to_png" and e["l"] in FAIL_LABELS
        is_up = lambda e: e["n"] in ("upload_attachment", "attachment_upload_succeeded")
        r = {
            "macro_uuid": m,
            "fails": len(fails),
            "successes_sampled": count(is_ok),
            "uploads_sampled": count(is_up),
            "first_fail": iso_ms(fails[0]["t"]) if fails else None,
            "last_fail": iso_ms(fails[-1]["t"]) if fails else None,
            "versions_failing": sorted({f["v"] for f in fails}),
            "users_failing": len({f["u"] for f in fails}),
            "categories": dict(cats),
            "evidence": evidence,
        }
        if split is not None:
            for k, pred in (("views", is_view), ("fails", is_fail), ("successes", is_ok), ("uploads", is_up)):
                r[k + "_before"] = count(pred, after=False)
                r[k + "_after"] = count(pred, after=True)
        results.append(r)

    unexplained = [r["macro_uuid"] for r in results if r["categories"].get("unexplained")]
    content = scan(unexplained) if unexplained and not a.no_scan else None
    for r in results:
        n = r["categories"].pop("unexplained", 0)
        if not n:
            continue
        c = (content or {}).get(r["macro_uuid"])
        if c is None:
            r["categories"]["unexplained"] = n
            r["evidence"]["unexplained"] = "no D1 row scanned" if content is not None else "scan skipped"
            continue
        src = c.get("imagesBySource", {})
        ext = {k: v for k, v in src.items() if k != "data:"}
        if ext:
            r["categories"]["external_icons_suspected"] = n
            r["evidence"]["external_icons_suspected"] = "D1 content images %s (suspected; confirm with a replay)" % json.dumps(ext)
        elif c.get("hasMath"):
            r["categories"]["math_suspected"] = n
            r["evidence"]["math_suspected"] = "D1 content has math=1 but no graph_math_not_ready event"
        else:
            r["categories"]["unexplained"] = n
            r["evidence"]["unexplained"] = "no external images or math in D1 content"
        if "unexplained" not in r["categories"]:
            r["evidence"].pop("unexplained", None)

    print()
    for i, r in enumerate(results, 1):
        main_cat = max(r["categories"], key=r["categories"].get) if r["categories"] else "-"
        line = (f"#{i} macro={r['macro_uuid']} fails={r['fails']} ok(sampled)={r['successes_sampled']} "
                f"uploads(sampled)={r['uploads_sampled']} first={r['first_fail']} last={r['last_fail']} "
                f"users={r['users_failing']} versions={','.join(r['versions_failing'])}")
        print(line)
        if split is not None:
            print(f"    before/after split: views {r['views_before']}/{r['views_after']} fails {r['fails_before']}/{r['fails_after']} "
                  f"ok {r['successes_before']}/{r['successes_after']} uploads {r['uploads_before']}/{r['uploads_after']}")
        print(f"    category={main_cat} {json.dumps(r['categories'])}")
        for c, why in r["evidence"].items():
            print(f"      {c}: {why}")

    total = collections.Counter()
    macros = collections.Counter()
    for r in results:
        for c, n in r["categories"].items():
            total[c] += n
        if r["categories"]:
            macros[max(r["categories"], key=r["categories"].get)] += 1
    print()
    print("summary (macros by main category / failures by category):")
    for c in sorted(set(total) | set(macros)):
        print(f"  {c}: macros={macros.get(c, 0)} fails={total.get(c, 0)}")
    print("note: toPng and upload counts are 10%-sampled raw counts; failures are never sampled.")

    if a.json:
        with open(a.json, "w") as f:
            json.dump(results, f, indent=2)
        print(f"wrote {a.json}", file=sys.stderr)


if __name__ == "__main__":
    main()
