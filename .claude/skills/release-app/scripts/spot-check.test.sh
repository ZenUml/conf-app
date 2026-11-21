#!/usr/bin/env bash
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
fail=0

ok() { printf 'ok %s\n' "$1"; }
bad() { printf 'FAIL %s\n%s\n' "$1" "${2:-}"; fail=1; }

# format
out="$(bash "$here/spot-check.sh" format pass 'watermark + 0 evaluated events, screenshot in PR #1224')" \
  && [[ "$out" == 'Spot check: PASS — watermark + 0 evaluated events, screenshot in PR #1224' ]] \
  && ok 'format pass' || bad 'format pass' "$out"
out="$(bash "$here/spot-check.sh" format na 'change is Lite-only')" \
  && [[ "$out" == 'Spot check: N/A — change is Lite-only' ]] \
  && ok 'format na' || bad 'format na' "$out"
bash "$here/spot-check.sh" format pass '' >/dev/null 2>&1 && bad 'empty note accepted' || ok 'reject empty note'
bash "$here/spot-check.sh" format '   ' >/dev/null 2>&1 && bad 'blank note accepted' || ok 'reject missing note'
bash "$here/spot-check.sh" format skipped 'x' >/dev/null 2>&1 && bad 'unknown result accepted' || ok 'reject unknown result'

# apply: appends once, replaces an earlier line
printf '## v1-diagramly\n- change\n\nE2E: ok\n' >"$dir/body.md"
bash "$here/spot-check.sh" apply "$dir/body.md" 'Spot check: N/A — first' >"$dir/b1.md"
bash "$here/spot-check.sh" apply "$dir/b1.md" 'Spot check: PASS — second' >"$dir/b2.md"
if [[ "$(grep -c '^Spot check:' "$dir/b2.md")" == 1 ]] && grep -q '^Spot check: PASS — second$' "$dir/b2.md" \
  && grep -q '^E2E: ok$' "$dir/b2.md"; then ok 'apply replaces'; else bad 'apply replaces' "$(cat "$dir/b2.md")"; fi

# check
bash "$here/spot-check.sh" check "$dir/b2.md" >/dev/null && ok 'check accepts PASS' || bad 'check accepts PASS'
bash "$here/spot-check.sh" check "$dir/b1.md" >/dev/null && ok 'check accepts N/A' || bad 'check accepts N/A'
out="$(bash "$here/spot-check.sh" check "$dir/body.md")" && bad 'check accepted a body with no line' "$out" \
  || { grep -q '^BLOCK' <<<"$out" && ok 'check blocks missing line' || bad 'check output' "$out"; }
printf 'Spot check: PASS — \n' >"$dir/empty.md"
bash "$here/spot-check.sh" check "$dir/empty.md" >/dev/null && bad 'check accepted empty reason' || ok 'check blocks empty reason'

exit "$fail"
