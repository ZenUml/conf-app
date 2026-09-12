#!/usr/bin/env python3
"""Read-only Forge snapshots; failed reads never become removals."""
import argparse, collections, datetime as dt, json, os, shlex, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
REGISTRY = Path(__file__).resolve().parents[2] / 'customer-data/products.json'


def parse_installations(raw):
    # Forge's register-installation-commands + CommandLineUI.table(json) emit this array.
    rows = json.loads(raw)
    if not isinstance(rows, list):
        raise ValueError('Expected Forge install-list JSON array')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or any(not isinstance(row.get(k), str) or not row[k]
                                            for k in ('id', 'environment', 'site')):
            raise ValueError('Incomplete record; snapshot rejected')
        if row['id'] in seen:
            raise ValueError('Duplicate installation ID')
        seen.add(row['id'])
    return rows


def sites(rows):
    return {(r['environment'], r['site']) for r in rows}


def compare(current, baseline):
    now, before = sites(current), sites(baseline)
    return {'added': [dict(environment=e, site=s) for e, s in sorted(now - before)],
            'removed': [dict(environment=e, site=s) for e, s in sorted(before - now)]}


def snapshot_report(product, rows, directory, now):
    directory.mkdir(parents=True, exist_ok=True)
    current = {'schema_version': 1, 'app_id': product['forge_app_id'], 'product': product['key'],
               'queried_at': now.isoformat(), 'scope': 'all environments', 'read_status': 'ok', 'rows': rows}
    prior = []
    for path in directory.glob(product['key'] + '-*.json'):
        try:
            candidate = json.loads(path.read_text())
            if any(candidate.get(k) != current[k] for k in ('schema_version', 'app_id', 'scope', 'read_status')):
                continue
            observed = dt.datetime.fromisoformat(candidate['queried_at'])
            parse_installations(json.dumps(candidate['rows']))
            if observed < now:
                prior.append((observed, candidate))
        except (ValueError, KeyError, TypeError):
            continue
    deltas = {}
    for days in (1, 7):
        eligible = [p for p in prior if p[0] <= now - dt.timedelta(days=days)]
        if not eligible:
            deltas[str(days)] = {'read_status': 'unavailable', 'reason': 'no compatible baseline'}
            continue
        observed, before = max(eligible, key=lambda p: p[0])
        deltas[str(days)] = {'read_status': 'ok', 'observed_interval': [observed.isoformat(), now.isoformat()],
                            **compare(rows, before['rows'])}
    path = directory / (product['key'] + '-' + now.strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    temp = path.with_suffix('.tmp'); temp.write_text(json.dumps(current, ensure_ascii=False, indent=2)); temp.replace(path)
    return {'product': product['key'], 'source': 'forge install list --json', 'source_ref': str(path),
            'read_status': 'ok' if rows else 'empty', 'queried_at': now.isoformat(),
            'counts': dict(collections.Counter(r['environment'] for r in rows)),
            'unique_sites_by_environment': len(sites(rows)), 'installations': len(rows), 'deltas': deltas, 'rows': rows}


def main():
    products = json.loads(REGISTRY.read_text())['products']
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('product', nargs='?', default='all', choices=['all'] + [p['key'] for p in products])
    parser.add_argument('--snapshot-dir', type=Path, default=Path.home() / '.claude/cache/forge-installs')
    parser.add_argument('--input', type=Path, help='Validate one product offline; no snapshot writes')
    args = parser.parse_args()
    chosen = products if args.product == 'all' else [p for p in products if p['key'] == args.product]
    if args.input:
        if len(chosen) != 1:
            parser.error('--input requires one product')
        print(json.dumps({'mode': 'offline validation', 'product': args.product,
                          'rows': parse_installations(args.input.read_text())}, indent=2))
        return 0
    results = []
    for product in chosen:
        if not product['forge_app_id']:
            results.append({'product': product['key'], 'read_status': 'unavailable',
                            'reason': 'Forge identity not configured; query the product separately'})
            continue
        try:
            env = dict(os.environ, APP_ID=product['forge_app_id'])
            command = shlex.split(os.environ.get('FORGE_CMD', 'npx --no-install forge'))
            result = subprocess.run(command + ['install', 'list', '--json'], cwd=ROOT, env=env,
                                    capture_output=True, text=True, timeout=300)
            if result.returncode:
                raise RuntimeError('Forge CLI failed')
            rows = parse_installations(result.stdout)
            results.append(snapshot_report(product, rows, args.snapshot_dir, dt.datetime.now(dt.timezone.utc)))
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
            results.append({'product': product['key'], 'read_status': 'failed',
                            'reason': 'Query or snapshot validation failed; no absence/delta inferred'})
    print(json.dumps({'scope': [p['key'] for p in chosen], 'results': results}, ensure_ascii=False, indent=2))
    return 1 if any(r['read_status'] == 'failed' for r in results) else 0


if __name__ == '__main__':
    sys.exit(main())
