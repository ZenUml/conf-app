#!/usr/bin/env bash
# Classify each commit in <previous>..<sha> as behavioral or infra.
#
# A commit is behavioral when it touches src/ or functions/ outside test files.
# Everything else is infra (CI, docs, tests, skills).
#
# Output, one commit per line:
#   behavioral <sha> <subject> <paths>
#   infra <sha> <subject> <paths>
#
# Tests pass CLASSIFY_FIXTURE, a TSV file: sha, subject, comma-separated paths.
set -euo pipefail

runtime_paths() {
  local path runtime=0
  for path in "$@"; do
    [[ -n "$path" ]] || continue
    case "$path" in
      *.spec.ts|*.spec.tsx|*.test.ts|*.test.tsx) continue ;;
    esac
    case "$path" in
      src/*|functions/*) runtime=1 ;;
    esac
  done
  [[ "$runtime" -eq 1 ]]
}

emit() {
  local kind="$1" sha="$2" subject="$3"
  shift 3
  local paths="$*"
  printf '%s\t%s\t%s\t%s\n' "$kind" "$sha" "$subject" "$paths"
}

classify_one() {
  local sha="$1" subject="$2"
  shift 2
  if runtime_paths "$@"; then
    emit behavioral "$sha" "$subject" "$@"
  else
    emit infra "$sha" "$subject" "$@"
  fi
}

if [[ -n "${CLASSIFY_FIXTURE:-}" ]]; then
  while IFS=$'\t' read -r sha subject paths; do
    [[ -n "$sha" ]] || continue
    # shellcheck disable=SC2086
    classify_one "$sha" "$subject" ${paths//,/ }
  done <"$CLASSIFY_FIXTURE"
  exit 0
fi

prev="${1:-}"
sha="${2:-}"
[[ -n "$prev" && -n "$sha" ]] || { printf 'usage: classify-delta.sh <previous-tag> <sha>\n' >&2; exit 1; }

git log --no-merges --format='%H%x09%s' "$prev".."$sha" | while IFS=$'\t' read -r commit subject; do
  [[ -n "$commit" ]] || continue
  paths="$(git diff-tree --no-commit-id --name-only -r "$commit" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  classify_one "$commit" "$subject" $paths
done
