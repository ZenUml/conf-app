#!/usr/bin/env python3
"""Turn the client-health ranking into follow-up candidates when nobody has written in.

client-health ranks active Lite sites by behaviour. It does not know whether the same site
already pays for another of our apps, who the contact is, or whether a reseller sits in between.
This script joins those facts from the local Marketplace snapshot and gives each ranked site a
verdict: candidate, skip (with the reason) or unknown.

Read-only. Input is the JSON from `health_score.py --json` and the Marketplace SQLite snapshot.
It does not check the Lite space-licence layer (KV / Stripe), the tracker or the mailbox:
do that for the candidates it returns (see the customer-followup skill).

  python3 health_score.py --json --top 60 > /tmp/health.json
  python3 behaviour_targets.py --health /tmp/health.json --top 10
"""
import argparse
import datetime as dt
import json
import os
import sqlite3
import sys

LITE_KEY = 'com.zenuml.confluence-addon-lite'
DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          '..', '..', 'marketplace', 'scripts', 'marketplace.db')


def _date(s):
    try:
        return dt.date.fromisoformat((s or '')[:10])
    except ValueError:
        return None


def other_product_state(cloud_id, licences, transactions, today):
    """What this site holds besides Lite: paying, lapsed, trial, commercial_unpaid, legacy_free or none.

    Purchase needs a positive net order amount AND an active commercial licence AND coverage that
    has not ended. A licence alone is not a purchase; an ended trial is not a signal.
    """
    mine = [r for r in licences if r.get('cloudId') == cloud_id and r.get('addonKey') != LITE_KEY]
    net, paid_thru = {}, {}
    for t in transactions:
        if t.get('cloudId') != cloud_id or t.get('addonKey') == LITE_KEY:
            continue
        p = t.get('purchaseDetails') or {}
        key = t.get('addonKey')
        amount = float(p.get('vendorAmount') or 0)
        net[key] = net.get(key, 0.0) + amount
        end = _date(p.get('maintenanceEndDate'))
        if amount > 0 and end and (key not in paid_thru or end > paid_thru[key]):
            paid_thru[key] = end

    def active(kind):
        return [r for r in mine if r.get('status') == 'active' and (r.get('licenseType') or '').upper() == kind]

    for r in active('COMMERCIAL'):
        key = r.get('addonKey')
        if net.get(key, 0) > 0.005 and paid_thru.get(key) and paid_thru[key] >= today:
            return {'state': 'paying', 'detail': f"pays for {key}, covered to {paid_thru[key]}"}
    lapsed = [k for k, v in net.items() if v > 0.005 and not (paid_thru.get(k) and paid_thru[k] >= today
                                                                and any(r.get('addonKey') == k for r in active('COMMERCIAL')))]
    if lapsed:
        k = lapsed[0]
        return {'state': 'lapsed', 'detail': f"paid for {k} before, coverage ended {paid_thru.get(k)}"}
    if active('COMMERCIAL'):
        r = active('COMMERCIAL')[0]
        return {'state': 'commercial_unpaid', 'detail': f"{r.get('addonKey')} commercial licence, no net order: verify"}
    if active('EVALUATION'):
        r = active('EVALUATION')[0]
        return {'state': 'trial', 'detail': f"{r.get('addonKey')} trial to {r.get('maintenanceEndDate')}"}
    if active('LEGACY_FREE'):
        return {'state': 'legacy_free', 'detail': f"{active('LEGACY_FREE')[0].get('addonKey')} legacy free licence"}
    return {'state': 'none', 'detail': ''}


def _lite_by_domain(licences):
    """First label of the site hostname -> the Lite licence; an active row beats an inactive one."""
    chosen = {}
    for r in licences:
        if r.get('addonKey') != LITE_KEY:
            continue
        domain = (r.get('cloudSiteHostname') or '').split('.')[0]
        if domain and (domain not in chosen or (r.get('status') == 'active' and chosen[domain].get('status') != 'active')):
            chosen[domain] = r
    return chosen


def build_targets(health_rows, licences, transactions, today, excluded=None, top=None):
    """Rows in ranking order with verdict and reason. `top` stops after that many candidates."""
    excluded = excluded or {}
    lite = _lite_by_domain(licences)
    out, candidates = [], 0
    for h in health_rows:
        domain = h['domain']
        row = {'domain': domain, 'opportunity_score': h.get('opportunity_score'), 'seats': h.get('seat_tier'),
               'usage_volume': h.get('usage_volume'), 'growth_trend%': h.get('growth_trend%'),
               'paywall_friction': h.get('paywall_friction')}
        r = lite.get(domain)
        if r is None:
            row.update(verdict='unknown', reason='no Lite licence found for this site in the snapshot')
            out.append(row)
            continue
        contact = (r.get('contactDetails') or {})
        tech = contact.get('technicalContact') or {}
        email = tech.get('email') or ''
        partner = r.get('partnerDetails') or {}
        state = other_product_state(r.get('cloudId'), licences, transactions, today)
        row.update(cloud_id=r.get('cloudId'), company=contact.get('company'), country=contact.get('country'),
                   contact_name=tech.get('name'), contact_email=tech.get('email'),
                   contact_email_domain=email.rpartition('@')[2].lower() if '@' in email else None,
                   contact_role='technical contact (role unverified)', via_partner=bool(partner),
                   partner_name=partner.get('partnerName'),
                   lite_status=r.get('status'), other_product=state['state'], other_product_detail=state['detail'])
        if domain in excluded:
            row.update(verdict='skip', reason='tracker: ' + excluded[domain])
        elif state['state'] == 'paying':
            row.update(verdict='skip', reason=state['detail'])
        else:
            row.update(verdict='candidate', reason=state['detail'] or 'free Lite use only')
            candidates += 1
        out.append(row)
        if top and candidates >= top:
            break
    return out


def load_snapshot(db):
    con = sqlite3.connect(f'file:{os.path.abspath(db)}?mode=ro', uri=True)
    try:
        licences = [json.loads(r[0]) for r in con.execute('select raw from licenses')]
        transactions = [json.loads(r[0]) for r in con.execute('select raw from transactions')]
        meta = con.execute('select * from sync_meta').fetchone()
    finally:
        con.close()
    return licences, transactions, (meta[0] if meta else None)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--health', required=True, help="JSON from health_score.py --json, or '-' for stdin")
    ap.add_argument('--db', default=DEFAULT_DB, help='Marketplace SQLite snapshot')
    ap.add_argument('--exclude', help='JSON file {domain: reason} from the tracker (pauses, recent contact)')
    ap.add_argument('--top', type=int, default=10, help='stop after this many candidates')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args(argv)

    health = json.load(sys.stdin if args.health == '-' else open(args.health))
    excluded = json.load(open(args.exclude)) if args.exclude else {}
    licences, transactions, synced = load_snapshot(args.db)
    rows = build_targets(health, licences, transactions, dt.date.today(), excluded, args.top)
    if args.json:
        print(json.dumps({'snapshot_synced_at': synced, 'ranked_input_rows': len(health), 'rows': rows}, indent=1))
        return 0
    print(f'Marketplace snapshot: {synced}. Ranking input: {len(health)} sites. Not checked: KV space licences, tracker, mailbox.')
    print('| # | site | verdict | seats | score | friction | other product | partner | reason |')
    print('|---|---|---|---|---|---|---|---|---|')
    for i, r in enumerate(rows, 1):
        print(f"| {i} | {r['domain']} | {r['verdict']} | {r.get('seats')} | {r.get('opportunity_score')} | "
              f"{r.get('paywall_friction')} | {r.get('other_product', '?')} | {(r.get('partner_name') or 'yes') if r.get('via_partner') else 'no'} | {r['reason']} |")
    return 0


if __name__ == '__main__':
    sys.exit(main())
