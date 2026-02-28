#!/usr/bin/env python3
"""Query D1 for Connect installations by CONNECT_KEY. Writes connect_sites.txt.

Usage: python3 query_d1_connect.py <CONNECT_KEY>

Requires wrangler CLI and wrangler-prod.toml in the project root.
"""
import json
import subprocess
import sys

if len(sys.argv) < 2:
    print("Usage: python3 query_d1_connect.py <CONNECT_KEY>", file=sys.stderr)
    sys.exit(1)

connect_key = sys.argv[1]
sql = f"SELECT clientDomain, pluginsVersion, eventType FROM ClientInstallation WHERE key = '{connect_key}'"

result = subprocess.run(
    [
        "npx", "wrangler", "d1", "execute", "conf-zenuml-prod",
        "--remote", "--env", "production",
        "--command", sql,
        "--config", "wrangler-prod.toml",
        "--json",
    ],
    capture_output=True, text=True,
)

if result.returncode != 0:
    print(f"wrangler failed: {result.stderr}", file=sys.stderr)
    sys.exit(1)

data = json.loads(result.stdout)
rows = data[0]["results"]
domains = sorted(set(r.get("clientDomain", "") for r in rows if r.get("clientDomain")))

with open("connect_sites.txt", "w") as f:
    for d in domains:
        f.write(d + "\n")

print(f"Connect installations ({connect_key}): {len(domains)}")
