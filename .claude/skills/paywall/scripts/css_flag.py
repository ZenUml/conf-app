#!/usr/bin/env python3
"""
Read or write the CUSTOMER_SUCCESS_SERVICE (CSS) flag in Cloudflare KV.

Usage:
    css_flag.py get
        Print current CSS flag as JSON. Exit 0 on success.

    css_flag.py put '<json>'
        Overwrite the CSS flag with the supplied JSON string.
        Example: css_flag.py put '{"vin3s":true,"zeptonow":true,...}'

Why this exists (read before "improving"): every wrangler KV call
needs --remote, otherwise wrangler defaults to local Miniflare
storage (because wrangler.toml declares pages_build_output_dir) and
silently returns "Value not found" even when the remote namespace
has data. Piping wrangler through 2>/dev/null also hides its auth
prompts (wrangler writes them to stdout, not stderr). Both footguns
are baked out here: --remote is always passed, and stderr is left
alone. The namespace ID and key name are also fixed values — there's
no scenario where you'd want to point this at a different KV
namespace, so they're hard-coded.

Authentication: requires either an interactive `npx wrangler login`
session or CLOUDFLARE_API_TOKEN exported in the environment.
"""
from __future__ import annotations

import json
import subprocess
import sys

CSS_NAMESPACE_ID = "fe9042cb20994651b0a2ef9e68f9037c"
CSS_KEY = "CUSTOMER_SUCCESS_SERVICE"


def get_flag() -> str:
    result = subprocess.run(
        [
            "npx",
            "wrangler",
            "kv",
            "key",
            "get",
            "--namespace-id",
            CSS_NAMESPACE_ID,
            "--remote",
            CSS_KEY,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    # Validate it parses as JSON before we hand it back.
    payload = result.stdout.strip()
    json.loads(payload)
    return payload


def put_flag(payload: str) -> None:
    # Validate before writing.
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        sys.exit("error: CSS flag must be a JSON object (e.g. {\"vin3s\":true})")
    subprocess.run(
        [
            "npx",
            "wrangler",
            "kv",
            "key",
            "put",
            "--namespace-id",
            CSS_NAMESPACE_ID,
            "--remote",
            CSS_KEY,
            payload,
        ],
        check=True,
    )


def main(argv: list[str]) -> int:
    if len(argv) < 1:
        sys.exit("usage: css_flag.py [get | put '<json>']")
    cmd = argv[0]
    if cmd == "get":
        sys.stdout.write(get_flag() + "\n")
        return 0
    if cmd == "put":
        if len(argv) < 2:
            sys.exit("usage: css_flag.py put '<json>'")
        put_flag(argv[1])
        return 0
    sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
