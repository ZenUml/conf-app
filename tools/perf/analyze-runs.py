#!/usr/bin/env python3
"""Aggregate measure-page-load.mjs run JSONs into per-condition summaries.

Usage: python3 analyze-runs.py <results-dir> [<results-dir> ...]
Emits one JSON object per condition label found, with medians across runs,
per-origin transfer stats, key-asset timings, API call timings, and per-frame
readiness. Designed so analysis agents interpret numbers instead of parsing raw runs.
"""
import json, sys, os, re, statistics
from collections import defaultdict
from urllib.parse import urlparse

def median(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 1) if xs else None

KEY_ASSETS = [
    ("entry-index", re.compile(r"/assets/index-[A-Za-z0-9_-]+\.js")),
    ("tailwind-chunk", re.compile(r"/assets/tailwind-[A-Za-z0-9_-]+\.js")),
    ("zenuml-esm", re.compile(r"zenuml\.esm-[A-Za-z0-9_-]+\.js")),
    ("mermaid-vendor", re.compile(r"vendor/mermaid/")),
    ("DiagramPortal", re.compile(r"DiagramPortal-[A-Za-z0-9_-]+\.js")),
    ("GenericViewer", re.compile(r"GenericViewer-[A-Za-z0-9_-]+\.js")),
    ("OpenApiViewer", re.compile(r"OpenApiViewer-[A-Za-z0-9_-]+\.js")),
    ("dom-to-image", re.compile(r"dom-to-image")),
    ("plantuml-www", re.compile(r"plantuml\.com/plantuml")),
    ("drawio-assets", re.compile(r"/drawio/")),
]
API_PATTERNS = [
    ("custom-content-v2", re.compile(r"/wiki/api/v2/custom-content/")),
    ("pages-adf", re.compile(r"/wiki/api/v2/pages/\d+")),
    ("forge-invoke", re.compile(r"forge/entities|/webhook/|invocation|xen\.atlassian|forge\.cdn", re.I)),
    ("cloudflare-backend", re.compile(r"zenuml\.com/(metrics-cache|feature-flags|api/|forge-)")),
    ("mixpanel", re.compile(r"mixpanel\.com")),
    ("plantuml", re.compile(r"plantuml\.com")),
]

def origin(u):
    try:
        h = urlparse(u).hostname or "?"
        if h.endswith("cdn.prod.atlassian-dev.net"): return "forge-cdn"
        if h.endswith("atlassian.net"): return "confluence"
        if h.endswith("zenuml.com"): return "zenuml-backend"
        if "mixpanel" in h: return "mixpanel"
        if "plantuml" in h: return "plantuml.com"
        if h.endswith("atlassian.com") or h.endswith("atl-paas.net") or h.endswith("cloudfront.net"): return "atlassian-other"
        return h
    except Exception:
        return "?"

def load_runs(dirs):
    by_label = defaultdict(list)
    for d in dirs:
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json"): continue
            with open(os.path.join(d, fn)) as f:
                r = json.load(f)
            if r.get("discard"): continue
            by_label[r["label"]].append(r)
    return by_label

def all_resources(run):
    """(scope, resource) for main frame and each macro frame, with absolute-ish start."""
    out = []
    mp = run.get("mainPerf") or {}
    for r in mp.get("resources") or []:
        out.append(("main", r))
    for fr in run.get("frames") or []:
        for r in (fr.get("resources") or []):
            out.append((f"frame:{fr.get('type')}:{(fr.get('label') or '')[:20]}", r))
    return out

def summarize(label, runs):
    s = {"label": label, "runs": len(runs)}
    for k in ["firstMacroMs", "allMacrosMs", "paywallMs", "mainTtfb", "mainDcl", "mainLoad", "mainLcp", "cacheHitRatio", "totalRequests"]:
        s[k] = median([r["summary"].get(k) for r in runs])
    # per-frame readiness medians keyed by frame label
    fr = defaultdict(list)
    for r in runs:
        for f in r.get("frames") or []:
            if f.get("type") in ("paywall", "text-content"): continue
            fr[(f.get("label") or "?")[:30]].append(f.get("readyMs"))
    s["frameReadyMs"] = {k: median(v) for k, v in sorted(fr.items(), key=lambda kv: median(kv[1]) or 0)}
    # per-origin transfer (median across runs of per-run totals)
    per_run_origin = []
    for r in runs:
        agg = defaultdict(lambda: [0, 0, 0])  # count, tx, enc
        for scope, res in all_resources(r):
            o = origin(res.get("u", ""))
            agg[o][0] += 1
            agg[o][1] += res.get("tx") or 0
            agg[o][2] += res.get("enc") or 0
        per_run_origin.append(agg)
    origins = set().union(*[set(a) for a in per_run_origin]) if per_run_origin else set()
    s["perOrigin"] = {
        o: {
            "reqs": median([a[o][0] if o in a else 0 for a in per_run_origin]),
            "txKB": median([round((a[o][1] if o in a else 0) / 1024) for a in per_run_origin]),
            "encKB": median([round((a[o][2] if o in a else 0) / 1024) for a in per_run_origin]),
        } for o in sorted(origins)
    }
    # key asset timings: median fetch start / duration / size (first occurrence per run)
    ka = {}
    for name, pat in KEY_ASSETS:
        starts, durs, sizes, hits = [], [], [], 0
        for r in runs:
            found = None
            for scope, res in all_resources(r):
                if pat.search(res.get("u", "")):
                    if found is None or res.get("s", 1e12) < found.get("s", 1e12):
                        found = res
            if found:
                hits += 1
                starts.append(found.get("s")); durs.append(found.get("d"))
                sizes.append(found.get("enc") or found.get("tx") or 0)
        if hits:
            ka[name] = {"inRuns": hits, "startMs": median(starts), "durMs": median(durs), "encKB": round((median(sizes) or 0) / 1024, 1)}
    s["keyAssets"] = ka
    # API calls (from resource timing across frames)
    api = {}
    for name, pat in API_PATTERNS:
        starts, durs, cnts = [], [], []
        for r in runs:
            matches = [res for _, res in all_resources(r) if pat.search(res.get("u", ""))]
            cnts.append(len(matches))
            if matches:
                starts.append(min(m.get("s", 0) for m in matches))
                durs.extend([m.get("d") for m in matches])
        if any(cnts):
            api[name] = {"countPerRun": median(cnts), "firstStartMs": median(starts), "medianDurMs": median(durs)}
    s["apiCalls"] = api
    # slowest 12 resources by duration (from run closest to median allMacros)
    tgt = min(runs, key=lambda r: abs((r["summary"].get("allMacrosMs") or 0) - (s["allMacrosMs"] or 0)))
    slowest = sorted(all_resources(tgt), key=lambda t: -(t[1].get("d") or 0))[:12]
    s["slowestResources"] = [
        {"scope": sc, "u": re.sub(r"https?://", "", res.get("u", ""))[:110], "s": res.get("s"), "d": res.get("d"), "encKB": round((res.get("enc") or 0) / 1024, 1)}
        for sc, res in slowest
    ]
    # mixpanel macro_viewed phase breakdown if captured
    mv = []
    for r in runs:
        for m in r.get("mixpanel") or []:
            if m.get("event") == "macro_viewed":
                p = m.get("props") or {}
                mv.append({k: p.get(k) for k in ("macro_type", "duration_ms", "fetch_ms", "render_ms")})
    s["mixpanelMacroViewed"] = mv[:20]
    return s

dirs = sys.argv[1:]
by_label = load_runs(dirs)
out = [summarize(label, runs) for label, runs in sorted(by_label.items())]
print(json.dumps(out, indent=1))
