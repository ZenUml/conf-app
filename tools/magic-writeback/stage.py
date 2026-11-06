#!/usr/bin/env python3
"""Stage reviewed Magic through the operator's existing Cloudflare D1 access.

Dry run is the default. --execute sends one parameterized D1 query. No public
admin endpoint, model call, or Confluence write is performed by this tool.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path
import sys
import urllib.request
import uuid

MAX_SVG_BYTES = 1024 * 1024


def bounded_file(path, limit):
    with Path(path).open('rb') as file:
        data = file.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Input exceeds size limit')
    return data.decode('utf-8')


def remote_scope(args):
    # Installed-event/CLI UUIDs differ from the full ARIs in verified Remote FIT.
    # Preserve canonical ARIs; never infer a different app or environment.
    pattern = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    if not re.fullmatch(pattern, args.app_id):
        raise ValueError('Expected Forge app UUID')
    prefix = f'ari:cloud:ecosystem::environment/{args.app_id}/'
    environment = args.environment_id
    if re.fullmatch(pattern, environment):
        environment = prefix + environment
    if not environment.startswith(prefix) or not re.fullmatch(pattern, environment[len(prefix):]):
        raise ValueError('Environment must belong to the selected app')
    prefix = 'ari:cloud:ecosystem::installation/'
    installation = args.installation_id
    if re.fullmatch(pattern, installation):
        installation = prefix + installation
    if not installation.startswith(prefix) or not re.fullmatch(pattern, installation[len(prefix):]):
        raise ValueError('Expected Forge installation UUID or ARI')
    return [args.cloud_id, args.app_id, environment, installation]


def prepare(args):
    if not args.reviewed:
        raise ValueError('--reviewed is required after completed visual and security review')
    for field in ('cloud_id', 'app_id', 'environment_id', 'installation_id'):
        value = getattr(args, field)
        if not value or len(value) > 200 or any(ord(c) < 32 for c in value):
            raise ValueError('Invalid target scope')
    if not args.content_id.isascii() or not args.content_id.isdigit() or len(args.content_id) > 30:
        raise ValueError('Content ID must be a numeric string')
    if not 1 <= args.ttl_hours <= 168:
        raise ValueError('TTL must be 1 to 168 hours')
    body = json.loads(bounded_file(args.body, 2 * 1024 * 1024))
    if not isinstance(body, dict) or body.get('diagramType') != 'mermaid' or not isinstance(body.get('mermaidCode'), str):
        raise ValueError('Expected a Mermaid raw body snapshot')
    svg = bounded_file(args.svg, MAX_SVG_BYTES)
    if not svg.lstrip().startswith('<svg'):
        raise ValueError('Expected an SVG document')
    timestamp = dt.datetime.now(dt.timezone.utc)
    artifact = {'sourceHash': hashlib.sha256(body['mermaidCode'].encode('utf-8')).hexdigest(),
                'svg': svg, 'rulesVersion': 'magic-v1', 'outcome': 'validated',
                'generatedAt': timestamp.isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
    created = int(timestamp.timestamp() * 1000)
    return {'id': str(uuid.uuid4()), 'scope': remote_scope(args),
            'contentId': args.content_id, 'artifact': artifact, 'createdAt': created,
            'expiresAt': created + args.ttl_hours * 3600000}


def d1(args, sql, params):
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not token or not account:
        raise ValueError('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for execution')
    # Explicit database selection avoids the prod default used by older tools.
    uuid.UUID(args.database_id)
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{args.database_id}/query',
        data=json.dumps({'sql': sql, 'params': params}).encode('utf-8'),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result.get('success') or not all(item.get('success') for item in result.get('result', [])):
        raise ValueError('D1 did not confirm success')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-id', required=True, help='Explicit D1 database UUID')
    parser.add_argument('--execute', action='store_true', help='Execute the stage/purge operation; omitted means dry run')
    sub = parser.add_subparsers(dest='command', required=True)
    stage = sub.add_parser('stage')
    for field in ('cloud-id', 'app-id', 'environment-id', 'installation-id', 'content-id', 'body', 'svg'):
        stage.add_argument('--' + field, required=True)
    stage.add_argument('--reviewed', action='store_true')
    stage.add_argument('--ttl-hours', type=int, default=24)
    sub.add_parser('purge', help='Delete expired queue payloads (including idle deliveries)')
    args = parser.parse_args(argv)
    try:
        uuid.UUID(args.database_id)
        if args.command == 'purge':
            if args.execute:
                d1(args, 'DELETE FROM MagicWriteback WHERE expiresAt <= ?', [int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)])
            print('Expired payload purge complete.' if args.execute else 'Dry run: would purge expired payloads. No request sent.')
            return 0
        plan = prepare(args)
        # Show only reviewable target metadata and sizes, never source/SVG/hash.
        print(json.dumps({'mode': 'stage' if args.execute else 'dry_run', 'databaseId': args.database_id,
                          'scope': plan['scope'], 'contentId': plan['contentId'], 'deliveryId': plan['id'],
                          'svgBytes': len(plan['artifact']['svg'].encode('utf-8')), 'ttlHours': args.ttl_hours}))
        if args.execute:
            d1(args, 'INSERT INTO MagicWriteback (id, cloudId, appId, environmentId, installationId, contentId, sourceHash, artifact, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
               [plan['id'], *plan['scope'], plan['contentId'], plan['artifact']['sourceHash'], json.dumps(plan['artifact']), plan['createdAt'], plan['expiresAt']])
            print('Staged. Fullscreen will verify current Confluence source before delivery.')
        else:
            print('Dry run complete. No request sent.')
        return 0
    except Exception:
        # Exceptions from HTTP can include response content or credentials. Keep
        # failure output finite; preserve local inputs for operator inspection.
        print('Operation failed: check inputs, review flag, target scope, database and Cloudflare access.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
