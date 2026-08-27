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
MARKETPLACE_LINK = "https://marketplace.atlassian.com/apps/1218380/zenuml-diagrams-for-confluence"
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
    # Name the product on BOTH calls: metrics-inspect used to treat an absent
    # product as `full`, so the fallback quietly read a key the tenant may not own.
    #
    # Use `addonKey`, NOT `productType`. `productType` is only honoured by the
    # metrics-inspect rewrite on `fix/metrics-inspect-explicit-product`, which is
    # deployed to staging but NOT to prod — and this script talks to PROD. Against
    # prod, `productType=lite` is ignored, the handler falls back to `full`, and a
    # variant-migrated tenant gets a fossil count (vin3s VARW: 438 frozen at
    # 2026-04-24, vs 188 live) — which would silently suppress the under-100 warning
    # below. `addonKey` is honoured by both the deployed handler and the rewrite
    # (productFromAddonKey maps '-lite' -> lite, 'confluence-addon' -> full), so this
    # keeps working after that branch ships. Verified 2026-07-26.
    for base, extra in ((KV_LITE_BASE, "&addonKey=com.zenuml.confluence-addon-lite"),
                        (KV_FULL_BASE, "&addonKey=com.zenuml.confluence-addon")):
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


# Live Marketplace pricing for the Full app (com.zenuml.confluence-addon).
# Two DIFFERENT published price shapes, and quoting the wrong one misquotes the customer:
#   perUnitItems (monthsValid=1) -> per-user-per-month rates, charged on the EXACT headcount
#   items       (monthsValid=12) -> fixed annual price for the user BAND (801-1000, etc.)
# Verified 2026-08-27 against the public calculator at 902 users:
#   monthly USD 165.22 ("0.18 per user average"), annual USD 1,760.00 ("User tier: 801-1000").
# The old `... * 10` model returned 1,652 at 902 users, which is neither published price.
# It agreed with the annual price only AT a band boundary (n=1000 -> 1,760 both ways).
MARKETPLACE_PRICING_URL = (
    "https://marketplace.atlassian.com/rest/2/addons/"
    "com.zenuml.confluence-addon/pricing/cloud/live"
)


def full_plan_pricing(n):
    """Published monthly + annual list price for n users. Raises if Marketplace is unreachable
    — a wrong price in a customer reply is worse than no reply, so there is no local fallback."""
    data = http_json(MARKETPLACE_PRICING_URL)

    # unitCount == -1 is the "Unlimited users" sentinel, not a band — it sorts first and
    # would shift every band boundary by one user (902 users quoted 165.66 instead of 165.22).
    per_unit = sorted(
        (i for i in data.get("perUnitItems", [])
         if i.get("licenseType") == "COMMERCIAL" and i.get("unitCount", 0) > 0),
        key=lambda i: i["unitCount"],
    )
    annual = sorted(
        (i for i in data.get("items", [])
         if i.get("licenseType") == "COMMERCIAL" and i.get("monthsValid") == 12
         and i.get("unitCount", 0) > 0),
        key=lambda i: i["unitCount"],
    )
    if not per_unit or not annual:
        raise RuntimeError("Marketplace pricing payload missing perUnitItems/items")

    # Monthly: cumulative per-unit rates. Each perUnitItem's unitCount is the TOP of its band,
    # so users between the previous top and this one bill at this item's rate.
    monthly, prev_top = 0.0, 0
    for item in per_unit:
        top = item["unitCount"]
        users_in_band = max(0, min(n, top) - prev_top)
        monthly += users_in_band * item["amount"]
        prev_top = top
        if n <= top:
            break
    else:
        monthly += max(0, n - prev_top) * per_unit[-1]["amount"]

    # Annual: flat price of the band that CONTAINS n (smallest published tier >= n).
    band = next((i for i in annual if i["unitCount"] >= n), annual[-1])

    # Below the first per-unit band the app is flat-rated; the annual band price is authoritative.
    if n <= 10:
        monthly = band["amount"] / 12.0

    return {
        "monthly": monthly,
        "annual": band["amount"],
        "band": band["unitCount"],
        "per_user_month": monthly / n if n else 0.0,
    }


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


def print_reply(space, expires_at, users, user_scoped=False, days=7, feedback_days=None):
    if users:
        p = full_plan_pricing(users)
        users_line = f"~{users:,} users"
        # Lead with the monthly figure — it is the smaller number and the one the Marketplace
        # calculator shows by default. The annual figure follows because that is what a
        # purchase order needs, and it is cheaper than paying monthly for twelve months.
        annual_saving = p["monthly"] * 12 - p["annual"]
        full_price = (
            f"~${p['monthly']:,.0f}/month (~${p['per_user_month']:.2f} per user). "
            f"Annual billing is ~${p['annual']:,.0f}/year"
            + (f" and saves ~${annual_saving:,.0f}" if annual_saving > 0 else "")
        )
    else:
        users_line = "~{USERS} users (fetch tier from the Marketplace license report)"
        full_price = "~${MONTHLY}/month, or ~${ANNUAL}/year on annual billing"

    if user_scoped:
        intro = (
            f"To get you unblocked straight away, we've enabled a temporary extension "
            f"for your account on {space} for the next {days} days (through {through_date(expires_at)}). "
            f"You can create and edit diagrams there as normal during this window — nothing to set up "
            f"on your end; just refresh the page if you have an editor open (it can take a few minutes to apply)."
        )
        scope_note = (
            f"This extension covers your account only — teammates in {space} may still see the limit. "
            f"If the whole team needs access, or other spaces are hitting the limit too, just reply here and we'll take a look."
        )
    else:
        intro = (
            f"To get you unblocked straight away, we've enabled a temporary extension on {space} for the "
            f"next {days} days (through {through_date(expires_at)}). You can create and edit diagrams there as "
            f"normal during this window — nothing to set up on your end; just refresh the page if you have "
            f"an editor open (it can take a few minutes to apply)."
        )
        scope_note = (
            f"The extension covers {space} specifically. If other spaces are hitting the limit too, "
            f"just reply here and we'll take a look."
        )

    # --feedback-offer: trade a LONGER window for product intel, instead of silently
    # renewing a repeat asker. Q4 is the commercially load-bearing one — after N free
    # comps with no conversion we still don't know WHICH wall we're hitting.
    # Deliberately does NOT mention Draw.io by name: Jira's editor auto-linkifies any
    # "word.io" into a broken http://Draw.io smart link in the customer's email.
    if feedback_days:
        feedback_block = f"""
That brings me to a request, and an offer. We're deciding what to build next, and candid input from a team using ZenUML this heavily is worth more to us than the license fee. If you reply with answers to these four questions, I'll extend your access to {feedback_days} days instead of {days}:

1. What are you using ZenUML for in {space} — what kind of documents, and where does it sit in your workflow?

2. What made you pick it over Confluence's built-in diagramming tools?

3. What's the most annoying thing about it today, or the thing you keep wishing it did?

4. If you wanted to lift the limit properly, what's the hard part internally — budget, admin approval, procurement, or simply nobody owning it?

Blunt answers are the useful ones — we won't take it badly.
"""
        # Decouples the free time from a purchase so the trade can't read as coercion.
        closing = (f"Either way, the {feedback_days} days is yours for the feedback — "
                   f"no strings attached to buying anything.")
    else:
        feedback_block = ""
        closing = "Tell us which fits better and we'll send exact pricing and the steps."

    print("\n" + "=" * 70)
    print("DRAFT REPLY  (canonical template: paywall/extension-request-replies.md)")
    print("=" * 70)
    print(f"""Hey,

Thanks for reaching out — glad to see your teams getting so much use out of ZenUML.

{intro}

A couple of things worth knowing:

{scope_note}
{feedback_block}
It's a temporary bridge. For a lasting fix there are two routes — happy to help with either:

Per-space (Enterprise Bundle) — ${ENTERPRISE_BUNDLE_USD}/space/year, unlimited macros and users in that space. It's the quickest path and doesn't require a Confluence admin — you can set it up directly, so it's ideal if you'd like {space} unblocked permanently right away. Purchase here: {STRIPE_BUNDLE_LINK} — just reply with the space key after payment and we'll activate it.

Org-wide (Full plan) — removes the limit across all your spaces and users at once; best value if you want everything covered (you're running a large site with diagrams across many spaces). Based on your site's {users_line}, this works out to {full_price}. Every Marketplace app also carries a 30-day free trial, so you can remove the limit site-wide today and decide afterwards. You can upgrade on the Atlassian Marketplace here: ZenUML Diagrams for Confluence | Atlassian Marketplace ({MARKETPLACE_LINK}) — this one goes through whoever administers Confluence apps for your site.

{closing}

Best Regards,

Peng""")
    print("=" * 70)


def main():
    ap = argparse.ArgumentParser(description="Grant a temporary Lite space-license extension + draft the reply.")
    ap.add_argument("--domain", required=True, help="Client domain (bare, hostname, or URL)")
    ap.add_argument("--space", required=True, help="Confluence space KEY (exact, case-sensitive)")
    ap.add_argument("--days", type=int, default=7,
                    help="Extension length (default 7 — deliberately short so the "
                         "--feedback-offer trade is worth taking; use 14 for a one-off "
                         "first-time asker where no feedback is being solicited)")
    ap.add_argument("--users", type=int, help="Site user tier (Marketplace license) → fills Full-plan price in the reply")
    ap.add_argument("--user", dest="user_account_id", default=None,
                    help="Requester's Atlassian accountId (e.g. 712020:...) — scopes the grant to this "
                         "user only. Omit to grant the whole space (manual escalation when multiple "
                         "independent users in the same space have requested).")
    ap.add_argument("--activated-by", default=None,
                    help="Provenance string on the record (default support:temp-<days>d-extension). "
                         "Append the ticket, e.g. support:temp-7d-extension:ZEN-1191, so a grant is "
                         "traceable to its request even if the sent log misses it.")
    ap.add_argument("--feedback-offer", dest="feedback_days", type=int, nargs="?", const=60, default=None,
                    metavar="N",
                    help="Add the feedback-for-time offer to the reply: grant --days now, promise N days "
                         "(default 60) in exchange for answers to 4 product questions. Use on a REPEAT "
                         "asker instead of silently renewing. Does not change what is written to KV — "
                         "when the feedback arrives, re-run with --days N to extend.")
    ap.add_argument("--dry-run", action="store_true", help="Preview only — no KV writes")
    ap.add_argument("--no-reply", action="store_true", help="Skip the drafted reply")
    args = ap.parse_args()

    if args.feedback_days is not None and args.feedback_days <= args.days:
        print(f"ERROR: --feedback-offer {args.feedback_days} must exceed --days {args.days} "
              f"(the offer is a LONGER window in exchange for feedback).", file=sys.stderr)
        sys.exit(1)

    activated_by = args.activated_by or f"support:temp-{args.days}d-extension"

    try:
        result = grant(args.domain, args.space, args.days, activated_by, args.dry_run,
                        user_account_id=args.user_account_id)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if not args.no_reply:
        print_reply(result["space"], result["expiresAt"], args.users,
                    user_scoped=bool(args.user_account_id), days=args.days,
                    feedback_days=args.feedback_days)

    scope = f"user {args.user_account_id}" if args.user_account_id else "the whole space"
    if result.get("wrote"):
        print(f"\n✅ Granted to {scope}. {result['space']} active through {result['expiresAt']} "
              f"(applies within ~5 min). Remember to log it in paywall/extension-request-replies.md.")
    elif args.dry_run:
        print("\n(dry-run — nothing written)")


if __name__ == "__main__":
    main()
