#!/usr/bin/env python3
"""Query Mixpanel for active client_domain values. Writes mixpanel_active.txt.

Usage: python3 query_mixpanel.py <lite|full|dia> <days>

Reads credentials from .env.mixpanel (API_Secret field).
"""
import json
import sys
import urllib.request
import urllib.parse
from base64 import b64encode
from datetime import datetime, timedelta
from pathlib import Path


def load_mixpanel_secret():
    env_path = Path(__file__).resolve().parents[2] / ".." / ".." / ".env.mixpanel"
    # Try multiple paths
    candidates = [
        Path.cwd() / ".env.mixpanel",
        env_path,
    ]
    for p in candidates:
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("API_Secret="):
                    return line.split("=", 1)[1].strip()
    print("Cannot find .env.mixpanel with API_Secret", file=sys.stderr)
    sys.exit(1)


APP_CONFIG = {
    "lite": {
        "event": "view_macro",
        "where": 'properties["addon_key"]=="com.zenuml.confluence-addon-lite"',
    },
    "full": {
        "event": "view_macro",
        "where": 'properties["addon_key"]=="com.zenuml.confluence-addon"',
    },
    "dia": {
        "event": "Pageview",
        "where": 'properties["$current_domain"]=="conf-gpt.zenuml.com"',
    },
}

if len(sys.argv) < 3:
    print("Usage: python3 query_mixpanel.py <lite|full|dia> <days>", file=sys.stderr)
    sys.exit(1)

app = sys.argv[1]
days = int(sys.argv[2])

if app not in APP_CONFIG:
    print(f"Unknown app: {app}. Use lite, full, or dia.", file=sys.stderr)
    sys.exit(1)

config = APP_CONFIG[app]
secret = load_mixpanel_secret()
auth = b64encode(f"{secret}:".encode()).decode()

to_date = datetime.now(tz=None).strftime("%Y-%m-%d")
from_date = (datetime.now(tz=None) - timedelta(days=days)).strftime("%Y-%m-%d")

params = {
    "from_date": from_date,
    "to_date": to_date,
    "event": json.dumps([config["event"]]),
    "where": config["where"],
}
url = f"https://data.mixpanel.com/api/2.0/export?{urllib.parse.urlencode(params)}"

req = urllib.request.Request(url, headers={
    "Authorization": f"Basic {auth}",
    "Accept": "text/plain",
})

print(f"Querying Mixpanel: {app}, {from_date} to {to_date}, event={config['event']}")
print("This may take several minutes for large date ranges...")

domains = set()
with urllib.request.urlopen(req) as resp:
    for line in resp:
        line = line.decode().strip()
        if not line:
            continue
        try:
            event = json.loads(line)
            domain = event.get("properties", {}).get("client_domain", "")
            if domain:
                domains.add(domain)
        except json.JSONDecodeError:
            pass

with open("mixpanel_active.txt", "w") as f:
    for d in sorted(domains):
        f.write(d + "\n")

print(f"Active {app} clients ({days}d): {len(domains)}")
