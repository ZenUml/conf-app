"""Organization billing snapshot plus true observed history; no Mixpanel live query."""
from __future__ import annotations

from datetime import date, datetime
import fcntl
import json
import math
import os
from pathlib import Path
import tempfile
from zoneinfo import ZoneInfo

HOME = Path.home() / '.local/share/remarkable-board'
SNAPSHOT = HOME / 'mixpanel-usage.json'
HISTORY = HOME / 'mixpanel-usage-history.json'
LOCAL = ZoneInfo('Australia/Melbourne')
METRICS = ('events', 'session_replay')


def aware(value):
    when = datetime.fromisoformat(value)
    if when.tzinfo is None:
        raise ValueError('Mixpanel checked_at must include timezone')
    return when


def number(value, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Mixpanel usage and limits must be finite numbers')
    if value < 0 or (positive and value == 0):
        raise ValueError('Mixpanel usage must be nonnegative and limits positive')
    return value


def fetch(path=SNAPSHOT, history_path=HISTORY):
    data = json.loads(Path(path).read_text())
    checked = aware(data['checked_at'])
    start, end = date.fromisoformat(data['period_start']), date.fromisoformat(data['period_end'])
    if start >= end:
        raise ValueError('Invalid Mixpanel billing period')
    result = {key: data[key] for key in ('checked_at', 'period_start', 'period_end')}
    for key in METRICS:
        used, limit = number(data[key]['used']), number(data[key]['limit'], positive=True)
        result[key] = {'used': used, 'limit': limit, 'remaining': max(0, min(100, 100*(1-used/limit)))}
    path = Path(history_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(str(path)+'.lock', os.O_CREAT | os.O_RDWR, 0o600), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            history = json.loads(path.read_text())
        except (OSError, ValueError):
            history = {}
        cycle = [data['period_start'], data['period_end']]
        points = history.get('points', []) if isinstance(history, dict) and history.get('cycle') == cycle else []
        # Keep only actual observations in this billing cycle; no synthetic month-start point.
        by_time = {}
        for point in points:
            stamp = aware(point['checked_at'])
            if start <= stamp.astimezone(LOCAL).date() < end:
                by_time[stamp.timestamp()] = point
        if start <= checked.astimezone(LOCAL).date() < end:
            by_time[checked.timestamp()] = {'checked_at': data['checked_at'],
                                          **{k: result[k]['remaining'] for k in METRICS}}
        points = [by_time[t] for t in sorted(by_time)]
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix=path.name+'.', delete=False) as out:
                temporary = out.name
                os.chmod(temporary, 0o600)
                json.dump({'cycle': cycle, 'points': points}, out)
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
    result['history'] = points
    return result
