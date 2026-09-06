#!/usr/bin/env python3
"""
New-customer tracker for P&D VISION Marketplace apps.

Method (validated 2026-07-12): a Marketplace license row is only a NEW customer
if the tenant has no prior Connect-install history in D1. Atlassian's staged
Connect->Forge migration backfilled FREE license rows for pre-existing tenants
(lite: 876 April-2026 rows, 88.7% pre-existing; full: 26/27 April + 15/18 May),
so raw license counts read as fake growth. This script classifies every row:

  INTERNAL      known internal/test tenant                      -> excluded
  PRE-EXISTING  D1 Connect first-seen predates license start by
                > --grace days (default 30)                     -> migration/backfill
  NEW           no D1 record (Forge-direct install) or D1
                first-seen within the grace window              -> real acquisition

Data sources:
  - marketplace.db  (built by ../../marketplace/scripts/mp_report.py sync)
  - D1 ClientInstallation via `npx wrangler d1 execute` (cached 24h locally)

Caveats:
  - Forge installs never write ClientInstallation (Connect-only table), so
    "not in D1" is the EXPECTED signature of a genuinely new Forge install.
  - my-api (AsyncAPI) has NO rows in this D1 (its Connect worker never persisted
    installs) -> backfill filtering is blind there; volume is tiny, eyeball it.
"""
import argparse, json, sqlite3, subprocess, sys, time
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict, Counter

SKILL_SCRIPTS = Path(__file__).resolve().parent
SKILLS_DIR = SKILL_SCRIPTS.parent.parent
AUDIT_DB = SKILLS_DIR / 'marketplace' / 'scripts' / 'marketplace.db'
MP_REPORT = SKILLS_DIR / 'marketplace' / 'scripts' / 'mp_report.py'
D1_CACHE = SKILL_SCRIPTS / 'd1_first_seen.json'
REPO_ROOT = SKILLS_DIR.parent.parent  # conf-app root

APPS = {
    'full': 'com.zenuml.confluence-addon',
    'lite': 'com.zenuml.confluence-addon-lite',
    'diagramly': 'gptdock-confluence',
    'asyncapi': 'my-api',
}
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
        return 'NEW', host, start, f'connect {first_seen[:10]}'
    return 'NEW', host, start, 'forge-direct'


def main():
    ap = argparse.ArgumentParser(description='Track genuinely new Marketplace customers')
    ap.add_argument('--from', dest='d_from', default=datetime.now().strftime('%Y-%m-01'))
    ap.add_argument('--to', dest='d_to', default=datetime.now().strftime('%Y-%m-%d'))
    ap.add_argument('--app', default='all', help='full|lite|diagramly|asyncapi|all|<addonKey>')
    ap.add_argument('--grace', type=int, default=30, help='days of D1-precedence tolerated (default 30)')
    ap.add_argument('--sync', action='store_true', help='refresh marketplace.db snapshot first (~15s)')
    ap.add_argument('--refresh-d1', action='store_true', help='bypass the 24h D1 cache')
    ap.add_argument('--contacts', action='store_true', help='show technical-contact name/email')
    ap.add_argument('--trend', action='store_true', help='append 6-month NEW-per-month trend')
    ap.add_argument('--json', dest='as_json', action='store_true')
    args = ap.parse_args()

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
            if verdict == 'NEW' and start >= (datetime.fromisoformat(args.d_to) -
                                              timedelta(days=183)).strftime('%Y-%m-%d'):
                trend[addon][start[:7]] += 1
        report[addon] = buckets

    if args.as_json:
        print(json.dumps(report, indent=1))
        return
    for addon, buckets in report.items():
        n_new, n_pre, n_int = (len(buckets[k]) for k in ('NEW', 'PRE-EXISTING', 'INTERNAL'))
        print(f'\n=== {addon}  [{args.d_from} .. {args.d_to}]  '
              f'NEW={n_new}  pre-existing={n_pre}  internal={n_int}')
        if addon == 'my-api' and (n_new or n_pre):
            print('    (caveat: my-api has no D1 install history - backfill filter is blind here)')
        for e in sorted(buckets['NEW'], key=lambda x: x['start']):
            line = f"  NEW  {e['start']}  {e['domain']:<28} {e['type']:<10} {e['tier'] or '?':<10} ({e['note']})"
            if args.contacts:
                line += f"  {e.get('contact', '')}"
            print(line)
        if args.trend and trend[addon]:
            months = ' '.join(f'{m}:{c}' for m, c in sorted(trend[addon].items()))
            print(f'  trend(NEW/mo): {months}')


if __name__ == '__main__':
    main()
