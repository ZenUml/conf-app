#!/usr/bin/env python3
"""Grant a temporary space-license editing extension (Lite paywall lockout requests).

Default scope is now PER-USER: writes a `license:<cloudId>:<spaceKey>:<userAccountId>`
record when `--user` is given, which unlocks only the requesting user. Whole-space
grants (`license:<cloudId>:<spaceKey>`, no `--user`) remain available as a manual
escalation — re-run without `--user` when multiple independent requesters hit the
same space. Either key shape is enforced by `functions/api/space-status.ts` (`isPaid`
iff status=='active' AND expiresAt in the future; user-key checked first, falling
back to the space-key). Cached 300s → applies within ~5 min.

Usage (run from the conf-app project root, so wrangler config + curl resolve):
    python3 grant_extension.py --domain example-tenant --space ENG --user 712020:abc-123
    python3 grant_extension.py --domain example-tenant --space ENG            # space-level escalation
    python3 grant_extension.py --domain example-tenant --space ENG --users 500
    python3 grant_extension.py --domain example-tenant --space ENG --user 712020:abc-123 --dry-run

This MUTATES production KV. It is a deploy-discipline action — only run it with an
explicit go-ahead. Use --dry-run to preview the exact record + commands first.

The reply message it prints follows the canonical template in the handbook:
  private/paywall/extension-request-replies.md  (keep that the source of truth).
"""

import argparse
import datetime as dt
import json
import subprocess
import sys
import tempfile
import urllib.request

# Prod namespace, shared across all prod variants (wrangler-prod.toml [env.production]).
SPACE_LICENSE_KV_NS = "8969e8528105403bb2d9adca9fc16567"
KV_FULL_BASE = "https://conf-full.zenuml.com"
KV_LITE_BASE = "https://conf-lite.zenuml.com"
STRIPE_BUNDLE_LINK = "https://buy.stripe.com/cNifZifkN7hzavK12H7IY05"
MARKETPLACE_LINK = "https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram"
ENTERPRISE_BUNDLE_USD = 299  # per space / year, flat


def normalize_domain(raw):
    s = raw.strip().lower()
    if "://" in s:
        s = s.split("://", 1)[1]
    s = s.split("/", 1)[0].split(":", 1)[0]
    bare = s.replace(".atlassian.net", "")
    return bare, f"{bare}.atlassian.net"


def http_json(url, ua="curl/8.4.0"):
    # Cloudflare WAF 403s the default python-urllib UA; mimic curl.
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": ua})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def resolve_cloud_id(full_domain):
    """Authoritative cloudId = the Forge context cloudId, from _edge/tenant_info."""
    data = http_json(f"https://{full_domain}/_edge/tenant_info")
    cid = data.get("cloudId")
    if not cid:
        raise RuntimeError(f"no cloudId in tenant_info for {full_domain}")
    return cid


def verify_space(bare_domain, space):
    """Sanity-check the space exists and how many macros it has (so a typo'd /
    truncated space key doesn't silently grant nothing). Returns total or None."""
    for base, extra in ((KV_LITE_BASE, "&addonKey=zenuml-lite"), (KV_FULL_BASE, "")):
        try:
            data = http_json(f"{base}/admin/metrics-inspect?domain={bare_domain}{extra}")
        except Exception:
            continue
        spaces = (data or {}).get("spaces") or {}
        if space in spaces:
            entry = spaces[space]
            s = entry.get("data", entry) if isinstance(entry, dict) else {}
            return s.get("total")
        # surface the available keys to catch a wrong space key
        if spaces:
            verify_space.available = sorted(spaces)
    return None


def wrangler_kv_get(key):
    cmd = ["npx", "wrangler", "kv", "key", "get", key,
           f"--namespace-id={SPACE_LICENSE_KV_NS}", "--remote"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        return None  # missing key exits non-zero
    out = proc.stdout.strip()
    return out or None


def wrangler_kv_put(key, value_path):
    cmd = ["npx", "wrangler", "kv", "key", "put", key, "--path", value_path,
           f"--namespace-id={SPACE_LICENSE_KV_NS}", "--remote"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "wrangler put failed")


def full_plan_arr(n):
    """Full-plan list price/yr via the ARR tier model (docs/pricing-model.yml)."""
    if n <= 10:
        return 40.0
    return (min(n, 100) * 0.44
            + (min(n, 250) - 100) * 0.33
            + (min(n, 1000) - 250) * 0.11
            + max(0, n - 1000) * 0.05) * 10


def grant(domain, space, days, activated_by, dry_run, user_account_id=None):
    bare, full = normalize_domain(domain)
    print(f"[1/5] resolving cloudId for {full} ...")
    cloud = resolve_cloud_id(full)
    print(f"      cloudId = {cloud}")

    print(f"[2/5] verifying space '{space}' in metrics KV ...")
    total = verify_space(bare, space)
    if total is None:
        avail = getattr(verify_space, "available", [])
        print(f"      ⚠ space '{space}' not found in KV. Available: {avail}")
        print("      (proceeding — KV may just be stale — but double-check the space KEY)")
    else:
        print(f"      space '{space}' has {total} macros"
              + ("" if (total or 0) >= 100 else "  ⚠ under the 100-limit — confirm this needs an extension"))

    today = dt.date.today()
    expires_at = f"{(today + dt.timedelta(days=days)).isoformat()}T23:59:59Z"
    now_iso = _utcnow_iso()
    key = f"license:{cloud}:{space}:{user_account_id}" if user_account_id else f"license:{cloud}:{space}"
    scope = f"user ({user_account_id})" if user_account_id else "space (all users)"

    # Upsert: preserve createdAt if a record already exists.
    existing_raw = wrangler_kv_get(key)
    if existing_raw:
        existing = json.loads(existing_raw)
        record = {**existing, "status": "active", "activatedBy": activated_by,
                  "expiresAt": expires_at, "updatedAt": now_iso}
        print(f"[3/5] existing record found (createdAt {existing.get('createdAt')}) — upserting")
    else:
        record = {"cloudId": cloud, "spaceKey": space, "status": "active",
                  "activatedBy": activated_by, "expiresAt": expires_at,
                  "createdAt": now_iso, "updatedAt": now_iso}
        if user_account_id:
            record["userAccountId"] = user_account_id
        print("[3/5] new record")

    print(f"      scope = {scope}")
    print(f"      key   = {key}")
    print(f"      value = {json.dumps(record)}")

    if dry_run:
        print("[4/5] --dry-run: NOT writing to KV or index.")
        print("[5/5] skipped verify.")
        return {"cloud": cloud, "space": space, "expiresAt": expires_at,
                "record": record, "wrote": False, "macros": total}

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(record, f)
        rec_path = f.name
    print("[4/5] writing license key + updating license-index ...")
    wrangler_kv_put(key, rec_path)
    _update_index(cloud, space, user_account_id)

    print("[5/5] verifying read-back ...")
    back = wrangler_kv_get(key)
    ok = back and json.loads(back).get("status") == "active"
    print(f"      read-back status: {'active ✓' if ok else 'UNEXPECTED: ' + str(back)}")
    return {"cloud": cloud, "space": space, "expiresAt": expires_at,
            "record": record, "wrote": True, "verified": bool(ok), "macros": total}


def _utcnow_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _update_index(cloud, space, user_account_id=None):
    raw = wrangler_kv_get("license-index")
    index = json.loads(raw) if raw else []
    if not any(e.get("cloudId") == cloud and e.get("spaceKey") == space
               and e.get("userAccountId") == user_account_id for e in index):
        entry = {"cloudId": cloud, "spaceKey": space}
        if user_account_id:
            entry["userAccountId"] = user_account_id
        index.append(entry)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(index, f)
            idx_path = f.name
        wrangler_kv_put("license-index", idx_path)
        print(f"      index appended -> {len(index)} entries")
    else:
        print("      index already contains this entry")


def through_date(expires_at):
    d = dt.date.fromisoformat(expires_at.split("T")[0])
    return d.strftime("%-d %B %Y")  # e.g. "7 July 2026"


def print_reply(space, expires_at, users):
    if users:
        price = full_plan_arr(users)
        users_line = f"~{users:,} users"
        full_price = f"~${price:,.0f}/year"
    else:
        users_line = "~{USERS} users (fetch tier from the Marketplace license report)"
        full_price = "~${FULL_PRICE}/year"

    print("\n" + "=" * 70)
    print("DRAFT REPLY  (canonical template: paywall/extension-request-replies.md)")
    print("=" * 70)
    print(f"""Hey,

Thanks for reaching out — glad to see your teams getting so much use out of ZenUML.

To get you unblocked straight away, we've enabled a temporary extension on {space} for the next 14 days (through {through_date(expires_at)}). You can create and edit diagrams there as normal during this window — nothing to set up on your end; just refresh the page if you have an editor open (it can take a few minutes to apply).

A couple of things worth knowing:

The extension covers {space} specifically. If other spaces are hitting the limit too, just reply here and we'll take a look.

It's a temporary bridge. For a lasting fix there are two routes — happy to help with either:

Per-space (Enterprise Bundle) — ${ENTERPRISE_BUNDLE_USD}/space/year, unlimited macros and users in that space. It's the quickest path and doesn't require a Confluence admin — you can set it up directly, so it's ideal if you'd like {space} unblocked permanently right away. Purchase here: {STRIPE_BUNDLE_LINK} — just reply with the space key after payment and we'll activate it.

Org-wide (Full plan) — removes the limit across all your spaces and users at once; best value if you want everything covered (you're running a large site with diagrams across many spaces). Based on your site's {users_line}, this works out to {full_price}. You can upgrade on the Atlassian Marketplace here: ZenUML Diagrams for Confluence | Atlassian Marketplace ({MARKETPLACE_LINK}) — this one goes through whoever administers Confluence apps for your site.

Tell us which fits better and we'll send exact pricing and the steps.

Best Regards,

Peng""")
    print("=" * 70)


def main():
    ap = argparse.ArgumentParser(description="Grant a temporary Lite space-license extension + draft the reply.")
    ap.add_argument("--domain", required=True, help="Client domain (bare, hostname, or URL)")
    ap.add_argument("--space", required=True, help="Confluence space KEY (exact, case-sensitive)")
    ap.add_argument("--days", type=int, default=14, help="Extension length (default 14)")
    ap.add_argument("--users", type=int, help="Site user tier (Marketplace license) → fills Full-plan price in the reply")
    ap.add_argument("--user", dest="user_account_id", default=None,
                    help="Requester's Atlassian accountId (e.g. 712020:...) — scopes the grant to this "
                         "user only. Omit to grant the whole space (manual escalation when multiple "
                         "independent users in the same space have requested).")
    ap.add_argument("--activated-by", default="support:temp-14d-extension")
    ap.add_argument("--dry-run", action="store_true", help="Preview only — no KV writes")
    ap.add_argument("--no-reply", action="store_true", help="Skip the drafted reply")
    args = ap.parse_args()

    try:
        result = grant(args.domain, args.space, args.days, args.activated_by, args.dry_run,
                        user_account_id=args.user_account_id)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if not args.no_reply:
        print_reply(result["space"], result["expiresAt"], args.users)

    scope = f"user {args.user_account_id}" if args.user_account_id else "the whole space"
    if result.get("wrote"):
        print(f"\n✅ Granted to {scope}. {result['space']} active through {result['expiresAt']} "
              f"(applies within ~5 min). Remember to log it in paywall/extension-request-replies.md.")
    elif args.dry_run:
        print("\n(dry-run — nothing written)")


if __name__ == "__main__":
    main()
