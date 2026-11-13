#!/usr/bin/env bash
# Combine model-written notes with the provenance lines already on the draft.
# Provenance lines are kept verbatim: Daily regression, Bypass reason, E2E.
# Refuses a body that still contains the draft placeholder.
set -euo pipefail

notes_file="${1:-}"
draft_body_file="${2:-}"
[[ -n "$notes_file" && -n "$draft_body_file" && -f "$notes_file" && -f "$draft_body_file" ]] \
  || { printf 'usage: notes-body.sh <notes-file> <draft-body-file>\n' >&2; exit 1; }

if grep -q 'This is a draft release' "$notes_file"; then
  printf 'BLOCK: notes still contain the draft placeholder\n' >&2
  exit 1
fi

provenance="$(grep -E '^(Daily regression|Bypass reason:|E2E:)' "$draft_body_file" || true)"

cat "$notes_file"
if [[ -n "$provenance" ]]; then
  printf '\n'
  while IFS= read -r line; do
    grep -qxF "$line" "$notes_file" || printf '%s\n' "$line"
  done <<<"$provenance"
fi
