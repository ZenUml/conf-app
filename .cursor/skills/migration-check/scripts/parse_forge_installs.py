#!/usr/bin/env python3
"""Parse Forge CLI JSON output from stdin, write unique production sites to forge_sites.txt."""
import json
import sys

raw = sys.stdin.read()
idx = raw.find("[")
if idx < 0:
    print("No JSON array found in input", file=sys.stderr)
    sys.exit(1)

data = json.loads(raw[idx:])
sites = sorted(set(
    d["site"] for d in data if d.get("environment") == "production"
))

with open("forge_sites.txt", "w") as f:
    for s in sites:
        f.write(s + "\n")

print(f"Forge production installations: {len(sites)}")
