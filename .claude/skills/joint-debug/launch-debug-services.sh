#!/bin/bash

# Joint Debug Startup Script
# This script opens multiple terminal windows to run all required services
# Usage: ./launch-debug-services.sh <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH>

# Check if all required arguments are provided
if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <NGROK_AUTHTOKEN> <NGROK_DOMAIN> <DIAGRAMLY_PATH>"
    echo "Example: $0 'your-token' 'your-domain.ngrok-free.app' '/path/to/diagramly'"
    exit 1
fi

# Read arguments
NGROK_AUTHTOKEN="$1"
NGROK_DOMAIN="$2"
DIAGRAMLY_PATH="$3"

# Get current directory (workspace root)
# Script is in .claude/skills/joint-debug/, so go up 3 levels to reach project root
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

echo "Starting Joint Debug Mode..."
echo "Workspace: $WORKSPACE_DIR"
echo "Diagramly: $DIAGRAMLY_PATH"
echo "ngrok Domain: $NGROK_DOMAIN"
echo "Opening terminal windows..."

# Terminal 1: diagramly
osascript -e 'tell app "Terminal" to do script "cd '"$DIAGRAMLY_PATH"' && echo '\''Terminal 1: Diagramly AI Service'\'' && echo '\''Running: pnpm dev'\'' && pnpm dev"'

# Wait a bit between opening terminals
sleep 0.5

# Terminal 2: worker
osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR"' && echo '\''Terminal 2: Cloudflare Worker'\'' && echo '\''Running: npx wrangler pages dev --port 8789'\'' && npx wrangler pages dev --port 8789"'

sleep 0.5

# Terminal 3: worker-ngrok
osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR"' && echo '\''Terminal 3: ngrok Tunnel'\'' && echo '\''Running: ngrok http --authtoken *** --url '"$NGROK_DOMAIN"' 8789'\'' && ngrok http --authtoken '"$NGROK_AUTHTOKEN"' --url '"$NGROK_DOMAIN"' 8789"'

sleep 0.5

# Terminal 4: confluence-plugin-cloud
osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR"' && echo '\''Terminal 4: Confluence Plugin Frontend'\'' && echo '\''Running: pnpm start:sit'\'' && pnpm start:sit"'

sleep 0.5

# Terminal 5: forge-tunnel
osascript -e 'tell app "Terminal" to do script "cd '"$WORKSPACE_DIR"' && echo '\''Terminal 5: Forge Tunnel'\'' && echo '\''Running: forge tunnel'\'' && forge tunnel"'

echo ""
echo "✅ All terminal windows opened!"
echo ""
echo "Expected services:"
echo "  - Diagramly:  http://localhost:3000"
echo "  - Worker:     http://localhost:8789"
echo "  - Frontend:   http://localhost:8000"
echo "  - ngrok:      https://$NGROK_DOMAIN"
echo "  - Forge:      Tunnel active"
echo ""
echo "To stop all services: Press Ctrl+C in each terminal window"
