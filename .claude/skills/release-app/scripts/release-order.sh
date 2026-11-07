# Sourced by select-draft.sh and check-prerequisite.sh: is a draft truly newer than
# what its variant has live? Publishing an older one would roll production back.
#
# Never order releases by created_at. GitHub rewrites it to the target commit's date on
# publish (every pinned published release has created_at == commit date; no draft does),
# so a draft built before a published release can still sort after it.
#
# Both tests below must hold. The tag holds the build time (Brisbane, zero-padded, so it
# sorts as text), but re-running an old workflow puts a new tag on an old commit, so the
# commit must also be strictly ahead. A rebuild of the live commit ships nothing new.

# draft_order <repo> <draft-tag> <draft-sha> <live-tag> <live-target>
# Exit 0: newer. Exit 1: not newer, reason on stdout. Exit 2: undetermined, reason on stdout.
draft_order() {
  local repo="$1" draft_tag="$2" draft_sha="$3" live_tag="$4" live_target="$5"
  local LC_ALL=C status

  if [[ ! "$draft_tag" > "$live_tag" ]]; then
    printf 'tag does not sort after live %s' "$live_tag"
    return 1
  fi

  if [[ ! "$live_target" =~ ^[0-9a-fA-F]{40}$ ]]; then
    printf 'could not compare %s with live %s: its target %s is not a commit SHA' \
      "$draft_tag" "$live_tag" "$live_target"
    return 2
  fi

  status="$(gh api "repos/$repo/compare/$live_target...$draft_sha" --jq '.status' 2>/dev/null)" || status=""
  case "$status" in
    ahead) return 0 ;;
    behind|identical|diverged)
      printf 'commit is %s vs live %s' "$status" "$live_tag"
      return 1
      ;;
    *)
      printf 'could not compare %s with live %s (%s...%s)' \
        "$draft_tag" "$live_tag" "$live_target" "$draft_sha"
      return 2
      ;;
  esac
}
