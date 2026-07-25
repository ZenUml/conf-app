#!/usr/bin/env bash
set -uo pipefail

# Retry a Forge CLI command, but ONLY when it died on a transient network fault.
#
# `forge deploy` runs `forge lint`, which fetches Atlassian's swagger/OpenAPI
# JSON over node-fetch. Those fetches drop intermittently and take the whole
# deploy with them:
#
#   Error: request to https://developer.atlassian.com/cloud/jira/software/swagger.v3.json
#   failed, reason: read ECONNRESET
#
# Pinning the Forge CLI steps to Node 20 (see the setup-node step in
# staging-deploy.yml / release.yml) fixed the "Premature close" variant of this
# on Node 22+, but does nothing for ECONNRESET / socket hang up — the socket is
# dropped upstream, not mangled by node-fetch. Until Atlassian migrates off
# node-fetch, retry the command instead of burning a manual re-run.
# https://community.developer.atlassian.com/t/forge-lint-deploy-issue-with-node-js-22/101420
#
# Deliberately narrow: only failures whose output matches TRANSIENT are retried.
# A manifest error, a lint rule violation, or an auth failure must still fail on
# the first attempt — retrying those just triples the time to a red build.
#
# Usage:  scripts/forge-retry.sh pnpm forge:deploy:lite:staging
# Tuning: FORGE_RETRY_ATTEMPTS (default 3), FORGE_RETRY_BASE_DELAY (default 10s)

TRANSIENT='ECONNRESET|Premature close|socket hang up|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|network socket disconnected|Client network socket disconnected|502 Bad Gateway|503 Service Unavailable|504 Gateway'

MAX_ATTEMPTS="${FORGE_RETRY_ATTEMPTS:-3}"
BASE_DELAY="${FORGE_RETRY_BASE_DELAY:-10}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

attempt=1
while :; do
  if [ "$attempt" -gt 1 ]; then
    echo "--- attempt ${attempt}/${MAX_ATTEMPTS}: $* ---"
  fi

  "$@" 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"

  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if ! grep -Eq "$TRANSIENT" "$log"; then
    echo "::error::'$*' failed with exit ${status} and no transient-network signature; not retrying." >&2
    exit "$status"
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::'$*' still failing on a transient network fault after ${MAX_ATTEMPTS} attempt(s) (exit ${status})." >&2
    exit "$status"
  fi

  delay=$(( BASE_DELAY * attempt ))
  echo "::warning::Transient network fault on attempt ${attempt}/${MAX_ATTEMPTS} of '$*'; retrying in ${delay}s." >&2
  sleep "$delay"
  attempt=$(( attempt + 1 ))
done
