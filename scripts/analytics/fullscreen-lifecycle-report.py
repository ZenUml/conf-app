#!/usr/bin/env python3
"""Report sampled fullscreen sessions; see docs/analytics/fullscreen-lifecycle.md."""
import argparse
import collections
import datetime as dt
import json
import math
import pathlib
import statistics
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
QUERY = ROOT / '.claude/skills/mixpanel/scripts/mp_query.py'


def date(text):
    return dt.date.fromisoformat(text)


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(fraction * len(values)) - 1)]


def report(rows):
    sessions = collections.defaultdict(list)
    for row in rows:
        sid, name, entry, phase, modal, diagram, visible = row['key']
        sessions[sid].append((name, entry, phase, modal, diagram, visible, row['value']))
    cohorts = collections.defaultdict(list)
    duplicates = orphaned = 0
    for events in sessions.values():
        opens = [e for e in events if e[0] == 'fullscreen_opened']
        closes = [e for e in events if e[0] == 'fullscreen_closed']
        if not opens:
            orphaned += 1
            continue
        if len(opens) != 1 or opens[0][-1] != 1 or len(closes) > 1 or any(e[-1] != 1 for e in closes):
            duplicates += 1
            continue
        cohorts[opens[0][1] or 'unknown'].append(closes[0] if closes else None)
    result = {'excluded_duplicate_sessions': duplicates, 'orphaned_sessions_without_open': orphaned, 'entries': {}}
    for entry, closes in sorted(cohorts.items()):
        completed = [e for e in closes if e is not None]
        phases = collections.Counter(e[2] or 'unknown' for e in completed)
        item = {'opens': len(closes), 'closed': len(completed),
                'close_coverage_pct': round(100 * len(completed) / len(closes), 2),
                'unclosed_pct': round(100 * (len(closes) - len(completed)) / len(closes), 2),
                'close_phases': dict(sorted(phases.items())), 'duration_ms_by_close_phase': {}}
        for phase in sorted(phases):
            phase_events = [event for event in completed if (event[2] or 'unknown') == phase]
            durations = {}
            for label, index in [('modal', 3), ('diagram', 4), ('visible', 5)]:
                values = [e[index] for e in phase_events if isinstance(e[index], (int, float)) and e[index] >= 0]
                if values:
                    durations[label] = {'n': len(values), 'median': statistics.median(values),
                        'p75': percentile(values, .75), 'p90': percentile(values, .90), 'mean': round(statistics.mean(values), 2)}
            item['duration_ms_by_close_phase'][phase] = durations
        result['entries'][entry] = item
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-date', type=date, required=True, help='First UTC open date, inclusive')
    parser.add_argument('--to-date', type=date, required=True, help='Last UTC open date, inclusive')
    parser.add_argument('--grace-days', type=int, default=2, help='Additional days observed for closes (default: 2)')
    args = parser.parse_args()
    if args.from_date > args.to_date or args.grace_days < 1:
        parser.error('Dates must be ordered and grace must be at least one day')
    end = args.to_date + dt.timedelta(days=1)
    if end + dt.timedelta(days=args.grace_days) > dt.datetime.now(dt.timezone.utc).date():
        parser.error('The observation window must be in the past; choose an older end date')
    start_ms = int(dt.datetime.combine(args.from_date, dt.time(), dt.timezone.utc).timestamp() * 1000)
    end_ms = int(dt.datetime.combine(end, dt.time(), dt.timezone.utc).timestamp() * 1000)
    observed_to = args.to_date + dt.timedelta(days=args.grace_days)
    script = '''function main() {
  return Events({from_date: FROM, to_date: TO, event_selectors: [
    {event:"fullscreen_opened"}, {event:"fullscreen_view_ready"}, {event:"fullscreen_closed"}
  ]}).filter(function(e) {
    var p = e.properties;
    return typeof p.fullscreen_session_id === "string" &&
      p.fullscreen_started_at_ms >= START && p.fullscreen_started_at_ms < END;
  }).groupBy([
    function(e) { return e.properties.fullscreen_session_id; },
    function(e) { return e.name; },
    function(e) { return e.properties.entry_point || "unknown"; },
    function(e) { return e.properties.fullscreen_phase || "unknown"; },
    function(e) { return e.properties.fullscreen_modal_duration_ms == null ? null : e.properties.fullscreen_modal_duration_ms; },
    function(e) { return e.properties.fullscreen_diagram_duration_ms == null ? null : e.properties.fullscreen_diagram_duration_ms; },
    function(e) { return e.properties.fullscreen_visible_duration_ms == null ? null : e.properties.fullscreen_visible_duration_ms; }
  ], mixpanel.reducer.count());
}'''.replace('FROM', json.dumps(args.from_date.isoformat())).replace('TO', json.dumps(observed_to.isoformat())).replace('START', str(start_ms)).replace('END', str(end_ms))
    output = subprocess.check_output([sys.executable, str(QUERY), '--script', script, '--pace', '0'], cwd=ROOT, text=True)
    print(json.dumps(report(json.loads(output)), indent=2))


if __name__ == '__main__':
    main()
