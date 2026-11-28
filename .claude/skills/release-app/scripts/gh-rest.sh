#!/usr/bin/env bash
# Release reads and edits through the REST API only.
#
# `gh release list` and `gh release view` go through GitHub's GraphQL API, and
# a Claude Code cloud session's GitHub proxy refuses GraphQL (403 "GitHub
# GraphQL is not available from Claude Code sessions"). The REST releases
# endpoint works everywhere and, unlike `releases/tags/{tag}`, also returns
# drafts, which have no git tag yet. Source this file; it expects $repo.

# All releases, newest first (the API's order), drafts included, as one JSON
# array. Fetched once per process.
rest_releases() {
  if [[ -z "${_REST_RELEASES_JSON:-}" ]]; then
    _REST_RELEASES_JSON="$(gh api --paginate "repos/$repo/releases?per_page=100" | jq -s 'add // []')" || return 1
  fi
  printf '%s\n' "$_REST_RELEASES_JSON"
}

# Forget the cached list (after an edit).
rest_releases_reset() { _REST_RELEASES_JSON=""; }

# One release by tag name (drafts included), as JSON; fails when absent.
rest_release_by_tag() {
  local tag="$1" json
  json="$(rest_releases | jq -c --arg t "$tag" '[.[] | select(.tag_name == $t)][0] // empty')" || return 1
  [[ -n "$json" ]] || return 1
  printf '%s\n' "$json"
}

# The newest published (non-draft) release tag ending in -<variant>, or empty.
rest_latest_published_tag() {
  local variant="$1"
  rest_releases | jq -r --arg s "-$variant" \
    '[.[] | select(.draft == false and (.tag_name | endswith($s)))][0].tag_name // empty'
}

# Published releases as tab-separated "tag<TAB>published_at", newest first.
rest_published_tsv() {
  rest_releases | jq -r '.[] | select(.draft == false) | [.tag_name, .published_at] | @tsv'
}

# A release's body (notes), raw text.
rest_release_body() {
  rest_release_by_tag "$1" | jq -r '.body // ""'
}

# Replace a release's body with the contents of a file. With "publish" as the
# third argument it also publishes a draft (draft: false), like
# `gh release edit --draft=false`.
rest_release_edit() {
  local tag="$1" notes_file="$2" mode="${3:-}" id
  id="$(rest_release_by_tag "$tag" | jq -r '.id')" || return 1
  [[ -n "$id" && "$id" != "null" ]] || return 1
  if [[ "$mode" == "publish" ]]; then
    jq -n --rawfile b "$notes_file" '{body: $b, draft: false}'
  else
    jq -n --rawfile b "$notes_file" '{body: $b}'
  fi | gh api -X PATCH "repos/$repo/releases/$id" --input - >/dev/null || return 1
  rest_releases_reset
}
