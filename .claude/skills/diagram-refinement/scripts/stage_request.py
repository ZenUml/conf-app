#!/usr/bin/env python3
"""Offline frozen D1 request generation and exact readback verification. No network."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

SCOPE_FIELDS = ('cloudId', 'appId', 'environmentId', 'installationId')
TTL_MS = 30 * 24 * 60 * 60 * 1000
SEND_WINDOW_MS = 120_000
INSERT_SQL = (
    'INSERT INTO MagicWriteback '
    '(id,cloudId,appId,environmentId,installationId,contentId,sourceHash,artifact,createdAt,expiresAt) '
    'SELECT ?,?,?,?,?,?,?,?,?,? '
    "WHERE ? >= CAST(strftime('%s','now') AS INTEGER)*1000 "
    'AND NOT EXISTS (SELECT 1 FROM MagicWriteback WHERE '
    'cloudId=? AND appId=? AND environmentId=? AND installationId=? AND contentId=?) '
    'AND EXISTS (SELECT 1 FROM CustomContent WHERE '
    'contentId=? AND appId=? AND cloudId=? AND macroUuid=? AND pageId=? '
    'AND latestVersionNumber=? AND status=? AND type=? AND diagramType=? AND body=?) '
    'RETURNING id,contentId;'
)


class InvalidEvidence(Exception):
    pass


def require(condition, code):
    if not condition:
        raise InvalidEvidence(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_bytes().decode('utf-8'))


def json_digest(value):
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'))


def nonempty(value):
    return isinstance(value, str) and bool(value.strip()) and '<' not in value and '>' not in value


TARGET_FIELDS = ('clientDomain', 'productType', 'environmentType')
PRODUCT_TYPES = ('lite', 'full', 'diagramly', 'asyncapi')
ENVIRONMENTS = ('DEVELOPMENT', 'STAGING', 'PRODUCTION')


def validate_target(target):
    for field in TARGET_FIELDS:
        require(nonempty(target.get(field)), 'MISSING_TARGET_' + field)
    require(target['productType'] in PRODUCT_TYPES, 'INVALID_TARGET_PRODUCT')
    require(target['environmentType'] in ENVIRONMENTS, 'INVALID_TARGET_ENVIRONMENT')


def freeze(handoff_path, output_path, *, expected_target):
    handoff_path, output_path = Path(handoff_path), Path(output_path)
    h = read_json(handoff_path)
    target, scope, connection = h['target'], h['scope'], h['connection']
    validate_target(expected_target)
    validate_target(target)
    require(all(target[field] == expected_target[field] for field in TARGET_FIELDS),
            'TARGET_SCOPE_MISMATCH')
    for field in SCOPE_FIELDS:
        require(nonempty(scope.get(field)), 'MISSING_SCOPE_' + field)
    for field in ('contentId', 'macroUuid', 'pageId', 'customContentType'):
        require(nonempty(target.get(field)), 'MISSING_TARGET_' + field)
    for field in ('accountId', 'databaseId'):
        require(nonempty(connection.get(field)), 'MISSING_CONNECTION_' + field)
    require(not output_path.exists(), 'FROZEN_REQUEST_EXISTS_READ_ONLY')

    def local_path(key):
        p = Path(h[key])
        return p if p.is_absolute() else handoff_path.parent / p

    cc = read_json(local_path('snapshotPath'))
    for field in ('cloudId', 'appId'):
        require(cc[field] == scope[field], 'CONTENT_SCOPE_MISMATCH_' + field)
    for field in ('contentId', 'macroUuid', 'pageId'):
        require(cc[field] == target[field], 'CONTENT_IDENTITY_MISMATCH_' + field)
    require(cc['status'] == 'current' and cc['diagramType'] == 'mermaid' and
            cc['type'] == target['customContentType'], 'CONTENT_TYPE_OR_STATUS_MISMATCH')
    require(isinstance(cc['latestVersionNumber'], int) and not isinstance(cc['latestVersionNumber'], bool)
            and cc['latestVersionNumber'] >= 1, 'INVALID_CONTENT_VERSION')
    source = local_path('sourcePath').read_bytes()
    reviewed_svg = local_path('reviewedSvgPath').read_bytes()
    doc = json.loads(json.loads(cc['body'])['raw']['value'])
    require(doc['diagramType'] == 'mermaid' and doc['mermaidCode'].encode('utf-8') == source,
            'CURRENT_SOURCE_MISMATCH')
    require(not doc.get('magic'), 'EXISTING_REFINED_REQUIRES_REPLACEMENT_DECISION')
    source_hash, reviewed_hash = digest(source), digest(reviewed_svg)
    review = read_json(local_path('reviewPath'))
    require(review['status'] in ('ACCEPTED', 'ACCEPTED_WITH_DISCLOSED_TRADEOFFS'), 'REVIEW_NOT_ACCEPTED')
    require((review['sourceHash'], review['svgHash']) == (source_hash, reviewed_hash), 'STALE_REVIEW')
    artifact = read_json(local_path('artifactPath'))
    require(isinstance(artifact['svg'], str) and artifact['svg'].strip(), 'EMPTY_PREPARED_SVG')
    svg_hash = digest(artifact['svg'].encode('utf-8'))
    require(artifact['sourceHash'] == source_hash and artifact['outcome'] == 'validated'
            and artifact['rulesVersion'] == 'magic-v1', 'ARTIFACT_CONTRACT_MISMATCH')
    generated = dt.datetime.fromisoformat(artifact['generatedAt'].replace('Z', '+00:00'))
    require(generated.tzinfo is not None, 'ARTIFACT_TIMESTAMP_NEEDS_TIMEZONE')
    compatibility = read_json(local_path('compatibilityPath'))
    require((compatibility['sourceHash'], compatibility['reviewedSvgHash'], compatibility['svgHash']) ==
            (source_hash, reviewed_hash, svg_hash), 'STALE_COMPATIBILITY')
    require(compatibility['displayValidation'] == 'PASS' and compatibility['highlightBinding'] == 'PASS'
            and compatibility['paintGeometryTextAttributesPreserved'] is True, 'COMPATIBILITY_NOT_PASSED')

    created = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    delivery = str(uuid.uuid4())
    frozen = {
        'formatVersion': 1, 'connection': connection, 'scope': scope, 'target': target,
        'deliveryId': delivery, 'sourceHash': source_hash, 'reviewedSvgHash': reviewed_hash,
        'svgHash': svg_hash, 'artifact': artifact, 'createdAt': created, 'expiresAt': created + TTL_MS,
        'sendBy': created + SEND_WINDOW_MS,
        'limitations': ['Offline evidence consistency only; no D1 write or customer runtime source verification.',
                        'Visual quality, tenant ownership, production compatibility and authorization require external evidence.'],
        'd1Request': {'sql': INSERT_SQL, 'params': [
            delivery, *[scope[f] for f in SCOPE_FIELDS], target['contentId'], source_hash,
            json.dumps(artifact, ensure_ascii=False, separators=(',', ':')), created, created + TTL_MS,
            created + SEND_WINDOW_MS,
            *[scope[f] for f in SCOPE_FIELDS], target['contentId'],
            cc['contentId'], cc['appId'], cc['cloudId'], cc['macroUuid'], cc['pageId'],
            cc['latestVersionNumber'], cc['status'], cc['type'], cc['diagramType'], cc['body']
        ]}
    }
    frozen['d1RequestSha256'] = json_digest(frozen['d1Request'])
    # Exclusive creation retains the first delivery/timestamps; no plan replacement.
    fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(frozen, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    return {'status': 'FROZEN_NOT_SENT', 'contentId': target['contentId'], 'deliveryId': delivery,
            'sourceHash': source_hash, 'svgHash': svg_hash, 'ttlDays': 30, 'sendBy': frozen['sendBy'],
            'requestSha256': digest(output_path.read_bytes())}


def verify(request_path, readback_path):
    plan, rows = read_json(request_path), read_json(readback_path)
    require(plan['formatVersion'] == 1 and plan['d1Request']['sql'] == INSERT_SQL, 'REQUEST_FORMAT_CHANGED')
    require(json_digest(plan['d1Request']) == plan['d1RequestSha256'], 'REQUEST_PARAMETERS_CHANGED')
    require(plan['expiresAt'] - plan['createdAt'] == TTL_MS, 'REQUEST_TTL_CHANGED')
    require(plan['sendBy'] - plan['createdAt'] == SEND_WINDOW_MS, 'REQUEST_SEND_WINDOW_CHANGED')
    require(digest(plan['artifact']['svg'].encode('utf-8')) == plan['svgHash'] and
            plan['artifact']['sourceHash'] == plan['sourceHash'], 'REQUEST_ARTIFACT_CHANGED')
    params = plan['d1Request']['params']
    expected_insert = [plan['deliveryId'], *[plan['scope'][f] for f in SCOPE_FIELDS],
                       plan['target']['contentId'], plan['sourceHash'],
                       json.dumps(plan['artifact'], ensure_ascii=False, separators=(',', ':')),
                       plan['createdAt'], plan['expiresAt'], plan['sendBy']]
    expected_queue_guard = [*[plan['scope'][f] for f in SCOPE_FIELDS], plan['target']['contentId']]
    expected_identity_guard = [plan['target']['contentId'], plan['scope']['appId'], plan['scope']['cloudId'],
                               plan['target']['macroUuid'], plan['target']['pageId']]
    require(len(params) == 26 and params[:11] == expected_insert and params[11:16] == expected_queue_guard
            and params[16:21] == expected_identity_guard, 'REQUEST_PARAMETERS_INCONSISTENT')
    require(isinstance(rows, list) and len(rows) == 1, 'READBACK_MISSING_OR_AMBIGUOUS')
    row = rows[0]
    for field in SCOPE_FIELDS:
        require(row[field] == plan['scope'][field], 'READBACK_SCOPE_MISMATCH_' + field)
    for field, expected in [('id', plan['deliveryId']), ('contentId', plan['target']['contentId']),
                            ('sourceHash', plan['sourceHash']), ('createdAt', plan['createdAt']),
                            ('expiresAt', plan['expiresAt'])]:
        require(row[field] == expected, 'READBACK_MISMATCH_' + field)
    require(json.loads(row['artifact']) == plan['artifact'], 'READBACK_ARTIFACT_MISMATCH')
    return {'status': 'EXACT_QUEUE_READBACK_PASS', 'contentId': row['contentId'],
            'deliveryId': row['id'], 'ttlDays': 30,
            'queue': 'LEASED' if row.get('claimToken') else 'PENDING',
            'customerWriteOrDisplay': 'NOT_CONFIRMED'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='phase', required=True)
    p = subs.add_parser('freeze')
    p.add_argument('--handoff', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--client-domain', required=True)
    p.add_argument('--product-type', choices=PRODUCT_TYPES, required=True)
    p.add_argument('--environment', choices=ENVIRONMENTS, required=True)
    p = subs.add_parser('verify')
    p.add_argument('--request', required=True)
    p.add_argument('--readback', required=True)
    args = parser.parse_args()
    try:
        result = freeze(args.handoff, args.out, expected_target={
            'clientDomain': args.client_domain, 'productType': args.product_type,
            'environmentType': args.environment
        }) if args.phase == 'freeze' else verify(args.request, args.readback)
    except (InvalidEvidence, OSError, KeyError, TypeError, ValueError) as exc:
        # Do not leak private source, API payloads or parser exception excerpts.
        print(json.dumps({'status': 'STOPPED', 'reason': str(exc) if isinstance(exc, InvalidEvidence)
                          else type(exc).__name__}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
