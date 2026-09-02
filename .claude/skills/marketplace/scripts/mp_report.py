#!/usr/bin/env python3
"""
mp_report.py — Atlassian Marketplace vendor reporting audit for ZenUML apps.

Fetches licenses + sales transactions via the BULK EXPORT endpoint (one request per
resource, gzipped) and answers renewal / overdue / revenue questions locally.

Why the export endpoint: the paginated `?limit=&offset=` reporting API caps pages at
50 rows regardless of the requested limit. The Full-app transaction set alone is ~4.2k
rows → ~85 sequential requests ≈ 160s (past the 120s Bash timeout). The export endpoint
returns the whole filtered dataset in ONE request (~3-7s). See SKILL.md.

Auth: FORGE_EMAIL / FORGE_API_TOKEN (Basic auth). Loaded from the environment, or from
`.env.forge.local` at the repo root (override with --env). Vendor id: 1215266.

All subcommands accept --json for machine-readable output.
"""
import argparse, base64, datetime, gzip, json, os, re, sqlite3, subprocess, sys, urllib.request, urllib.error
from collections import defaultdict

VENDOR = "1215266"
BASE = "https://marketplace.atlassian.com"
APPS = {                                  # --app alias -> Marketplace addonKey
    "full": "com.zenuml.confluence-addon",
    "lite": "com.zenuml.confluence-addon-lite",
    "diagramly": "gptdock-confluence",
    "asyncapi": "my-api",                     # "AsyncAPI for Confluence" (its own Forge app identity)
}
ADDON_KEYS = set(APPS.values())
BOTH_KEYS = {APPS["full"], APPS["lite"]}     # `--app both` = the two ZenUML-branded apps only
APP_MODES = ("both", "all")                   # vendor-wide fetch, filtered client-side


# ----- credentials -------------------------------------------------------------
def load_creds(env_path):
    email, tok = os.environ.get("FORGE_EMAIL"), os.environ.get("FORGE_API_TOKEN")
    if (not email or not tok) and env_path and os.path.exists(env_path):
        for line in open(env_path):
            line = line.strip()
            if line.startswith("FORGE_EMAIL="): email = line.split("=", 1)[1].strip()
            elif line.startswith("FORGE_API_TOKEN="): tok = line.split("=", 1)[1].strip()
    if not email or not tok:
        sys.exit("ERROR: FORGE_EMAIL / FORGE_API_TOKEN not found (env or .env.forge.local). "
                 "Pass --env <path> or export them.")
    return email, tok


def find_env():
    # walk up from CWD looking for .env.forge.local (repo root)
    d = os.getcwd()
    for _ in range(6):
        p = os.path.join(d, ".env.forge.local")
        if os.path.exists(p): return p
        d = os.path.dirname(d)
    return ".env.forge.local"


# ----- fetch -------------------------------------------------------------------
def _auth_header(email, tok):
    return "Basic " + base64.b64encode(f"{email}:{tok}".encode()).decode()


def export(kind, auth, **filters):
    """kind = 'licenses' or 'sales/transactions'. Returns a LIST (JSON export is a bare array).
    If a local snapshot is active (`--local`), serve from SQLite instead of the API — the rows
    are the SAME raw dicts, so every downstream command works unchanged (raw-passthrough)."""
    if LOCAL["db"]:
        return _local_export(kind, filters)
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in filters.items() if v is not None)
    path = f"/rest/2/vendors/{VENDOR}/reporting/{kind}/export?accept=json" + (("&" + qs) if qs else "")
    req = urllib.request.Request(BASE + path, headers={
        "Authorization": auth, "Accept": "application/json", "Accept-Encoding": "gzip"})
    try:
        resp = urllib.request.urlopen(req, timeout=90)
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR {e.code} fetching {kind}: {e.read()[:200]!r}")
    raw = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    data = json.loads(raw)
    # export returns a bare array; be defensive if a dict wrapper ever appears
    if isinstance(data, dict):
        data = data.get("licenses") or data.get("transactions") or []
    return data


def check_app(app):
    """Validate a --app value and return it unchanged; ValueError for anything unrecognised.
    Accepted: an alias in APPS, 'both' / 'all', a known addonKey, or an explicit com.* key.
    Before 2026-09-02 an unknown value fell through addon_filter/keep_addon to the ALL-apps
    result while the header still printed app=<value>: `revenue --app gptdock-confluence`
    (and `--app my-api`, neither of which starts with com.) reported the vendor-wide
    164 payers / $134k as Diagramly's. Reject up front instead."""
    if app in APPS or app in APP_MODES or app in ADDON_KEYS or app.startswith("com."):
        return app
    accepted = ", ".join(list(APPS) + list(APP_MODES) + sorted(ADDON_KEYS))
    raise ValueError(f"unknown --app {app!r}; accepted: {accepted}, or an explicit com.* addon key")


def _app_arg(value):
    """argparse `type=` wrapper so a bad --app dies as a usage error, before any fetch."""
    try: return check_app(value)
    except ValueError as e: raise argparse.ArgumentTypeError(str(e))


def addon_filter(app):
    """Return the addon= filter value, or None to fetch the whole vendor (then filter client-side)."""
    check_app(app)
    if app in APPS: return APPS[app]
    if app in APP_MODES: return None                 # 'both' / 'all'
    return app                                       # explicit addon key


def keep_addon(rec, app):
    check_app(app)
    k = rec.get("addonKey", "")
    if app in APPS: return k == APPS[app]
    if app == "both": return k in BOTH_KEYS
    if app == "all": return True
    return k == app                                  # explicit addon key


# ----- transaction aggregation -------------------------------------------------
def pdate(s):
    try: return datetime.date.fromisoformat(s)
    except Exception: return None


def aggregate_tx(txs):
    """Aggregate transactions by cloudId -> revenue, billing period, paid-through date."""
    agg = defaultdict(lambda: {"vendor": 0.0, "n": 0, "annual": 0, "monthly": 0,
                               "paid_thru": None, "last_sale": "", "company": "", "tier": "",
                               "last_paid_amount": 0.0, "last_paid_date": "", "last_paid_mend": "",
                               "last_paid_billing": ""})
    for t in txs:
        cid = t.get("cloudId"); p = t.get("purchaseDetails", {}); a = agg[cid]
        amt = float(p.get("vendorAmount", 0) or 0)
        a["vendor"] += amt; a["n"] += 1
        a["company"] = t.get("customerDetails", {}).get("company", a["company"])
        bp = p.get("billingPeriod", "")
        if bp == "Annual": a["annual"] += 1
        elif bp == "Monthly": a["monthly"] += 1
        sd = p.get("saleDate", "")
        if sd > a["last_sale"]: a["last_sale"] = sd; a["tier"] = p.get("tier", a["tier"])
        if amt > 0:                                  # paid-through = latest PAID coverage end
            mes = p.get("maintenanceEndDate") or ""
            me = pdate(mes)
            if me and (a["paid_thru"] is None or me > a["paid_thru"]): a["paid_thru"] = me
            # most recent PAID sale -> expected renewal $. Tie-break on maintenanceEndDate:
            # a cycle often posts TWO same-day transactions — a small trailing true-up for the
            # cycle just ended (mEnd in the past) plus the real forward line. Comparing saleDate
            # alone let whichever came first in the API response win, so a $0.27 true-up could
            # stand in for a $15.49 renewal (socialplus / liberty-corporate, 2026-07-25).
            if (sd, mes) > (a["last_paid_date"], a["last_paid_mend"]):
                a["last_paid_date"] = sd; a["last_paid_mend"] = mes; a["last_paid_amount"] = amt
                a["last_paid_billing"] = bp
    return agg


def aggregate_tx_by_app(txs):
    """Like aggregate_tx but keyed by (cloudId, addonKey) instead of cloudId alone. A tenant
    can hold two licenses on one cloudId (e.g. a paid Full license AND a leftover free Lite
    listing that has zero transactions). aggregate_tx would put all of that cloudId's revenue
    in one bucket, so BOTH license rows read the same paid amount and the income is counted
    twice. Splitting by app keeps each subscription separate; the empty Lite bucket then has
    vendor $0 and drops out of any payers-only view."""
    groups = defaultdict(list)
    for t in txs:
        groups[(t.get("cloudId"), t.get("addonKey"))].append(t)
    out = {}
    for key, group in groups.items():
        for _cid, a in aggregate_tx(group).items():  # each group is one cloudId -> one entry
            out[key] = a
    return out


def billing_of(a):
    # The CURRENT cycle, not the lifetime majority: maymobility ran 28 monthly cycles before
    # switching to Annual in 2024-07, so a count-based vote called its $841.50/yr renewal
    # "Monthly" (2026-07-25). The most recent paid transaction is the authority.
    if a.get("last_paid_billing"): return a["last_paid_billing"]
    if a["annual"] > a["monthly"] and a["annual"] > 0: return "Annual"
    if a["monthly"] > 0: return "Monthly"
    return "-"


def company_of(rec):
    return (rec.get("contactDetails", {}) or {}).get("company") or rec.get("cloudSiteHostname", "?")


# ----- local SQLite snapshot ---------------------------------------------------
# The cloudId<->domain identity is stable but BILLING (tx, lifetime $, tier, status) is
# volatile, so the snapshot is timestamped and `--local` prints its age — never present
# stale billing as current. Payoff is batch / analytics / cross-source joins (cloudId is
# the key to Mixpanel + D1), not single-lookup speed. Stores raw JSON so `export()` can
# hand downstream commands the exact same dicts (raw-passthrough).
APP_KEYS_ALL = list(APPS.values())                    # every app `sync` snapshots = every --app alias
LOCAL = {"db": None}


def _default_db():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "marketplace.db")


def _local_export(kind, filters):
    table = "transactions" if kind.startswith("sales") else "licenses"
    con = sqlite3.connect(LOCAL["db"])
    rows = [json.loads(r[0]) for r in con.execute(f"SELECT raw FROM {table}")]
    con.close()
    if filters.get("addon"):
        rows = [r for r in rows if r.get("addonKey") == filters["addon"]]
    if filters.get("text"):                              # mimic the API's broad text filter
        tl = str(filters["text"]).lower()
        rows = [r for r in rows if tl in json.dumps(r, default=str).lower()]
    return rows


def cmd_sync(args, auth):
    path = args.db or _default_db()
    con = sqlite3.connect(path)
    con.executescript(
        "DROP TABLE IF EXISTS licenses; DROP TABLE IF EXISTS transactions; DROP TABLE IF EXISTS sync_meta;"
        "CREATE TABLE licenses(addonKey TEXT, cloudId TEXT, raw TEXT);"
        "CREATE TABLE transactions(addonKey TEXT, cloudId TEXT, raw TEXT);"
        "CREATE TABLE sync_meta(synced_at TEXT, apps TEXT, license_rows INT, tx_rows INT);")
    nlic = ntx = 0
    for app in APP_KEYS_ALL:                              # runs LIVE (LOCAL['db'] is None during sync)
        for r in export("licenses", auth, addon=app):
            con.execute("INSERT INTO licenses VALUES(?,?,?)",
                        (r.get("addonKey"), r.get("cloudId"), json.dumps(r, default=str))); nlic += 1
        for t in export("sales/transactions", auth, addon=app):
            con.execute("INSERT INTO transactions VALUES(?,?,?)",
                        (t.get("addonKey"), t.get("cloudId"), json.dumps(t, default=str))); ntx += 1
    con.executescript("CREATE INDEX ix_l ON licenses(addonKey); CREATE INDEX ix_t ON transactions(addonKey);")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    con.execute("INSERT INTO sync_meta VALUES(?,?,?,?)", (now, ",".join(APP_KEYS_ALL), nlic, ntx))
    con.commit(); con.close()
    print(f"synced {nlic} licenses + {ntx} transactions -> {path}  @ {now}")


def _snapshot_age_note(db):
    con = sqlite3.connect(db)
    row = con.execute("SELECT synced_at FROM sync_meta ORDER BY synced_at DESC LIMIT 1").fetchone()
    con.close()
    if not row:
        return "[local snapshot: unknown age]"
    try:
        dt = datetime.datetime.fromisoformat(row[0])
        hrs = (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds() / 3600
        warn = "  ⚠ billing may be stale — `sync` to refresh" if hrs > 24 else ""
        return f"[local snapshot @ {row[0]} ({hrs:.1f}h old){warn}]"
    except Exception:
        return f"[local snapshot @ {row[0]}]"


# ----- shared load -------------------------------------------------------------
def load(app, auth, with_tx=True):
    lic = [r for r in export("licenses", auth, addon=addon_filter(app)) if keep_addon(r, app)]
    agg = {}
    if with_tx:
        txs = [t for t in export("sales/transactions", auth, addon=addon_filter(app)) if keep_addon(t, app)]
        agg = aggregate_tx(txs)
    return lic, agg


# ----- subcommands -------------------------------------------------------------
def cmd_renewals(args, auth):
    lic, agg = load(args.app, auth)
    f0, f1 = pdate(args.frm), pdate(args.to)
    rows = []
    for r in lic:
        me = pdate(r.get("maintenanceEndDate"))
        if not (me and f0 <= me <= f1): continue
        cid = r.get("cloudId"); a = agg.get(cid, {})
        bill = billing_of(a) if a else "-"
        vendor = a.get("vendor", 0) if a else 0
        if args.billing != "any" and bill.lower() != args.billing: continue
        if args.paid_only and vendor <= 0: continue
        rows.append({
            "company": company_of(r), "host": r.get("cloudSiteHostname"),
            "app": "Full" if r.get("addonKey") == APPS["full"] else ("Lite" if r.get("addonKey") == APPS["lite"] else r.get("addonKey")),
            "type": r.get("licenseType"), "status": r.get("status"), "tier": r.get("tier"),
            "mEnd": r.get("maintenanceEndDate"), "billing": bill,
            "lifetime_vendor": round(vendor, 2), "paid_thru": str(a.get("paid_thru")) if a else None,
            "grace": r.get("inGracePeriod"), "dunning": r.get("invoiceDunningReason"),
        })
    rows.sort(key=lambda x: (x["mEnd"] or "", -x["lifetime_vendor"]))
    _emit(args, rows, f"renewals {args.frm}..{args.to} app={args.app} billing={args.billing}"
          + (" paid-only" if args.paid_only else ""),
          cols=["mEnd", "app", "type", "status", "tier", "lifetime_vendor", "billing", "paid_thru", "dunning", "company"])


def cmd_overdue(args, auth):
    today = pdate(args.asof) or datetime.date.today()
    lic, agg = load(args.app, auth)
    rows = []
    for r in lic:
        cid = r.get("cloudId"); a = agg.get(cid, {})
        me = pdate(r.get("maintenanceEndDate"))
        paid_thru = a.get("paid_thru") if a else None
        flags = []
        if r.get("inGracePeriod") == "Yes": flags.append("grace")
        if r.get("invoiceDunningReason"): flags.append("no-payment-method")
        if paid_thru and paid_thru < today: flags.append("coverage-lapsed")
        elif me and me < today and r.get("status") == "active": flags.append("past-due")
        if not flags: continue
        vendor = a.get("vendor", 0) if a else 0
        if args.paid_only and vendor <= 0: continue
        rows.append({
            "company": company_of(r), "status": r.get("status"), "tier": r.get("tier"),
            "billing": billing_of(a) if a else "-", "lifetime_vendor": round(vendor, 2),
            "paid_thru": str(paid_thru) if paid_thru else None, "mEnd": r.get("maintenanceEndDate"),
            "last_sale": a.get("last_sale") if a else "", "flags": ",".join(flags),
        })
    # most valuable at-risk payers first
    rows.sort(key=lambda x: (-x["lifetime_vendor"], x["mEnd"] or ""))
    _emit(args, rows, f"overdue app={args.app} asof={today}" + (" paid-only" if args.paid_only else ""),
          cols=["lifetime_vendor", "billing", "status", "tier", "paid_thru", "mEnd", "flags", "company"])


APP_LABEL = {"com.zenuml.confluence-addon": "Full",
             "com.zenuml.confluence-addon-lite": "Lite",
             "gptdock-confluence": "Diagramly",
             "my-api": "AsyncAPI"}
# ZenUML's own instances — not customers. zenuml-dev is the Forge development site; its
# license lapsing showed up as "$3.20 of income at risk" in the radar (2026-07-25).
INTERNAL_HOSTS = {"zenuml", "zenuml-connect", "zenuml-dev"}


def cmd_radar(args, auth):
    """Near-term cash view: renewals due in the next N days (expected income) and payer
    subscriptions that lapsed in the past N days without a new payment (missed). Payers only
    (vendor $ > 0); ONE row per (tenant, app) subscription across all revenue apps (Full +
    Diagramly; a leftover Lite listing has $0 here and drops out). Internal ZenUML instances
    are excluded. Also lists EVALUATIONS (trials) expiring in the next N days or lapsed in the
    past N days — a conversion signal, shown separately and kept out of the income totals."""
    today = pdate(args.asof) or datetime.date.today()
    n = args.days
    fwd_end = today + datetime.timedelta(days=n)
    back_start = today - datetime.timedelta(days=n)
    lic = export("licenses", auth, addon=None)       # all vendor apps; scoped to payers below
    txs = export("sales/transactions", auth, addon=None)
    agg = aggregate_tx_by_app(txs)                   # keyed by (cloudId, addonKey) — no cross-app double count
    incoming, missed, seen = [], [], set()
    for r in lic:
        cid = r.get("cloudId"); app_key = r.get("addonKey"); host = r.get("cloudSiteHostname") or ""
        if host.split(".")[0] in INTERNAL_HOSTS: continue
        if (cid, app_key) in seen: continue          # one row per subscription (guard dup license rows)
        seen.add((cid, app_key))
        a = agg.get((cid, app_key), {})
        vendor = a.get("vendor", 0) if a else 0
        if vendor <= 0: continue                     # income / miss only meaningful for real payers
        paid_thru = a.get("paid_thru") if a else None
        if not paid_thru: continue
        amount = round(a.get("last_paid_amount", 0) or 0, 2)
        # payment-risk flags apply to BOTH sides: on an INCOMING renewal a dead card / grace is
        # the *leading* indicator it will land in MISSED next cycle, so surface it now, not later.
        flags = []
        if r.get("inGracePeriod") == "Yes": flags.append("grace")
        if r.get("invoiceDunningReason"): flags.append("no-payment-method")
        if r.get("status") != "active": flags.append("inactive")
        flags = ",".join(flags) or "-"
        base = {"company": company_of(r), "host": host,
                "entitlement": r.get("appEntitlementNumber"),
                "app": APP_LABEL.get(app_key, app_key),
                "billing": billing_of(a), "amount": amount, "tier": r.get("tier"), "flags": flags}
        if today <= paid_thru <= fwd_end:
            incoming.append({**base, "due": str(paid_thru)})
        elif back_start <= paid_thru < today:
            missed.append({**base, "paid_thru": str(paid_thru), "days_late": (today - paid_thru).days})
    incoming.sort(key=lambda x: (x["due"], -x["amount"]))
    missed.sort(key=lambda x: -x["amount"])
    inc_total = round(sum(x["amount"] for x in incoming), 2)
    inc_at_risk = round(sum(x["amount"] for x in incoming if x["flags"] != "-"), 2)
    miss_total = round(sum(x["amount"] for x in missed), 2)
    # Evaluations (trials) are a conversion signal, NOT income ($0) — kept out of the totals
    # above and shown separately: trials about to expire (convert now) or that just lapsed.
    # `converted` = this (tenant, app) already has a paid transaction. Lite excluded (free).
    evals_soon, evals_expired, seen_ev = [], [], set()
    for r in lic:
        if (r.get("licenseType") or "").upper() != "EVALUATION": continue
        cid = r.get("cloudId"); app_key = r.get("addonKey"); host = r.get("cloudSiteHostname") or ""
        if host.split(".")[0] in INTERNAL_HOSTS or app_key == "com.zenuml.confluence-addon-lite": continue
        if (cid, app_key) in seen_ev: continue
        seen_ev.add((cid, app_key))
        me = pdate(r.get("maintenanceEndDate"))
        if not me: continue
        converted = "yes" if agg.get((cid, app_key), {}).get("vendor", 0) > 0 else "-"
        row = {"expires": str(me), "app": APP_LABEL.get(app_key, app_key), "tier": r.get("tier"),
               "status": r.get("status"), "converted": converted, "company": company_of(r), "host": host,
               "entitlement": r.get("appEntitlementNumber")}
        if today <= me <= fwd_end:
            evals_soon.append(row)
        elif back_start <= me < today:
            evals_expired.append({**row, "days_ago": (today - me).days})
    evals_soon.sort(key=lambda x: x["expires"])
    evals_expired.sort(key=lambda x: x["expires"], reverse=True)
    if args.json:
        print(json.dumps({"asof": str(today), "days": n,
                          "incoming": {"total": inc_total, "at_risk": inc_at_risk,
                                       "count": len(incoming), "rows": incoming},
                          "missed": {"total": miss_total, "count": len(missed), "rows": missed},
                          "evaluations": {"expiring": {"count": len(evals_soon), "rows": evals_soon},
                                          "expired": {"count": len(evals_expired), "rows": evals_expired}}},
                         indent=2, default=str))
        return
    print(f"=== income radar  asof={today}  window=+/-{n}d  (all revenue apps, payers only) ===\n")
    print(f"INCOMING (next {n}d): {len(incoming)} renewals, ~ ${inc_total:,.2f} expected"
          + (f"  (at-risk on flagged cards: ${inc_at_risk:,.2f})" if inc_at_risk > 0 else ""))
    _print_table(incoming, ["due", "app", "billing", "amount", "flags", "tier", "company", "host", "entitlement"])
    print(f"\nMISSED (past {n}d): {len(missed)} renewals overdue, ~ ${miss_total:,.2f} at risk")
    _print_table(missed, ["paid_thru", "days_late", "app", "billing", "amount", "flags", "company", "host", "entitlement"])
    print("\nnote: dates are customer-renewal timing (a proxy for income); Atlassian disburses on its")
    print("own monthly cycle. A lapse in the last 1-2 days may be settlement lag, not a true miss —")
    print("read the grace / no-payment-method flags.")
    print(f"\nEVALUATIONS expiring (next {n}d): {len(evals_soon)} trials — conversion window (not income)")
    _print_table(evals_soon, ["expires", "app", "tier", "status", "converted", "company", "host", "entitlement"])
    print(f"\nEVALUATIONS expired (past {n}d): {len(evals_expired)} trials")
    _print_table(evals_expired, ["expires", "days_ago", "app", "tier", "converted", "company", "host", "entitlement"])


def cmd_client(args, auth):
    lics = export("licenses", auth, text=args.name)
    lics = [r for r in lics if keep_addon(r, args.app)] if args.app != "all" else lics
    # Transactions carry cloudId + customerDetails.company but NO hostname, so a text
    # search by a hostname/slug (e.g. "nuvem340") matches the license yet returns ZERO
    # transactions -> a false $0. Join on cloudId instead: pull the cloudIds off the
    # matched licenses and fetch each one's transactions by id, unioned with any direct
    # company-name text matches, then dedup. (Trap is documented in SKILL.md; this is the
    # command that fell into it.) Falls back to text=name when a tenant has no license.
    cloud_ids = {r.get("cloudId") for r in lics if r.get("cloudId")}
    by_key = {}
    for t in export("sales/transactions", auth, text=args.name):
        by_key[json.dumps(t, sort_keys=True, default=str)] = t
    for cid in cloud_ids:
        for t in export("sales/transactions", auth, text=cid):
            by_key[json.dumps(t, sort_keys=True, default=str)] = t
    txs = list(by_key.values())
    txs = [t for t in txs if keep_addon(t, args.app)] if args.app != "all" else txs
    hist = []
    for t in sorted(txs, key=lambda t: t.get("purchaseDetails", {}).get("saleDate", "")):
        p = t.get("purchaseDetails", {})
        hist.append({"saleDate": p.get("saleDate"), "saleType": p.get("saleType"),
                     "billing": p.get("billingPeriod"), "tier": p.get("tier"),
                     "vendor": p.get("vendorAmount"), "mEnd": p.get("maintenanceEndDate"),
                     "app": t.get("addonKey", "").replace("com.zenuml.", "")})
    licrows = [{"app": r.get("addonKey", "").replace("com.zenuml.", ""), "type": r.get("licenseType"),
                "status": r.get("status"), "tier": r.get("tier"), "mEnd": r.get("maintenanceEndDate"),
                "grace": r.get("inGracePeriod"), "dunning": r.get("invoiceDunningReason"),
                "host": r.get("cloudSiteHostname")} for r in lics]
    total = sum(float(h["vendor"] or 0) for h in hist)
    out = {"client": args.name, "lifetime_vendor": round(total, 2),
           "transactions": hist, "licenses": licrows}
    if args.json:
        print(json.dumps(out, indent=2, default=str)); return
    print(f"=== {args.name} — lifetime vendor ${total:,.2f} ===")
    print("\nLICENSES:")
    for r in licrows:
        print(f"  [{r['type']}] {r['app']:20} status={r['status']:8} tier={r['tier']:10} "
              f"mEnd={r['mEnd']} grace={r['grace']} dun={r['dunning']} | {r['host']}")
    print("\nTRANSACTIONS:")
    for h in hist:
        print(f"  {h['saleDate']} {str(h['saleType']):9} {str(h['billing']):7} tier={h['tier']:12} "
              f"vendor=${h['vendor']} mEnd={h['mEnd']} {h['app']}")


def cmd_revenue(args, auth):
    lic, agg = load(args.app, auth)
    payers = [(cid, a) for cid, a in agg.items() if a["vendor"] > 0]
    if args.period != "any":
        payers = [(c, a) for c, a in payers if billing_of(a).lower() == args.period]
    payers.sort(key=lambda t: -t[1]["vendor"])
    rows = [{"company": a["company"], "lifetime_vendor": round(a["vendor"], 2),
             "billing": billing_of(a), "tier": a["tier"], "paid_thru": str(a["paid_thru"]),
             "last_sale": a["last_sale"], "tx": a["n"]} for _, a in payers[:args.top]]
    total = sum(a["vendor"] for _, a in payers)
    if args.json:
        print(json.dumps({"total_vendor": round(total, 2), "payers": len(payers), "top": rows}, indent=2, default=str)); return
    print(f"=== revenue app={args.app} period={args.period}: {len(payers)} paying cloudIds, "
          f"lifetime ${total:,.2f} ===\n")
    _print_table(rows, ["lifetime_vendor", "billing", "tier", "paid_thru", "last_sale", "tx", "company"])


def cmd_tier(args, auth):
    lics = export("licenses", auth, text=args.domain)
    lics = [r for r in lics if keep_addon(r, args.app)] if args.app != "all" else lics
    rows = [{"app": r.get("addonKey", "").replace("com.zenuml.", ""), "type": r.get("licenseType"),
             "status": r.get("status"), "tier": r.get("tier"), "mEnd": r.get("maintenanceEndDate"),
             "host": r.get("cloudSiteHostname")} for r in lics]
    _emit(args, rows, f"tier lookup {args.domain} app={args.app}",
          cols=["app", "type", "status", "tier", "mEnd", "host"])


def _tenant_info_cloudid(domain):
    """Fallback cloudId resolver for a domain with no Marketplace license (free/Lite/uninstalled).
    <host>/_edge/tenant_info is a public per-tenant endpoint returning {cloudId, ...} — no auth."""
    host = domain if "." in domain else f"{domain}.atlassian.net"
    try:
        with urllib.request.urlopen(f"https://{host}/_edge/tenant_info", timeout=10) as resp:
            return json.loads(resp.read()).get("cloudId")
    except Exception:
        return None


def _tier_users(tier):
    m = re.search(r"(\d+)\s*Users?", tier or "")
    return int(m.group(1)) if m else None


SPACE_LICENSE_KV_NS = "8969e8528105403bb2d9adca9fc16567"   # prod SPACE_LICENSE_KV (from wrangler-prod.toml)


def _license_state(r, a, today):
    """Classify a license into FREE / TRIAL / PAID / LAPSED / COMMERCIAL_$0. The binary 'paying?'
    hides the difference between a free rider, an ACTIVE TRIAL (expiring!), and a churned payer —
    which is exactly the fact the card most needs to surface (colesgroup: Full trial, 2 days left)."""
    vendor = round((a or {}).get("vendor", 0.0), 2)
    lt = (r.get("licenseType") or "").upper()
    pt = (a or {}).get("paid_thru")
    if vendor > 0:
        if pt and pt < today:
            return "LAPSED", f"LAPSED — was paying ${vendor:,.2f}, coverage ended {pt}", vendor
        return "PAID", f"PAID ${vendor:,.2f} {billing_of(a)} paid_thru {pt}", vendor
    if lt == "EVALUATION":
        me = pdate(r.get("maintenanceEndDate"))
        if me:
            d = (me - today).days
            tag = (f"EXPIRED {-d}d ago ({me})" if d < 0 else
                   f"expires {me} (⚠ {d}d left)" if d <= 14 else f"expires {me} ({d}d left)")
            return "TRIAL", f"TRIAL — {tag}", 0.0
        return "TRIAL", "TRIAL — no expiry date", 0.0
    if lt == "FREE":
        return "FREE", "FREE (Lite listing)", 0.0
    if lt == "COMMERCIAL":
        return "COMMERCIAL_$0", "COMMERCIAL but $0 received — comped / eval-converted / verify", 0.0
    return lt or "?", f"{lt or '?'} — $0", 0.0


def _fuzzy_hosts(domain, auth):
    """On a no-match, suggest near hosts by searching the domain's longest alnum token — the miss
    is usually a slug typo (woolworth-agile -> woolworths-agile)."""
    toks = sorted({t for t in re.split(r"[^a-z0-9]+", domain.lower()) if len(t) >= 4}, key=len, reverse=True)
    for t in toks[:2]:
        hosts = sorted({r.get("cloudSiteHostname") for r in export("licenses", auth, text=t)
                        if r.get("cloudSiteHostname")})
        if hosts:
            return hosts[:8]
    return []


def _kv_run(*a):
    return subprocess.run(["npx", "--yes", "wrangler", "kv", *a, "--namespace-id", SPACE_LICENSE_KV_NS,
                           "--remote"], capture_output=True, text=True, timeout=40).stdout


def _kv_space_licenses(cloud_id):
    """Layer-B space-licenses for a cloudId -> [ {space, kind, activatedBy, expiresAt, status} ] or
    None if unchecked. `--remote` is REQUIRED (wrangler v4 defaults to LOCAL state -> a false empty).
    Reads each VALUE and classifies **PAID** vs **COMPED** by the presence of `paymentReference`
    (the Stripe webhook stores `session.id` there; comped/manual grants via extend-space-license
    write none). Key existence alone over-reports paying: space-status.ts marks ANY active+future
    license `isPaid`, so a comped 14-day extension (vin3s) otherwise looked 'PAYING'. NB: as of this
    writing every prod space-license is comped/manual — there are zero Stripe-paid ones."""
    try:
        keys = json.loads(_kv_run("key", "list", "--prefix", f"license:{cloud_id}") or "[]")
    except Exception:
        return None
    out = []
    for k in keys:
        name = k.get("name", "")
        try:
            rec = json.loads(_kv_run("key", "get", name) or "{}")
        except Exception:
            rec = {}
        paid = bool(rec.get("paymentReference"))          # Stripe webhook stores session.id here; a
        out.append({"space": name.split(":")[-1],          # comped/manual grant has none -> not revenue
                    "kind": "PAID" if paid else "COMPED",
                    "activatedBy": str(rec.get("activatedBy") or "") or None,
                    "paymentReference": rec.get("paymentReference"),
                    "expiresAt": rec.get("expiresAt"), "status": rec.get("status")})
    return out


def cmd_whois(args, auth):
    """domain -> one card across ALL apps: cloudId(s), users, STATE (FREE/TRIAL/PAID/LAPSED) with
    expiry, lifetime $, AND the Layer-B (Stripe/KV) space-license check for Lite tenants. Suggests
    near-match hosts on a miss. Marketplace tx join on cloudId (see cmd_client)."""
    today = datetime.date.today()
    domain = args.domain
    # The Marketplace text= search matches the tenant SLUG, not the full hostname: passing
    # "subsplash.atlassian.net" returned zero licenses and a "not paying" verdict for a $5,782
    # payer (2026-07-25). Every host this tool prints elsewhere is fully qualified, so strip the
    # suffix before searching and keep `domain` only for display / tenant_info fallback.
    q = domain[: -len(".atlassian.net")] if domain.lower().endswith(".atlassian.net") else domain
    lics = export("licenses", auth, text=q)
    cloud_ids = {r.get("cloudId") for r in lics if r.get("cloudId")}

    by_key = {}                                           # dedup: text=slug ∪ per-cloudId
    for t in export("sales/transactions", auth, text=q):
        by_key[json.dumps(t, sort_keys=True, default=str)] = t
    for cid in cloud_ids:
        for t in export("sales/transactions", auth, text=cid):
            by_key[json.dumps(t, sort_keys=True, default=str)] = t
    # Per (cloudId, addonKey), not per cloudId: maymobility holds a paid Full license AND a
    # zero-transaction Lite listing on one cloudId, so a cloudId-keyed aggregate gave BOTH rows
    # $3,996.30 and summed the verdict to $7,992.60 — double its real lifetime (2026-07-25).
    agg = aggregate_tx_by_app(list(by_key.values()))

    LITE = APPS["lite"]
    has_lite = False
    apps = []
    for r in lics:
        key = r.get("addonKey", "")
        if key == LITE:
            has_lite = True
        app = "Full" if key == APPS["full"] else ("Lite" if key == LITE else key)
        a = agg.get((r.get("cloudId"), key), {})
        tag, desc, vendor = _license_state(r, a, today)
        apps.append({
            "app": app, "cloudId": r.get("cloudId"),
            "users": _tier_users(r.get("tier")), "tier": r.get("tier"),
            "status": r.get("status"), "licenseType": r.get("licenseType"),
            "state": tag, "state_desc": desc,
            "paying": vendor > 0, "lifetime_vendor": vendor,
            "billing": billing_of(a) if a else "-",
            "paid_thru": str(a["paid_thru"]) if a.get("paid_thru") else None,
            "mEnd": r.get("maintenanceEndDate"),
        })

    # Layer B: real Lite paid status lives in Stripe/KV, not Marketplace. Check it (unless skipped,
    # or running against a deterministic local snapshot — KV is a live system).
    layer_b = {}
    kv_checked = has_lite and not getattr(args, "no_kv", False) and not LOCAL["db"]
    if kv_checked:
        for cid in sorted({r.get("cloudId") for r in lics if r.get("addonKey") == LITE and r.get("cloudId")}):
            layer_b[cid] = _kv_space_licenses(cid)
    b_records = [sl for recs in layer_b.values() if recs for sl in recs]
    b_paying = any(sl["kind"] == "PAID" for sl in b_records)     # genuine Stripe = revenue
    b_comped = any(sl["kind"] == "COMPED" for sl in b_records)   # support grant = access, $0 revenue

    cids = sorted(c for c in cloud_ids if c)
    suggest = []
    if not cids:                                          # no license -> resolve cloudId off-Marketplace
        edge = _tenant_info_cloudid(domain)
        if edge:
            cids = [edge]
        if not lics:
            suggest = _fuzzy_hosts(domain, auth)

    out = {
        "domain": domain, "cloudIds": cids, "apps": apps,
        "layer_b_space_licenses": (layer_b if kv_checked else None),
        "any_paying_marketplace": any(x["paying"] for x in apps),
        "paying_any_layer": any(x["paying"] for x in apps) or b_paying,
        "total_lifetime_vendor": round(sum(x["lifetime_vendor"] for x in apps), 2),
        "suggestions": (suggest or None),
    }
    if LOCAL["db"]:                                       # self-document the data vintage (determinism/repro)
        con = sqlite3.connect(LOCAL["db"])
        m = con.execute("SELECT synced_at, license_rows, tx_rows FROM sync_meta "
                        "ORDER BY synced_at DESC LIMIT 1").fetchone()
        con.close()
        if m:
            out["_snapshot"] = {"synced_at": m[0], "license_rows": m[1], "tx_rows": m[2]}
    if args.json:
        print(json.dumps(out, indent=2, default=str)); return

    print(f"=== {domain} ===")
    print(f"  cloudId : {', '.join(cids) if cids else '(unresolved)'}")
    if not apps:
        print("  apps    : (no Marketplace license found)")
        if suggest:
            print(f"  did you mean: {', '.join(suggest)}")
    for x in apps:
        u = f"{x['users']} users" if x["users"] is not None else (x["tier"] or "?")
        line = f"  {x['app']:12} {u:12} status={x['status'] or '?':8} {x['state_desc']}"
        if x["app"] == "Lite" and kv_checked:
            lb = layer_b.get(x["cloudId"])
            if lb is None:
                line += "   [Layer B: unchecked]"
            elif not lb:
                line += "   [Layer B: none]"
            else:
                parts = [f"{s['kind']} {s['space']}"
                         + (f" exp {s['expiresAt'][:10]}" if s.get("expiresAt") else "")
                         + (f" via {s['activatedBy']}" if s.get("activatedBy") else "") for s in lb]
                line += "   [Layer B: " + "; ".join(parts) + "]"
        print(line)
    verdict = ("PAYING" if out["paying_any_layer"]
               else "not paying (comped access only)" if b_comped else "not paying")
    extra = (", +Layer B PAID" if b_paying else
             ", comped Layer-B grant (=$0 revenue)" if b_comped else "")
    print(f"  VERDICT : {verdict}  (marketplace ${out['total_lifetime_vendor']:,.2f}{extra})")
    if has_lite and not kv_checked:
        print("  NOTE    : Lite present but Layer-B (KV) not checked "
              + ("(local snapshot)" if LOCAL["db"] else "(--no-kv)") + " — real Lite paid status unknown.")


# ----- output helpers ----------------------------------------------------------
def _emit(args, rows, title, cols):
    if args.json:
        print(json.dumps(rows, indent=2, default=str)); return
    print(f"=== {title}  ({len(rows)} rows) ===\n")
    _print_table(rows, cols)


def _print_table(rows, cols):
    if not rows:
        print("  (none)"); return
    widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in rows)) for c in cols}
    print("  " + "  ".join(c.ljust(widths[c]) for c in cols))
    print("  " + "  ".join("-" * widths[c] for c in cols))
    for r in rows:
        print("  " + "  ".join(str(r.get(c, "")).ljust(widths[c]) for c in cols))


# ----- CLI ---------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="ZenUML Marketplace vendor reporting audit.")
    ap.add_argument("--env", default=None, help="path to .env.forge.local (default: auto-discover)")
    ap.add_argument("--json", action="store_true", help="machine-readable JSON output")
    ap.add_argument("--app", default="full", type=_app_arg,
                    help="full | lite | diagramly | asyncapi | both (full+lite) | all | <addonKey> (default: full)")
    ap.add_argument("--local", action="store_true", help="read from the local SQLite snapshot (run `sync` first)")
    ap.add_argument("--db", default=None, help="SQLite snapshot path (default: alongside the script)")

    # Global flags should also work AFTER the subcommand (e.g. `overdue --paid-only --json`),
    # which is what everyone reaches for. `default=SUPPRESS` means these copies only override
    # the top-level value when actually passed, so either position works and neither clobbers.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--env", default=argparse.SUPPRESS)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    common.add_argument("--app", default=argparse.SUPPRESS, type=_app_arg)
    common.add_argument("--local", action="store_true", default=argparse.SUPPRESS)
    common.add_argument("--db", default=argparse.SUPPRESS)

    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("renewals", parents=[common], help="licenses expiring in a date window (+ revenue & billing)")
    p.add_argument("--from", dest="frm", required=True, help="YYYY-MM-DD")
    p.add_argument("--to", required=True, help="YYYY-MM-DD")
    p.add_argument("--billing", choices=["any", "annual", "monthly"], default="any")
    p.add_argument("--paid-only", action="store_true", help="only clients with lifetime vendor $ > 0")
    p.set_defaults(func=cmd_renewals)

    p = sub.add_parser("overdue", parents=[common], help="paying clients past due / in grace / no payment method")
    p.add_argument("--asof", default=None, help="YYYY-MM-DD (default: today)")
    p.add_argument("--paid-only", action="store_true", help="only real payers (lifetime vendor $ > 0)")
    p.set_defaults(func=cmd_overdue)

    p = sub.add_parser("radar", parents=[common],
                       help="near-term cash view: renewals due (next Nd) + missed payments (past Nd)")
    p.add_argument("--days", type=int, default=7, help="window each direction in days (default 7)")
    p.add_argument("--asof", default=None, help="YYYY-MM-DD (default: today)")
    p.set_defaults(func=cmd_radar)

    p = sub.add_parser("client", parents=[common], help="full license + transaction history for one client")
    p.add_argument("name", help="company / site slug (text search)")
    p.set_defaults(func=cmd_client)

    p = sub.add_parser("revenue", parents=[common], help="lifetime vendor revenue, top payers")
    p.add_argument("--period", choices=["any", "annual", "monthly"], default="any")
    p.add_argument("--top", type=int, default=30)
    p.set_defaults(func=cmd_revenue)

    p = sub.add_parser("tier", parents=[common], help="quick tier / license lookup by domain")
    p.add_argument("domain", help="tenant domain / slug")
    p.set_defaults(func=cmd_tier)

    p = sub.add_parser("whois", parents=[common],
                       help="domain -> cloudId, users, state (FREE/TRIAL/PAID), lifetime $ + Lite KV check")
    p.add_argument("domain", help="tenant domain / slug")
    p.add_argument("--no-kv", action="store_true", help="skip the Layer-B (Stripe/KV) space-license check for Lite")
    p.set_defaults(func=cmd_whois)

    p = sub.add_parser("sync", parents=[common],
                       help="snapshot all apps' licenses + transactions to local SQLite (~16s)")
    p.set_defaults(func=cmd_sync)

    args = ap.parse_args()
    if getattr(args, "local", False) and args.cmd != "sync":
        LOCAL["db"] = args.db or _default_db()
        if not os.path.exists(LOCAL["db"]):
            sys.exit(f"no local snapshot at {LOCAL['db']} — run: mp_report.py sync")
        print(_snapshot_age_note(LOCAL["db"]), file=sys.stderr)
        args.func(args, None)                            # local mode needs no creds
    else:
        email, tok = load_creds(args.env or find_env())
        args.func(args, _auth_header(email, tok))


if __name__ == "__main__":
    main()
