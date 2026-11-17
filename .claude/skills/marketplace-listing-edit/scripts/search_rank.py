#!/usr/bin/env python3
"""Rank of our apps in the public Marketplace search for one query.

Reads the public search API (no credentials). Prints the total, then one line
per matching app: rank, key, and the name and tagline AS THE SEARCH INDEX HOLDS
THEM. A listing page can show a new name while the index still holds the old
one, so compare the printed name with what you saved before reading the rank.

Usage:
    python3 search_rank.py mermaid
    python3 search_rank.py "sequence diagram" --match zenuml --match gptdock
    python3 search_rank.py mermaid --save /abs/path/prefix   # writes prefix_0.json, prefix_50.json, ...

The API rank and the website card position are not guaranteed to be equal;
report them as two readings.
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request

BASE = "https://marketplace.atlassian.com/rest/2/addons"
DEFAULT_MATCH = ["zenuml", "gptdock", "com.pnd."]
PAGE = 50
MAX_PAGES = 10


def fetch(query, application, hosting, offset):
    params = urllib.parse.urlencode(
        {"text": query, "application": application, "hosting": hosting, "limit": PAGE, "offset": offset}
    )
    request = urllib.request.Request(f"{BASE}?{params}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("query")
    parser.add_argument("--application", default="confluence")
    parser.add_argument("--hosting", default="cloud")
    parser.add_argument("--match", action="append", help="substring of an app key (repeatable)")
    parser.add_argument("--save", help="absolute path prefix for the raw JSON pages")
    args = parser.parse_args()
    needles = [n.lower() for n in (args.match or DEFAULT_MATCH)]

    addons, total = [], None
    for page in range(MAX_PAGES):
        offset = page * PAGE
        data = fetch(args.query, args.application, args.hosting, offset)
        if args.save:
            with open(f"{args.save}_{offset}.json", "w") as handle:
                json.dump(data, handle)
        batch = data.get("_embedded", {}).get("addons", [])
        total = data.get("count", total)
        addons.extend(batch)
        if len(batch) < PAGE:
            break

    print(f"query={args.query!r} application={args.application} hosting={args.hosting} "
          f"total={total} fetched={len(addons)}")
    found = 0
    for rank, addon in enumerate(addons, 1):
        key = addon.get("key", "")
        if any(needle in key.lower() for needle in needles):
            found += 1
            print(f"{rank}\t{key}\t{addon.get('name')}\t{(addon.get('tagLine') or '')[:90]}")
    if not found:
        print("no matching app in the fetched results")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
