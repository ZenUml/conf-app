"""Render fixtures/sample.json to the PNG path given on the command line."""
import json
import sys
from datetime import datetime
from pathlib import Path

from layout import render_page

if __name__ == "__main__":
    sections = json.loads((Path(__file__).parent / "fixtures" / "sample.json").read_text())
    Path(sys.argv[1]).write_bytes(render_page(sections, 80, datetime(2026, 11, 6, 17, 30), set()))
