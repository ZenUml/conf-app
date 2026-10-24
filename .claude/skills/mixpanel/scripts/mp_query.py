#!/usr/bin/env python3
"""Reusable Mixpanel JQL query runner for conf-app analytics.

Usage:
    python3 mp_query.py --script "function main() { ... }"
    python3 mp_query.py --file query.js
    python3 mp_query.py --script "..." --output results.json

Reads API_Secret from .env.mixpanel in current directory or conf-app root.
"""

import urllib.request
import urllib.parse
import json
import base64
import time
import argparse
import os
import sys


def load_api_secret():
    """Load API_Secret from .env.mixpanel file."""
    for path in [".env.mixpanel", os.path.join(os.path.dirname(__file__), "../../.env.mixpanel")]:
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    if line.startswith("API_Secret="):
                        return line.strip().split("=", 1)[1]
    # Try conf-app project root
    conf_app = os.path.expanduser("~/workspaces/zenuml/conf-app/.env.mixpanel")
    if os.path.exists(conf_app):
        with open(conf_app) as f:
            for line in f:
                if line.startswith("API_Secret="):
                    return line.strip().split("=", 1)[1]
    raise FileNotFoundError("Cannot find .env.mixpanel with API_Secret")


def run_jql(script, api_secret, retries=5, pace=10):
    """Execute a JQL script against Mixpanel API with retry logic."""
    jql_url = "https://mixpanel.com/api/2.0/jql"
    for attempt in range(retries):
        try:
            data = urllib.parse.urlencode({"script": script}).encode("utf-8")
            credentials = base64.b64encode(f"{api_secret}:".encode()).decode()
            req = urllib.request.Request(jql_url, data=data, method="POST")
            req.add_header("Authorization", f"Basic {credentials}")
            with urllib.request.urlopen(req, timeout=180) as resp:
                result = json.loads(resp.read().decode())
            time.sleep(pace)
            return result
        except Exception as e:
            if "429" in str(e) and attempt < retries - 1:
                wait = 90 * (attempt + 1)
                print(f"  Rate limited, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
            else:
                raise


def main():
    parser = argparse.ArgumentParser(description="Run Mixpanel JQL query")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--script", help="JQL script string")
    group.add_argument("--file", help="Path to .js file containing JQL script")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")
    parser.add_argument("--pace", type=int, default=10, help="Seconds between requests (default: 10)")
    args = parser.parse_args()

    api_secret = load_api_secret()

    if args.file:
        with open(args.file) as f:
            script = f.read()
    else:
        script = args.script

    result = run_jql(script, api_secret, pace=args.pace)

    output = json.dumps(result, indent=2)
    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
        print(f"Wrote {len(result)} results to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
