#!/usr/bin/env bash
# Pick the draft release a production release of <variant> should publish.
#
# Only drafts created after the variant's latest published release are candidates.
#
#   diagramly / asyncapi  newest draft (no prerequisite; caller still applies 24 h freshness)
#   lite                  newest draft whose commit matches a PUBLISHED diagramly release
#   full                  newest draft whose commit matches a PUBLISHED lite release
#
# The canary chain ships one commit through diagramly -> lite -> full, so the right
# lite/full draft is the one built from the already-published prerequisite commit,
# not the newest one: merges after the canary keep producing newer drafts that no
# prerequisite has validated. This script only selects; check-prerequisite.sh still
# enforces the gate (including the 7-day full soak).
#
# Output: `SELECT: <tag> <sha> [matches <prerequisite-tag>]` (exit 0), one
# `SKIP: <tag> <sha> — <reason>` line per newer draft passed over, or
# `NONE: <reason>` (exit 1).
# Test: bash select-draft.test.sh (set RELEASES_JSON_FILE to read a fixture offline).

set -euo pipefail

repo="${RELEASE_REPO:-ZenUml/conf-app}"

case "${1:-}" in
  diagramly|dia) variant="diagramly" ;;
  lite) variant="lite" ;;
  full) variant="full" ;;
  asyncapi|async|api) variant="asyncapi" ;;
  *) printf 'NONE: variant must be diagramly (or dia), lite, full, or asyncapi (or async/api)\n'; exit 1 ;;
esac

if [[ -n "${RELEASES_JSON_FILE:-}" ]]; then
  releases="$(cat "$RELEASES_JSON_FILE")"
else
  # The releases API (unlike `gh release list`) returns target_commitish for drafts.
  releases="$(gh api --paginate "repos/$repo/releases?per_page=100" | jq -s 'add')" \
    || { printf 'NONE: could not list releases for %s\n' "$repo"; exit 1; }
fi

# Drafts are pinned to a full commit SHA by the build. Only pinned releases can
# match: legacy releases that target a branch name (e.g. "main") predate pinning
# and are never a prerequisite for a current draft, so they are ignored rather
# than resolved one API call at a time.
pinned='select(.target_commitish | test("^[0-9a-fA-F]{40}$"))'

# The API lists all drafts before all published releases, so order by created_at.
releases="$(jq 'sort_by(.created_at) | reverse' <<<"$releases")"

# Candidate drafts: newest first, and only those created AFTER this
# variant's latest published release. An older draft would roll production back
# even when its commit matches an old published prerequisite.
latest_published="$(jq -r --arg v "-$variant" \
  'first(.[] | select((.draft | not) and (.tag_name | endswith($v))) | .tag_name) // empty' \
  <<<"$releases")"
drafts="$(jq -r --arg v "-$variant" \
  "[.[] | select(.tag_name | endswith(\$v))] | (map(.draft | not) | index(true)) as \$cut
   | (if \$cut == null then . else .[:\$cut] end) | .[] | $pinned | [.tag_name, (.target_commitish | ascii_downcase)] | @tsv" \
  <<<"$releases")"
if [[ -z "$drafts" ]]; then
  if [[ -n "$latest_published" ]]; then
    printf 'NONE: no %s draft newer than published %s\n' "$variant" "$latest_published"
  else
    printf 'NONE: no %s draft exists\n' "$variant"
  fi
  exit 1
fi

case "$variant" in
  diagramly|asyncapi)
    IFS=$'\t' read -r tag sha <<<"$(head -n1 <<<"$drafts")"
    printf 'SELECT: %s %s\n' "$tag" "$sha"
    exit 0
    ;;
  lite) prerequisite="diagramly" ;;
  full) prerequisite="lite" ;;
esac

# "<sha>\t<tag>" for published prerequisite releases, newest first.
published="$(jq -r --arg v "-$prerequisite" \
  ".[] | select((.draft | not) and (.tag_name | endswith(\$v))) | $pinned | [(.target_commitish | ascii_downcase), .tag_name] | @tsv" \
  <<<"$releases")"

while IFS=$'\t' read -r tag sha; do
  match="$(awk -F'\t' -v sha="$sha" '$1 == sha { print $2; exit }' <<<"$published")"
  if [[ -n "$match" ]]; then
    printf 'SELECT: %s %s matches %s\n' "$tag" "$sha" "$match"
    exit 0
  fi
  printf 'SKIP: %s %s — no published %s release at this commit\n' "$tag" "$sha" "$prerequisite"
done <<<"$drafts"

printf 'NONE: no %s draft newer than published %s matches a published %s release\n' "$variant" "${latest_published:-<none>}" "$prerequisite"
exit 1
