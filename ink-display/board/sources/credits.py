"""Read a local AWS Activate dashboard snapshot; never query AWS or advance checked_at."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

SNAPSHOT = Path.home() / ".local/share/remarkable-board/aws-credits.json"


def fetch(path: Path = SNAPSHOT) -> dict:
    try:
        data = json.loads(path.read_text())
        status = data["status"].strip().upper()
        checked_at = data["checked_at"]
        datetime.fromisoformat(checked_at)
        if not status:
            raise ValueError("missing status")
        result = {"status": status, "checked_at": checked_at}
        if isinstance(data.get("requested_amount"), str):
            result["requested_amount"] = data["requested_amount"]
        if data.get("applied_date"):
            result["applied_date"] = datetime.strptime(data["applied_date"], "%Y-%m-%d").strftime("%d %b %Y")
        return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {"status": "UNAVAILABLE", "checked_at": None}
