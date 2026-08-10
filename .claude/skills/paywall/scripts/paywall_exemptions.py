#!/usr/bin/env python3
"""
Read or write the PAYWALL_EXEMPTIONS flag in Cloudflare KV.

Lite-paywall-default-on (docs/superpowers/specs/
2026-08-04-lite-paywall-default-on-design.md) inverted the paywall's runtime
decision: the metered paywall is now ON by default for every Lite tenant, and
PAYWALL_EXEMPTIONS is the one small reverse list of exceptions. CUSTOMER_SUCCESS_SERVICE
(see css_flag.py) is unrelated to this decision after that change — it stays
the daily macro-count snapshot enrollment list only.

Usage:
    paywall_exemptions.py get
        Print the current PAYWALL_EXEMPTIONS map as JSON. Exit 0 on success.

    paywall_exemptions.py put '<json>'
        Overwrite PAYWALL_EXEMPTIONS with the supplied JSON string.
        Example: paywall_exemptions.py put '{"*":true,"example-tenant":true}'

Value contract (validated before every write, and checked on read so a
corrupt value is caught early):
  - a JSON object;
  - every value boolean (`true`/`false`) — no strings, numbers, nested
    objects, or arrays as values;
  - keys are Confluence subdomain prefixes, or the literal "*" for the
    fleet-wide kill switch;
  - a key set to `true` exempts that tenant (or, for "*", the whole fleet)
    from the Lite paywall; missing keys and `false` values are NOT exempt —
    they get the default-on paywall.

This targets the PRODUCTION KV_FEATURE_FLAGS namespace ONLY — there is no
`--environment` switch (unlike the plan's original design), by explicit
narrower instruction when this script was built. Staging uses a different
namespace ID (fd87eed34f864190880a4b44d25c0e91, see wrangler-stg.toml) and is
NOT reachable from this script; use the Cloudflare dashboard or a manual
wrangler command with `--namespace-id fd87eed34f864190880a4b44d25c0e91` for
staging reads/writes. The namespace ID below is fixed deliberately: a write
must not be able to silently land on the wrong namespace.

Why this exists (read before "improving"): every wrangler KV call needs
--remote, otherwise wrangler defaults to local Miniflare storage (because
wrangler.toml declares pages_build_output_dir) and silently returns "Value
not found" even when the remote namespace has data. Piping wrangler through
2>/dev/null also hides its auth prompts (wrangler writes them to stdout, not
stderr). Both footguns are baked out here: --remote is always passed, and
stderr is left alone.

Authentication: requires either an interactive `npx wrangler login` session
or CLOUDFLARE_API_TOKEN exported in the environment.
"""
from __future__ import annotations

import json
import subprocess
import sys

PAYWALL_EXEMPTIONS_NAMESPACE_ID = "fe9042cb20994651b0a2ef9e68f9037c"
PAYWALL_EXEMPTIONS_KEY = "PAYWALL_EXEMPTIONS"


def validate_boolean_only_object(parsed: object) -> None:
    """Raise via sys.exit with a clear message if `parsed` is not a JSON
    object whose values are all booleans. Shared by get() (so a corrupt
    stored value is caught, not silently trusted) and put() (so a bad write
    never reaches KV)."""
    if not isinstance(parsed, dict):
        sys.exit(
            "error: PAYWALL_EXEMPTIONS must be a JSON object "
            '(e.g. {"*":true,"example-tenant":true}), got '
            f"{type(parsed).__name__}"
        )
    for key, value in parsed.items():
        if not isinstance(value, bool):
            sys.exit(
                f"error: PAYWALL_EXEMPTIONS[{key!r}] must be a boolean, "
                f"got {value!r} ({type(value).__name__}). The map is "
                "boolean-only by design — reasons/approvals/expiry belong "
                "in the private paywall runbook, not this runtime value."
            )


def get_flag() -> str:
    result = subprocess.run(
        [
            "npx",
            "wrangler",
            "kv",
            "key",
            "get",
            "--namespace-id",
            PAYWALL_EXEMPTIONS_NAMESPACE_ID,
            "--remote",
            PAYWALL_EXEMPTIONS_KEY,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = result.stdout.strip()
    # Validate it parses as a boolean-only JSON object before handing it
    # back — a stored value that fails this is itself an incident (the
    # backend would omit PAYWALL_EXEMPT for every tenant, i.e. fail open
    # fleet-wide), so surface it loudly rather than printing raw garbage.
    validate_boolean_only_object(json.loads(payload))
    return payload


def put_flag(payload: str) -> None:
    parsed = json.loads(payload)
    validate_boolean_only_object(parsed)
    subprocess.run(
        [
            "npx",
            "wrangler",
            "kv",
            "key",
            "put",
            "--namespace-id",
            PAYWALL_EXEMPTIONS_NAMESPACE_ID,
            "--remote",
            PAYWALL_EXEMPTIONS_KEY,
            payload,
        ],
        check=True,
    )


def main(argv: list[str]) -> int:
    if len(argv) < 1:
        sys.exit("usage: paywall_exemptions.py [get | put '<json>']")
    cmd = argv[0]
    if cmd == "get":
        sys.stdout.write(get_flag() + "\n")
        return 0
    if cmd == "put":
        if len(argv) < 2:
            sys.exit("usage: paywall_exemptions.py put '<json>'")
        put_flag(argv[1])
        return 0
    sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
