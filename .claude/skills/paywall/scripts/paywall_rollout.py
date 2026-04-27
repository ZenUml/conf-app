#!/usr/bin/env python3
"""
Paywall rollout analysis script.

Resolves domains → cloudIds via `forge install list`, then queries D1
for per-tenant metrics and outputs a recommendation table showing which
CSS-enrolled tenants are ready to be promoted to PAP.

Usage:
    # 1. Switch to Lite app first
    pnpm forge:use lite

    # 2. Run analysis
    python scripts/paywall_rollout.py \
        --css-domains "zenuml-stg,linemanwongnai,zeptonow,zenuml-connect,zenuml" \
        --pap-domains "zenuml"

Run from the conf-app project root.
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

D1_DB = "conf-zenuml-prod"
D1_ENV = "production"

MIN_INSTALL_DAYS = 30
MIN_VIEWERS = 3
SMALL_LIKELY_MAX_VIEWERS = 8

INTERNAL_DOMAINS = {"zenuml", "zenuml-stg", "dia-stg"}


def run_d1(sql: str) -> list[dict]:
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", D1_DB,
         "--env", D1_ENV, "--remote", "--json",
         "--command", sql],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"D1 error: {result.stderr}", file=sys.stderr)
        return []
    try:
        data = json.loads(result.stdout)
        return data[0].get("results", []) if data else []
    except (json.JSONDecodeError, IndexError, KeyError):
        return []


def fetch_forge_domain_to_cloudid() -> dict[str, str]:
    """
    Return {subdomain: cloudId} by:
      1. Running `forge install list -e production --json` to get {installationId: site}
      2. Querying D1 ForgeInstallation to get {installationId: cloudId}
      3. Joining to produce {subdomain: cloudId}

    forge install list JSON schema:
      {"id": <installationId>, "site": "linemanwongnai.atlassian.net", ...}

    D1 ForgeInstallation schema:
      installationId TEXT, cloudId TEXT, appId TEXT, installed_at TEXT
    """
    print("Running forge install list...", file=sys.stderr)
    result = subprocess.run(
        ["./scripts/forgex", "install", "list", "-e", "production", "--json"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"forge install list failed: {result.stderr[:200]}", file=sys.stderr)
        return {}

    # Strip ANSI codes and find the JSON array in stdout
    import re
    clean = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout)
    # forgex prints "Loading: ..." lines before the JSON; find the array
    match = re.search(r'(\[.*\])', clean, re.DOTALL)
    if not match:
        print("Could not parse forge install list output", file=sys.stderr)
        return {}

    try:
        installs = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}", file=sys.stderr)
        return {}

    # Build installationId → subdomain
    id_to_domain: dict[str, str] = {}
    for rec in installs:
        install_id = rec.get("id", "")
        site = rec.get("site", "")
        if install_id and site:
            # "linemanwongnai.atlassian.net" → "linemanwongnai"
            subdomain = site.split(".")[0]
            id_to_domain[install_id] = subdomain

    if not id_to_domain:
        return {}

    print(f"Found {len(id_to_domain)} Forge installations", file=sys.stderr)

    # Query D1 to get cloudId for each installationId
    placeholders = ", ".join(f"'{iid}'" for iid in id_to_domain)
    rows = run_d1(
        f"SELECT installationId, cloudId FROM ForgeInstallation "
        f"WHERE installationId IN ({placeholders})"
    )

    domain_to_cloudid: dict[str, str] = {}
    for r in rows:
        install_id = r.get("installationId", "")
        cloud_id = r.get("cloudId", "")
        domain = id_to_domain.get(install_id, "")
        if domain and cloud_id:
            domain_to_cloudid[domain] = cloud_id

    print(f"Resolved {len(domain_to_cloudid)} domain→cloudId mappings", file=sys.stderr)
    return domain_to_cloudid


def fetch_install_ages(cloud_ids: list[str]) -> dict[str, int]:
    """Return {cloudId: install_age_days} from ForgeInstallation."""
    if not cloud_ids:
        return {}
    placeholders = ", ".join(f"'{c}'" for c in cloud_ids)
    rows = run_d1(
        f"SELECT cloudId, MIN(installed_at) AS first_install "
        f"FROM ForgeInstallation WHERE cloudId IN ({placeholders}) GROUP BY cloudId"
    )
    now = datetime.now(timezone.utc)
    result = {}
    for r in rows:
        try:
            installed = datetime.fromisoformat(r["first_install"].replace("Z", "+00:00"))
            result[r["cloudId"]] = max(0, (now - installed).days)
        except Exception:
            pass
    return result


def fetch_viewer_counts(cloud_ids: list[str]) -> dict[str, int]:
    """Return {cloudId: unique_viewer_count_30d} from UserBehaviorEvent."""
    if not cloud_ids:
        return {}
    placeholders = ", ".join(f"'{c}'" for c in cloud_ids)
    rows = run_d1(
        f"SELECT cloudId, COUNT(DISTINCT userAccountId) AS n "
        f"FROM UserBehaviorEvent "
        f"WHERE action = 'view_macro' "
        f"  AND createdAt >= datetime('now', '-30 days') "
        f"  AND cloudId IN ({placeholders}) "
        f"GROUP BY cloudId"
    )
    return {r["cloudId"]: r["n"] for r in rows}


def compute_tenant_size(install_days: int, viewers_30d: int) -> str:
    if install_days < MIN_INSTALL_DAYS or viewers_30d < MIN_VIEWERS:
        return "unknown"
    if viewers_30d <= SMALL_LIKELY_MAX_VIEWERS:
        return "small_likely"
    return "medium_or_larger"


def recommend(stage: int, install_days: int, viewers_30d: int) -> str:
    if stage == 2:
        tenant_size = compute_tenant_size(install_days, viewers_30d)
        return "monitor" if tenant_size == "unknown" else "already_pap"
    if install_days < 0 or viewers_30d < 0:
        return "insufficient_data"
    if install_days < MIN_INSTALL_DAYS or viewers_30d < MIN_VIEWERS:
        return "insufficient_data"
    return "promote_to_pap"


def main():
    parser = argparse.ArgumentParser(description="Paywall rollout analysis")
    parser.add_argument("--css-domains", required=True,
                        help="Comma-separated list of domains on CSS")
    parser.add_argument("--pap-domains", default="",
                        help="Comma-separated list of domains on PAP")
    parser.add_argument("--include-internal", action="store_true",
                        help="Include zenuml/zenuml-stg/dia-stg in output")
    parser.add_argument("--skip-forge-lookup", action="store_true",
                        help="Skip forge install list (use if forgex is not configured)")
    args = parser.parse_args()

    css_set = {d.strip() for d in args.css_domains.split(",") if d.strip()}
    pap_set = {d.strip() for d in args.pap_domains.split(",") if d.strip()}

    if not args.include_internal:
        css_set -= INTERNAL_DOMAINS

    # Step 1: resolve domain → cloudId via forge install list
    domain_to_cloudid: dict[str, str] = {}
    if not args.skip_forge_lookup:
        domain_to_cloudid = fetch_forge_domain_to_cloudid()
    else:
        print("Skipping forge install list lookup (--skip-forge-lookup)", file=sys.stderr)

    # Step 2: fetch D1 metrics for resolved cloudIds
    resolved_cloud_ids = [cid for d, cid in domain_to_cloudid.items() if d in css_set]
    print(f"Querying D1 metrics for {len(resolved_cloud_ids)} cloudIds...", file=sys.stderr)
    install_ages = fetch_install_ages(resolved_cloud_ids)
    viewer_counts = fetch_viewer_counts(resolved_cloud_ids)

    # Step 3: build output rows
    rows = []
    for domain in sorted(css_set):
        on_pap = domain in pap_set
        stage = 2 if on_pap else 1

        cloud_id = domain_to_cloudid.get(domain, "")
        install_days = install_ages.get(cloud_id, -1) if cloud_id else -1
        viewers_30d = viewer_counts.get(cloud_id, -1) if cloud_id else -1

        tenant_size = compute_tenant_size(install_days, viewers_30d) if install_days >= 0 else "unknown"
        rec = recommend(stage, install_days, viewers_30d)

        rows.append({
            "domain": domain,
            "stage": stage,
            "cloud_id": cloud_id or "?",
            "install_age_d": install_days if install_days >= 0 else "?",
            "viewers_30d": viewers_30d if viewers_30d >= 0 else "?",
            "tenant_size": tenant_size,
            "recommendation": rec,
        })

    # Sort: promote_to_pap first (by viewers desc), then others
    priority = {"promote_to_pap": 0, "monitor": 1, "already_pap": 2, "insufficient_data": 3}
    rows.sort(key=lambda r: (
        priority.get(r["recommendation"], 9),
        -(r["viewers_30d"] if isinstance(r["viewers_30d"], int) else 0)
    ))

    # Print table
    header = (f"{'domain':<25} {'stage':>5} {'install_d':>10} "
              f"{'viewers_30d':>12} {'tenant_size':<20} {'recommendation'}")
    print("\n" + header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{r['domain']:<25} {r['stage']:>5} {str(r['install_age_d']):>10} "
            f"{str(r['viewers_30d']):>12} {r['tenant_size']:<20} {r['recommendation']}"
        )

    # Summary + ready-to-paste KV command
    promote = [r["domain"] for r in rows if r["recommendation"] == "promote_to_pap"]
    if promote:
        current_pap = ",".join(sorted(pap_set))
        new_pap = ",".join(sorted(pap_set | set(promote)))
        print(f"\n--- Ready to promote to PAP ---")
        print(f"Domains: {', '.join(promote)}")
        print(f"\nCurrent PAP value:  \"{current_pap}\"")
        print(f"Updated PAP value:  \"{new_pap}\"")
        print(f"\nKV command:")
        print(f'npx wrangler kv key put --namespace-id fe9042cb20994651b0a2ef9e68f9037c "PERSONA_AWARE_PAYWALL" "{new_pap}"')
    else:
        print("\nNo domains ready for PAP promotion at this time.")

    unresolved = [r["domain"] for r in rows if r["cloud_id"] == "?"]
    if unresolved:
        print(f"\nNote: No Forge installation found for: {', '.join(unresolved)}")
        print("These may be Connect-only tenants or the APP_ID may be wrong.")
        print("Run `pnpm forge:use lite` before this script to ensure the correct APP_ID is loaded.")


if __name__ == "__main__":
    main()
