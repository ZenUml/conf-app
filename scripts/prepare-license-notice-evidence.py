#!/usr/bin/env python3
"""Prepare (never apply) one expiring Full license-notice KV record from live Marketplace evidence."""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7'
FULL_ADDON = 'com.zenuml.confluence-addon'
ENVIRONMENTS = ('development', 'staging', 'production')


def normalize_domain(value):
    value = value.strip().lower()
    if '://' in value:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.port:
            raise ValueError('Invalid Confluence site domain')
        value = parsed.hostname or ''
    if re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?', value):
        value += '.atlassian.net'
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net', value):
        raise ValueError('Expected a Confluence site slug or atlassian.net hostname')
    return value


def updated_at(row):
    try:
        value = dt.datetime.fromisoformat(row.get('lastUpdated', '').replace('Z', '+00:00'))
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value
    except (ValueError, TypeError, AttributeError):
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)


MAX_VALID_HOURS = 168  # Must equal the endpoint and viewer cap (7 days).


def build_entry(rows, domain, environment, now=None, valid_hours=24):
    """Pure builder; rows must come from a fresh, complete Full license export."""
    if environment not in ENVIRONMENTS:
        raise ValueError('Unsupported Forge environment')
    if not isinstance(valid_hours, int) or isinstance(valid_hours, bool) or not 0 < valid_hours <= MAX_VALID_HOURS:
        raise ValueError(f'Validity window must be 1 to {MAX_VALID_HOURS} hours')
    domain = normalize_domain(domain)
    rows = [r for r in rows if r.get('addonKey') == FULL_ADDON]
    matching = [r for r in rows if str(r.get('cloudSiteHostname', '')).lower() == domain]
    cloud_ids = {r.get('cloudId') for r in matching}
    if len(cloud_ids) != 1 or not matching:
        raise ValueError('Site must map to exactly one Marketplace cloudId')
    cloud_id = next(iter(cloud_ids))
    if not isinstance(cloud_id, str) or not cloud_id.strip():
        raise ValueError('Marketplace cloudId is missing')
    installation_rows = [r for r in rows if r.get('cloudId') == cloud_id]
    if any(str(r.get('status', '')).lower() == 'active' and r.get('licenseType') != 'LEGACY_FREE'
           for r in installation_rows):
        raise ValueError('Active non-LEGACY_FREE entitlement conflicts with notice evidence')
    legacy = [r for r in installation_rows if r.get('licenseType') == 'LEGACY_FREE']
    if not legacy:
        raise ValueError('No LEGACY_FREE Marketplace evidence')
    selected = max(legacy, key=updated_at)
    entitlement = selected.get('appEntitlementId')
    if not isinstance(entitlement, str) or not entitlement.strip():
        raise ValueError('Selected Marketplace appEntitlementId is missing')
    checked = now or dt.datetime.now(dt.timezone.utc)
    if checked.tzinfo is None:
        raise ValueError('Evidence timestamp must have a timezone')
    checked = checked.astimezone(dt.timezone.utc)
    expires = checked + dt.timedelta(hours=valid_hours)
    iso = lambda timestamp: timestamp.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    record = dict(schemaVersion=1, licenseType='LEGACY_FREE', source='atlassian_marketplace',
                  checkedAt=iso(checked), expiresAt=iso(expires), entitlementId=entitlement)
    return dict(key=f'license-notice:{FULL_APP_ID}:{environment}:{cloud_id}',
                value=json.dumps(record, separators=(',', ':')), expiration=int(expires.timestamp()))


def live_full_licenses():
    engine_path = Path(__file__).resolve().parents[1] / '.claude/skills/marketplace/scripts/mp_report.py'
    spec = importlib.util.spec_from_file_location('marketplace_report', engine_path)
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    email, token = engine.load_creds(engine.find_env())
    # Fresh import has no local snapshot; explicitly retain live-only behavior.
    engine.LOCAL['db'] = None
    return engine.export('licenses', engine._auth_header(email, token), addon=FULL_ADDON)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', required=True, help='Confluence site slug or hostname')
    parser.add_argument('--environment', required=True, choices=ENVIRONMENTS)
    parser.add_argument('--output', required=True, help='New private output file for Wrangler bulk-put JSON')
    parser.add_argument('--valid-hours', type=int, default=24,
                        help=f'How long the record stays valid, 1 to {MAX_VALID_HOURS} hours (default 24)')
    args = parser.parse_args()
    try:
        domain = normalize_domain(args.domain)
        entry = build_entry(live_full_licenses(), domain, args.environment, valid_hours=args.valid_hours)
        # Refuse to replace an earlier evidence artifact silently.
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump([entry], output, indent=2)
            output.write('\n')
    except ValueError as error:
        parser.exit(1, f'Cannot prepare evidence: {error}\n')
    except (Exception, SystemExit):
        # Upstream exceptions can contain response bodies; do not print those or credentials.
        parser.exit(1, 'Cannot prepare evidence: live export or output write failed\n')
    print('Prepared one expiring KV entry. No KV changes were made.')


if __name__ == '__main__':
    main()
