#!/usr/bin/env python3
"""License-start candidates, with known Connect history for backfill filtering.
Missing D1 history does not establish a new install or a new customer.
"""
import argparse, json, sqlite3, subprocess, sys, time
from datetime import datetime, timedelta
import importlib.util
from pathlib import Path
from collections import defaultdict, Counter
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SKILL_SCRIPTS = Path(__file__).resolve().parent
SKILLS_DIR = SKILL_SCRIPTS.parent.parent
AUDIT_DB = SKILLS_DIR / 'marketplace' / 'scripts' / 'marketplace.db'
MP_REPORT = SKILLS_DIR / 'marketplace' / 'scripts' / 'mp_report.py'
D1_CACHE = SKILL_SCRIPTS / 'd1_first_seen.json'
REPO_ROOT = SKILLS_DIR.parent.parent  # conf-app root

with (SKILLS_DIR / "customer-data" / "products.json").open() as f:
    PRODUCTS = json.load(f)["products"]
APPS = {p["key"]: p["marketplace_key"] for p in PRODUCTS if p["conf_app"]}
LIVE_APPS = {p["key"]: p["marketplace_key"] for p in PRODUCTS
             if p.get("recent_customer_scan", p["conf_app"])}
INTERNAL = ('whimet', 'zenuml', 'd4c-forge', 'async-prd', 'zicjin', 'danshuitaihejie',
            'lite-stg', 'full-stg', 'dia-stg', 'lite-dev', 'lite-prod', 'mtwtf', 'nextrelease-sbx',
            '2023-bug-bounty', 'diagramly-install-test')

D1_SQL = ("SELECT clientDomain, key, min(timestamp) AS first_seen FROM ClientInstallation "
          "WHERE clientDomain IS NOT NULL GROUP BY clientDomain, key")


def is_internal(slug: str) -> bool:
    return any(p in slug for p in INTERNAL) if slug else True


def load_d1(refresh: bool) -> dict:
    """{(clientDomain, addonKey): first_seen_iso} with a 24h local cache."""
    if not refresh and D1_CACHE.exists():
        cached = json.loads(D1_CACHE.read_text())
        if time.time() - cached['fetched_at'] < 86400:
            return {tuple(k.split('\t')): v for k, v in cached['rows'].items()}
    cmd = ['npx', 'wrangler', 'd1', 'execute', 'conf-zenuml-prod', '--env', 'production',
           '--remote', '--json', '--command', D1_SQL]
    out = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        sys.exit(f'D1 query failed:\n{out.stderr[-800:]}')
    rows = json.loads(out.stdout)[0]['results']
    mapping = {(r['clientDomain'], r['key']): r['first_seen'] for r in rows}
    D1_CACHE.write_text(json.dumps({
        'fetched_at': time.time(),
        'rows': {f'{d}\t{k}': v for (d, k), v in mapping.items()},
    }))
    return mapping


def classify(lic: dict, addon: str, d1: dict, grace_days: int):
    host = (lic.get('cloudSiteHostname') or '').replace('.atlassian.net', '')
    start = lic.get('maintenanceStartDate') or ''
    if is_internal(host):
        return 'INTERNAL', host, start, None
    first_seen = d1.get((host, addon))
    if first_seen:
        delta = (datetime.fromisoformat(start) -
                 datetime.fromisoformat(first_seen[:10])).days
        if delta > grace_days:
            return 'PRE-EXISTING', host, start, first_seen[:10]
        return 'CANDIDATE', host, start, f'known history {first_seen[:10]}; first install unverified'
    return 'CANDIDATE', host, start, 'no matching historical record; first install unknown'


def recent_window(days=1, timezone='Australia/Melbourne', now=None, d_from=None, d_to=None):
    """Inclusive calendar dates approximating the last N days, including today."""
    if days < 1:
        raise ValueError('--days must be positive')
    zone = ZoneInfo(timezone)
    if bool(d_from) != bool(d_to):
        raise ValueError('provide both --from and --to')
    today = (now or datetime.now(zone)).astimezone(zone).date()
    start = datetime.strptime(d_from, '%Y-%m-%d').date() if d_from else today - timedelta(days=days)
    end = datetime.strptime(d_to, '%Y-%m-%d').date() if d_to else today
    if start > end:
        raise ValueError('--from must not be after --to')
    return start.isoformat(), end.isoformat()


def license_candidates(rows, addon, d_from, d_to):
    """Use maintenanceStartDate for all products; evaluation is optional context."""
    result = {'license_start_candidates': [], 'evaluation_start_candidates': []}
    for row in rows:
        if not isinstance(row, dict) or row.get('addonKey') != addon:
            raise ValueError('invalid or wrong-product license export; result is unknown')
        for field, bucket in (('maintenanceStartDate', 'license_start_candidates'),
                              ('latestEvaluationStartDate', 'evaluation_start_candidates')):
            if field == 'latestEvaluationStartDate' and row.get('licenseType') == 'FREE':
                continue
            value = row.get(field)
            if not value:
                continue
            date = datetime.strptime(str(value)[:10], '%Y-%m-%d').date().isoformat()
            if d_from <= date <= d_to:
                result[bucket].append({
                    'site': row.get('cloudSiteHostname'), 'cloud_id': row.get('cloudId'),
                    'company': (row.get('contactDetails') or {}).get('company'),
                    'license_type': row.get('licenseType'), 'status': row.get('status'),
                    'source_id': row.get('appEntitlementId') or row.get('licenseId') or row.get('addonLicenseId'),
                    'source_field': field, 'occurred_at': value,
                    'classification': 'CANDIDATE', 'first_install': 'unverified',
                })
    result['unique_candidate_sites'] = sorted({r['site'] for r in result['license_start_candidates']
                                              if r['site']})
    return result


def live_report(app, d_from, d_to, timezone, env=None, reader=None):
    selected = LIVE_APPS if app == 'all' else {app: LIVE_APPS[app]}
    if reader is None:
        spec = importlib.util.spec_from_file_location('new_customers_marketplace', MP_REPORT)
        mp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mp)
        email, token = mp.load_creds(env or str(REPO_ROOT / '.env.forge.local'))
        auth = mp._auth_header(email, token)
        reader = lambda addon: mp.export('licenses', auth, addon=addon)
    report = {'source': 'Marketplace licenses-only live API GET',
              'window': {'from': d_from, 'to': d_to, 'timezone': timezone,
                         'precision': 'inclusive calendar dates; approximate past N days'},
              'query_started_at': datetime.now().astimezone().isoformat(), 'products': {}}
    for product, addon in selected.items():
        rows = reader(addon)
        if not isinstance(rows, list):
            raise ValueError('license export must be an array; result is unknown')
        product_report = license_candidates(rows, addon, d_from, d_to)
        product_report.update({'read_status': 'ok' if rows else 'empty',
                               'license_rows': len(rows),
                               'queried_at': datetime.now().astimezone().isoformat(),
                               'source_ref': f'https://marketplace.atlassian.com/rest/2/vendors/1215266/reporting/licenses/export?accept=json&addon={addon}'})
        report['products'][product] = product_report
    report['query_finished_at'] = datetime.now().astimezone().isoformat()
    report['read_status'] = 'ok'
    report['unknowns'] = ['First installation and first company acquisition are unverified.',
                          'Investigate prior licenses/site-product history only for returned candidates; '
                          'separate existing-company new product, renewal, migration and internal sites.',
                          'No transactions, D1, Forge installation events or CRM were queried.']
    return report


def main():
    ap = argparse.ArgumentParser(description='Track Marketplace license-start candidates')
    ap.add_argument('--from', dest='d_from')
    ap.add_argument('--to', dest='d_to')
    ap.add_argument('--app', default='all', help='all or a product alias; --live also covers aws-widgets, whiteboard, mini-sites')
    ap.add_argument('--live', action='store_true', help='fresh license-only GETs; no cache, transactions or D1')
    ap.add_argument('--days', type=int, default=1, help='approximate past N days for --live (default 1)')
    ap.add_argument('--timezone', default='Australia/Melbourne', help='calendar timezone for --live')
    ap.add_argument('--env', help='existing Marketplace credential file for --live')
    ap.add_argument('--grace', type=int, default=30, help='days of D1-precedence tolerated (default 30)')
    ap.add_argument('--sync', action='store_true', help='refresh marketplace.db snapshot first (~15s)')
    ap.add_argument('--refresh-d1', action='store_true', help='bypass the 24h D1 cache')
    ap.add_argument('--contacts', action='store_true', help='show technical-contact name/email')
    ap.add_argument('--trend', action='store_true', help='append 6-month candidate license starts per month')
    ap.add_argument('--json', dest='as_json', action='store_true')
    args = ap.parse_args()

    if args.live:
        if args.sync or args.trend or args.refresh_d1 or args.contacts:
            ap.error('--live cannot combine with --sync, --trend, --refresh-d1 or --contacts')
        if args.app != 'all' and args.app not in LIVE_APPS:
            ap.error('--live --app accepts all or ' + ', '.join(LIVE_APPS))
        try:
            d_from, d_to = recent_window(args.days, args.timezone, d_from=args.d_from, d_to=args.d_to)
            report = live_report(args.app, d_from, d_to, args.timezone, args.env)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            ap.error(str(exc))
        print(json.dumps(report, indent=2))
        return

    args.d_from = args.d_from or datetime.now().strftime('%Y-%m-01')
    args.d_to = args.d_to or datetime.now().strftime('%Y-%m-%d')
    if args.sync:
        subprocess.run([sys.executable, str(MP_REPORT), 'sync'], cwd=REPO_ROOT, check=True)
    if not AUDIT_DB.exists():
        sys.exit(f'{AUDIT_DB} missing - run with --sync first')

    keys = list(APPS.values()) if args.app == 'all' else [APPS.get(args.app, args.app)]
    d1 = load_d1(args.refresh_d1)
    db = sqlite3.connect(AUDIT_DB)

    report, trend = {}, defaultdict(Counter)
    for addon in keys:
        buckets = defaultdict(list)
        for raw, in db.execute('SELECT raw FROM licenses WHERE addonKey=?', (addon,)):
            lic = json.loads(raw)
            start = lic.get('maintenanceStartDate') or ''
            if not start:
                continue
            verdict, host, start, note = classify(lic, addon, d1, args.grace)
            if args.d_from <= start <= args.d_to:
                entry = {'domain': host, 'start': start, 'type': lic.get('licenseType'),
                         'tier': lic.get('tier'), 'note': note}
                if args.contacts:
                    tc = (lic.get('contactDetails') or {}).get('technicalContact') or {}
                    entry['contact'] = f"{tc.get('name', '?')} <{tc.get('email', '?')}>"
                buckets[verdict].append(entry)
            if verdict == 'CANDIDATE' and start >= (datetime.fromisoformat(args.d_to) -
                                              timedelta(days=183)).strftime('%Y-%m-%d'):
                trend[addon][start[:7]] += 1
        report[addon] = buckets

    if args.as_json:
        print(json.dumps(report, indent=1))
        return
    for addon, buckets in report.items():
        n_new, n_pre, n_int = (len(buckets[k]) for k in ('CANDIDATE', 'PRE-EXISTING', 'INTERNAL'))
        print(f'\n=== {addon}  [{args.d_from} .. {args.d_to}]  '
              f'CANDIDATE={n_new}  pre-existing={n_pre}  internal={n_int}')
        if addon == 'my-api' and (n_new or n_pre):
            print('    (caveat: my-api has no D1 install history - backfill filter is blind here)')
        for e in sorted(buckets['CANDIDATE'], key=lambda x: x['start']):
            line = f"  CANDIDATE  {e['start']}  {e['domain']:<28} {e['type']:<10} {e['tier'] or '?':<10} ({e['note']})"
            if args.contacts:
                line += f"  {e.get('contact', '')}"
            print(line)
        if args.trend and trend[addon]:
            months = ' '.join(f'{m}:{c}' for m, c in sorted(trend[addon].items()))
            print(f'  trend(candidate license starts/mo): {months}')


if __name__ == '__main__':
    main()
