#!/usr/bin/env bash
# Offline test for select-draft.sh. Run: bash .claude/skills/release-app/scripts/select-draft.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT

A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
C=cccccccccccccccccccccccccccccccccccccccc

# Mimics the GitHub releases API order: ALL drafts first, then published releases —
# not chronological, so the script must sort by created_at itself.
# Commit A shipped Diagramly + Lite; a later test-only merge B produced newer drafts;
# drafts at C predate A (C's Diagramly was published, its Lite never was).
cat >"$fixture" <<JSON
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

fail=0
check() {
  local name="$1" variant="$2" expected_status="$3" expected_line="$4"
  local out status
  out="$(RELEASES_JSON_FILE="$fixture" bash "$here/select-draft.sh" "$variant" 2>&1)"
  status=$?
  if [[ "$status" != "$expected_status" ]] || ! grep -qF -- "$expected_line" <<<"$out"; then
    printf 'FAIL %s: exit %s (want %s)\n%s\n' "$name" "$status" "$expected_status" "$out"
    fail=1
  else
    printf 'ok   %s\n' "$name"
  fi
}

check "full picks the draft matching published Lite, not the newest" full 0 "SELECT: v2-full $A"
check "full reports the newer unmatched draft as skipped"          full 0 "SKIP: v3-full $B"
check "lite never selects a draft older than the published Lite"    lite 1 "NONE: no lite draft newer than published v2-lite"
check "diagramly takes the newest draft"                            diagramly 0 "SELECT: v3-diagramly $B"
check "unpinned legacy releases never match"                      full 0 "SKIP: v3-full $B"
check "dia alias works"                                             dia 0 "SELECT: v3-diagramly $B"

exit "$fail"
