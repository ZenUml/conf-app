#!/bin/bash

set -euo pipefail

# Open the five joint-debug services in separate macOS Terminal windows.
# Usage: ./launch-debug-services.sh <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH> [LOCAL_DATABASE_URL]

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
    echo "Usage: $0 <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH> [LOCAL_DATABASE_URL]"
    echo "Example: $0 'your-token' 'your-domain.ngrok-free.app' '/path/to/diagramly' 'postgresql://test_user:test_pass@127.0.0.1:5433/diagramly_test'"
    exit 1
fi

NGROK_AUTHTOKEN="$1"
NGROK_DOMAIN="$2"
DIAGRAMLY_PATH="$3"
DIAGRAMLY_DATABASE_URL="${4:-}"

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

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

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

osascript -e 'tell app "Terminal" to do script "cd '"$DIAGRAMLY_PATH_Q"' && echo '\''Terminal 1: Diagramly AI Service'\'' && '"$DIAGRAMLY_START_COMMAND"'"'
sleep 0.5

osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR_Q"' && echo '\''Terminal 2: Cloudflare Worker'\'' && npx wrangler pages dev --port 8789"'
sleep 0.5

osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR_Q"' && echo '\''Terminal 3: ngrok Tunnel'\'' && ngrok http --authtoken '"$NGROK_AUTHTOKEN_Q"' --url '"$NGROK_DOMAIN_Q"' 8789"'
sleep 0.5

osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR_Q"' && echo '\''Terminal 4: conf-app Frontend'\'' && pnpm start:local"'
sleep 0.5

osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR_Q"' && echo '\''Terminal 5: Forge Tunnel'\'' && forge tunnel"'

echo
echo "All Terminal commands were accepted. Verify readiness in every window:"
echo "  - Diagramly:  http://localhost:3000"
echo "  - Worker:     http://localhost:8789"
echo "  - Frontend:   http://127.0.0.1:8080"
echo "  - ngrok:      https://$NGROK_DOMAIN"
echo "  - Forge:      Tunnel active"
echo
echo "To stop all services: press Ctrl+C in each Terminal window."
