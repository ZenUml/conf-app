#!/usr/bin/env bash
# Read one `gh run view --json jobs` array from stdin and judge a production release.
#
# Prints `deploy: …` and `smoke: …`.
# Exit 0  deploy succeeded and every non-skipped smoke job succeeded
# Exit 2  deploy succeeded and the workflow has no smoke jobs (AsyncAPI today)
# Exit 3  deploy succeeded and smoke is still running
# Exit 1  deploy missing or failed, or smoke failed
set -euo pipefail

jobs="$(cat)"

deploy="$(jq -r '
  [.[] | select((.name | endswith(" to production")) or .name == "Deploy Cron Worker to Production")]
  | if length == 0 then "missing"
    elif all(.conclusion == "success") then "success"
    elif any(.conclusion == "failure" or .conclusion == "cancelled") then "failure"
    else "pending"
    end
' <<<"$jobs")"

smoke="$(jq -r '
  [.[] | select(.name | startswith("Smoke Test")) | select(.conclusion != "skipped")]
  | if length == 0 then "absent"
    elif any(.conclusion == "failure" or .conclusion == "cancelled") then "failure"
    elif all(.conclusion == "success") then "success"
    else "pending"
    end
' <<<"$jobs")"

printf 'deploy: %s\nsmoke: %s\n' "$deploy" "$smoke"

if [[ "$deploy" == success && "$smoke" == success ]]; then
  exit 0
fi
if [[ "$deploy" == success && "$smoke" == absent ]]; then
  exit 2
fi
if [[ "$deploy" == success && "$smoke" == pending ]]; then
  exit 3
fi
exit 1
