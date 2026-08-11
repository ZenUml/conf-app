#!/usr/bin/env python3
"""Authoritative event-name and property lookup for conf-app analytics.

The source of truth is the CODE, never a hand-maintained list:

  src/utils/analytics/catalog.ts  -> the `AnalyticsEventName` union (valid event names)
  src/utils/analytics/types.ts    -> the `AnalyticsProperties` vocabulary + doc comments
  emit sites in src/**            -> which properties actually ride which event

Nothing here is hardcoded. Every answer is re-derived from the repo at call
time, so this file cannot drift the way a prose reference would.

Why this exists (2026-08-11): a dashboard was built with `space_key` as the
space dimension on `macro_viewed`. `space_key` is a real declared property, but
it belongs to the Cloudflare backend's macro-count snapshot events; on
`macro_viewed` it is 100% undefined. The correct property is `confluence_space`,
which the tracker auto-injects on every event. The mistake survived a probe
because the probe ran against a SINGLE tenant that had one space: a distinct
count of `space_key` returned 1 (counting the single value "undefined") and a
distinct count of `confluence_space` also returned 1 (the tenant's one real
space). Only a fleet-wide comparison separates them: 1 vs 1842.

    Rule: never validate a property against one tenant. Use `verify`, which is
    fleet-wide by construction and reports the undefined-only case explicitly.

Usage:
    python3 mp_schema.py events [pattern]        # valid event names
    python3 mp_schema.py props  [pattern]        # declared properties + doc comments
    python3 mp_schema.py check  <property>       # declaration, doc comment, emit sites
    python3 mp_schema.py event  <event_name>     # properties passed at that event's emit sites
    python3 mp_schema.py verify <event> <prop>   # LIVE fleet-wide check against Mixpanel
    python3 mp_schema.py doctor                  # working tree vs origin/main for the two files

Options:
    --ref <git-ref>   Read the .ts sources from a git ref instead of the working
                      tree (e.g. --ref origin/main, --ref v2026.08.092209-lite).
    --days N          Window for `verify` (default 30).
"""

import argparse
import json
import os
import re
import subprocess
import sys

REPO_MARKER = "src/utils/analytics/catalog.ts"
CATALOG = "src/utils/analytics/catalog.ts"
TYPES = "src/utils/analytics/types.ts"
TRACKER = "src/utils/analytics/trackAnalyticsEvent.ts"
PROJECT_ID = 3373228


# --------------------------------------------------------------------------
# Repo access
# --------------------------------------------------------------------------

def repo_root():
    """Locate the conf-app checkout that holds the analytics sources."""
    here = os.path.abspath(os.path.dirname(__file__))
    d = here
    while d != "/":
        if os.path.exists(os.path.join(d, REPO_MARKER)):
            return d
        d = os.path.dirname(d)
    fallback = os.path.expanduser("~/workspaces/zenuml/conf-app")
    if os.path.exists(os.path.join(fallback, REPO_MARKER)):
        return fallback
    raise FileNotFoundError(
        "Cannot locate a conf-app checkout containing " + REPO_MARKER
    )


def read_source(path, ref=None):
    root = repo_root()
    if ref:
        out = subprocess.run(
            ["git", "-C", root, "show", "{}:{}".format(ref, path)],
            capture_output=True, text=True,
        )
        if out.returncode != 0:
            raise SystemExit("git show {}:{} failed: {}".format(ref, path, out.stderr.strip()))
        return out.stdout
    with open(os.path.join(root, path)) as f:
        return f.read()


def tree_matches_origin(path):
    """True when the working-tree copy equals origin/main's. None when unknown."""
    root = repo_root()
    out = subprocess.run(
        ["git", "-C", root, "diff", "--quiet", "origin/main", "--", path],
        capture_output=True, text=True,
    )
    if out.returncode == 0:
        return True
    if out.returncode == 1:
        return False
    return None


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

def _leading_comment(lines, idx):
    """Collect the `//` comment block immediately above lines[idx]."""
    block = []
    j = idx - 1
    while j >= 0:
        s = lines[j].strip()
        if s.startswith("//"):
            block.append(s.lstrip("/").strip())
            j -= 1
        elif s == "":
            break
        else:
            break
    return " ".join(reversed(block))


def parse_events(ref=None):
    """Event names from the `AnalyticsEventName` union in catalog.ts."""
    src = read_source(CATALOG, ref)
    lines = src.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if re.search(r"export\s+type\s+AnalyticsEventName\s*=", ln):
            start = i
            break
    if start is None:
        raise SystemExit("AnalyticsEventName union not found in " + CATALOG)

    events = []
    for i in range(start + 1, len(lines)):
        ln = lines[i]
        m = re.match(r'\s*\|\s*"([^"]+)"', ln)
        if m:
            events.append({"name": m.group(1), "doc": _leading_comment(lines, i)})
            continue
        if ln.strip().endswith(";") or re.match(r"\s*export\s", ln):
            if events:
                break
    return events


def parse_props(ref=None):
    """Declared properties from the `AnalyticsProperties` type in types.ts."""
    src = read_source(TYPES, ref)
    lines = src.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if re.search(r"export\s+type\s+AnalyticsProperties\s*=\s*\{", ln):
            start = i
            break
    if start is None:
        raise SystemExit("AnalyticsProperties type not found in " + TYPES)

    props, depth, section = [], 0, ""
    for i in range(start, len(lines)):
        ln = lines[i]
        depth += ln.count("{") - ln.count("}")
        if i > start and depth <= 0:
            break
        s = ln.strip()
        # Track the nearest standalone comment block as a section label.
        if s.startswith("//") and i + 1 < len(lines) and not re.match(r"\s*\w+\??\s*:", lines[i + 1]):
            section = s.lstrip("/").strip()
        m = re.match(r"\s*(\w+)(\??)\s*:\s*(.+?);?\s*$", ln)
        if m and not s.startswith("//"):
            props.append({
                "name": m.group(1),
                "required": m.group(2) != "?",
                "type": m.group(3).rstrip(";").strip(),
                "doc": _leading_comment(lines, i),
                "section": section,
            })
    return props


def _brace_slice(src, open_idx):
    """Return the text of the object literal starting at src[open_idx] == '{'."""
    depth, i = 0, open_idx
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[open_idx:i + 1]
        i += 1
    return src[open_idx:]


def parse_emit_sites(ref=None):
    """Map event name -> {property -> [file:line]} by scanning tracker call sites.

    Handles both `trackAnalyticsEvent('name', {...})` and
    `trackUpgradeEvent(UpgradeEventName.NAME, {...})`.
    """
    root = repo_root()
    if ref:
        listing = subprocess.run(
            ["git", "-C", root, "ls-tree", "-r", "--name-only", ref, "src/"],
            capture_output=True, text=True,
        ).stdout.splitlines()
        files = [p for p in listing if p.endswith((".ts", ".vue")) and ".spec." not in p]
        reader = lambda p: read_source(p, ref)
    else:
        files = []
        for dirpath, _dirs, names in os.walk(os.path.join(root, "src")):
            for n in names:
                if n.endswith((".ts", ".vue")) and ".spec." not in n:
                    files.append(os.path.relpath(os.path.join(dirpath, n), root))
        reader = lambda p: open(os.path.join(root, p)).read()

    call_re = re.compile(
        r"track(?:AnalyticsEvent|UpgradeEvent)\(\s*"
        r"(?:['\"](?P<lit>[\w]+)['\"]|(?P<enum>[\w.]+))\s*,\s*(?=\{)"
    )
    key_re = re.compile(r"^\s*(?:\.\.\.)?([A-Za-z_]\w*)\s*:", re.M)

    out = {}
    for path in files:
        try:
            src = reader(path)
        except Exception:
            continue
        if "trackAnalyticsEvent(" not in src and "trackUpgradeEvent(" not in src:
            continue
        for m in call_re.finditer(src):
            name = m.group("lit") or m.group("enum")
            body = _brace_slice(src, m.end())
            line = src.count("\n", 0, m.start()) + 1
            bucket = out.setdefault(name, {})
            for k in key_re.findall(body):
                bucket.setdefault(k, []).append("{}:{}".format(path, line))
    return out


def auto_enriched_names(ref=None):
    """Properties the tracker injects on EVERY event.

    Parsed from the `enriched` object literal in trackAnalyticsEvent.ts, NOT
    from the section comments in types.ts. The comments are organisational and
    have already been wrong once: `confluence_space` sits under "Contextual"
    yet the tracker auto-injects it with a `getSpaceKey() ?? "unknown_space"`
    fallback. The runtime object is the authority.
    """
    src = read_source(TRACKER, ref)
    m = re.search(r"const\s+enriched\s*:\s*Record<[^>]*>\s*=\s*\{", src)
    if not m:
        return []
    body = _brace_slice(src, src.index("{", m.end() - 1))
    names, depth = [], 0
    for line in body.splitlines():
        depth += line.count("{") + line.count("(") - line.count("}") - line.count(")")
        km = re.match(r"\s*([A-Za-z_]\w*)\s*:", line)
        if km and depth <= 1:
            names.append(km.group(1))
    # Conditionally-spread helpers (sample_rate, space-admin, demo-page) are not
    # unconditional, so they are reported separately by `check`, not here.
    return names


# --------------------------------------------------------------------------
# Live verification
# --------------------------------------------------------------------------

def verify_live(event, prop, days):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from mp_query import load_api_secret, run_jql  # noqa: E402
    import datetime

    today = datetime.date.today()
    frm = (today - datetime.timedelta(days=days)).isoformat()
    to = today.isoformat()

    # Two separate reductions. The defined/undefined split groups on a
    # two-valued key, so it is exact. The distinct count groups on the raw
    # value and IS subject to JQL's group cap, so it is treated as a lower
    # bound and self-checked: when the summed group counts fall short of the
    # exact defined total, the grouping was truncated and the number is
    # reported as ">= N" rather than as the true cardinality.
    split_script = """
function main() {
  return Events({
    from_date: "%s", to_date: "%s",
    event_selectors: [{event: "%s"}]
  }).groupBy(
    [function (x) {
       var v = x.properties["%s"];
       return (v === undefined || v === null) ? "UNDEFINED" : "DEFINED";
     }],
    mixpanel.reducer.count()
  );
}
""" % (frm, to, event, prop)

    distinct_script = """
function main() {
  return Events({
    from_date: "%s", to_date: "%s",
    event_selectors: [{event: "%s"}]
  }).groupBy(
    [function (x) {
       var v = x.properties["%s"];
       return (v === undefined || v === null) ? "__UNDEFINED__" : String(v);
     }],
    mixpanel.reducer.count()
  );
}
""" % (frm, to, event, prop)

    secret = load_api_secret()
    split_rows = run_jql(split_script, secret, pace=0) or []
    defined = undefined = 0
    for r in split_rows:
        key = (r.get("key") or [None])[0]
        if key == "DEFINED":
            defined = r.get("value", 0)
        elif key == "UNDEFINED":
            undefined = r.get("value", 0)

    distinct, samples, counted = 0, [], 0
    if defined:
        for r in (run_jql(distinct_script, secret, pace=0) or []):
            key = (r.get("key") or [None])[0]
            if key == "__UNDEFINED__":
                continue
            distinct += 1
            counted += r.get("value", 0)
            if len(samples) < 8:
                samples.append([key, r.get("value", 0)])

    row = {
        "defined_events": defined,
        "undefined_events": undefined,
        "distinct_defined": distinct,
        "samples": samples,
        "truncated": bool(defined) and counted < defined,
    }
    return frm, to, row


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def cmd_events(args):
    evs = parse_events(args.ref)
    if args.pattern:
        evs = [e for e in evs if args.pattern.lower() in e["name"].lower()]
    for e in evs:
        print(e["name"])
        if args.verbose and e["doc"]:
            print("    " + e["doc"][:300])
    print("\n{} event name(s). Source: {}{}".format(
        len(evs), CATALOG, " @ " + args.ref if args.ref else " (working tree)"), file=sys.stderr)


def cmd_props(args):
    props = parse_props(args.ref)
    if args.pattern:
        props = [p for p in props if args.pattern.lower() in p["name"].lower()]
    auto = set(auto_enriched_names(args.ref))
    for p in props:
        tag = "  [auto-enriched on every event]" if p["name"] in auto else ""
        print("{:<28} {}{}".format(p["name"], p["type"], tag))
        if args.verbose and p["doc"]:
            print("    " + p["doc"][:300])
    print("\n{} declared propert(ies). Source: {}{}".format(
        len(props), TYPES, " @ " + args.ref if args.ref else " (working tree)"), file=sys.stderr)


def cmd_check(args):
    props = parse_props(args.ref)
    match = [p for p in props if p["name"] == args.property]
    if not match:
        near = [p["name"] for p in props if args.property.lower() in p["name"].lower()]
        print("NOT DECLARED in {}: {}".format(TYPES, args.property))
        if near:
            print("Did you mean: " + ", ".join(near))
        return 1
    p = match[0]
    auto = p["name"] in set(auto_enriched_names(args.ref))

    print("property     : {}".format(p["name"]))
    print("type         : {}".format(p["type"]))
    print("required     : {}".format("yes" if p["required"] else "no (optional)"))
    print("auto-enriched: {}".format(
        "YES — the tracker injects it on every event" if auto
        else "no — only present when an emit site passes it"))
    if p["section"]:
        print("section      : {}".format(p["section"][:400]))
    if p["doc"]:
        print("doc          : {}".format(p["doc"][:800]))

    sites = parse_emit_sites(args.ref)
    carriers = sorted(ev for ev, keys in sites.items() if p["name"] in keys)
    print("\nemitted with : {}".format(
        ", ".join(carriers) if carriers else
        "(no literal emit site found — auto-enriched, spread via a context helper, or backend-emitted)"))
    if not auto and not carriers:
        print("\nWARNING: neither auto-enriched nor found at any emit site.")
        print("Before using it as a dimension, run:")
        print("  python3 mp_schema.py verify <event> {}".format(p["name"]))
    return 0


def cmd_event(args):
    evs = {e["name"] for e in parse_events(args.ref)}
    if args.event not in evs:
        near = [e for e in evs if args.event.lower() in e.lower()]
        print("NOT a declared event name in {}: {}".format(CATALOG, args.event))
        if near:
            print("Did you mean: " + ", ".join(sorted(near)))
        return 1
    sites = parse_emit_sites(args.ref)
    keys = sites.get(args.event, {})
    auto = auto_enriched_names(args.ref)
    print("event: {}\n".format(args.event))
    print("auto-enriched on every event (always available):")
    for a in auto:
        print("  {}".format(a))
    print("\npassed at this event's emit sites:")
    if not keys:
        print("  (none found — the event may be emitted by the backend, or via a spread helper)")
    for k in sorted(keys):
        print("  {:<28} {}".format(k, keys[k][0]))
    return 0


def cmd_verify(args):
    frm, to, row = verify_live(args.event, args.property, args.days)
    defined = row.get("defined_events", 0)
    undef = row.get("undefined_events", 0)
    distinct = row.get("distinct_defined", 0)
    total = defined + undef

    print("event    : {}".format(args.event))
    print("property : {}".format(args.property))
    print("window   : {} .. {}  (FLEET-WIDE — all tenants, by design)".format(frm, to))
    print("events   : {}".format(total))
    print("defined  : {}".format(defined))
    print("undefined: {}".format(undef))
    print("distinct : {}{}".format(">= " if row.get("truncated") else "", distinct))
    if row.get("truncated"):
        print("           (JQL group cap truncated the grouping; treat as a lower bound)")
    if row.get("samples"):
        print("samples  : " + ", ".join("{}={}".format(k, v) for k, v in row["samples"]))

    print()
    if total == 0:
        print("VERDICT: no events in the window. Widen --days or check the event name.")
        return 1
    if defined == 0:
        print("VERDICT: UNUSABLE. The property is never populated on this event.")
        print("A per-tenant distinct count would still return 1 here, counting the")
        print("single value 'undefined'. That is the trap this command exists for.")
        return 1
    if distinct <= 1:
        print("VERDICT: CONSTANT. Populated but only one distinct value fleet-wide;")
        print("useless as a breakdown dimension.")
        return 1
    print("VERDICT: USABLE. {} distinct values across {} defined events.".format(distinct, defined))
    return 0


def cmd_doctor(args):
    print("repo: {}".format(repo_root()))
    stale = False
    for path in (CATALOG, TYPES):
        same = tree_matches_origin(path)
        label = {True: "matches origin/main",
                 False: "DIFFERS from origin/main",
                 None: "comparison unavailable (fetch origin?)"}[same]
        print("  {:<36} {}".format(path, label))
        if same is False:
            stale = True
    print("  events declared   : {}".format(len(parse_events(None))))
    print("  properties declared: {}".format(len(parse_props(None))))
    if stale:
        print("\nThe working tree differs from origin/main for an analytics source.")
        print("Re-run with --ref origin/main to read the shipped vocabulary instead.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", help="git ref to read the .ts sources from (e.g. origin/main)")
    ap.add_argument("--days", type=int, default=30, help="window for verify (default 30)")
    ap.add_argument("-v", "--verbose", action="store_true", help="include doc comments")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("events"); p.add_argument("pattern", nargs="?"); p.set_defaults(fn=cmd_events)
    p = sub.add_parser("props"); p.add_argument("pattern", nargs="?"); p.set_defaults(fn=cmd_props)
    p = sub.add_parser("check"); p.add_argument("property"); p.set_defaults(fn=cmd_check)
    p = sub.add_parser("event"); p.add_argument("event"); p.set_defaults(fn=cmd_event)
    p = sub.add_parser("verify"); p.add_argument("event"); p.add_argument("property"); p.set_defaults(fn=cmd_verify)
    p = sub.add_parser("doctor"); p.set_defaults(fn=cmd_doctor)

    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
