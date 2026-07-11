#!/bin/bash

set -euo pipefail

# Open the five joint-debug services in separate macOS Terminal windows.
# Usage: ./launch-debug-services.sh <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH> <LOCAL_DATABASE_URL>

if [ "$#" -ne 4 ]; then
    echo "Usage: $0 <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH> <LOCAL_DATABASE_URL>"
    echo "Example: $0 'your-token' 'your-domain.ngrok-free.app' '/path/to/diagramly' 'postgresql://test_user:test_pass@127.0.0.1:5433/diagramly_test'"
    exit 1
fi

NGROK_AUTHTOKEN="$1"
NGROK_DOMAIN="$2"
DIAGRAMLY_PATH="$3"
DIAGRAMLY_DATABASE_URL="$4"

if [ ! -d "$DIAGRAMLY_PATH" ] || [ ! -f "$DIAGRAMLY_PATH/package.json" ]; then
    echo "ERROR: Diagramly path is not a project directory: $DIAGRAMLY_PATH" >&2
    exit 1
fi

case "$DIAGRAMLY_DATABASE_URL" in
    postgresql://*@localhost:* | postgresql://*@127.0.0.1:*) ;;
    *)
        echo "ERROR: LOCAL_DATABASE_URL must target localhost or 127.0.0.1." >&2
        exit 1
        ;;
esac

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Shell-escape dynamic values before embedding them into Terminal commands.
printf -v DIAGRAMLY_PATH_Q '%q' "$DIAGRAMLY_PATH"
printf -v DIAGRAMLY_DATABASE_URL_Q '%q' "$DIAGRAMLY_DATABASE_URL"
printf -v WORKSPACE_DIR_Q '%q' "$WORKSPACE_DIR"
printf -v NGROK_AUTHTOKEN_Q '%q' "$NGROK_AUTHTOKEN"
printf -v NGROK_DOMAIN_Q '%q' "$NGROK_DOMAIN"

echo "Starting Joint Debug Mode..."
echo "Workspace: $WORKSPACE_DIR"
echo "Diagramly: $DIAGRAMLY_PATH"
echo "ngrok Domain: $NGROK_DOMAIN"
echo "Opening terminal windows..."

osascript -e 'tell app "Terminal" to do script "cd '"$DIAGRAMLY_PATH_Q"' && echo '\''Terminal 1: Diagramly AI Service'\'' && DATABASE_URL='"$DIAGRAMLY_DATABASE_URL_Q"' pnpm dev"'
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
