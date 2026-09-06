#!/usr/bin/env bash

set -euo pipefail

repo="${RELEASE_REPO:-ZenUml/conf-app}"
requested_variant="${1:-}"
draft_tag="${2:-}"

block() {
  printf 'BLOCK: %s\n' "$*"
  exit 1
}

case "$requested_variant" in
  diagramly|dia) variant="diagramly" ;;
  lite) variant="lite" ;;
  full) variant="full" ;;
  asyncapi|async|api) variant="asyncapi" ;;
  *) block "variant must be diagramly (or dia), lite, full, or asyncapi (or async/api)" ;;
esac

[[ -n "$draft_tag" ]] || block "draft tag is required"

release_json="$(gh release view "$draft_tag" --repo "$repo" \
  --json isDraft,tagName,targetCommitish 2>/dev/null)" \
  || block "$draft_tag not found"

[[ "$(jq -r '.isDraft' <<<"$release_json")" == "true" ]] \
  || block "$draft_tag is already published"

draft_target="$(jq -r '.targetCommitish' <<<"$release_json")"
[[ "$draft_target" =~ ^[0-9a-fA-F]{40}$ ]] \
  || block "$draft_tag targetCommitish '$draft_target' is not a full commit SHA — pin the draft before publishing"

draft_sha="$(gh api "repos/$repo/commits/$draft_target" --jq '.sha' 2>/dev/null)" \
  || block "$draft_tag target commit $draft_target does not resolve"
normalized_draft_sha="$(tr '[:upper:]' '[:lower:]' <<<"$draft_sha")"
normalized_draft_target="$(tr '[:upper:]' '[:lower:]' <<<"$draft_target")"
[[ "$normalized_draft_sha" == "$normalized_draft_target" ]] \
  || block "$draft_tag target $draft_target did not resolve to the same commit SHA"

case "$variant" in
  diagramly|asyncapi)
    printf 'OK: %s targets pinned commit %s and has no prerequisite\n' "$draft_tag" "$draft_sha"
    exit 0
    ;;
  lite) prerequisite_variant="diagramly" ;;
  full) prerequisite_variant="lite" ;;
esac

matching_tag=""
matching_published_at=""
published_releases="$(gh release list --repo "$repo" --exclude-drafts --limit 1000 \
  --json tagName,publishedAt)" \
  || block "could not list published $prerequisite_variant releases"
git fetch --tags --quiet origin \
  || block "could not fetch release tags from origin"
while IFS=$'\t' read -r tag published_at; do
  [[ -n "$tag" ]] || continue
  prerequisite_sha="$(git rev-parse --verify "$tag^{commit}" 2>/dev/null)" \
    || block "could not resolve published prerequisite tag $tag to a commit SHA"
  normalized_prerequisite_sha="$(tr '[:upper:]' '[:lower:]' <<<"$prerequisite_sha")"
  if [[ "$normalized_prerequisite_sha" == "$normalized_draft_sha" ]]; then
    matching_tag="$tag"
    matching_published_at="$published_at"
    break
  fi
done < <(
  jq -r ".[] | select(.tagName | endswith(\"-$prerequisite_variant\")) | [.tagName, .publishedAt] | @tsv" \
    <<<"$published_releases"
)

[[ -n "$matching_tag" ]] \
  || block "no published $prerequisite_variant release targets commit $draft_sha"

if [[ "$variant" == "full" ]]; then
  published_epoch="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$matching_published_at" '+%s' 2>/dev/null \
    || date -u -d "$matching_published_at" '+%s' 2>/dev/null)" \
    || block "could not parse publishedAt for $matching_tag: $matching_published_at"
  now_epoch="$(date -u '+%s')"
  age_seconds=$((now_epoch - published_epoch))
  if (( age_seconds < 604800 )); then
    remaining_seconds=$((604800 - age_seconds))
    remaining_days="$(awk -v seconds="$remaining_seconds" 'BEGIN { printf "%.2f", seconds / 86400 }')"
    block "$matching_tag targets $draft_sha but has soaked for < 7 days; $remaining_days days remain"
  fi
  printf 'OK: %s and %s target %s; lite soak is >= 7 days\n' "$draft_tag" "$matching_tag" "$draft_sha"
else
  printf 'OK: %s and %s target %s\n' "$draft_tag" "$matching_tag" "$draft_sha"
fi
