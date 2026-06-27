#!/usr/bin/env bash
#
# One-time batched cleanup for AnalyticsEventFact in a conf-zenuml-* D1 database.
#
# Why this exists:
#   AnalyticsEventFact grew to ~9.9 GB / 9.7M rows against D1's 10 GB hard cap.
#   ~88% of rows are dead `page_viewed` telemetry that stopped being written.
#   Those rows are mostly younger than the cron's age-based retention window, so
#   they must be drained explicitly. A single DELETE of millions of rows would
#   time out and bill a huge rows-written spike, so we delete in bounded batches
#   until the table stops shrinking.
#
# Observed against prod (2026-06-27): deleting the 8.5M-row backlog dropped the
# reported D1 size from 9.89 GB -> 3.49 GB right away — D1 reclaims space after
# deletes, no VACUUM/support ticket needed.
#
# Usage:
#   scripts/purge-analytics-fact-backlog.sh [--env prod|stg] [--event NAME] \
#       [--batch N] [--dry-run] [--yes]
#
# Examples:
#   # Count what would be deleted, no writes:
#   scripts/purge-analytics-fact-backlog.sh --env prod --event page_viewed --dry-run
#
#   # Drain the page_viewed backlog from prod, 50k rows per batch:
#   scripts/purge-analytics-fact-backlog.sh --env prod --event page_viewed
#
set -euo pipefail

ENV="prod"
EVENT="page_viewed"
BATCH=50000
DRY_RUN=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      ENV="$2"; shift 2 ;;
    --event)    EVENT="$2"; shift 2 ;;
    --batch)    BATCH="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$ENV" in
  prod) CONFIG="wrangler-prod.toml"; DB="conf-zenuml-prod" ;;
  stg)  CONFIG="wrangler-stg.toml";  DB="conf-zenuml-stg"  ;;
  *) echo "--env must be prod or stg" >&2; exit 2 ;;
esac

# Resolve repo root so the script works from any cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Reject anything but a bare event name to keep it safe to interpolate into SQL.
if [[ ! "$EVENT" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Refusing unsafe --event value: $EVENT" >&2
  exit 2
fi

run_sql() { # $1 = SQL; echoes JSON
  wrangler d1 execute "$DB" --config "$CONFIG" --remote --json --command "$1" 2>/dev/null
}

json_first_meta() { # $1 = json, $2 = meta key -> value
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['meta'].get('$2',''))" <<<"$1"
}
json_first_result() { # $1 = json, $2 = column -> value of first row
  python3 -c "import sys,json; d=json.load(sys.stdin); r=d[0]['results']; print(r[0].get('$2','') if r else '')" <<<"$1"
}

echo "Target: $DB  (config: $CONFIG)"
echo "Event:  $EVENT"

remaining_json="$(run_sql "SELECT COUNT(*) AS n FROM AnalyticsEventFact WHERE event = '$EVENT';")"
REMAINING="$(json_first_result "$remaining_json" n)"
echo "Rows matching event='$EVENT': ${REMAINING:-unknown}"

if [[ "${REMAINING:-0}" == "0" ]]; then
  echo "Nothing to delete. Done."
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] Would delete $REMAINING rows in batches of $BATCH. No writes performed."
  exit 0
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  read -r -p "Delete $REMAINING rows from $DB in batches of $BATCH? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

TOTAL=0
BATCH_NO=0
while :; do
  BATCH_NO=$((BATCH_NO + 1))
  # D1's SQLite is not built with DELETE ... LIMIT, so bound via an id subquery.
  out="$(run_sql "DELETE FROM AnalyticsEventFact WHERE id IN (SELECT id FROM AnalyticsEventFact WHERE event = '$EVENT' LIMIT $BATCH);")"
  CHANGES="$(json_first_meta "$out" changes)"
  CHANGES="${CHANGES:-0}"
  TOTAL=$((TOTAL + CHANGES))
  printf 'batch %3d: deleted %-8s (total %d)\n' "$BATCH_NO" "$CHANGES" "$TOTAL"
  [[ "$CHANGES" -lt "$BATCH" ]] && break
done

echo "Done. Deleted $TOTAL rows for event='$EVENT' from $DB."
echo "Note: reported D1 size may not drop until D1 compacts; freed pages are reused by new writes."
