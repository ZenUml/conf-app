#!/usr/bin/env bash
# Offline test for select-draft.sh. Run: bash .claude/skills/release-app/scripts/select-draft.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Stub `gh` so the order gate's commit comparison runs offline. Answers come from
# $work/compare ("<base> <head> <status>" per line); an unlisted pair fails, like an API error.
mkdir "$work/bin"
cat >"$work/bin/gh" <<STUB
#!/usr/bin/env bash
range="\${2##*/compare/}"
status="\$(awk -v b="\${range%%...*}" -v h="\${range##*...}" '\$1 == b && \$2 == h { print \$3; exit }' "$work/compare")"
[[ -n "\$status" ]] || { echo "stub gh: no answer for \$*" >&2; exit 1; }
echo "\$status"
STUB
chmod +x "$work/bin/gh"
PATH="$work/bin:$PATH"

A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
C=cccccccccccccccccccccccccccccccccccccccc
D=dddddddddddddddddddddddddddddddddddddddd

fail=0
check() {
  local name="$1" variant="$2" expected_status="$3" expected_line="$4"
  local out status
  out="$(RELEASES_JSON_FILE="$work/releases" bash "$here/select-draft.sh" "$variant" 2>&1)"
  status=$?
  if [[ "$status" != "$expected_status" ]] || ! grep -qF -- "$expected_line" <<<"$out"; then
    printf 'FAIL %s: exit %s (want %s)\n%s\n' "$name" "$status" "$expected_status" "$out"
    fail=1
  else
    printf 'ok   %s\n' "$name"
  fi
}

# Mimics the GitHub releases API order: ALL drafts first, then published releases.
# Commit A shipped Diagramly + Lite; a later test-only merge B produced newer drafts;
# drafts at C predate A (C's Diagramly was published, its Lite never was).
cat >"$work/releases" <<JSON
[
  {"tag_name":"v3-full","draft":true,"target_commitish":"$B","created_at":"2026-10-02T09:00:00Z","published_at":null},
  {"tag_name":"v3-lite","draft":true,"target_commitish":"$B","created_at":"2026-10-02T09:00:00Z","published_at":null},
  {"tag_name":"v3-diagramly","draft":true,"target_commitish":"$B","created_at":"2026-10-02T09:00:00Z","published_at":null},
  {"tag_name":"v2-full","draft":true,"target_commitish":"$A","created_at":"2026-10-02T08:06:00Z","published_at":null},
  {"tag_name":"v1-full","draft":true,"target_commitish":"$C","created_at":"2026-09-28T00:00:00Z","published_at":null},
  {"tag_name":"v1-lite","draft":true,"target_commitish":"$C","created_at":"2026-09-28T00:00:00Z","published_at":null},
  {"tag_name":"v0-full","draft":true,"target_commitish":"main","created_at":"2026-07-01T00:00:00Z","published_at":null},
  {"tag_name":"v2-lite","draft":false,"target_commitish":"$A","created_at":"2026-10-02T08:02:00Z","published_at":"2026-10-02T08:20:38Z"},
  {"tag_name":"v2-diagramly","draft":false,"target_commitish":"$A","created_at":"2026-10-02T08:00:00Z","published_at":"2026-10-02T08:10:16Z"},
  {"tag_name":"v1-diagramly","draft":false,"target_commitish":"$C","created_at":"2026-09-28T00:00:00Z","published_at":"2026-09-28T01:00:00Z"},
  {"tag_name":"v0-lite","draft":false,"target_commitish":"main","created_at":"2026-07-01T00:00:00Z","published_at":"2026-07-01T01:00:00Z"}
]
JSON
printf '%s %s ahead\n' "$A" "$B" >"$work/compare"

check "full picks the draft matching published Lite, not the newest" full 0 "SELECT: v2-full $A"
check "full reports the newer unmatched draft as skipped"          full 0 "SKIP: v3-full $B"
check "lite never selects a draft older than the published Lite"    lite 1 "NONE: no lite draft newer than published v2-lite"
check "diagramly takes the newest draft"                            diagramly 0 "SELECT: v3-diagramly $B"
check "unpinned legacy releases never match"                      full 0 "SKIP: v3-full $B"
check "dia alias works"                                             dia 0 "SELECT: v3-diagramly $B"

# Regression, observed 2026-11-07. Publishing rewrites created_at to the target commit's
# date, so the published 071119 (commit pushed 00:48:56Z) sorts BEFORE the 071048 draft
# (built 00:58:18Z) even though 071048's commit is an ancestor of 071119's. Each variant
# lost the same way: Lite and Full also match a published prerequisite at the old commit.
OLD=13135a40a2456e0f29d4ab50e80da258e18d4c67
NEW=6c4eef4a764a4d2dc15501366b4a1aa0bbd7a7c9
cat >"$work/releases" <<JSON
[
  {"tag_name":"v2026.11.071048-diagramly","draft":true,"target_commitish":"$OLD","created_at":"2026-11-07T00:58:18Z","published_at":null},
  {"tag_name":"v2026.11.071048-lite","draft":true,"target_commitish":"$OLD","created_at":"2026-11-07T00:58:16Z","published_at":null},
  {"tag_name":"v2026.11.071048-full","draft":true,"target_commitish":"$OLD","created_at":"2026-11-07T00:58:17Z","published_at":null},
  {"tag_name":"v2026.11.071048-asyncapi","draft":true,"target_commitish":"$OLD","created_at":"2026-11-07T00:58:15Z","published_at":null},
  {"tag_name":"v2026.11.071119-diagramly","draft":false,"target_commitish":"$NEW","created_at":"2026-11-07T00:48:56Z","published_at":"2026-11-07T01:32:29Z"},
  {"tag_name":"v2026.11.071119-lite","draft":false,"target_commitish":"$NEW","created_at":"2026-11-07T00:48:56Z","published_at":"2026-11-07T01:42:53Z"},
  {"tag_name":"v2026.11.071119-full","draft":false,"target_commitish":"$NEW","created_at":"2026-11-07T00:48:56Z","published_at":"2026-11-08T02:00:00Z"},
  {"tag_name":"v2026.11.071119-asyncapi","draft":false,"target_commitish":"$NEW","created_at":"2026-11-07T00:48:56Z","published_at":"2026-11-07T02:00:00Z"},
  {"tag_name":"v2026.11.071030-diagramly","draft":false,"target_commitish":"$OLD","created_at":"2026-11-06T23:54:41Z","published_at":"2026-11-07T00:10:00Z"},
  {"tag_name":"v2026.11.071031-lite","draft":false,"target_commitish":"$OLD","created_at":"2026-11-06T23:54:41Z","published_at":"2026-11-07T00:20:00Z"}
]
JSON
: >"$work/compare"
check "incident: diagramly rejects the draft older than published" diagramly 1 "NONE: no diagramly draft newer than published v2026.11.071119-diagramly"
check "incident: lite rejects it despite a matching Diagramly"     lite 1 "NONE: no lite draft newer than published v2026.11.071119-lite"
check "incident: full rejects it despite a matching Lite"          full 1 "NONE: no full draft newer than published v2026.11.071119-full"
check "incident: asyncapi rejects it too"                          asyncapi 1 "NONE: no asyncapi draft newer than published v2026.11.071119-asyncapi"

# A re-run of an old workflow gets a NEW tag on an OLD commit, so tag order alone is not
# enough: the commit itself must be ahead of what is live.
cat >"$work/releases" <<JSON
[
  {"tag_name":"v2026.11.080900-diagramly","draft":true,"target_commitish":"$OLD","created_at":"2026-11-07T23:00:00Z","published_at":null},
  {"tag_name":"v2026.11.071119-diagramly","draft":false,"target_commitish":"$NEW","created_at":"2026-11-07T00:48:56Z","published_at":"2026-11-07T01:32:29Z"}
]
JSON
printf '%s %s behind\n' "$NEW" "$OLD" >"$work/compare"
check "re-run: newer tag on an older commit is skipped"            diagramly 1 "SKIP: v2026.11.080900-diagramly $OLD — commit is behind vs live v2026.11.071119-diagramly"
check "re-run: and nothing is selected"                            diagramly 1 "NONE: no diagramly draft newer than published"

printf '%s %s diverged\n' "$NEW" "$OLD" >"$work/compare"
check "diverged commit is skipped"                                 diagramly 1 "commit is diverged vs live"

: >"$work/compare"
check "comparison failure fails closed"                            diagramly 1 "NONE: could not compare"

# A rebuild of the live commit (newer tag, same SHA) ships nothing new, but passing over
# it must not stop the walk to the next real candidate.
cat >"$work/releases" <<JSON
[
  {"tag_name":"v2026.11.081000-diagramly","draft":true,"target_commitish":"$NEW","created_at":"2026-11-08T00:00:00Z","published_at":null},
  {"tag_name":"v2026.11.080900-diagramly","draft":true,"target_commitish":"$D","created_at":"2026-11-07T23:00:00Z","published_at":null},
  {"tag_name":"v2026.11.071119-diagramly","draft":false,"target_commitish":"$NEW","created_at":"2026-11-07T00:48:56Z","published_at":"2026-11-07T01:32:29Z"}
]
JSON
printf '%s %s identical\n%s %s ahead\n' "$NEW" "$NEW" "$NEW" "$D" >"$work/compare"
check "rebuild of the live commit is skipped"                      diagramly 0 "SKIP: v2026.11.081000-diagramly $NEW — commit is identical vs live"
check "walk continues to the next real candidate"                  diagramly 0 "SELECT: v2026.11.080900-diagramly $D"

# What is live is the most recently PUBLISHED release, whatever its tag says.
cat >"$work/releases" <<JSON
[
  {"tag_name":"v3-diagramly","draft":true,"target_commitish":"$C","created_at":"2026-10-03T00:00:00Z","published_at":null},
  {"tag_name":"v2-diagramly","draft":false,"target_commitish":"$B","created_at":"2026-10-02T00:00:00Z","published_at":"2026-10-02T01:00:00Z"},
  {"tag_name":"v1-diagramly","draft":false,"target_commitish":"$A","created_at":"2026-10-01T00:00:00Z","published_at":"2026-10-02T09:00:00Z"}
]
JSON
printf '%s %s ahead\n' "$A" "$C" >"$work/compare"
check "live is the last published, not the highest tag"            diagramly 0 "SELECT: v3-diagramly $C"

# An unpinned live release has no commit to compare against.
cat >"$work/releases" <<JSON
[
  {"tag_name":"v2-diagramly","draft":true,"target_commitish":"$B","created_at":"2026-10-02T00:00:00Z","published_at":null},
  {"tag_name":"v1-diagramly","draft":false,"target_commitish":"main","created_at":"2026-10-01T00:00:00Z","published_at":"2026-10-01T01:00:00Z"}
]
JSON
: >"$work/compare"
check "unpinned live release fails closed"                         diagramly 1 "NONE: could not compare"

# A variant's first release has nothing to roll back.
cat >"$work/releases" <<JSON
[
  {"tag_name":"v1-asyncapi","draft":true,"target_commitish":"$B","created_at":"2026-10-02T00:00:00Z","published_at":null}
]
JSON
check "first release of a variant needs no comparison"             asyncapi 0 "SELECT: v1-asyncapi $B"

exit "$fail"
