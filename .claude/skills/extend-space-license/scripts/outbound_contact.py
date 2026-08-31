#!/usr/bin/env python3
"""Open the COMMERCIAL conversation with a tenant's Marketplace technical contact.

This is the counterpart to `grant_extension.py`. That script unblocks ONE engineer for a
few days; this one tells the person who can actually buy a licence what the whole site is
doing and what it costs to remove the limit for good. Run it after a grant, when a space
has produced repeat requests from different people and the comps are not converting.

It raises a JSM ticket ON BEHALF OF the technical contact, adds the inbound requester as a
request participant (the desk's CC), and posts the letter as a public comment. The customer
receives the full letter as email text and can answer by replying to that mail — they never
have to open the portal.

Usage (run from the conf-app project root):
    # preview everything — contact, usage numbers, price, the letter. Sends nothing.
    python3 outbound_contact.py --domain example-tenant --space ENG --ticket ZEN-1209 \
        --participant requester@example.com

    # send it (requires an explicit go-ahead from the owner — see below)
    python3 outbound_contact.py --domain example-tenant --space ENG --ticket ZEN-1209 \
        --participant requester@example.com --send

⚠ `--send` CONTACTS A REAL CUSTOMER who has not written to us. It is an unsolicited
approach to a named individual, it cannot be recalled once the notification email leaves,
and it creates a portal account for them that CANNOT be deleted afterwards (the service
desk has open access enabled; customer removal returns 400). **Never pass --send without
the owner saying so for this specific tenant.** The default run prints the letter and stops.

Trigger rule (unchanged from SKILL.md § Outbound): this is not a mail-merge. Send only when
one space has drawn repeat requests from DIFFERENT people with no conversion. Blanket
outbound to every over-limit tenant is support-costumed marketing.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import sqlite3
import datetime as dt
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Reuse the grant script's verified helpers rather than restating them — in particular
# full_plan_pricing(), which reads the PUBLISHED Marketplace prices. Never recompute a
# price here (see SKILL.md § Pricing for the reply for why a formula goes wrong).
from grant_extension import (  # noqa: E402
    normalize_domain,
    resolve_cloud_id,
    http_json,
    full_plan_pricing,
    KV_LITE_BASE,
    KV_FULL_BASE,
    MARKETPLACE_LINK,
    STRIPE_BUNDLE_LINK,
    ENTERPRISE_BUNDLE_USD,
)

JIRA_BASE = "https://zenuml.atlassian.net"
SERVICE_DESK_ID = "1"
REQUEST_TYPE_ID = "9"                    # "Extension request" portal form
PLAN_FIELD = "customfield_10070"         # "Plan you're interested in" — REQUIRED on type 9
PLAN_FREE_EXTENSION = "10037"            # its "free extension" option
MARKETPLACE_DB = os.path.join(
    HERE, "..", "..", "marketplace", "scripts", "marketplace.db")
MP_QUERY = os.path.join(HERE, "..", "..", "mixpanel", "scripts", "mp_query.py")
UPGRADE_PAGE = "https://zenuml.com/upgrade/"


# --------------------------------------------------------------------------- credentials
def jsm_auth():
    """support@zenuml.com agent token: the environment first, then .env.forge.local.

    `.env.forge.local` is gitignored, so it exists only in the primary checkout — a git
    worktree has none, and hard-coding the script's own parent walk finds nothing there.
    Search cwd and every parent of it as well, and let an already-exported pair win.
    """
    if os.environ.get("JSM_EMAIL") and os.environ.get("JSM_API_TOKEN"):
        return os.environ["JSM_EMAIL"], os.environ["JSM_API_TOKEN"]
    candidates = [".env.forge.local",
                  os.path.join(HERE, "..", "..", "..", ".env.forge.local")]
    d = os.path.abspath(os.getcwd())
    while True:
        candidates.append(os.path.join(d, ".env.forge.local"))
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    for path in candidates:
        if not os.path.exists(path):
            continue
        env = {}
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        if env.get("JSM_EMAIL") and env.get("JSM_API_TOKEN"):
            return env["JSM_EMAIL"], env["JSM_API_TOKEN"]
    raise RuntimeError(
        "JSM_EMAIL / JSM_API_TOKEN not found. Export them, or run from a checkout that "
        "has .env.forge.local (it is gitignored, so a worktree will not have one).")


def jsm(method, path, payload=None, experimental=False):
    user, token = jsm_auth()
    cmd = ["curl", "-s", "-u", f"{user}:{token}", "-X", method,
           "-H", "Content-Type: application/json"]
    if experimental:
        cmd += ["-H", "X-ExperimentalApi: opt-in"]
    if payload is not None:
        cmd += ["-d", json.dumps(payload)]
    cmd += ["-w", "\n%{http_code}", f"{JIRA_BASE}{path}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=90).stdout
    body, _, code = out.rpartition("\n")
    try:
        return int(code), (json.loads(body) if body.strip() else {})
    except json.JSONDecodeError:
        return int(code), {"raw": body[:400]}


# ------------------------------------------------------------------------------- contact
def marketplace_contact(bare_domain):
    """Technical contact + user tier + reseller, from the local Marketplace snapshot.

    The v2 vendor reporting API returns 410 API_DEPRECATED since 2026, so the snapshot in
    the `marketplace` skill is the source. It is a SNAPSHOT — the caller prints its sync
    date, because a contact who left the company still appears here.
    """
    db = os.path.normpath(MARKETPLACE_DB)
    if not os.path.exists(db):
        raise RuntimeError(f"Marketplace snapshot missing at {db} — run the marketplace skill's sync")
    con = sqlite3.connect(db)
    rows = con.execute("SELECT raw FROM licenses WHERE raw LIKE ?",
                       (f"%{bare_domain}.atlassian%",)).fetchall()
    synced = con.execute("SELECT * FROM sync_meta").fetchone()
    con.close()
    if not rows:
        return None, (synced[0] if synced else "unknown")

    best = None
    for (raw,) in rows:
        r = json.loads(raw)
        # Prefer the Lite row (that is the app with the limit) but accept any.
        if best is None or "lite" in (r.get("addonKey") or ""):
            best = r
    cd = best.get("contactDetails") or {}
    tech = cd.get("technicalContact") or {}
    partner = (best.get("partnerDetails") or {}).get("partnerName")
    tier = best.get("tier") or ""
    users = int(re.sub(r"[^0-9]", "", tier) or 0)
    return {
        "email": tech.get("email"),
        "name": tech.get("name"),
        "users": users,
        "tier": tier,
        "partner": partner,
        "licenseType": best.get("licenseType"),
        "addonName": best.get("addonName"),
    }, (synced[0] if synced else "unknown")


def participant_display_name(email_or_id, account_id):
    """A human name for the CC line. The desk stores an email-as-displayName for portal-only
    customers, so fall back to the capitalised local part rather than printing an address."""
    if not email_or_id:
        return None
    if account_id:
        code, data = jsm("GET", f"/rest/api/3/user?accountId={account_id}")
        name = (data or {}).get("displayName") or ""
        if name and "@" not in name:
            return name
    local = email_or_id.split("@")[0]
    return " ".join(w.capitalize() for w in re.split(r"[._-]+", local) if w) or None


def desk_account_id(email_or_id):
    """Resolve a CC target to the accountId that POST /participant will accept.

    Two different ids exist for the same person and mixing them is the classic failure:
      - `712020:…`  the requester's Confluence account on THEIR OWN site. It is what the
                    KV licence key uses, and a 404 on zenuml.atlassian.net.
      - `qm:…`      their customer account on OUR service desk. This is the one to use.
    POST /participant rejects an email outright ("Users must be specified using the
    'accountIds' field"), so an email has to be resolved here first.
    """
    if not email_or_id:
        return None
    if email_or_id.startswith("qm:"):
        return email_or_id
    if ":" in email_or_id and "@" not in email_or_id:
        raise RuntimeError(
            f"{email_or_id} looks like a Confluence accountId from the customer's own site. "
            "The desk needs the 'qm:…' id — read it from the inbound ticket's reporter field.")
    code, data = jsm("GET",
                     f"/rest/servicedeskapi/servicedesk/{SERVICE_DESK_ID}/customer"
                     f"?query={email_or_id}", experimental=True)
    for v in (data.get("values") or []):
        if (v.get("emailAddress") or "").lower() == email_or_id.lower():
            return v["accountId"]
    return None


# --------------------------------------------------------------------------------- usage
def space_totals(bare_domain):
    """Every space's macro count for this tenant, from the prod metrics KV snapshot."""
    for base, extra in ((KV_LITE_BASE, "&addonKey=com.zenuml.confluence-addon-lite"),
                        (KV_FULL_BASE, "&addonKey=com.zenuml.confluence-addon")):
        try:
            data = http_json(f"{base}/admin/metrics-inspect?domain={bare_domain}{extra}")
        except Exception:
            continue
        spaces = (data or {}).get("spaces") or {}
        if not spaces:
            continue
        rows, stale = [], 0
        for key, entry in spaces.items():
            d = entry.get("data", {}) if isinstance(entry, dict) else {}
            if entry.get("status") == "stale":
                stale += 1
            rows.append((key, d.get("total", 0)))
        rows.sort(key=lambda r: -r[1])
        personal = [r for r in rows if r[0].startswith("~")]
        return {
            "rows": rows,
            "total": sum(r[1] for r in rows),
            "spaces": len(rows),
            "team_spaces": len(rows) - len(personal),
            "personal_spaces": len(personal),
            "over_limit": [r for r in rows if r[1] > 100 and not r[0].startswith("~")],
            "stale": stale,
        }
    return None


def mixpanel_usage(bare_domain, days):
    """Distinct users + paywall pressure over the window. Runs the mixpanel skill's JQL client.

    Counts EXCLUDE the literal `unknown_user_account_id` — it is a shared constant emitted
    when the Forge context had not resolved, so counting it collapses every affected user
    into one (see the mixpanel skill).
    """
    script = os.path.normpath(MP_QUERY)
    if not os.path.exists(script):
        raise RuntimeError(f"mp_query.py missing at {script}")
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    events = ["macro_viewed", "macro_create_succeeded", "macro_save_succeeded",
              "paywall_triggered", "paywall_blocked_create",
              "paywall_attempts_exhausted", "extension_request_clicked"]
    selectors = ",".join("{event:'%s'}" % e for e in events)
    jql = f"""
function main(){{
  return Events({{
    from_date: '{start.isoformat()}', to_date: '{end.isoformat()}',
    event_selectors: [{selectors}]
  }})
  .filter(e => e.properties.client_domain === '{bare_domain}')
  .groupBy([e => e.name, e => e.distinct_id], mixpanel.reducer.count());
}}"""
    path = os.path.join("/tmp", f"outbound_usage_{bare_domain}.js")
    open(path, "w").write(jql)
    out = subprocess.run([sys.executable, script, "--file", path, "-o", path + ".json"],
                         capture_output=True, text=True, timeout=300)
    if not os.path.exists(path + ".json"):
        raise RuntimeError(f"Mixpanel query failed: {out.stderr.strip()[:300]}")
    agg = {}
    for r in json.load(open(path + ".json")):
        name, uid = r["key"]
        e = agg.setdefault(name, {"events": 0, "users": set()})
        e["events"] += r["value"]
        if uid != "unknown_user_account_id":
            e["users"].add(uid)
    return {k: {"events": v["events"], "users": len(v["users"])} for k, v in agg.items()}


# -------------------------------------------------------------------------------- letter
def compose(contact, usage, spaces, price, space, grants, days, ticket_note):
    def ev(name, field):
        return (usage.get(name) or {}).get(field, 0)

    viewers = ev("macro_viewed", "users")
    over = ", ".join(f"{k} at {v:,}" for k, v in spaces["over_limit"][:5]) if spaces else ""
    grant_line = ""
    if grants:
        dates = ", ".join(grants[:-1]) + " and " + grants[-1] if len(grants) > 1 else grants[0]
        grant_line = (
            f"That is the part I want to bring to your attention. We have granted "
            f"{len(grants)} temporary extensions for the {space} space — on {dates}. Each one "
            f"lasts 7 to 14 days and covers a single person. When it lapses, that engineer is "
            f"blocked again and files another request.\n\n"
            f"{len(grants)} extensions do not cover {ev('paywall_triggered','users')} people. Most of the "
            f"affected engineers do not file a ticket at all. They reach the limit and stop "
            f"editing. Viewing is never blocked, so no existing diagram is lost, but editing "
            f"stops for anyone who has not asked us individually.\n\n")

    # Partner rule: a tenant that buys through a reseller must NOT be handed the direct
    # Stripe Bundle link — it routes revenue around the partner. Full plan only there.
    if contact.get("partner"):
        commercial = (
            f"On procurement: your ZenUML licence is billed through {contact['partner']}, your "
            f"Atlassian partner. If a purchase order is the blocker, they can quote and invoice "
            f"the Full plan the same way as your other Atlassian apps. I have not contacted them.\n\n")
    else:
        commercial = (
            f"If you only need one space rather than the whole site, there is also an Enterprise "
            f"Space Bundle at ${ENTERPRISE_BUNDLE_USD}/space/year, which needs no Confluence admin: "
            f"{STRIPE_BUNDLE_LINK} — reply with the space key after payment and we'll activate it.\n\n")

    first = contact.get("name", "").split(" ")[0] if contact.get("name") else "there"
    return f"""Hi {first},

You did not raise this request — I opened this ticket on your behalf, so please ignore the confirmation line above. I'm reaching out because you're listed as the technical contact for {contact.get('addonName') or 'ZenUML'} on {contact['site']}.{ticket_note}

Here is what your teams are doing with ZenUML, measured over the last {days} days:

{viewers:,} people opened a ZenUML diagram. {ev('macro_create_succeeded','users'):,} of them created new diagrams and {ev('macro_save_succeeded','users'):,} edited existing ones. Total diagram views: {ev('macro_viewed','events'):,}.

You hold at least {spaces['total']:,} diagrams across {spaces['spaces']} spaces — {spaces['team_spaces']} team spaces and {spaces['personal_spaces']} personal spaces. {len(spaces['over_limit'])} team spaces are over the free Lite limit of 100 diagrams per space: {over}.

In the same {days} days, {ev('paywall_triggered','users'):,} people reached the limit. {ev('paywall_blocked_create','users'):,} of them were blocked from creating a diagram. {ev('paywall_attempts_exhausted','users'):,} used up their remaining attempts entirely. {ev('extension_request_clicked','users'):,} clicked the "request an extension" button.

{grant_line}The permanent fix is the Full plan. It removes the limit across every space and every user on the site, with no diagram limit anywhere.

At your {contact['users']:,} users it is {price['annual']:,.0f} USD per year on annual billing — that is {price['per_user_month_annual']:.2f} USD per licensed user per month, or about {price['annual']/max(viewers,1)/12:.2f} USD per month for each of the {viewers:,} people who actually opened a diagram. Monthly billing is also available at {price['monthly']:,.0f} USD per month, though it costs about {price['monthly']*12-price['annual']:,.0f} USD more over a year.

Every app on the Marketplace also carries a 30-day free trial, so you can remove the limit site-wide today and decide afterwards.

What it covers and how the upgrade works: {UPGRADE_PAGE}

Buy or start a free trial on the Atlassian Marketplace: {MARKETPLACE_LINK}

{commercial}If a site-wide licence is more than you need right now, talk to us. We can look at a narrower or staged arrangement that fits your budget and your timeline.

If neither route fits, tell me what the actual obstacle is — budget, admin approval, procurement, or no clear owner. We adjust our plans based on that, and a straight answer is useful to us even if it ends in "not this year".

Best regards,

Peng Xiao
ZenUML"""


# ----------------------------------------------------------------------------------- send
def send(summary, body, on_behalf_of, participant_id):
    print("[1/3] creating the ticket ...")
    code, data = jsm("POST", "/rest/servicedeskapi/request", {
        "serviceDeskId": SERVICE_DESK_ID, "requestTypeId": REQUEST_TYPE_ID,
        "raiseOnBehalfOf": on_behalf_of,
        "requestFieldValues": {
            "summary": summary,
            # Portal-only: the customer email does NOT include the description field.
            "description": "Opened by ZenUML support on your behalf — details in the reply below.",
            PLAN_FIELD: {"id": PLAN_FREE_EXTENSION},
        }})
    if code not in (200, 201) or not data.get("issueKey"):
        raise RuntimeError(f"create failed HTTP {code}: {json.dumps(data)[:400]}")
    key = data["issueKey"]
    print(f"      {key}")

    if participant_id:
        print("[2/3] adding the participant ...")
        code, _ = jsm("POST", f"/rest/servicedeskapi/request/{key}/participant",
                      {"accountIds": [participant_id]})
        print(f"      HTTP {code}" + ("" if code == 200 else "  ⚠ participant NOT added"))
    else:
        print("[2/3] no participant to add.")

    print("[3/3] posting the letter as a public comment ...")
    code, _ = jsm("POST", f"/rest/servicedeskapi/request/{key}/comment",
                  {"body": body, "public": True})
    if code != 201:
        raise RuntimeError(f"comment failed HTTP {code} — the ticket exists but is EMPTY: {key}")

    code, data = jsm("GET", f"/rest/servicedeskapi/request/{key}")
    print(f"\n✅ sent. {key} — reporter {(data.get('reporter') or {}).get('emailAddress')}, "
          f"status {(data.get('currentStatus') or {}).get('status')}")
    print(f"   {JIRA_BASE}/browse/{key}")
    print("   Log it in paywall/extension-request-replies.md (outbound entry).")
    return key


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--domain", required=True, help="Tenant subdomain, e.g. example-tenant")
    ap.add_argument("--space", help="The space that keeps hitting the limit (named in the letter)")
    ap.add_argument("--ticket", help="Related inbound ticket, e.g. ZEN-1209 (mentioned in the letter)")
    ap.add_argument("--participant",
                    help="CC: the inbound requester's EMAIL, or their qm: desk accountId. "
                         "A 712020:… Confluence id is rejected — see desk_account_id().")
    ap.add_argument("--grants", nargs="*", default=[],
                    help='Dates of prior extensions, e.g. "23 June" "8 July" — named in the letter')
    ap.add_argument("--days", type=int, default=90, help="Usage window (default 90)")
    ap.add_argument("--to", help="Override the technical contact's email (use when the snapshot is stale)")
    ap.add_argument("--send", action="store_true",
                    help="Actually contact the customer. Requires the owner's explicit go-ahead "
                         "for THIS tenant. Without it the script only prints the letter.")
    args = ap.parse_args()

    bare, full = normalize_domain(args.domain)
    print(f"[contact] {full}")
    contact, synced = marketplace_contact(bare)
    if not contact:
        sys.exit(f"No Marketplace licence found for {bare} in the local snapshot (synced {synced}).")
    if args.to:
        contact["email"] = args.to
    contact["site"] = full
    if not contact.get("email"):
        sys.exit("The Marketplace record has no technical contact email — nobody to write to.")
    print(f"          {contact['name']} <{contact['email']}>  |  {contact['tier']}  "
          f"|  {contact['licenseType']}  |  partner: {contact['partner'] or 'none'}")
    print(f"          snapshot synced {synced} — a contact who has left still appears here.")

    print(f"[cloud]   {resolve_cloud_id(full)}")
    print(f"[spaces]  reading prod metrics KV ...")
    spaces = space_totals(bare)
    if not spaces:
        sys.exit("No metrics KV data for this tenant — cannot quantify usage, so do not send.")
    print(f"          {spaces['total']:,} macros / {spaces['spaces']} spaces "
          f"({spaces['stale']} stale) | over limit: "
          f"{', '.join(f'{k} {v}' for k, v in spaces['over_limit'][:5]) or 'none'}")

    print(f"[usage]   querying Mixpanel, last {args.days} days ...")
    usage = mixpanel_usage(bare, args.days)
    for k in sorted(usage, key=lambda x: -usage[x]["events"]):
        print(f"          {k:<28} events {usage[k]['events']:>7}  users {usage[k]['users']:>5}")

    price = full_plan_pricing(contact["users"])
    print(f"[price]   annual ${price['annual']:,.0f} (band {price['band']}) "
          f"| monthly ${price['monthly']:,.2f} | ${price['per_user_month_annual']:.2f}/user/mo")

    pid = desk_account_id(args.participant) if args.participant else None
    cc_name = participant_display_name(args.participant, pid)
    ticket_note = ""
    if args.participant:
        who = cc_name or "The engineer who raised it"
        ref = f" — they raised {args.ticket}, and they are" if args.ticket else " — they are"
        ticket_note = f" {who} is copied here{ref} one of the engineers affected."
    body = compose(contact, usage, spaces, price, args.space or "that space",
                   args.grants, args.days, ticket_note)
    summary = (f"ZenUML usage on {full} — {(usage.get('macro_viewed') or {}).get('users', 0):,} users, "
               f"{spaces['total']:,} diagrams")

    print("\n" + "=" * 74)
    print(f"SUMMARY: {summary}")
    print("=" * 74)
    print(body)
    print("=" * 74)

    if args.participant and not pid:
        print(f"\n⚠ {args.participant} is not a customer on this desk — they will NOT be CC'd. "
              f"Read their qm: id from the inbound ticket's reporter field.")

    if not args.send:
        print("\n(preview only — nothing sent. Re-run with --send once the owner has "
              "approved contacting this customer.)")
        return
    print()
    send(summary, body, contact["email"], pid)


if __name__ == "__main__":
    main()
