#!/usr/bin/env bash
# Offline test for source-jobs.sh. Run: bash source-jobs.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() {
  local name="$1" expected="$2" json="$3" status=0
  bash "$here/source-jobs.sh" <<<"$json" >/dev/null 2>&1 || status=$?
  if [[ "$status" != "$expected" ]]; then
    printf 'FAIL %s: exit %s (want %s)\n' "$name" "$status" "$expected"
    fail=1
  else
    printf 'ok %s\n' "$name"
  fi
}

# Before the one-graph change the root had one waiter job per phase.
check "old shape green" 0 '[
  {"name":"Source and version","conclusion":"success"},
  {"name":"Staging validation","conclusion":"success"},
  {"name":"Draft preparation","conclusion":"success"}
]'
check "old shape staging red" 1 '[
  {"name":"Staging validation","conclusion":"failure"},
  {"name":"Draft preparation","conclusion":"success"}
]'

# One graph: the phase jobs are root jobs named "<Phase> / <job>".
check "one graph green, skipped jobs allowed" 0 '[
  {"name":"Source and version","conclusion":"success"},
  {"name":"Staging validation / Read root options","conclusion":"success"},
  {"name":"Staging validation / Validate: Lite / regression / shard 1/4","conclusion":"success"},
  {"name":"Staging validation / Validate: Lite / aggregate concrete evidence","conclusion":"skipped"},
  {"name":"Draft preparation / Draft: Lite","conclusion":"success"},
  {"name":"Draft preparation / Draft gate outcome","conclusion":"success"},
  {"name":"Pipeline outcome","conclusion":"success"}
]'
# Report merging has job-level continue-on-error: red job, green phase.
check "one graph report merge red, outcome green" 0 '[
  {"name":"Staging validation / Validate: Lite / regression / merge shard reports","conclusion":"failure"},
  {"name":"Draft preparation / Draft gate outcome","conclusion":"success"},
  {"name":"Pipeline outcome","conclusion":"success"}
]'
check "one graph staging shard red" 1 '[
  {"name":"Staging validation / Validate: Full / regression / shard 2/4","conclusion":"failure"},
  {"name":"Draft preparation / Draft gate outcome","conclusion":"failure"},
  {"name":"Pipeline outcome","conclusion":"failure"}
]'
check "one graph outcome cancelled" 1 '[
  {"name":"Staging validation / Deploy: Lite / deploy","conclusion":"cancelled"},
  {"name":"Draft preparation / Draft gate outcome","conclusion":"success"},
  {"name":"Pipeline outcome","conclusion":"cancelled"}
]'
check "one graph draft phase missing" 1 '[
  {"name":"Staging validation / Deploy: Lite / deploy","conclusion":"success"},
  {"name":"Pipeline outcome","conclusion":"success"}
]'
check "no jobs" 1 '[]'
check "empty input" 1 ''

exit "$fail"
