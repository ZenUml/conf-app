#!/usr/bin/env python3
"""Vendor admin entry for the Lite->Full macro conversion queue (phase 1).

Enqueues a ConversionJob row in prod D1; the tenant's Full app claims and
executes it on its hourly scheduled tick (src/lite-full-conversion.ts).

A job is only enqueued for a migration the CUSTOMER asked for —
--request-source is mandatory and should reference that request
(e.g. "email:jessica 2026-08-12" or "jsm:ZEN-1234"). See
docs/superpowers/specs/2026-08-11-lite-to-full-conversion.md.

Usage:
    python3 enqueue.py enqueue --domain <tenant> --space <SPACEKEY> \
        --request-source "jsm:ZEN-1234" [--pages 123,456] [--dry-run]
    python3 enqueue.py status [--domain <tenant>]
    python3 enqueue.py cancel --job <uuid>

Always --remote: the queue lives in prod D1 (conf-zenuml-prod).
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import uuid

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DB_NAME = 'conf-zenuml-prod'


def d1(sql):
    cmd = ['npx', 'wrangler', 'd1', 'execute', DB_NAME, '--env', 'production',
           '--remote', '--json', '--command', sql]
    out = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        sys.exit(f'D1 failed:\n{out.stderr[-800:]}')
    return json.loads(out.stdout)[0]['results']


def q(value):
    """Single-quote a SQL literal (values here are uuids/keys we mint or verify)."""
    return "'" + str(value).replace("'", "''") + "'"


def resolve_cloud_id(domain):
    bare = domain.replace('.atlassian.net', '')
    rows = d1(
        'SELECT cloudId, clientDomain FROM AtlassianInstance '
        f"WHERE clientDomain IN ({q(bare)}, {q(bare + '.atlassian.net')})"
    )
    if not rows:
        rows = d1(
            'SELECT cloudId, clientDomain FROM ForgeInstallation '
            f"WHERE clientDomain IN ({q(bare)}, {q(bare + '.atlassian.net')}) "
            'AND cloudId IS NOT NULL LIMIT 1'
        )
    if not rows:
        sys.exit(f'cannot resolve cloudId for {domain} '
                 '(no AtlassianInstance/ForgeInstallation row)')
    return rows[0]['cloudId']


def cmd_enqueue(args):
    cloud = resolve_cloud_id(args.domain)
    job_id = str(uuid.uuid4())
    pages = None
    if args.pages:
        pages = [p.strip() for p in args.pages.split(',') if p.strip().isdigit()]
        if not pages:
            sys.exit('--pages must be a comma-separated list of numeric page ids')
    if not pages and not args.space:
        sys.exit('one of --space or --pages is required')

    print(f'cloudId       : {cloud}')
    print(f'job           : {job_id}')
    print(f'scope         : {"pages " + ",".join(pages) if pages else "space " + args.space}')
    print(f'dry run       : {args.dry_run}')
    print(f'request source: {args.request_source}')

    d1(
        'INSERT INTO ConversionJob (id, cloudId, spaceKey, pageIds, dryRun, requestSource, '
        'status, pageBatchLimit) '
        f"VALUES ({q(job_id)}, {q(cloud)}, "
        f"{q(args.space) if args.space else 'NULL'}, "
        f"{q(json.dumps(pages)) if pages else 'NULL'}, "
        f"{1 if args.dry_run else 0}, {q(args.request_source)}, 'queued', "
        f"{args.page_batch_limit if args.page_batch_limit else 'NULL'})"
    )
    print('queued. The tenant\'s Full app picks it up on its next hourly tick.')
    print(f'watch: python3 {os.path.relpath(__file__, os.getcwd())} status --domain {args.domain}')


def cmd_status(args):
    where = ''
    if args.domain:
        cloud = resolve_cloud_id(args.domain)
        where = f' WHERE cloudId = {q(cloud)}'
    rows = d1(
        'SELECT id, cloudId, spaceKey, pageIds, dryRun, status, requestSource, '
        'claimedAt, completedAt, statsJson, failureStage, createdAt, pageOffset '
        f'FROM ConversionJob{where} ORDER BY createdAt DESC LIMIT 20'
    )
    if not rows:
        print('no jobs')
        return
    for r in rows:
        scope = r['spaceKey'] or (r['pageIds'] and f"{len(json.loads(r['pageIds']))} pages") or '?'
        line = (f"{r['createdAt']}  {r['status']:<8} {scope:<14} @{r.get('pageOffset', 0)} dry={r['dryRun']} "
                f"src={r['requestSource']}  {r['id']}")
        print(line)
        if r['statsJson']:
            print(f'    stats: {r["statsJson"]}')
        if r['failureStage']:
            print(f'    failureStage: {r["failureStage"]}')


def cmd_cancel(args):
    d1(f"UPDATE ConversionJob SET status = 'cancelled' "
       f"WHERE id = {q(args.job)} AND status IN ('queued', 'claimed')")
    print('cancelled (if it was still queued/claimed)')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('enqueue')
    p.add_argument('--domain', required=True)
    p.add_argument('--space', help='convert every page in this space that holds Lite macros')
    p.add_argument('--pages', help='comma-separated explicit page ids (alternative to --space)')
    p.add_argument('--request-source', required=True,
                   help='customer request provenance, e.g. "jsm:ZEN-1234" or "email:<who> <date>"')
    p.add_argument('--dry-run', action='store_true',
                   help='walk and report without creating content or editing pages')
    p.add_argument('--page-batch-limit', type=int,
                   help='pages per tick (default 25). A job larger than one batch '
                        'requeues itself until the sweep comes up short.')
    p.set_defaults(fn=cmd_enqueue)

    p = sub.add_parser('status')
    p.add_argument('--domain')
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser('cancel')
    p.add_argument('--job', required=True)
    p.set_defaults(fn=cmd_cancel)

    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
