"""Print the current Q5 frame. Runs under the epaper-quota venv, which owns the quota source code."""
import json
import sys
from pathlib import Path

SENDER_DIR = Path.home() / "workspaces/remarkable/esp32-quota-display"
CONFIG = Path.home() / ".local/share/epaper-quota/config.json"

sys.path.insert(0, str(SENDER_DIR))
import send_quota  # noqa: E402

sys.stdout.write(send_quota.read_source(json.loads(CONFIG.read_text())).decode())
