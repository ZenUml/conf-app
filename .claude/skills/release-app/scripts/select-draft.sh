#!/usr/bin/env bash
# Pick the draft release a production release of <variant> should publish.
#
# Only drafts truly newer than the variant's live release are candidates: tagged after
# it and with a commit strictly ahead of it (release-order.sh). An older draft would roll
# production back even when its commit matches an old published prerequisite.
#
#   diagramly / asyncapi  newest draft (no prerequisite; caller still applies 24 h freshness)
#   lite                  newest draft whose commit matches a PUBLISHED diagramly release
#   full                  newest draft whose commit matches a PUBLISHED lite release
#
# The canary chain ships one commit through diagramly -> lite -> full, so the right
# lite/full draft is the one built from the already-published prerequisite commit,
# not the newest one: merges after the canary keep producing newer drafts that no
# prerequisite has validated. This script only selects; check-prerequisite.sh still
# enforces the gate (including the 24-hour full soak).
#
# Output: `SELECT: <tag> <sha> [matches <prerequisite-tag>]` (exit 0), one
# `SKIP: <tag> <sha> — <reason>` line per newer draft passed over, or
# `NONE: <reason>` (exit 1), including when a comparison fails: this fails closed.
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

# shellcheck source=release-order.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-order.sh"

# Newest build first: the tag holds the build time. See release-order.sh for why
# created_at cannot be used, and why the commit is compared as well.
releases="$(jq 'sort_by(.tag_name) | reverse' <<<"$releases")"

# What is live is the variant's most recently published release.
IFS=$'\t' read -r live_tag live_target <<<"$(jq -r --arg v "-$variant" \
  '[.[] | select((.draft | not) and (.tag_name | endswith($v)))] | sort_by(.published_at) | last
   | if . == null then empty else [.tag_name, .target_commitish] | @tsv end' \
  <<<"$releases")"

# Candidates: pinned drafts tagged after the live release. draft_order below then
# requires the commit to be ahead of it too.
drafts="$(jq -r --arg v "-$variant" --arg live "$live_tag" \
  ".[] | select(.draft and (.tag_name | endswith(\$v)) and (\$live == \"\" or .tag_name > \$live)) | $pinned
   | [.tag_name, (.target_commitish | ascii_downcase)] | @tsv" \
  <<<"$releases")"
if [[ -z "$drafts" ]]; then
  if [[ -n "$live_tag" ]]; then
    printf 'NONE: no %s draft newer than published %s\n' "$variant" "$live_tag"
  else
    printf 'NONE: no %s draft exists\n' "$variant"
  fi
  exit 1
fi

case "$variant" in
  diagramly|asyncapi) prerequisite="" ;;
  lite) prerequisite="diagramly" ;;
  full) prerequisite="lite" ;;
esac

# "<sha>\t<tag>" for published prerequisite releases, newest first.
published=""
if [[ -n "$prerequisite" ]]; then
  published="$(jq -r --arg v "-$prerequisite" \
    ".[] | select((.draft | not) and (.tag_name | endswith(\$v))) | $pinned | [(.target_commitish | ascii_downcase), .tag_name] | @tsv" \
    <<<"$releases")"
fi

while IFS=$'\t' read -r tag sha; do
  match=""
  if [[ -n "$prerequisite" ]]; then
    match="$(awk -F'\t' -v sha="$sha" '$1 == sha { print $2; exit }' <<<"$published")"
    if [[ -z "$match" ]]; then
      printf 'SKIP: %s %s — no published %s release at this commit\n' "$tag" "$sha" "$prerequisite"
      continue
    fi
  fi

  if [[ -n "$live_tag" ]]; then
    order=0
    reason="$(draft_order "$repo" "$tag" "$sha" "$live_tag" "$live_target")" || order=$?
    if (( order == 2 )); then
      printf 'NONE: %s\n' "$reason"
      exit 1
    elif (( order == 1 )); then
      printf 'SKIP: %s %s — %s\n' "$tag" "$sha" "$reason"
      continue
    fi
  fi

  printf 'SELECT: %s %s%s\n' "$tag" "$sha" "${match:+ matches $match}"
  exit 0
done <<<"$drafts"

if [[ -n "$prerequisite" ]]; then
  printf 'NONE: no %s draft newer than published %s matches a published %s release\n' "$variant" "${live_tag:-<none>}" "$prerequisite"
else
  printf 'NONE: no %s draft newer than published %s\n' "$variant" "${live_tag:-<none>}"
fi
exit 1
