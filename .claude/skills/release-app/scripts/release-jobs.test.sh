#!/usr/bin/env bash
# Offline test for release-jobs.sh. Run: bash release-jobs.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() {
  local name="$1" expected="$2" json="$3" out status
  out="$(bash "$here/release-jobs.sh" <<<"$json" 2>&1)" || status=$?
  status="${status:-0}"
  if [[ "$status" != "$expected" ]] || ! grep -q '^deploy: ' <<<"$out" || ! grep -q '^smoke: ' <<<"$out"; then
    printf 'FAIL %s: exit %s (want %s)\n%s\n' "$name" "$status" "$expected" "$out"
    fail=1
  else
    printf 'ok %s\n' "$name"
  fi
}

check success 0 '[
  {"name":"v1-diagramly to production","status":"completed","conclusion":"success"},
  {"name":"Deploy Cron Worker to Production","status":"completed","conclusion":"success"},
  {"name":"Smoke Test (Prod) — diagramly / auth / auth bootstrap","status":"completed","conclusion":"success"},
  {"name":"Smoke Test (Prod) — diagramly / plan concrete tests","status":"completed","conclusion":"skipped"},
  {"name":"Smoke Test (Prod) — diagramly / shard 1/5","status":"completed","conclusion":"success"},
  {"name":"Smoke Test (Prod) — diagramly / aggregate concrete evidence","status":"completed","conclusion":"skipped"}
]'

check "smoke shard failed" 1 '[
  {"name":"v1-lite to production","status":"completed","conclusion":"success"},
  {"name":"Deploy Cron Worker to Production","status":"completed","conclusion":"success"},
  {"name":"Smoke Test (Prod) — lite / shard 3/5","status":"completed","conclusion":"failure"},
  {"name":"Smoke Test (Prod) — lite / shard 1/5","status":"completed","conclusion":"success"}
]'

check "smoke still running" 3 '[
  {"name":"v1-diagramly to production","status":"completed","conclusion":"success"},
  {"name":"Deploy Cron Worker to Production","status":"completed","conclusion":"success"},
  {"name":"Smoke Test (Prod) — diagramly / shard 1/5","status":"in_progress","conclusion":null}
]'

check "asyncapi deploy only" 2 '[
  {"name":"v1-asyncapi to production","status":"completed","conclusion":"success"},
  {"name":"Deploy Cron Worker to Production","status":"completed","conclusion":"success"}
]'

check "deploy failed" 1 '[
  {"name":"v1-full to production","status":"completed","conclusion":"failure"},
  {"name":"Deploy Cron Worker to Production","status":"completed","conclusion":"success"}
]'

exit "$fail"
