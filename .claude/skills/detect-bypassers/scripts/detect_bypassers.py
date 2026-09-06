#!/usr/bin/env python3
"""
detect_bypassers.py — #302 Lite paywall fail-open bypass detection.

A "bypasser" = a user who SAVED a macro on a genuinely over-limit, CSS-on,
unpaid Lite space where the paywall gate FAILED OPEN (paywall_gate_evaluated
with gate_fired=false and a failed macro-count read). Rolled up per tenant for
conversion targeting. Report-only; no outreach.

Pipeline:
  1. Pull failed gate evals (the bypass candidates).
  2. Link a save behind each, by (distinct_id, macro_uuid) within a window,
     with no continue-editing in between (that would be the legit grace path).
  3. Verify each space is GENUINELY over-limit via macro_viewed distinct
     content_id >= 100 (the empty-space guardrail: never trust the failed read).
  4. Roll up per tenant + a conservative Enterprise-Bundle revenue floor.

Internal-domain exclusion here uses the canonical CONTAINS list, NOT
`is_internal_client_domain` — that computed property exists only in
Run-Query/Insights, not in raw JQL (see the mixpanel skill).

Usage:
  python3 detect_bypassers.py [--days N] [--domain X] [--json OUT.json]
Run from the conf-app repo root so .env.mixpanel resolves.
"""
import sys
import os
import json
import argparse
from datetime import datetime, timedelta, timezone
from collections import defaultdict

# Reuse the mixpanel skill's JQL harness (auth + retries + pacing).
_MIX = os.path.join(os.path.dirname(__file__), "..", "..", "mixpanel", "scripts")
sys.path.insert(0, os.path.abspath(_MIX))
sys.path.insert(0, os.path.expanduser("~/workspaces/zenuml/conf-app/.claude/skills/mixpanel/scripts"))
import mp_query  # noqa: E402

LAUNCH = "2026-07-08"          # paywall_gate_evaluated went live (Lite prod)
INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "diagramly", "danshuitaihejie"]
OVERLIMIT = 100               # per-space Lite macro limit
BUNDLE_PRICE = 299            # Enterprise Bundle USD/space/yr (docs/pricing-model.yml)
WINDOW_SEC = 600             # save must follow the failed gate eval within 10 min
SIZE_DAYS = 180              # macro_viewed window for true-size (lower bound)

_INTERNAL_JS = json.dumps(INTERNAL)


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _events_jql(from_date, to_date, domain):
    dom = json.dumps(domain) if domain else "null"
    return f"""
var INTERNAL = {_INTERNAL_JS};
var DOMAIN = {dom};
function isInternal(d){{ if(!d) return true; for(var i=0;i<INTERNAL.length;i++) if(d.indexOf(INTERNAL[i])!==-1) return true; return false; }}
function main(){{
  return Events({{
    from_date:'{from_date}', to_date:'{to_date}',
    event_selectors:[
      {{event:'paywall_gate_evaluated'}},
      {{event:'macro_create_succeeded'}},
      {{event:'macro_save_succeeded'}},
      {{event:'paywall_continued_editing'}}
    ]
  }})
  .filter(function(e){{
    var p=e.properties||{{}};
    if(isInternal(p.client_domain)) return false;
    if(DOMAIN && p.client_domain!==DOMAIN) return false;
    if(e.name==='paywall_gate_evaluated'){{
      var notFired = (p.gate_fired===false || p.gate_fired==='false');
      var css = (p.css_enabled===true || p.css_enabled==='true');
      var unpaid = (p.space_paid===false || p.space_paid==='false');
      var readFailed = (p.macro_count_source==='undefined' || p.macro_count_source==='zero');
      return notFired && css && unpaid && readFailed;
    }}
    return true; // saves + continues are kept for linking
  }})
  .map(function(e){{
    var p=e.properties||{{}};
    return {{
      u:e.distinct_id, t:e.time, name:e.name,
      dom:p.client_domain||'', space:(p.confluence_space||p.space_key||''),
      muid:p.macro_uuid||'', src:p.macro_count_source||'',
      mc:(p.macro_count===undefined?null:p.macro_count), mtype:p.macro_type||''
    }};
  }});
}}
"""


def _size_jql(pairs, from_date, to_date):
    setjs = "{" + ",".join(f"{json.dumps(k)}:1" for k in sorted(pairs)) + "}"
    return f"""
var SET={setjs};
function key(e){{ var p=e.properties||{{}}; return (p.client_domain||'')+'|'+(p.confluence_space||p.space_key||''); }}
function main(){{
  return Events({{from_date:'{from_date}', to_date:'{to_date}', event_selectors:[{{event:'macro_viewed'}}]}})
  .filter(function(e){{ var p=e.properties||{{}}; return SET[key(e)]===1 && p.content_id; }})
  .groupBy([key, 'properties.content_id'], mixpanel.reducer.count());
}}
"""


def _run(jql, secret):
    return mp_query.run_jql(jql, secret)


def _link_bypasses(rows):
    """Attach a save to each failed gate eval by (user, macro_uuid) within the
    window, excluding cases with a continue-editing between mount and save."""
    gate = [r for r in rows if r["name"] == "paywall_gate_evaluated"]
    saves = [r for r in rows if r["name"] in ("macro_create_succeeded", "macro_save_succeeded")]
    conts = [r for r in rows if r["name"] == "paywall_continued_editing"]

    saves_by_uid_muid = defaultdict(list)
    saves_by_uid_space = defaultdict(list)
    for s in saves:
        saves_by_uid_muid[(s["u"], s["muid"])].append(s)
        saves_by_uid_space[(s["u"], s["space"])].append(s)
    conts_by_uid_space = defaultdict(list)
    for c in conts:
        conts_by_uid_space[(c["u"], c["space"])].append(c["t"])

    bypasses = []
    for g in gate:
        # Prefer a stable macro_uuid match; fall back to (user, space).
        cands = []
        if g["muid"] and g["muid"] != "unknown_macro_uuid":
            cands = saves_by_uid_muid.get((g["u"], g["muid"]), [])
        if not cands:
            cands = saves_by_uid_space.get((g["u"], g["space"]), [])
        window = [s for s in cands if g["t"] < s["t"] <= g["t"] + WINDOW_SEC * 1000]
        if not window:
            continue
        save = min(window, key=lambda s: s["t"])
        # Exclude if a continue-editing happened for this user+space in between
        # (that is the legitimate metered-grace path, not a fail-open bypass).
        if any(g["t"] < c <= save["t"] for c in conts_by_uid_space.get((g["u"], g["space"]), [])):
            continue
        bypasses.append({**g, "save_t": save["t"], "save_name": save["name"], "save_mtype": save["mtype"]})
    return bypasses


def _true_sizes(pairs, secret):
    if not pairs:
        return {}
    to_date = _today()
    from_date = (datetime.now(timezone.utc) - timedelta(days=SIZE_DAYS)).strftime("%Y-%m-%d")
    rows = _run(_size_jql(pairs, from_date, to_date), secret)
    distinct = defaultdict(set)
    for r in rows:
        pairkey, content_id = r["key"][0], r["key"][1]
        distinct[pairkey].add(content_id)
    return {k: len(v) for k, v in distinct.items()}


def detect(days, domain, secret):
    to_date = _today()
    from_date = LAUNCH if not days else (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    if from_date < LAUNCH:
        from_date = LAUNCH
    rows = _run(_events_jql(from_date, to_date, domain), secret)
    bypasses = _link_bypasses(rows)

    pairs = {f'{b["dom"]}|{b["space"]}' for b in bypasses}
    sizes = _true_sizes(pairs, secret)

    for b in bypasses:
        b["true_macros"] = sizes.get(f'{b["dom"]}|{b["space"]}', 0)
        b["confirmed"] = b["true_macros"] >= OVERLIMIT

    return {"window": [from_date, to_date], "domain": domain, "bypasses": bypasses}


def rollup(result):
    tenants = defaultdict(lambda: {"users": set(), "saves": 0, "confirmed_spaces": set(),
                                   "unconfirmed_spaces": set(), "sources": defaultdict(int)})
    for b in result["bypasses"]:
        t = tenants[b["dom"]]
        t["users"].add(b["u"])
        t["saves"] += 1
        t["sources"][b["src"]] += 1
        (t["confirmed_spaces"] if b["confirmed"] else t["unconfirmed_spaces"]).add(b["space"])
    out = []
    for dom, t in tenants.items():
        out.append({
            "domain": dom,
            "bypassers": len(t["users"]),
            "bypass_saves": t["saves"],
            "confirmed_spaces": sorted(t["confirmed_spaces"]),
            "unconfirmed_spaces": sorted(t["unconfirmed_spaces"]),
            "recoverable_usd_yr": len(t["confirmed_spaces"]) * BUNDLE_PRICE,
            "sources": dict(t["sources"]),
        })
    out.sort(key=lambda x: (-x["recoverable_usd_yr"], -x["bypass_saves"]))
    return out


def render_md(result, tenants):
    w = result["window"]
    conf = [t for t in tenants if t["confirmed_spaces"]]
    tot_users = sum(t["bypassers"] for t in conf)
    tot_saves = sum(t["bypass_saves"] for t in tenants)
    tot_rev = sum(t["recoverable_usd_yr"] for t in tenants)
    L = []
    L.append(f"# Paywall bypassers (#302 fail-open) — {w[0]} → {w[1]}")
    L.append("")
    L.append(f"**Confirmed:** {tot_users} bypassers across {len(conf)} tenants; "
             f"{sum(len(t['confirmed_spaces']) for t in tenants)} over-limit spaces; "
             f"**${tot_rev:,}/yr recoverable** (Enterprise Bundle floor, ${BUNDLE_PRICE}/space).")
    L.append(f"_Total bypass-saves (incl. unconfirmed): {tot_saves}. Confirmed = space has ≥{OVERLIMIT} distinct macros viewed in {SIZE_DAYS}d._")
    L.append("")
    L.append("| Tenant | Bypassers | Saves | Confirmed over-limit spaces | $/yr | Read failure |")
    L.append("|---|---|---|---|---|---|")
    for t in tenants:
        if not t["confirmed_spaces"] and not t["unconfirmed_spaces"]:
            continue
        cs = ", ".join(t["confirmed_spaces"]) or "—"
        src = ", ".join(f"{k}:{v}" for k, v in sorted(t["sources"].items()))
        flag = "" if t["confirmed_spaces"] else " _(unconfirmed only)_"
        L.append(f"| {t['domain']}{flag} | {t['bypassers']} | {t['bypass_saves']} | {cs} | ${t['recoverable_usd_yr']:,} | {src} |")
    unconf = [s for t in tenants for s in t["unconfirmed_spaces"]]
    if unconf:
        L.append("")
        L.append(f"**Unconfirmed candidates** (read failed but <{OVERLIMIT} distinct macros viewed — verify true size via D1 `CustomContent GROUP BY spaceId` before acting; spaceId↔space_key join needed): "
                 + ", ".join(f"{t['domain']}/{s}" for t in tenants for s in t["unconfirmed_spaces"]))
    if not tenants:
        L.append("")
        L.append("_No bypassers detected in this window._")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Detect #302 paywall fail-open bypassers.")
    ap.add_argument("--days", type=int, default=None, help="lookback days (default: since launch 2026-07-08)")
    ap.add_argument("--domain", default=None, help="restrict to one client_domain (bare subdomain, e.g. example-tenant)")
    ap.add_argument("--json", dest="json_out", default=None, help="write the full JSON result to this path")
    args = ap.parse_args()

    secret = mp_query.load_api_secret()
    result = detect(args.days, args.domain, secret)
    tenants = rollup(result)
    print(render_md(result, tenants))
    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump({"window": result["window"], "domain": result["domain"], "tenants": tenants,
                       "bypasses": result["bypasses"]}, f, indent=2, default=str)
        print(f"\n_JSON written to {args.json_out}_", file=sys.stderr)


if __name__ == "__main__":
    main()
