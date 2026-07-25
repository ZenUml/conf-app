#!/usr/bin/env python3
"""Per-space macro count for one client, triangulated across three sources.

Sources (they answer THREE DIFFERENT questions — see SKILL.md):
  1. Metrics KV  -> current inventory, reported-on-save, keyed by space KEY
  2. D1          -> lifetime-created macro rows, keyed by numeric spaceId
  3. Mixpanel    -> distinct macro_uuid VIEWED in last 90d, keyed by space KEY

Why they won't match exactly, and the key-vs-id join trap, are documented in
SKILL.md. This script just gathers all three and lines up KV + Mixpanel by space
KEY (they share it), printing D1 separately because it keys by numeric spaceId
and only scopes to a client for Connect installs.

Usage:
    python3 macro_count.py --domain example-tenant
    python3 macro_count.py --domain example-tenant.atlassian.net --json
    python3 macro_count.py --domain example-tenant --no-d1   # skip the slow source
    python3 macro_count.py --domain example-tenant --days 30

Run from the conf-app project root (so .env.mixpanel and wrangler config resolve).
Each source is independent: if one fails or is skipped, the others still print.
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

# Mixpanel tracking started here — no point asking for data before it.
TRACKING_START = dt.date(2026, 4, 18)
KV_FULL_BASE = "https://conf-full.zenuml.com"
KV_LITE_BASE = "https://conf-lite.zenuml.com"
D1_DB = "conf-zenuml-prod"
D1_ENV = "production"
UNKNOWN_SPACE = {"unknown_space", "no_space_context", ""}
UNKNOWN_UUID = {"unknown_macro_uuid", ""}


def normalize_domain(raw):
    """Return (bare, full). Accepts 'x', 'x.atlassian.net', 'https://x.atlassian.net/...'."""
    s = raw.strip().lower()
    if "://" in s:
        s = s.split("://", 1)[1]
    s = s.split("/", 1)[0]          # strip any path
    s = s.split(":", 1)[0]          # strip any port
    bare = s.replace(".atlassian.net", "")
    full = f"{bare}.atlassian.net"
    return bare, full


# --------------------------------------------------------------------------- #
# Source 1: Metrics KV (current inventory, reported-on-save, space KEY)
# --------------------------------------------------------------------------- #
def fetch_kv(bare_domain):
    """Hit metrics-inspect on both full and lite Pages projects. Merge on space KEY,
    preferring the **freshest** record per space.

    A domain does NOT always live on exactly one variant: a tenant that migrated
    between variants keeps a frozen snapshot on the old backend forever. vin3s ran
    Full until 2026-04-24 and moved to Lite on 2026-04-27, so `metrics:vin3s:full`
    still serves 34 spaces of April data. Selecting the LARGER total (the rule until
    2026-07-26) let that fossil win — VARW reported 438 macros from April instead of
    the live 188, and that number was one step away from a customer-facing email.
    Freshness is the tiebreak; `shadowed` keeps whatever lost so divergence stays
    visible instead of silently vanishing.

    NOTE: the KV key is built from `getClientDomain()` = the BARE subdomain
    (e.g. `zenuml`), NOT the full hostname. Passing `zenuml.atlassian.net` here
    silently returns no_data. (The older /metrics skill docs are wrong on this.)
    """
    out = {}  # space KEY -> {total, sequence, graph, mermaid, openapi, plantuml, unknown, lastUpdated, variant}
    # Always name the product. metrics-inspect used to default an absent product to
    # `full`, so the first URL silently asked for a key this tenant may never have
    # had. Both hosts read the same KV namespace, so the host choice is cosmetic —
    # the productType param is what selects the key.
    targets = [
        ("full", f"{KV_FULL_BASE}/admin/metrics-inspect?domain={bare_domain}&productType=full"),
        ("lite", f"{KV_LITE_BASE}/admin/metrics-inspect?domain={bare_domain}&productType=lite"),
    ]
    errors = []
    for variant, url in targets:
        try:
            # Cloudflare's WAF 403s the default Python-urllib UA; mimic curl.
            req = urllib.request.Request(
                url,
                headers={"Accept": "application/json", "User-Agent": "curl/8.4.0"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:  # noqa: BLE001 - report, keep going
            errors.append(f"{variant}: {e}")
            continue
        spaces = (data or {}).get("spaces") or {}
        for key, entry in spaces.items():
            # Domain-wide query nests counts under `data`; single-space query is
            # flatter. Accept either shape.
            s = entry.get("data", entry) if isinstance(entry, dict) else {}
            total = s.get("total", 0) or 0
            updated = s.get("lastUpdated") or ""
            row = {
                "total": total,
                "sequence": s.get("sequence", 0),
                "graph": s.get("graph", 0),
                "mermaid": s.get("mermaid", 0),
                "openapi": s.get("openapi", 0),
                "plantuml": s.get("plantuml", 0),
                "unknown": s.get("unknown", 0),
                "lastUpdated": s.get("lastUpdated"),
                "variant": variant,
                "shadowed": None,
            }
            prev = out.get(key)
            if prev is None:
                out[key] = row
                continue
            # Freshest wins; equal timestamps fall back to the larger count.
            keep, drop = ((row, prev)
                          if (updated, total) > ((prev.get("lastUpdated") or ""), prev.get("total") or 0)
                          else (prev, row))
            keep["shadowed"] = {"variant": drop["variant"], "total": drop["total"],
                                "lastUpdated": drop["lastUpdated"]}
            out[key] = keep
    return out, errors


# --------------------------------------------------------------------------- #
# Source 2: D1 (lifetime macro rows, numeric spaceId, Connect-scopable only)
# --------------------------------------------------------------------------- #
def run_d1(sql):
    cmd = [
        "npx", "wrangler", "d1", "execute", D1_DB,
        "--env", D1_ENV, "--remote", "--json", "--command", sql,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "wrangler failed")
    # wrangler --json prints [{"results":[...], "success":true, ...}]
    payload = json.loads(proc.stdout)
    if isinstance(payload, list) and payload:
        return payload[0].get("results", [])
    return []


def fetch_d1(bare_domain):
    """Connect macros for this client, grouped by numeric spaceId. Forge macros
    can't be scoped to a client in D1 (UUID appId, no clientDomain) — we detect
    that case and say so."""
    result = {"connect_spaces": [], "is_connect": False, "note": None, "error": None}
    try:
        # Is this domain a Connect install at all?
        inst = run_d1(
            "SELECT COUNT(*) AS n FROM AppInstance "
            f"WHERE clientDomain = '{bare_domain}'"
        )
        n_appinstance = (inst[0]["n"] if inst else 0)
        result["is_connect"] = n_appinstance > 0

        rows = run_d1(
            "SELECT cc.spaceId AS spaceId, COUNT(*) AS macros, "
            "COUNT(DISTINCT cc.macroUuid) AS distinct_uuids, "
            "MAX(cc.createdAt) AS last_created "
            "FROM CustomContent cc JOIN AppInstance ai ON cc.appId = ai.appId "
            f"WHERE ai.clientDomain = '{bare_domain}' "
            "GROUP BY cc.spaceId ORDER BY macros DESC"
        )
        result["connect_spaces"] = rows
        if not result["is_connect"]:
            result["note"] = (
                "No AppInstance row -> not a Connect client. If they're a Forge "
                "install (most prod tenants), D1 cannot scope macros to this "
                "client (shared UUID appId, no clientDomain). Use KV + Mixpanel."
            )
        elif not rows:
            result["note"] = "Connect install present, but 0 macros in CustomContent."
    except Exception as e:  # noqa: BLE001
        result["error"] = str(e)
    return result


# --------------------------------------------------------------------------- #
# Source 3: Mixpanel (distinct macro_uuid VIEWED in last N days, space KEY)
# --------------------------------------------------------------------------- #
def build_jql(bare_domain, from_date, to_date):
    # Distinct macro_uuid per confluence_space: group by [space, uuid], then
    # count the groups per space. Both event names cover the 2026-04 rename
    # window; the dedupe across names is implicit (same uuid -> one group).
    return f"""
function main() {{
  return Events({{
    from_date: '{from_date}',
    to_date: '{to_date}',
    event_selectors: [{{event: 'macro_viewed'}}, {{event: 'view_macro'}}]
  }})
  .filter(e => e.properties.client_domain == '{bare_domain}')
  .filter(e => e.properties.macro_uuid && e.properties.macro_uuid != 'unknown_macro_uuid')
  .filter(e => e.properties.confluence_space && e.properties.confluence_space != 'unknown_space' && e.properties.confluence_space != 'no_space_context')
  .groupBy(['properties.confluence_space', 'properties.macro_uuid'], mixpanel.reducer.count())
  .groupBy([r => r.key[0]], mixpanel.reducer.count());
}}
""".strip()


def find_mp_query():
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "..", "..", "mixpanel", "scripts", "mp_query.py"),
        os.path.expanduser(
            "~/workspaces/zenuml/conf-app/.claude/skills/mixpanel/scripts/mp_query.py"
        ),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return None


def fetch_mixpanel(bare_domain, days):
    result = {"spaces": {}, "error": None, "window": None}
    mp = find_mp_query()
    if not mp:
        result["error"] = "mp_query.py not found (mixpanel skill missing)"
        return result
    today = dt.date.today()
    from_date = max(today - dt.timedelta(days=days), TRACKING_START)
    result["window"] = f"{from_date.isoformat()}..{today.isoformat()}"
    jql = build_jql(bare_domain, from_date.isoformat(), today.isoformat())
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", suffix=".js", delete=False
        ) as f:
            f.write(jql)
            tmp = f.name
        proc = subprocess.run(
            [sys.executable, mp, "--file", tmp],
            capture_output=True, text=True, timeout=300,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "mp_query failed")
        rows = json.loads(proc.stdout)
        # rows: [{"key": ["ENG"], "value": 42}, ...]
        for r in rows:
            key = r["key"][0] if isinstance(r.get("key"), list) else r.get("key")
            if key in UNKNOWN_SPACE:
                continue
            result["spaces"][key] = r["value"]
    except Exception as e:  # noqa: BLE001
        result["error"] = str(e)
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)
    return result


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
def print_report(bare, full, kv, kv_errors, d1, mp):
    print(f"\n# Macro count: {full}  (bare: {bare})\n")

    # --- KV + Mixpanel reconciled by space KEY -----------------------------
    kv_spaces = kv or {}
    mp_spaces = (mp or {}).get("spaces", {})
    all_keys = sorted(set(kv_spaces) | set(mp_spaces))

    print("## Per-space (KV inventory + Mixpanel 90d distinct-viewed)\n")
    if mp.get("window"):
        print(f"_Mixpanel window: {mp['window']} (clamped to tracking start)_\n")
    if all_keys:
        print(f"| Space KEY | KV total | KV variant | MP {'%dd' % 90} distinct-viewed |")
        print("|---|---|---|---|")
        kv_sum = 0
        mp_sum = 0
        for k in all_keys:
            kvt = kv_spaces.get(k, {}).get("total", "-")
            var = kv_spaces.get(k, {}).get("variant", "-")
            mpv = mp_spaces.get(k, "-")
            if isinstance(kvt, int):
                kv_sum += kvt
            if isinstance(mpv, int):
                mp_sum += mpv
            print(f"| {k} | {kvt} | {var} | {mpv} |")
        print(f"| **TOTAL** | **{kv_sum}** | | **{mp_sum}** |")

        # A space present on BOTH backends means the tenant migrated variants and the
        # old backend still serves a frozen snapshot. Show what was discarded — the
        # gap is the signal, and hiding it once nearly put an April number in a
        # customer email (vin3s VARW, 2026-07-26).
        shadowed = [(k, kv_spaces[k]) for k in all_keys
                    if (kv_spaces.get(k) or {}).get("shadowed")]
        if shadowed:
            print("\n_Superseded records (same space on the other variant's backend — "
                  "freshest kept):_\n")
            print("| Space KEY | kept | from | superseded | from |")
            print("|---|---|---|---|---|")
            for k, row in shadowed:
                sh = row["shadowed"]
                print(f"| {k} | {row['total']} ({row['variant']}) | {row['lastUpdated']} "
                      f"| {sh['total']} ({sh['variant']}) | {sh['lastUpdated']} |")
    else:
        print("_No KV or Mixpanel per-space data._")
    if kv_errors:
        print(f"\n_KV fetch notes: {'; '.join(kv_errors)}_")
    if mp.get("error"):
        print(f"\n_Mixpanel error: {mp['error']}_")

    # --- D1 (numeric spaceId, Connect-scopable only) -----------------------
    print("\n## D1 (lifetime macro rows — numeric spaceId)\n")
    if d1.get("error"):
        print(f"_D1 error: {d1['error']}_")
    elif d1.get("connect_spaces"):
        print("| spaceId (numeric) | macros | distinct uuids | last created |")
        print("|---|---|---|---|")
        tot = 0
        for r in d1["connect_spaces"]:
            tot += r.get("macros", 0)
            print(f"| {r.get('spaceId')} | {r.get('macros')} | {r.get('distinct_uuids')} | {r.get('last_created')} |")
        print(f"| **TOTAL** | **{tot}** | | |")
        print("\n_spaceId is the numeric Confluence space ID, NOT the space KEY "
              "above — they do not line up without a key↔id map (Confluence REST)._")
    if d1.get("note"):
        print(f"\n_{d1['note']}_")

    print("\n## Reading this\n"
          "- KV = current live inventory (reported on save; can be stale >24h; "
          "only spaces saved-into since reporting began). Closest to 'how many "
          "macros exist right now'.\n"
          "- Mixpanel = distinct `macro_uuid` (Forge localId = per *placement*) "
          "VIEWED in the window. Counts since-deleted and duplicated placements, "
          "so it can run ABOVE KV; but the Forge **graph** viewer emits no view "
          "event and never-viewed macros are absent, pulling it DOWN. Net: a "
          "usage signal, not an inventory count — don't expect it to equal KV.\n"
          "- D1 = cumulative rows ever created (may include since-deleted "
          "macros); per-client only for Connect installs.\n"
          "The three answer different questions, so divergence is expected and "
          "informative — large gaps are signal, not error.")


def main():
    ap = argparse.ArgumentParser(description="Per-space macro count for a client across KV, D1, Mixpanel.")
    ap.add_argument("--domain", required=True, help="Client domain: 'x', 'x.atlassian.net', or a URL")
    ap.add_argument("--days", type=int, default=90, help="Mixpanel lookback window (default 90)")
    ap.add_argument("--no-kv", action="store_true", help="Skip the Metrics KV source")
    ap.add_argument("--no-d1", action="store_true", help="Skip the D1 source (slowest)")
    ap.add_argument("--no-mixpanel", action="store_true", help="Skip the Mixpanel source")
    ap.add_argument("--json", action="store_true", help="Emit raw JSON instead of the report")
    args = ap.parse_args()

    bare, full = normalize_domain(args.domain)

    kv, kv_errors = ({}, []) if args.no_kv else fetch_kv(bare)
    d1 = {"connect_spaces": [], "note": "skipped", "error": None} if args.no_d1 else fetch_d1(bare)
    mp = {"spaces": {}, "error": "skipped", "window": None} if args.no_mixpanel else fetch_mixpanel(bare, args.days)

    if args.json:
        print(json.dumps({
            "bare": bare, "full": full,
            "kv": kv, "kv_errors": kv_errors, "d1": d1, "mixpanel": mp,
        }, indent=2, default=str))
    else:
        print_report(bare, full, kv, kv_errors, d1, mp)


if __name__ == "__main__":
    main()
