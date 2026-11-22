#!/usr/bin/env bash
# Read the jobs of a green "Build, Test and Draft Release" run (one JSON array, all
# pages) from stdin. Exit 0 when its staging validation and draft preparation phases
# both succeeded, else 1.
#
# Two shapes:
# - before the one-graph change, one root job per phase, named "Staging validation"
#   and "Draft preparation", each waiting for a dispatched child run;
# - one graph: the phases are called workflows, so their jobs are root jobs named
#   "Staging validation / …" and "Draft preparation / …". A phase succeeded when it has
#   jobs and none of them failed, was cancelled or timed out (skipped jobs are normal).
set -euo pipefail

jobs="$(cat)"
# No input (a failed fetch) is never a pass; jq -e on empty input exits 0.
[[ -n "${jobs//[[:space:]]/}" ]] || exit 1

jq -e '
  def old($n): [.[] | select(.name == $n)][0].conclusion == "success";
  def phase($n): [.[] | select(.name | startswith($n + " / "))]
    | length > 0 and all(.conclusion == "success" or .conclusion == "skipped");
  (old("Staging validation") and old("Draft preparation"))
  or (phase("Staging validation") and phase("Draft preparation"))
' >/dev/null <<<"$jobs"
