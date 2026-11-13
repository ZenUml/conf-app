#!/usr/bin/env bash
# Offline test for check-prerequisite.sh. Run: bash .claude/skills/release-app/scripts/check-prerequisite.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

OLD=13135a40a2456e0f29d4ab50e80da258e18d4c67
NEW=6c4eef4a764a4d2dc15501366b4a1aa0bbd7a7c9
NEXT=dddddddddddddddddddddddddddddddddddddddd

# Stubs for `gh` and `git`, answering from the tables below. An unlisted query fails.
#   $work/releases  "<tag> <isDraft> <sha> <publishedAt|->" per line
#   $work/compare   "<base> <head> <status>" per line
mkdir "$work/bin"
cat >"$work/bin/gh" <<STUB
#!/usr/bin/env bash
case "\$1 \$2" in
  "release view")
    line="\$(awk -v t="\$3" '\$1 == t' "$work/releases")"
    [[ -n "\$line" ]] || exit 1
    read -r tag draft sha _ <<<"\$line"
    if [[ "\$*" == *"--jq"* ]]; then echo "\$sha"; else
      printf '{"isDraft":%s,"tagName":"%s","targetCommitish":"%s"}\n' "\$draft" "\$tag" "\$sha"
    fi ;;
  "release list")
    awk '\$2 == "false" { printf "%s{\"tagName\":\"%s\",\"publishedAt\":\"%s\"}", s, \$1, \$4; s="," } BEGIN { printf "[" } END { print "]" }' "$work/releases" ;;
  "api repos/"*"/commits/"*) echo "\${2##*/commits/}" ;;
  "api repos/"*"/compare/"*)
    range="\${2##*/compare/}"
    status="\$(awk -v b="\${range%%...*}" -v h="\${range##*...}" '\$1 == b && \$2 == h { print \$3; exit }' "$work/compare")"
    [[ -n "\$status" ]] || exit 1
    echo "\$status" ;;
  *) exit 1 ;;
esac
STUB
cat >"$work/bin/git" <<STUB
#!/usr/bin/env bash
case "\$1" in
  fetch) exit 0 ;;
  rev-parse) awk -v t="\${3%%^*}" '\$1 == t && \$2 == "false" { print \$3; found=1 } END { exit !found }' "$work/releases" ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$work/bin/gh" "$work/bin/git"
PATH="$work/bin:$PATH"

fail=0
check() {
  local name="$1" variant="$2" tag="$3" expected_status="$4" expected_line="$5"
  local out status
  out="$(bash "$here/check-prerequisite.sh" "$variant" "$tag" 2>&1)"
  status=$?
  if [[ "$status" != "$expected_status" ]] || ! grep -qF -- "$expected_line" <<<"$out"; then
    printf 'FAIL %s: exit %s (want %s)\n%s\n' "$name" "$status" "$expected_status" "$out"
    fail=1
  else
    printf 'ok   %s\n' "$name"
  fi
}

# Regression, observed 2026-11-07: the 071048 drafts are older than the live 071119
# releases, and their Lite/Full forms also match a published prerequisite at OLD.
cat >"$work/releases" <<TABLE
v2026.11.071048-diagramly true $OLD -
v2026.11.071048-lite true $OLD -
v2026.11.071048-full true $OLD -
v2026.11.071048-asyncapi true $OLD -
v2026.11.071119-diagramly false $NEW 2026-11-07T01:32:29Z
v2026.11.071119-lite false $NEW 2026-11-07T01:42:53Z
v2026.11.071119-full false $NEW 2026-11-05T12:32:10Z
v2026.11.071119-asyncapi false $NEW 2026-11-07T02:00:00Z
v2026.11.071030-diagramly false $OLD 2026-11-07T00:10:00Z
v2026.11.071031-lite false $OLD 2026-11-05T00:20:00Z
v2026.11.080900-diagramly true $OLD -
v2026.11.081000-diagramly true $NEW -
v2026.11.081100-diagramly true $NEXT -
v2026.11.081100-lite true $NEW -
v2026.11.081100-asyncapi true $NEXT -
TABLE
cat >"$work/compare" <<TABLE
$NEW $OLD behind
$NEW $NEW identical
$NEW $NEXT ahead
TABLE

check "incident: diagramly older than live is blocked" diagramly v2026.11.071048-diagramly 1 "BLOCK: v2026.11.071048-diagramly is not newer than live v2026.11.071119-diagramly"
check "incident: lite blocked despite matching Diagramly" lite v2026.11.071048-lite 1 "BLOCK: v2026.11.071048-lite is not newer than live v2026.11.071119-lite"
check "incident: full blocked despite matching Lite" full v2026.11.071048-full 1 "BLOCK: v2026.11.071048-full is not newer than live v2026.11.071119-full"
check "incident: asyncapi blocked" asyncapi v2026.11.071048-asyncapi 1 "BLOCK: v2026.11.071048-asyncapi is not newer than live v2026.11.071119-asyncapi"
check "re-run: newer tag on an older commit is blocked" diagramly v2026.11.080900-diagramly 1 "commit is behind vs live"
check "rebuild of the live commit is blocked" diagramly v2026.11.081000-diagramly 1 "commit is identical vs live"
check "a newer commit passes" diagramly v2026.11.081100-diagramly 0 "OK: v2026.11.081100-diagramly targets pinned commit $NEXT"
check "asyncapi newer commit passes" asyncapi v2026.11.081100-asyncapi 0 "OK: v2026.11.081100-asyncapi"

# Lite ahead of its own live release, at a commit Diagramly already shipped.
sed -i.bak '/^v2026.11.071119-lite /d' "$work/releases"
printf '%s %s ahead\n' "$OLD" "$NEW" >>"$work/compare"
check "lite ahead of live and matching Diagramly passes" lite v2026.11.081100-lite 0 "OK: v2026.11.081100-lite and v2026.11.071119-diagramly target $NEW"

: >"$work/compare"
check "comparison failure fails closed" diagramly v2026.11.081100-diagramly 1 "BLOCK: could not compare"

exit "$fail"
