"""Token quota section: Claude week, Codex week and Cursor week.

Runs kindle/frame_source.py under the epaper-quota venv (same bytes the ESP32 panel gets) and parses
the Q5 frame with kindle/render.parse_frame. Cells 1, 2, 3 of the frame are kept. Raises on failure.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

KINDLE = Path(__file__).resolve().parents[2] / "kindle"
EPAPER_PYTHON = Path.home() / ".local/share/epaper-quota/venv/bin/python"
CELL_INDEXES = (1, 2, 3)
MAC_SOURCE = Path.home() / ".local/share/epaper-quota/mac-source.json"


def run_frame_source() -> str:
    result = subprocess.run([str(EPAPER_PYTHON), str(KINDLE / "frame_source.py")],
                            capture_output=True, text=True, timeout=120, check=False)
    if result.returncode:
        raise RuntimeError(f"frame source failed: {result.stderr.strip().splitlines()[-1:]}")
    return result.stdout


def read_mac_source() -> dict:
    return json.loads(MAC_SOURCE.read_text())


def sample_times(read_source=read_mac_source) -> dict:
    """Epoch seconds of each provider's last good sample, keyed by lower-case name."""
    try:
        providers = read_source().get("providers") or {}
    except (OSError, ValueError):
        return {}
    return {name: p.get("sampled_at") for name, p in providers.items() if isinstance(p, dict)}


def fetch(run=run_frame_source, read_source=read_mac_source) -> dict:
    if str(KINDLE) not in sys.path:
        sys.path.insert(0, str(KINDLE))
    import render  # kindle/render.py

    cells = render.parse_frame(run())
    sampled = sample_times(read_source)
    return {"cells": [{
        "name": cells[i].provider,
        "percent": cells[i].percent,
        "countdown": cells[i].countdown,
        "reset": cells[i].reset,
        "chart": list(cells[i].chart),
        "max": render.MAX_LEVEL,
        "sampled_at": sampled.get(cells[i].provider.lower()),
    } for i in CELL_INDEXES]}
