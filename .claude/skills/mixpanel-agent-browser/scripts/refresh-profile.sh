#!/usr/bin/env bash
set -euo pipefail

AB_BIN=$(readlink /usr/local/bin/agent-browser)
SOURCE_PROFILE=${1:-Profile 8}
MP_PROFILE=${MIXPANEL_AGENT_BROWSER_PROFILE:-"$HOME/.agent-browser/profiles/mixpanel"}
SEED_SESSION="mixpanel-profile-seed-$$"
TARGET_SESSION="mixpanel-profile-target-$$"
RAW_STATE=$(mktemp /tmp/mixpanel-state.XXXXXX)
FILTERED_STATE=$(mktemp /tmp/mixpanel-filtered-state.XXXXXX)

cleanup() {
  "$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" close >/dev/null 2>&1 || true
  "$AB_BIN" --session "$TARGET_SESSION" --profile "$MP_PROFILE" close >/dev/null 2>&1 || true
  rm -f "$RAW_STATE" "$FILTERED_STATE"
}
trap cleanup EXIT

"$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" \
  open 'https://mixpanel.com/project/3373228/view/3879592/app/home' >/dev/null

SEED_URL=$("$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" get url)
if [[ "$SEED_URL" == *'/request_access'* ]]; then
  echo "Source Chrome profile is not authenticated to Mixpanel." >&2
  exit 1
fi

"$AB_BIN" --session "$SEED_SESSION" --profile "$SOURCE_PROFILE" state save "$RAW_STATE" >/dev/null

jq '{
  cookies: [.cookies[] | select((.domain | ltrimstr(".")) == "mixpanel.com")],
  origins: [.origins[]? | select(.origin == "https://mixpanel.com")]
}' "$RAW_STATE" > "$FILTERED_STATE"
chmod 600 "$FILTERED_STATE"

COOKIE_COUNT=$(jq '.cookies | length' "$FILTERED_STATE")
if [[ "$COOKIE_COUNT" -eq 0 ]]; then
  echo "No Mixpanel cookies found in the source Chrome profile." >&2
  exit 1
fi

mkdir -p "$MP_PROFILE"
chmod 700 "$MP_PROFILE"

"$AB_BIN" --session "$TARGET_SESSION" --profile "$MP_PROFILE" open about:blank >/dev/null
"$AB_BIN" --session "$TARGET_SESSION" --profile "$MP_PROFILE" state load "$FILTERED_STATE" >/dev/null
"$AB_BIN" --session "$TARGET_SESSION" --profile "$MP_PROFILE" \
  open 'https://mixpanel.com/project/3373228/view/3879592/app/home' >/dev/null

TARGET_URL=$("$AB_BIN" --session "$TARGET_SESSION" --profile "$MP_PROFILE" get url)
if [[ "$TARGET_URL" == *'/request_access'* ]]; then
  echo "Mixpanel state import did not produce an authenticated profile." >&2
  exit 1
fi

echo "Persistent Mixpanel profile refreshed at $MP_PROFILE ($COOKIE_COUNT domain-scoped cookies)."
