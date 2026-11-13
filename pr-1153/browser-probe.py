"""Capture the Title Draft Ready panel through a controllable local Vite proxy.

Set PROXY_URL to the proxy origin before running. Screenshots and JSON are
written beside this script. Requires agent-browser and an already-running
Storybook/Vite host behind slow_proxy.py.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = os.environ["PROXY_URL"].rstrip("/")
SESSION = os.environ.get("AGENT_BROWSER_SESSION", "title-draft-evidence")
AB = ["/usr/local/bin/agent-browser", "--session", SESSION]
urllib.request.urlopen(BASE + "/__repro/hold").read()
subprocess.run(AB + ["open", BASE + "/iframe.html?id=modal-titledraftpanel--ready&viewMode=story"], check=True)
probe = ('JSON.stringify({svg:document.querySelectorAll("[data-testid=title-draft-preview] svg").length,'
         'disabled:document.querySelector("[data-testid=title-draft-add]")?.disabled,'
         'status:document.querySelector("[role=status]")?.textContent??null,'
         'alert:document.querySelector("[role=alert]")?.textContent??null,'
         'reload:[...document.querySelectorAll("button")].some(b=>/reload preview/i.test(b.textContent))})')
for _ in range(15):
    result = subprocess.run(AB + ["eval", probe], capture_output=True, text=True, check=True)
    state = json.loads(json.loads(result.stdout.strip()))
    if state.get("disabled") is True:
        break
    subprocess.run(AB + ["wait", "1000"], check=True)
prefix = sys.argv[1] if len(sys.argv) > 1 else "capture"
subprocess.run(AB + ["screenshot", str(HERE / (prefix + "-loading.png"))], check=True)
subprocess.run(AB + ["wait", "11000"], check=True)
result = subprocess.run(AB + ["eval", probe], capture_output=True, text=True, check=True)
state = json.loads(json.loads(result.stdout.strip()))
(HERE / (prefix + "-browser.json")).write_text(json.dumps(state, indent=2) + "\n")
subprocess.run(AB + ["screenshot", str(HERE / (prefix + "-stall.png"))], check=True)
network = json.loads(urllib.request.urlopen(BASE + "/__repro/state").read())
print(json.dumps({"state": state, "network_control": network}, indent=2))
ok = bool(state.get("alert") and state.get("reload"))
print("PASS" if ok else "FAIL: preview has no timeout recovery")
sys.exit(0 if ok else 1)
