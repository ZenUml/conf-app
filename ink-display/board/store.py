"""Section cache: one JSON file per section, {"fetched_at": iso, "data": {...}}.

A failed fetch keeps the last good file and records the error.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

INTERVALS = {"tokens": 300, "revenue": 3600, "gcp": 300, "customers": 43200, "sites": 86400, "credits": 300, "fullscreen": 300, "mixpanel": 300}
STALE_FACTOR = 3
RETRY_SECONDS = 60  # a failing fetcher is not retried more often than this
DEFAULT_DIR = Path.home() / ".local/share/remarkable-board/cache"


class Store:
    def __init__(self, directory: Path | str = DEFAULT_DIR):
        self.dir = Path(directory)
        self.errors: dict[str, str] = {}
        self._attempts: dict[str, datetime] = {}

    def _path(self, name: str) -> Path:
        return self.dir / f"{name}.json"

    def _read(self, name: str):
        try:
            record = json.loads(self._path(name).read_text())
            fetched = datetime.fromisoformat(record["fetched_at"])
            if fetched.tzinfo is not None:  # compare in naive local time, like datetime.now()
                fetched = fetched.astimezone().replace(tzinfo=None)
            return fetched, record["data"]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def load(self, name: str):
        record = self._read(name)
        return record[1] if record else None

    def record(self, name: str):
        """(fetched_at, data) of the cached section, or None."""
        return self._read(name)

    def save(self, name: str, data, now: datetime) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self._path(name).with_suffix(".tmp")
        tmp.write_text(json.dumps({"fetched_at": now.isoformat(), "data": data}))
        os.replace(tmp, self._path(name))

    def _age(self, name: str, now: datetime):
        record = self._read(name)
        return None if record is None else (now - record[0]).total_seconds()

    def due(self, name: str, now: datetime) -> bool:
        if name == "mixpanel":
            try:
                if (self.dir.parent / "mixpanel-usage.json").stat().st_mtime_ns > self._path(name).stat().st_mtime_ns:
                    return True
            except OSError:
                pass
        age = self._age(name, now)
        return age is None or age >= INTERVALS[name]

    def stale(self, name: str, now: datetime) -> bool:
        age = self._age(name, now)
        return age is None or age > STALE_FACTOR * INTERVALS[name]

    def refresh_due(self, fetchers: dict, now: datetime) -> set[str]:
        """Call each due fetcher; return the names whose data changed."""
        changed = set()
        for name, fetch in fetchers.items():
            if name not in INTERVALS or not self.due(name, now):
                continue
            last = self._attempts.get(name)
            if name in self.errors and last and (now - last).total_seconds() < RETRY_SECONDS:
                continue
            self._attempts[name] = now
            before = self.load(name)
            try:
                data = fetch()
            except Exception as error:  # keep the last good file
                self.errors[name] = f"{type(error).__name__}: {error}"
                continue
            self.errors.pop(name, None)
            self.save(name, data, now)
            if data != before:
                changed.add(name)
        return changed
