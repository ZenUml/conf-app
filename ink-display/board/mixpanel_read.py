#!/usr/bin/env python3
"""Read the Mixpanel organization billing page headless and hand it to billing_sync ingest.

Run hourly by launchd (com.pengxiao.remarkable-mixpanel). It replaces the Codex automation that read the same page
through the Chrome extension. The browser is agent-browser with the dedicated, already signed-in profile
~/.agent-browser/profiles/mixpanel, in its own session, closed after every run so the profile is released.

Only the billing text from the "Event Volume" heading on is sent, after the organization and tab lines that this
script checked on the page: the sidebar also says "Session Replay", which billing_sync rejects as ambiguous.
Nothing on the page is clicked. Any failure (sign-in page, missing section, ingest rejection) exits non-zero and
leaves the previous snapshot in place; the board then shows STALE after three hours.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BOARD = Path(__file__).resolve().parent
AGENT_BROWSER = os.path.realpath("/usr/local/bin/agent-browser")
PROFILE = Path.home() / ".agent-browser/profiles/mixpanel"
SESSION = "mixpanel-board"
URL = "https://mixpanel.com/project/3373228/app/settings/org/plan/data-usage"
ORG = "Diagramly.Ai"
PYTHON = Path.home() / ".local/share/kindle-quota/venv/bin/python"


class ReadError(RuntimeError):
    pass


def payload(url: str, text: str, observed_at: str) -> dict:
    """The billing_sync ingest JSON from the page's visible text."""
    lines = text.splitlines()
    if url.split("?")[0] != URL:
        raise ReadError(f"unexpected page {url}")
    if ORG not in lines or "Data Usage" not in lines:
        raise ReadError("organization or Data Usage tab not on the page (signed out?)")
    if lines.count("Event Volume") != 1:
        raise ReadError("Event Volume section missing or repeated")
    body = "\n".join(lines[lines.index("Event Volume"):])
    return {"source_url": url, "text": f"{ORG}\nData Usage\n{body}", "observed_at": observed_at}


def ab(*args: str, timeout: int = 90) -> str:
    result = subprocess.run([AGENT_BROWSER, "--session", SESSION, "--profile", str(PROFILE), *args],
                            capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise ReadError(f"agent-browser {args[0]} failed: {(result.stderr or result.stdout).strip()[-300:]}")
    return result.stdout


def read_page() -> dict:
    ab("open", URL)
    try:
        for _ in range(15):  # the billing cards load after the shell
            raw = json.loads(ab("eval", "JSON.stringify({url: location.href, text: document.body.innerText})"))
            page = json.loads(raw) if isinstance(raw, str) else raw
            if "Event Volume" in page["text"].splitlines():
                break
            time.sleep(2)
        observed = dt.datetime.now(dt.timezone.utc).astimezone().isoformat()
        return payload(page["url"], page["text"], observed)
    finally:
        try:
            ab("close", timeout=30)
        except (ReadError, subprocess.TimeoutExpired):
            pass


def main() -> int:
    stamp = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    try:
        data = read_page()
    except (ReadError, subprocess.TimeoutExpired, ValueError, KeyError) as error:
        print(f"{stamp} mixpanel read failed: {error}", flush=True)
        return 1
    result = subprocess.run([str(PYTHON), str(BOARD / "billing_sync.py"), "ingest", "--stdin", "--verify", "--timeout", "45"],
                            input=json.dumps(data), capture_output=True, text=True, timeout=180, check=False)
    print(f"{stamp} ingest exit {result.returncode}: {(result.stdout or result.stderr).strip()[-600:]}", flush=True)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
