#!/bin/bash
# Run the full 4-condition load-time matrix (throttle x cache) against one Confluence page.
#
# Usage:
#   STORAGE_STATE=/path/to/storage-state.json \
#   tools/perf/run-matrix.sh <pageUrl> <outDir> <expectedMacroFrames> <labelPrefix>
#
# storage-state.json = Playwright storageState with logged-in Atlassian cookies.
# Export one from an authenticated Playwright context:
#   await context.storageState({ path: 'storage-state.json' })
set -eu
cd "$(dirname "$0")/../.."
URL="$1"; OUT="$2"; EXPECT="$3"; PREFIX="$4"
: "${STORAGE_STATE:?set STORAGE_STATE to a Playwright storage-state.json with Atlassian login}"
run() {
  node tools/perf/measure-page-load.mjs \
    --url "$URL" --runs 3 --expect "$EXPECT" --out "$OUT" \
    --storage "$STORAGE_STATE" \
    --label "$PREFIX-$1" --throttle "$2" --cache "$3" --timeout "$4"
}
run none-cold none   cold 120000
run none-warm none   warm 120000
run 4g-cold   fast4g cold 300000
run 4g-warm   fast4g warm 300000
echo "=== MATRIX DONE: $PREFIX ==="
