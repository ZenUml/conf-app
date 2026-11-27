#!/usr/bin/env python3
"""Validate visible Mixpanel billing facts and atomically update the private snapshot."""
from __future__ import annotations
import argparse
from datetime import date, datetime, timedelta, timezone
import fcntl
import io
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import uuid
import tempfile
import time
from urllib.request import urlopen
from zoneinfo import ZoneInfo

HOME = Path.home() / '.local/share/remarkable-board'
SOURCE_URL = 'https://mixpanel.com/project/3373228/app/settings/org/plan/data-usage'
LOCAL = ZoneInfo('Australia/Melbourne')

class Invalid(ValueError):
    pass

def stamp(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed
    except (ValueError, TypeError):
        raise Invalid('invalid_observation_time') from None

def unique(pattern, text):
    matches = re.findall(pattern, text, re.MULTILINE)
    if len(matches) != 1:
        raise Invalid('incomplete_or_ambiguous_billing_text')
    return matches[0]

def integer(value):
    if not re.fullmatch(r'(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)', value):
        raise Invalid('invalid_number')
    return int(value.replace(',', ''))

def parse(envelope, current, period_start=None, now=None):
    if not isinstance(envelope, dict) or envelope.get('source_url') != SOURCE_URL:
        raise Invalid('unsupported_source')
    observed = stamp(envelope.get('observed_at'))
    now = now or datetime.now(timezone.utc)
    age = (now - observed).total_seconds()
    if age < 0 or age > 600:
        raise Invalid('observation_outside_freshness_window')
    text = envelope.get('text')
    if not isinstance(text, str) or len(text) > 1000000:
        raise Invalid('invalid_billing_text')
    lines = '\n'.join(line.strip() for line in text.splitlines() if line.strip())
    unique(r'^Diagramly\.Ai$', lines)
    unique(r'^Data Usage$', lines)
    for heading in ('Event Volume', 'Session Replay', 'Experiments'):
        unique('^' + heading + '$', lines)
    metrics = {}
    ends = []
    for heading, next_heading, key, noun, count_label in [
        ('Event Volume', 'Session Replay', 'events', 'tracked events', 'Events Tracked'),
        ('Session Replay', 'Experiments', 'session_replay', 'session replays', 'Replays')]:
        section = unique(r'^' + heading + r'\n([\s\S]*?)(?=^' + next_heading + r'$)', lines)
        amount, suffix = unique(r'^Your plan provides up to ([0-9,]+)([KM]?) ' + noun + r'(?=[.,])', section)
        limit = integer(amount) * {'': 1, 'K': 1000, 'M': 1000000}[suffix]
        used = integer(unique(r'^([^\n ]+) ' + count_label + r'$', section))
        if limit <= 0:
            raise Invalid('invalid_limit')
        end_text = unique(r'^Period ends ([A-Za-z]{3} [0-9]{1,2}, [0-9]{4})$', section)
        try:
            ends.append(datetime.strptime(end_text, '%b %d, %Y').date() + timedelta(days=1))
        except ValueError:
            raise Invalid('invalid_period') from None
        metrics[key] = {'used': used, 'limit': limit}
    if len(set(ends)) != 1:
        raise Invalid('different_metric_periods')
    end = ends[0]
    try:
        start = date.fromisoformat(period_start or (current['period_start'] if current.get('period_end') == end.isoformat() else ''))
    except (ValueError, KeyError, TypeError):
        raise Invalid('verified_period_start_required') from None
    if not start <= observed.astimezone(LOCAL).date() < end:
        raise Invalid('observation_outside_billing_cycle')
    return {'organization': 'Diagramly.Ai', 'source_url': SOURCE_URL, 'checked_at': observed.astimezone(LOCAL).isoformat(), 'period_start': start.isoformat(), 'period_end': end.isoformat(), **metrics}

def ingest(envelope, home=HOME, period_start=None, now=None):
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    target = home / 'mixpanel-usage.json'
    with os.fdopen(os.open(str(target) + '.lock', os.O_CREAT | os.O_RDWR, 0o600), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            current = json.loads(target.read_text())
        except (OSError, ValueError):
            current = {}
        candidate = parse(envelope, current, period_start, now)
        if current and stamp(current.get('checked_at')) > stamp(candidate['checked_at']):
            raise Invalid('older_observation')
        if current and stamp(current.get('checked_at')) == stamp(candidate['checked_at']) and current != candidate:
            raise Invalid('conflicting_observation')
        changed = {k: v for k, v in current.items() if k != 'checked_at'} != {k: v for k, v in candidate.items() if k != 'checked_at'}
        if current != candidate:
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', dir=home, prefix='.mixpanel-usage.', delete=False) as out:
                    temporary = out.name
                    os.fchmod(out.fileno(), 0o600)
                    json.dump(candidate, out)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temporary, target)
            finally:
                if temporary and os.path.exists(temporary):
                    os.unlink(temporary)
        return candidate, changed

def verify(snapshot, home=HOME, timeout=60):
    """Wait for both cache consumption and the actual served panel; never expose URL."""
    deadline = time.monotonic() + min(60, max(0, timeout))
    flags = {'cache_verified': False, 'served_crop_verified': False}
    while True:
        try:
            cached = json.loads((Path(home) / 'cache/mixpanel.json').read_text())['data']
            flags['cache_verified'] = all(cached.get(k) == snapshot[k] for k in ('checked_at', 'period_start', 'period_end')) and all(
                all(cached[k].get(field) == snapshot[k][field] for field in ('used', 'limit')) for k in ('events', 'session_replay'))
            if flags['cache_verified']:
                from PIL import Image, ImageChops
                from layout import Canvas, draw_mixpanel
                config = json.loads((Path(home) / 'config.json').read_text())
                url = 'http://127.0.0.1:%d/r/%s.png' % (int(config.get('port', 8766)), config['token'])
                with urlopen(url, timeout=3) as response:
                    served = Image.open(io.BytesIO(response.read())).convert('L')
                canvas = Canvas()
                draw_mixpanel(canvas, cached, 210, datetime.now())
                crop = (40, 210, 704, 685)
                flags['served_crop_verified'] = ImageChops.difference(served.crop(crop), canvas.image.crop(crop)).getbbox() is None
        except Exception:
            pass  # private paths, config and token must never enter diagnostics
        if flags['served_crop_verified'] or time.monotonic() >= deadline:
            return flags
        time.sleep(min(1, max(0, deadline - time.monotonic())))

def browser_capture():
    """One bounded attach attempt, with a strictly owned tab and session."""
    session = 'billing-sync-' + uuid.uuid4().hex
    base = ['/usr/local/bin/agent-browser', '--session', session, '--auto-connect', '--pin-tab', '--json']
    label = session + '-page'
    attached = False
    def run(*args, timeout=8):
        result = subprocess.run(base + list(args), capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise Invalid('needs_browser')
        data = json.loads(result.stdout)
        if not data.get('success'):
            raise Invalid('needs_browser')
        return data.get('data', {})
    try:
        run('tab', 'new', '--label', label, 'chrome://version')
        attached = True
        profile = run('get', 'text', '#profile_path').get('text', '')
        if not profile.rstrip('/').endswith('/Profile 8'):
            raise Invalid('needs_browser')
        run('open', SOURCE_URL)
        run('wait', '--fn', "document.readyState === 'complete' && document.body.innerText.includes('Events Tracked') && document.body.innerText.includes('Replays')", timeout=12)
        result = run('eval', "({source_url: location.href, text: document.body.innerText})").get('result')
        if not isinstance(result, dict):
            raise Invalid('needs_browser')
        return {**result, 'observed_at': datetime.now(timezone.utc).isoformat()}
    except Exception:
        raise Invalid('needs_browser') from None
    finally:
        # Never use --all. Bound tab closure cannot select an unrelated user tab.
        if attached:
            try:
                run('tab', 'close', label, timeout=3)
            except Exception:
                pass
        try:
            run('close', timeout=3)
        except Exception:
            pass

def read_snapshot(home):
    """Read only the canonical schema; never echo arbitrary file contents."""
    data = json.loads((Path(home) / 'mixpanel-usage.json').read_text())
    if data['organization'] != 'Diagramly.Ai' or data['source_url'] != SOURCE_URL:
        raise Invalid('invalid_saved_snapshot')
    stamp(data['checked_at'])
    if date.fromisoformat(data['period_start']) >= date.fromisoformat(data['period_end']):
        raise Invalid('invalid_saved_snapshot')
    result = {key: data[key] for key in ('organization', 'source_url', 'checked_at', 'period_start', 'period_end')}
    for metric in ('events', 'session_replay'):
        used, limit = data[metric]['used'], data[metric]['limit']
        if type(used) is not int or type(limit) is not int or used < 0 or limit <= 0:
            raise Invalid('invalid_saved_snapshot')
        result[metric] = {'used': used, 'limit': limit}
    return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['ingest', 'sync', 'verify'])
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--stdin', action='store_true')
    source.add_argument('--input-file', type=Path)
    parser.add_argument('--home', type=Path, default=HOME)
    parser.add_argument('--period-start')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--timeout', type=float, default=60)
    args = parser.parse_args(argv)
    try:
        if args.command == 'verify':
            snapshot = read_snapshot(args.home)
            flags = verify(snapshot, args.home, args.timeout)
            print(json.dumps({'status': 'verified' if flags['served_crop_verified'] else 'pending', 'changed': False, **snapshot, 'observed_at': snapshot['checked_at'], **flags}, separators=(',', ':')))
            return 0
        if args.command == 'sync':
            envelope = browser_capture()
        else:
            if not args.stdin and not args.input_file:
                raise Invalid('input_required')
            raw = sys.stdin.read(1000001) if args.stdin else args.input_file.read_text()
            envelope = json.loads(raw)
        snapshot, changed = ingest(envelope, args.home, args.period_start)
        flags = verify(snapshot, args.home, args.timeout) if args.verify else {'cache_verified': False, 'served_crop_verified': False}
        print(json.dumps({'status': ('verified' if flags['served_crop_verified'] else 'pending') if args.verify else 'saved', 'changed': changed, **snapshot, 'observed_at': snapshot['checked_at'], **flags}, separators=(',', ':')))
        return 0
    except Invalid as error:
        if str(error) == 'needs_browser':
            print(json.dumps({'status': 'needs_browser', 'reason': 'capture_visible_official_page_then_ingest'}))
            return 2
        print(json.dumps({'status': 'error', 'reason': str(error)}))
    except Exception:
        print(json.dumps({'status': 'error', 'reason': 'input_or_storage_failure'}))
    return 1

if __name__ == '__main__':
    raise SystemExit(main())
