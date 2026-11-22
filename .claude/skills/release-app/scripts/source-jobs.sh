#!/usr/bin/env bash
# Read the jobs of a green "Build, Test and Draft Release" run (one JSON array, all
# pages) from stdin. Exit 0 when its staging validation and draft preparation phases
# both succeeded, else 1.
#
# Two shapes:
# - before the one-graph change, one root job per phase, named "Staging validation"
#   and "Draft preparation", each waiting for a dispatched child run;
# - one graph: the phases are called workflows, so their jobs are root jobs named
#   "Staging validation / …" and "Draft preparation / …". Both must be present, and
#   "Pipeline outcome" must be green: it fails unless every phase's result is success.
#   Single jobs are not judged: a job with job-level continue-on-error (E2E report
#   merging) shows "failure" while its phase still succeeds.
set -euo pipefail

jobs="$(cat)"
# No input (a failed fetch) is never a pass; jq -e on empty input exits 0.
[[ -n "${jobs//[[:space:]]/}" ]] || exit 1

jq -e '
  def old($n): [.[] | select(.name == $n)][0].conclusion == "success";
  def present($n): any(.[]; .name | startswith($n + " / "));
  (old("Staging validation") and old("Draft preparation"))
  or (present("Staging validation") and present("Draft preparation") and old("Pipeline outcome"))
' >/dev/null <<<"$jobs"
