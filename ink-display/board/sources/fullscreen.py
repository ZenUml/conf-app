"""Read configured Fullscreen requests and our mail outbox; no contacts, writes, or email."""
from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo
from .sites import run_d1

CONFIG = Path.home() / '.local/share/remarkable-board/fullscreen-followups.json'
LOCAL = ZoneInfo('Australia/Melbourne')


def timestamp(value):
    if not value:
        return None
    when = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if when.tzinfo is None:
        raise ValueError('Fullscreen timestamp must include timezone')
    return when


def date_label(value, clock=False):
    when = timestamp(value)
    return when.astimezone(LOCAL).strftime('%d %b %H:%M' if clock else '%d %b') if when else '—'


def request_row(raw, now):
    expiry, activated = timestamp(raw.get('expiresAt')), timestamp(raw.get('activatedAt'))
    grant = 'EXPIRED' if expiry and expiry <= now else 'ACTIVE' if activated and expiry else 'PENDING' if not activated else 'UNKNOWN'
    state = str(raw.get('mailState') or '').lower()
    labels = {'delivered': 'Reply delivered', 'accepted': 'Reply sent (unconfirmed)',
              'bounced': 'REPLY BOUNCED', 'failed': 'REPLY FAILED',
              'pending': 'Reply pending', 'queued': 'Reply queued', 'sending': 'Reply sending',
              'draft': 'Reply draft (not sent)'}
    mail = labels.get(state, 'Reply not recorded' if not state else f'Reply state: {state}')
    stamp = raw.get('mailEventAt') if state in ('delivered', 'bounced') else raw.get('replySentAt') if state == 'accepted' else None
    return {'id': str(raw['id'])[:8], 'space': str(raw.get('spaceKey') or '—'),
            'requested': date_label(raw.get('createdAt')), 'grant': grant,
            'expires': date_label(raw.get('expiresAt')), 'mail': mail,
            'mail_at': date_label(stamp, clock=True) if stamp else '',
            'support_outcome': raw.get('supportOutcome')}


def fetch(d1=None, config_file=CONFIG, now=None):
    config = json.loads(Path(config_file).read_text())
    cloud = str(UUID(config['cloud_id']))
    site = config['site']
    if not isinstance(site, str) or not site.strip():
        raise ValueError('Missing Fullscreen site label')
    now = now or datetime.now(LOCAL)
    if now.tzinfo is None:
        raise ValueError('Fullscreen now must include timezone')
    sql = ('SELECT r.id,r.spaceKey,r.createdAt,r.activatedAt,r.expiresAt,r.supportOutcome,r.supportOutcomeAt,'
           'm.state AS mailState,m.firstAttemptAt AS replySentAt,m.providerOccurredAt AS mailEventAt,'
           'm.updatedAt AS mailUpdatedAt FROM FullscreenRecoveryRequest r '
           'LEFT JOIN FullscreenRecoveryMailOutbox m ON m.requestId=r.id '
           f"WHERE r.cloudId='{cloud}' ORDER BY r.createdAt ASC")
    rows = [request_row(raw, now) for raw in (d1 or run_d1)(sql)]
    return {'site': site.strip(), 'checked_at': now.isoformat(), 'rows': rows,
            'active': sum(r['grant'] == 'ACTIVE' for r in rows),
            'expired': sum(r['grant'] == 'EXPIRED' for r in rows),
            'outcomes_recorded': sum(bool(r['support_outcome']) for r in rows)}
