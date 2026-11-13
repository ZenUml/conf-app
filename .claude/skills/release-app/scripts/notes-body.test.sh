#!/usr/bin/env bash
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
fail=0

cat >"$dir/draft.txt" <<'EOF'
This is a draft release for the Diagramly version of the plugin.
Daily regression gate: Latest completed main regression succeeded
Daily regression: https://github.com/ZenUml/conf-app/actions/runs/1
Bypass reason: none
EOF

cat >"$dir/notes.md" <<'EOF'
## v1-diagramly

### Changes
- Maintenance release; no user-facing changes.
EOF

out="$(bash "$here/notes-body.sh" "$dir/notes.md" "$dir/draft.txt")" || status=$?
status="${status:-0}"
if [[ "$status" != 0 ]] || ! grep -q 'Maintenance release' <<<"$out" || ! grep -q 'Daily regression gate:' <<<"$out" || ! grep -q 'Bypass reason: none' <<<"$out" || grep -q 'This is a draft release' <<<"$out"; then
  printf 'FAIL append provenance\n%s\n' "$out"
  fail=1
else
  printf 'ok append provenance\n'
fi

cat >"$dir/placeholder.md" <<'EOF'
This is a draft release for the Lite version of the plugin.
EOF
if bash "$here/notes-body.sh" "$dir/placeholder.md" "$dir/draft.txt" >/dev/null 2>&1; then
  printf 'FAIL placeholder was accepted\n'
  fail=1
else
  printf 'ok reject placeholder\n'
fi

exit "$fail"
