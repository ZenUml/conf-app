#!/usr/bin/env bash
# Audit an Atlassian Marketplace Privacy & Security questionnaire for a ZenUML app
# via the PUBLIC REST endpoint (no auth). Prints the live SUBMITTED/APPROVED state
# and flags deviations from the canonical target.
#
# Usage:  verify-ps.sh <variant|appKey> [--json]
#   variant : lite | full | diagramly | asyncapi   (or pass a raw appKey)
#   --json  : dump the full raw JSON instead of the field summary
#
# `formStatus`: SUBMITTED = awaiting Atlassian review; APPROVED = last approved answers
# (if you just edited and it still says APPROVED with old values, your change did NOT land).
# This endpoint is the authoritative post-edit check. It is NOT the same as the listing
# JSON's endUserLicenseAgreementUrl, which is dormant/stale — never judge the EULA from that.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

arg="${1:-}"
[ -z "$arg" ] && { echo "usage: verify-ps.sh <lite|full|diagramly|asyncapi|appKey> [--json]"; exit 2; }

case "$arg" in
  lite)      KEY="com.zenuml.confluence-addon-lite"; SUBS=5 ;;
  full)      KEY="com.zenuml.confluence-addon";      SUBS=5 ;;
  diagramly) KEY="gptdock-confluence";               SUBS=5 ;;
  asyncapi)  KEY="my-api";                           SUBS=4 ;;  # no PlantUML (sequence macro stripped)
  *)         KEY="$arg";                             SUBS=0 ;;  # raw appKey; unknown expected sub count
esac

URL="https://marketplace.atlassian.com/rest/2/addons/${KEY}/privacy-and-security?cb=${RANDOM}${RANDOM}"
JSON="$(curl -s "$URL")"
[ -z "$JSON" ] && { echo "empty response for $KEY"; exit 1; }

if [ "${2:-}" = "--json" ]; then echo "$JSON" | python3 -m json.tool; exit 0; fi
echo "$JSON" | python3 "$here/_summarize_ps.py" "$KEY" "$SUBS"
