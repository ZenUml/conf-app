"""Customers section.

The list and the action note are hand-written in ~/.local/share/remarkable-board/customers.json:
  [{"site": "acme.atlassian.net", "name": "Acme", "status": "due Wed", "note": "..."}]
Product, seats, and region/country come from the Marketplace licence export, matched by site hostname.
Rows are sorted by seats, largest first (no seats last, then by name), and cut to 10.

status may be the literal "auto"; it is then computed from the site's licence maintenanceEndDate:
  evaluation, end today or later   "trial ends 3 Dec"
  commercial, end within 7 days    "renews Sun"   (later: "renews 3 Dec")
  any licence, end already passed  "12d overdue"
Among the site's COMMERCIAL/EVALUATION licences the active one with the earliest end date is used; with no
active one, the licence that ended most recently. Dates are Australia/Sydney calendar days.
Raises when the notes file is missing or malformed, or when the licence export fails.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from zoneinfo import ZoneInfo

from . import marketplace

NOTES_PATH = os.path.expanduser("~/.local/share/remarkable-board/customers.json")
SYDNEY = ZoneInfo("Australia/Sydney")
MAX_ROWS = 10


def load_notes(path: str = NOTES_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a JSON list")
    for i, item in enumerate(data):
        if not isinstance(item, dict) or not item.get("site") or not item.get("name"):
            raise ValueError(f"{path}: entry {i} needs 'site' and 'name'")
    return data


def _day(text) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


def _short(d: dt.date) -> str:
    return f"{d.day} {d.strftime('%b')}"


def auto_status(licenses: list[dict], today: dt.date) -> str:
    cands = [(r, _day(r.get("maintenanceEndDate"))) for r in licenses
             if r.get("licenseType") in ("COMMERCIAL", "EVALUATION")]
    cands = [(r, d) for r, d in cands if d]
    if not cands:
        return ""
    active = [(r, d) for r, d in cands if r.get("status") == "active" and d >= today]
    rec, end = min(active, key=lambda c: c[1]) if active else max(cands, key=lambda c: c[1])
    if end < today:
        return f"{(today - end).days}d overdue"
    if rec.get("licenseType") == "EVALUATION":
        return f"trial ends {_short(end)}"
    return f"renews {end.strftime('%a')}" if (end - today).days < 7 else f"renews {_short(end)}"


def build(notes: list[dict], lic: dict, today: dt.date) -> dict:
    rows = []
    for item in notes:
        info = lic.get(marketplace.site_key(item["site"]), marketplace.SiteLicenses())
        status = str(item.get("status", ""))
        if status == "auto":
            status = auto_status(info.licenses, today)
        rows.append((info.seats, item["name"], {
            "product": info.product, "name": item["name"], "place": info.place,
            "seats": marketplace.fmt_seats(info.seats),
            "status": status, "note": str(item.get("note", "")),
        }))
    rows.sort(key=lambda r: (-r[0], r[1].lower()))
    return {"rows": [r[2] for r in rows[:MAX_ROWS]]}


def fetch(notes_path: str = NOTES_PATH, licenses=None, now: dt.datetime | None = None) -> dict:
    """licenses: optional callable returning the raw export list (injected in tests)."""
    now = now or dt.datetime.now(SYDNEY)
    notes = load_notes(notes_path)
    lic = marketplace.license_index(licenses)
    return build(notes, lic, now.astimezone(SYDNEY).date())
