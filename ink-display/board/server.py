#!/usr/bin/env python3
"""Serve the reMarkable board on the LAN: GET /r/<token>.png?b=<0-100>.

GET /r/<token>/tokens.json gives the token cells as JSON for the iPhone widget (iphone/).

A background loop refreshes due sections every 30 s and re-renders when one changed. A failed fetch
keeps the last good data, so the last good image keeps being served.
"""
from __future__ import annotations

import argparse
import json
import shutil
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from layout import render_page
from store import INTERVALS, Store

HOME = Path.home() / ".local/share/remarkable-board"
LOOP_SECONDS = 30
BOARD_ID = "remarkable-board"  # not a secret: the tablet sends its token only to a server that answers this
REDRAW_SECONDS = 300  # refresh the disk reading even if other sections have not changed


def load_fetchers() -> dict:
    try:
        from sources import FETCHERS
    except ModuleNotFoundError as error:
        if error.name != "sources":
            raise
        return {}
    return dict(FETCHERS)


class BoardState:
    def __init__(self, store: Store, fetchers: dict | None = None, clock=datetime.now):
        self.store = store
        self.fetchers = fetchers if fetchers is not None else {}
        self.clock = clock
        self.png: bytes | None = None
        self.battery: int | None = None
        self.rendered_at: datetime | None = None
        self._stale: set[str] = set()
        self.error: str | None = None
        self._lock = threading.Lock()

    def _render(self) -> None:
        now = self.clock()
        sections = {name: self.store.load(name) for name in INTERVALS}
        sections = {k: v for k, v in sections.items() if v is not None}
        self._stale = {n for n in sections if self.store.stale(n, now)}
        try:
            disk_free_gb = round(shutil.disk_usage(Path.home()).free / 1_000_000_000)
        except OSError:
            disk_free_gb = None
        self.png = render_page(sections, self.battery, now, self._stale, disk_free_gb=disk_free_gb)
        self.rendered_at = now

    def refresh(self) -> None:
        now = self.clock()
        try:
            changed = self.store.refresh_due(self.fetchers, now)
            with self._lock:
                stale = {n for n in INTERVALS if self.store.load(n) is not None and self.store.stale(n, now)}
                old = self.rendered_at is None or (now - self.rendered_at).total_seconds() >= REDRAW_SECONDS
                if changed or stale != self._stale or old:
                    self._render()
                self.error = None
        except Exception as error:  # keep serving the last good image
            with self._lock:
                self.error = f"{type(error).__name__}: {error}"

    def take_force_full(self) -> bool:
        try:
            (self.store.dir / "force-full").unlink()
            return True
        except OSError:
            return False

    def tokens_json(self) -> bytes | None:
        record = self.store.record("tokens")
        if record is None:
            return None
        fetched, data = record
        return json.dumps({"fetched_at": fetched.isoformat(), "stale": self.store.stale("tokens", self.clock()),
                           "cells": data.get("cells", [])}).encode()

    def snapshot(self, battery: int | None = None) -> bytes:
        with self._lock:
            if self.png is None or (battery is not None and battery != self.battery):
                if battery is not None:
                    self.battery = battery
                self._render()
            return self.png


def parse_battery(query: str) -> int | None:
    value = parse_qs(query).get("b", [""])[0]
    return int(value) if value.isdigit() and int(value) <= 100 else None


def make_server(host: str, port: int, token: str, state: BoardState) -> ThreadingHTTPServer:
    path = f"/r/{token}.png"
    full_path = f"/r/{token}.full"
    tokens_path = f"/r/{token}/tokens.json"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            request = urlsplit(self.path)
            if request.path == "/board-id":  # lets the tablet find this server after the Mac's IP changes
                body = BOARD_ID.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if request.path == full_path:  # "1" once after `touch <cache>/force-full`; the tablet then redraws full
                body = b"1" if state.take_force_full() else b"0"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if request.path == tokens_path:
                body = state.tokens_json()
                if body is None:
                    self.send_error(503)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if request.path != path:
                self.send_error(404)
                return
            try:
                png = state.snapshot(parse_battery(request.query))
            except Exception:
                self.send_error(500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(png)

        def log_message(self, fmt, *args):  # the token is in the path; keep it out of logs
            label = {path: "/r/<token>.png", full_path: "/r/<token>.full",
                     tokens_path: "/r/<token>/tokens.json"}.get(urlsplit(self.path).path, "-")
            print(f"{self.address_string()} {self.command} {label} "
                  f"{args[1] if len(args) > 1 else ''}", flush=True)

    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=HOME / "config.json")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    state = BoardState(Store(HOME / "cache"), load_fetchers())

    def loop():
        while True:
            state.refresh()
            errors = {**state.store.errors}
            if state.error:
                errors["render"] = state.error
            print("refresh ok" if not errors else f"refresh errors: {errors}", flush=True)
            time.sleep(LOOP_SECONDS)

    threading.Thread(target=loop, daemon=True).start()
    bind, port = config.get("bind", "0.0.0.0"), config.get("port", 8766)
    server = make_server(bind, port, config["token"], state)
    print(f"serving on {bind}:{server.server_address[1]}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
