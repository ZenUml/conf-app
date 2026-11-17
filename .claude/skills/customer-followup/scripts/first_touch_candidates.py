#!/usr/bin/env python3
"""List first-touch candidates: new conf-app licence starts with their Marketplace contact.

Read-only. Fresh Marketplace licence exports for the four conf-app variants (Lite, Full,
Diagramly, AsyncAPI). Writes nothing, sends nothing, drafts nothing.

A row is a candidate when its start date falls in the last --days calendar days
(Australia/Melbourne, inclusive). Start date: latestEvaluationStartDate for EVALUATION rows,
otherwise maintenanceStartDate.

Each candidate carries `exclude` reasons. An empty list means "reachable": the caller still
has to check prior contact (Gmail, ledger) before drafting.

Usage (from the conf-app primary checkout):
  python3 .claude/skills/customer-followup/scripts/first_touch_candidates.py --days 2
  python3 .claude/skills/customer-followup/scripts/first_touch_candidates.py --days 2 --env .env.forge.local

Output: JSON on stdout. Contains contact emails: keep it out of public files.
"""
import argparse
import datetime
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "marketplace", "scripts"))
import mp_report as m  # noqa: E402

APPS = {
    "lite": "com.zenuml.confluence-addon-lite",
    "full": "com.zenuml.confluence-addon",
    "diagramly": "gptdock-confluence",
    "asyncapi": "my-api",
}
PRODUCT_NAMES = {
    "lite": "ZenUML Lite",
    "full": "ZenUML Diagrams for Confluence",
    "diagramly": "Diagramly for Confluence",
    "asyncapi": "AsyncAPI for Confluence",
}
DEV_HOST = re.compile(r"(^|[-.])(test|testing|sandbox|stg|staging|bugbounty|bug-bounty|qa)([-.\d]|$)|bugcrowd|hackerone", re.I)
INTERNAL_HOST = re.compile(r"zenuml|whimet|diagramly|z4c", re.I)
PERSONAL_DEV_HOST = re.compile(r"developer-\d{10,}")
FREEMAIL = {"gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "qq.com",
            "163.com", "proton.me", "protonmail.com", "live.com", "aol.com", "mail.ru", "yandex.ru"}


def start_date(row):
    if row.get("licenseType") == "EVALUATION" and row.get("latestEvaluationStartDate"):
        return row["latestEvaluationStartDate"]
    return row.get("maintenanceStartDate")


def domain(email):
    return (email or "").rsplit("@", 1)[-1].lower()


def classify(row, app, other_apps):
    """Return the candidate record for one licence row (pure function, no I/O)."""
    host = row.get("cloudSiteHostname") or ""
    c = row.get("contactDetails") or {}
    tech = c.get("technicalContact") or {}
    bill = c.get("billingContact") or {}
    partner = row.get("partnerDetails") or {}
    partner_dom = domain((partner.get("billingContact") or {}).get("email"))
    excl = []
    if INTERNAL_HOST.search(host):
        excl.append("internal host")
    if DEV_HOST.search(host):
        excl.append("dev/test host")
    if other_apps:
        excl.append("existing customer: " + ", ".join(sorted(other_apps)))
    if not tech.get("email"):
        excl.append("no technical contact email")
    elif partner_dom and domain(tech["email"]) == partner_dom:
        excl.append("technical contact is at the reseller")
    if row.get("status") != "active":
        excl.append("licence not active")
    return {
        "app": app,
        "product_name": PRODUCT_NAMES[app],
        "site": host,
        "license_type": row.get("licenseType"),
        "start": start_date(row),
        "tier": row.get("tier"),
        "country": c.get("country"),
        "tech_name": tech.get("name"),
        "tech_email": tech.get("email"),
        "billing_email": bill.get("email"),
        "freemail": domain(tech.get("email")) in FREEMAIL,
        "partner": partner.get("partnerName"),
        "personal_dev_site": bool(PERSONAL_DEV_HOST.search(host)),
        "exclude": excl,
    }


def select(rows_by_app, start, end):
    by_cloud = {}
    for app, rows in rows_by_app.items():
        for r in rows:
            by_cloud.setdefault(r.get("cloudId"), []).append((app, r))
    out = []
    for app, rows in rows_by_app.items():
        for r in rows:
            s = start_date(r)
            if not s or not (start <= s <= end):
                continue
            # Another conf-app licence on the same site that started earlier = existing customer.
            others = {a for a, o in by_cloud.get(r.get("cloudId"), [])
                      if o is not r and (start_date(o) or "9999") < s}
            out.append(classify(r, app, others))
    out.sort(key=lambda x: (x["start"], x["site"]))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=2, help="past N calendar days, inclusive (default 2)")
    ap.add_argument("--timezone", default="Australia/Melbourne")
    ap.add_argument("--env", default=".env.forge.local")
    a = ap.parse_args()
    today = datetime.datetime.now(ZoneInfo(a.timezone)).date()
    start = (today - datetime.timedelta(days=a.days)).isoformat()
    end = today.isoformat()
    auth = m._auth_header(*m.load_creds(a.env))
    started = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    rows = {app: m.export("licenses", auth, addon=key) for app, key in APPS.items()}
    cands = select(rows, start, end)
    json.dump({
        "window": {"from": start, "to": end, "timezone": a.timezone},
        "queried_at": started,
        "rows_read": {app: len(r) for app, r in rows.items()},
        "candidates": cands,
        "reachable": [c for c in cands if not c["exclude"]],
    }, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
