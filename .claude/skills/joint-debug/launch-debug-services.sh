#!/bin/bash

set -euo pipefail

# Open the five joint-debug services in separate macOS Terminal windows.
# Usage:
#   ./launch-debug-services.sh
#   ./launch-debug-services.sh <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH> [LOCAL_DATABASE_URL]

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [ "$#" -eq 0 ]; then
    WRANGLER_CONFIG="$WORKSPACE_DIR/wrangler.toml"
    DIAGRAMLY_PATH="$WORKSPACE_DIR/../diagramly.ai"

    if [ ! -f "$WRANGLER_CONFIG" ]; then
        echo "ERROR: wrangler.toml was not found: $WRANGLER_CONFIG" >&2
        exit 1
    fi

    NGROK_AUTHTOKEN="$(sed -nE 's/^[[:space:]]*NGROK_AUTHTOKEN[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$WRANGLER_CONFIG" | head -n 1)"
    NGROK_DOMAIN="$(sed -nE 's/^[[:space:]]*NGROK_DOMAIN[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$WRANGLER_CONFIG" | head -n 1)"
    DIAGRAMLY_DATABASE_URL=""
elif [ "$#" -ge 3 ] && [ "$#" -le 4 ]; then
    NGROK_AUTHTOKEN="$1"
    NGROK_DOMAIN="$2"
    DIAGRAMLY_PATH="$3"
    DIAGRAMLY_DATABASE_URL="${4:-}"
else
    echo "Usage: $0"
    echo "   or: $0 <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH> [LOCAL_DATABASE_URL]"
    exit 1
fi

if [ -z "$NGROK_AUTHTOKEN" ] || [ -z "$NGROK_DOMAIN" ]; then
    echo "ERROR: NGROK_AUTHTOKEN and NGROK_DOMAIN must be configured." >&2
    exit 1
fi

if [ ! -d "$DIAGRAMLY_PATH" ] || [ ! -f "$DIAGRAMLY_PATH/package.json" ]; then
    echo "ERROR: Diagramly path is not a project directory: $DIAGRAMLY_PATH" >&2
    exit 1
fi

if [ -z "$DIAGRAMLY_DATABASE_URL" ]; then
    DIAGRAMLY_ENV_FILE="$DIAGRAMLY_PATH/.env"
    if [ ! -f "$DIAGRAMLY_ENV_FILE" ]; then
        echo "ERROR: Diagramly default .env was not found. Pass LOCAL_DATABASE_URL explicitly." >&2
        exit 1
    fi

    # Validate the default without sourcing the file or printing its credentials.
    DIAGRAMLY_DATABASE_URL_TO_VALIDATE="$(awk -F= '
        /^[[:space:]]*DATABASE_URL[[:space:]]*=/ {
            value = substr($0, index($0, "=") + 1)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            sub(/[[:space:]]+#.*/, "", value)
            gsub(/^['\''"]|['\''"]$/, "", value)
            print value
            exit
        }
    ' "$DIAGRAMLY_ENV_FILE")"
    if [ -z "$DIAGRAMLY_DATABASE_URL_TO_VALIDATE" ]; then
        echo "ERROR: Diagramly default .env does not define DATABASE_URL. Pass LOCAL_DATABASE_URL explicitly." >&2
        exit 1
    fi
else
    DIAGRAMLY_DATABASE_URL_TO_VALIDATE="$DIAGRAMLY_DATABASE_URL"
fi

case "$DIAGRAMLY_DATABASE_URL_TO_VALIDATE" in
    postgresql://*@localhost:* | postgresql://*@127.0.0.1:*) ;;
    *)
        echo "ERROR: Diagramly DATABASE_URL must target localhost or 127.0.0.1." >&2
        exit 1
        ;;
esac

# Refuse to open duplicate service windows. The local PostgreSQL port is
# intentionally excluded because the database container is expected to persist.
BUSY_PORTS=""
if command -v lsof >/dev/null 2>&1; then
    for PORT in 3000 9000 8789 4040 8080 8000; do
        if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
            BUSY_PORTS="$BUSY_PORTS $PORT"
        fi
    done
fi

if [ -n "$BUSY_PORTS" ]; then
    echo "ERROR: Joint-debug ports are already in use:$BUSY_PORTS" >&2
    echo "Stop the existing service windows with Ctrl+C, then run this script again." >&2
    exit 1
fi

open_terminal_window() {
    osascript - "$1" <<'APPLESCRIPT'
on run argv
    tell application "Terminal"
        do script (item 1 of argv)
    end tell
end run
APPLESCRIPT
}

# Shell-escape dynamic values before embedding them into Terminal commands.
printf -v DIAGRAMLY_PATH_Q '%q' "$DIAGRAMLY_PATH"
printf -v WORKSPACE_DIR_Q '%q' "$WORKSPACE_DIR"
printf -v NGROK_AUTHTOKEN_Q '%q' "$NGROK_AUTHTOKEN"
printf -v NGROK_DOMAIN_Q '%q' "$NGROK_DOMAIN"

if [ -n "$DIAGRAMLY_DATABASE_URL" ]; then
    printf -v DIAGRAMLY_DATABASE_URL_Q '%q' "$DIAGRAMLY_DATABASE_URL"
    DIAGRAMLY_START_COMMAND="DATABASE_URL=$DIAGRAMLY_DATABASE_URL_Q pnpm dev"
    DIAGRAMLY_DATABASE_SOURCE="explicit local override"
else
    DIAGRAMLY_START_COMMAND="pnpm dev"
    DIAGRAMLY_DATABASE_SOURCE="Diagramly default .env"
fi

echo "Starting Joint Debug Mode..."
echo "Workspace: $WORKSPACE_DIR"
echo "Diagramly: $DIAGRAMLY_PATH"
echo "Diagramly database: $DIAGRAMLY_DATABASE_SOURCE"
echo "ngrok Domain: $NGROK_DOMAIN"
echo "Opening terminal windows..."

open_terminal_window "cd $DIAGRAMLY_PATH_Q && echo 'Terminal 1: Diagramly AI Service' && $DIAGRAMLY_START_COMMAND"
sleep 0.5

open_terminal_window "cd $WORKSPACE_DIR_Q && echo 'Terminal 2: Cloudflare Worker' && pnpm exec wrangler pages dev --port 8789"
sleep 0.5

open_terminal_window "cd $WORKSPACE_DIR_Q && echo 'Terminal 3: ngrok Tunnel' && npx --yes ngrok http --authtoken $NGROK_AUTHTOKEN_Q --url $NGROK_DOMAIN_Q 8789"
sleep 0.5

open_terminal_window "cd $WORKSPACE_DIR_Q && echo 'Terminal 4: conf-app Frontend (Forge + Diagramly)' && FORGE_TUNNEL=1 VERSION=latest PRODUCT_TYPE=diagramly pnpm exec vite dev --port 8080 --host 127.0.0.1"
sleep 0.5

open_terminal_window "cd $WORKSPACE_DIR_Q && echo 'Terminal 5: Forge Tunnel' && pnpm forge:tunnel"

echo
echo "All Terminal commands were accepted. Verify readiness in every window:"
echo "  - Diagramly:  http://localhost:3000"
echo "  - Worker:     http://localhost:8789"
echo "  - Frontend:   http://127.0.0.1:8080 (Vite)"
echo "  - ngrok:      https://$NGROK_DOMAIN"
echo "  - Forge:      Tunnel active (the iframe may use localhost:8000 as its bridge)"
echo
echo "To stop all services: press Ctrl+C in each Terminal window."
