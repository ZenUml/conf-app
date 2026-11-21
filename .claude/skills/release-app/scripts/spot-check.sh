#!/usr/bin/env bash
# The post-release spot-check record that gates the next variant.
#
#   spot-check.sh format <pass|na> <note>   prints "Spot check: PASS — <note>"
#   spot-check.sh apply <body-file> <line>  prints the body with that line,
#                                            replacing an earlier Spot check line
#   spot-check.sh check <body-file>          exit 0 when the body holds a
#                                            PASS or N/A line with a reason
#
# PASS needs the evidence, N/A needs the reason the variant cannot reach the
# change. Both are notes; an empty note is refused.
set -euo pipefail

prefix='Spot check:'

case "${1:-}" in
  format)
    result="${2:-}"; note="$(printf '%s' "${3:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    case "$result" in
      pass) label=PASS ;;
      na) label=N/A ;;
      *) printf 'BLOCK: spot check result must be pass or na\n' >&2; exit 1 ;;
    esac
    [[ -n "$note" ]] || { printf 'BLOCK: spot check needs a note (evidence for pass, reason for na)\n' >&2; exit 1; }
    printf '%s %s — %s\n' "$prefix" "$label" "$note"
    ;;
  apply)
    body="${2:-}"; line="${3:-}"
    [[ -f "$body" && "$line" == "$prefix "* ]] || { printf 'usage: spot-check.sh apply <body-file> <line>\n' >&2; exit 1; }
    grep -v "^$prefix" "$body" || true
    printf '%s\n' "$line"
    ;;
  check)
    body="${2:-}"
    [[ -f "$body" ]] || { printf 'usage: spot-check.sh check <body-file>\n' >&2; exit 1; }
    if line="$(grep -E "^$prefix (PASS|N/A) — .*[^[:space:]]" "$body" | tail -1)"; then
      printf '%s\n' "$line"
    else
      printf 'BLOCK: no spot check recorded; run release.sh <variant> --spot-check pass|na --note "..."\n'
      exit 1
    fi
    ;;
  *)
    printf 'usage: spot-check.sh format|apply|check ...\n' >&2
    exit 1
    ;;
esac
