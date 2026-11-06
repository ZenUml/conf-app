#!/usr/bin/env bash
set -euo pipefail

AB_BIN=$(readlink /usr/local/bin/agent-browser)
SOURCE_PROFILE=${1:-Profile 8}
DEVCON_PROFILE=${ATLASSIAN_DEVELOPER_CONSOLE_PROFILE:-"$HOME/.agent-browser/profiles/atlassian-developer-console"}
SEED_SESSION="atlassian-dev-profile-seed-$$"
TARGET_SESSION="atlassian-dev-profile-target-$$"
TMP_DIR=$(mktemp -d /tmp/atlassian-dev-profile.XXXXXX)
RAW_STATE="$TMP_DIR/source.json"
FILTERED_STATE="$TMP_DIR/atlassian.json"
CONSOLE_URL='https://developer.atlassian.com/console/myapps/'

cleanup() {
  "$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" close >/dev/null 2>&1 || true
  "$AB_BIN" --session "$TARGET_SESSION" --profile "$DEVCON_PROFILE" close >/dev/null 2>&1 || true
  find "$TMP_DIR" -type f -delete 2>/dev/null || true
  rmdir "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

verify_account() {
  local session=$1
  local profile=$2
  local snapshot account_ref

  snapshot=$("$AB_BIN" --session "$session" --profile "$profile" snapshot -c)
  if ! grep -q 'heading "My apps' <<<"$snapshot"; then
    echo "Developer Console app list is unavailable; the profile may require login." >&2
    return 1
  fi

  account_ref=$(sed -n 's/.*button "Peng Xiao".*ref=\([^]]*\).*/\1/p' <<<"$snapshot" | head -1)
  if [[ -z "$account_ref" ]]; then
    echo "Could not locate the Developer Console account menu." >&2
    return 1
  fi

  "$AB_BIN" --session "$session" --profile "$profile" click "@$account_ref" >/dev/null
  snapshot=$("$AB_BIN" --session "$session" --profile "$profile" snapshot -c)
  if ! grep -q 'support@zenuml\.com' <<<"$snapshot"; then
    echo "Developer Console is not signed in as support@zenuml.com." >&2
    return 1
  fi
}

"$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" open "$CONSOLE_URL" >/dev/null
"$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" wait 2500 >/dev/null
verify_account "$SEED_SESSION" "$SOURCE_PROFILE"
"$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" state save "$RAW_STATE" >/dev/null

jq '{
  cookies: [(.cookies // [])[] | select((.domain | ltrimstr(".")) as $d | ($d == "atlassian.com" or ($d | endswith(".atlassian.com"))))],
  origins: [(.origins // [])[] | select(.origin | test("^https://([^.]+\\.)*atlassian\\.com$"))]
}' "$RAW_STATE" > "$FILTERED_STATE"
chmod 600 "$FILTERED_STATE"

COOKIE_COUNT=$(jq '.cookies | length' "$FILTERED_STATE")
if [[ "$COOKIE_COUNT" -eq 0 ]]; then
  echo "No Atlassian-domain cookies found in the source Chrome profile." >&2
  exit 1
fi

mkdir -p "$DEVCON_PROFILE"
chmod 700 "$DEVCON_PROFILE"

"$AB_BIN" --session "$TARGET_SESSION" --profile "$DEVCON_PROFILE" open about:blank >/dev/null
"$AB_BIN" --session "$TARGET_SESSION" --profile "$DEVCON_PROFILE" state load "$FILTERED_STATE" >/dev/null
"$AB_BIN" --session "$TARGET_SESSION" --profile "$DEVCON_PROFILE" open "$CONSOLE_URL" >/dev/null
"$AB_BIN" --session "$TARGET_SESSION" --profile "$DEVCON_PROFILE" wait 2500 >/dev/null
verify_account "$TARGET_SESSION" "$DEVCON_PROFILE"

echo "Persistent Atlassian Developer Console profile refreshed at $DEVCON_PROFILE ($COOKIE_COUNT domain-scoped cookies)."
