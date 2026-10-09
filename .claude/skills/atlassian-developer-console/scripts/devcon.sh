#!/bin/zsh
# Developer Console driver: runs agent-browser against the dedicated
# support@zenuml.com Atlassian Developer Console profile with a fixed session.
# It forwards exactly one agent-browser subcommand per call and nothing else,
# so a Bash permission rule can be scoped to this script alone:
#   Bash(.claude/skills/atlassian-developer-console/scripts/devcon.sh *)
#
# Usage:
#   .claude/skills/atlassian-developer-console/scripts/devcon.sh open <url>
#   .claude/skills/atlassian-developer-console/scripts/devcon.sh snapshot -c
#   .claude/skills/atlassian-developer-console/scripts/devcon.sh click @e12
#   .claude/skills/atlassian-developer-console/scripts/devcon.sh close
#
# Reads: ~/.agent-browser/profiles/atlassian-developer-console (never a tenant site).
# Writes: only what the forwarded agent-browser subcommand does in that browser.
set -euo pipefail

AB_BIN="$(readlink /usr/local/bin/agent-browser || true)"
[[ -n "$AB_BIN" ]] || AB_BIN="/usr/local/bin/agent-browser"
PROFILE="$HOME/.agent-browser/profiles/atlassian-developer-console"
SESSION="${DEVCON_SESSION:-atlassian-dev-console}"

[[ $# -ge 1 ]] || { echo "usage: devcon.sh <agent-browser subcommand> [args...]" >&2; exit 2; }
[[ -d "$PROFILE" ]] || { echo "profile missing: $PROFILE" >&2; exit 3; }

exec "$AB_BIN" --session "$SESSION" --profile "$PROFILE" "$@"
