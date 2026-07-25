#!/usr/bin/env python3
"""Read a Mixpanel board and dump its cards, for auditing against
docs/analytics/rendering-perf-board.md.

Why this exists: a project API secret CANNOT read a board
(`/api/app/projects/<id>/boards/<board>` → 401 "Invalid service account
credentials"), and there is no documented board-read endpoint at all. A
**service account** can reach the app API, so this script authenticates with one
and walks the board.

The board endpoints are UNDOCUMENTED, so this script is deliberately
discovery-shaped rather than schema-assuming: it validates the credentials
against a documented endpoint first, then tries each candidate board URL and
reports what every one of them answered. It dumps raw JSON for a human (or
agent) to read instead of pretending to know the response shape.

Credentials — service account, NOT the project secret. Either put them in
.env.mixpanel (which is gitignored):
    MIXPANEL_SA_USER=my-service-account.123abc.mp-service-account
    MIXPANEL_SA_SECRET=...
or export MIXPANEL_SA_USER / MIXPANEL_SA_SECRET. Secrets are never printed.

Usage:
    python3 board_audit.py                          # defaults below
    python3 board_audit.py --board 11250759 --raw board.json
    python3 board_audit.py --report 12345678        # one saved report's data
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# From https://mixpanel.com/project/3373228/view/3879592/app/boards#id=11250759
PROJECT_ID = 3373228
WORKSPACE_ID = 3879592          # the /view/<id> segment
BOARD_ID = 11250759             # the #id=<id> fragment

ENV_FILES = (".env.mixpanel",
             os.path.join(os.path.dirname(__file__), "../../../../.env.mixpanel"))


def load_env_pair():
    """Return (user, secret) from .env.mixpanel or the environment."""
    vals = {}
    for path in ENV_FILES:
        if not os.path.exists(path):
            continue
        with open(path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    vals.setdefault(k.strip(), v.strip())
    user = os.environ.get("MIXPANEL_SA_USER") or vals.get("MIXPANEL_SA_USER")
    secret = os.environ.get("MIXPANEL_SA_SECRET") or vals.get("MIXPANEL_SA_SECRET")
    return user, secret


def get(url, auth, timeout=60):
    """GET → (status, parsed_or_text). Never raises on HTTP error status."""
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        status = e.code
    except Exception as e:                                  # network / TLS
        return 0, f"{type(e).__name__}: {e}"
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, body[:2000]


def validate(auth):
    """Confirm the credentials work before blaming the board endpoints.

    Uses `/api/2.0/events/names`, which is the only probe verified to actually
    discriminate: 200 for valid credentials, 400 with an "Unauthorized" body for
    invalid ones. Note it answers **400, not 401**, on bad auth.

    Do NOT validate against `/api/query/insights?bookmark_id=0` — it rejects the
    id BEFORE checking auth, so bogus credentials also get 400 "Invalid
    insights_id" and the check silently passes. That trap cost a debugging round.
    """
    url = (f"https://mixpanel.com/api/2.0/events/names?project_id={PROJECT_ID}"
           f"&type=general&limit=1")
    status, body = get(url, auth)
    if status != 200:
        print(f"✗ credentials REJECTED ({status}) on the query API.")
        print(f"  response: {str(body)[:200]}")
        print("  → use the SERVICE ACCOUNT username + secret (not the project API")
        print("    secret), and give the account a role on this project.")
        return False
    print(f"✓ credentials accepted (query API returned 200)")
    return True


CANDIDATES = [
    "https://mixpanel.com/api/app/projects/{p}/boards/{b}",
    "https://mixpanel.com/api/app/projects/{p}/boards/{b}?workspace_id={w}",
    "https://mixpanel.com/api/app/workspaces/{w}/boards/{b}",
    "https://mixpanel.com/api/app/projects/{p}/dashboards/{b}",
    "https://mixpanel.com/api/app/projects/{p}/boards",
    "https://mixpanel.com/api/app/projects/{p}/bookmarks?workspace_id={w}",
]


def find_board(auth, board):
    print("\nprobing board endpoints (all undocumented):")
    hit = None
    for tpl in CANDIDATES:
        url = tpl.format(p=PROJECT_ID, w=WORKSPACE_ID, b=board)
        status, body = get(url, auth)
        marker = "✓" if 200 <= status < 300 else " "
        print(f" {marker} {status}  {url}")
        if 200 <= status < 300 and hit is None:
            hit = (url, body)
        elif not (200 <= status < 300):
            snippet = str(body)[:120].replace("\n", " ")
            if snippet:
                print(f"        {snippet}")
    return hit


def walk_cards(obj, depth=0, path="$"):
    """Yield (path, dict) for objects that look like board cards/reports.

    Heuristic on purpose: the schema is undocumented, so anything carrying a
    name/title plus a type/query-ish key is surfaced for a human to read.
    """
    if isinstance(obj, dict):
        keys = set(obj)
        namey = keys & {"name", "title", "label"}
        typey = keys & {"type", "chart_type", "display", "bookmark", "query",
                        "params", "sections", "cards", "contents"}
        if namey and typey:
            yield path, obj
        for k, v in obj.items():
            yield from walk_cards(v, depth + 1, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_cards(v, depth + 1, f"{path}[{i}]")


# The dimensions the board must pin, per docs/analytics/rendering-perf-board.md.
# Presence is checked as a substring over the serialized board, which is a
# coarse signal — it proves a property is REFERENCED somewhere, not that it is
# filtered correctly. Treat misses as reliable and hits as "verify by eye".
EXPECTED = [
    ("surface", "board filter: surface=viewer (excludes editor renders)"),
    ("tab_hidden", "board filter: tab_hidden != true (throttled-timer renders)"),
    ("duration_ms", "the metric itself"),
    ("is_internal_client_domain", "board filter: exclude our own + staging tenants"),
    ("macro_type", "breakdown: per-viewer regressions"),
    ("content_source", "the SWR lever — biggest determinant of loading time"),
    ("cache_state", "cold vs warm browser cache"),
    ("fetch_ms", "phase attribution: the dominant phase"),
    ("bootstrap_ms", "phase attribution"),
    ("context_ms", "phase attribution"),
    ("render_ms", "phase attribution (absent for graph/openapi by design gap)"),
    ("measured_sum_ms", "phase attribution: unattributed remainder"),
    ("client_domain", "worst-tenant breakdown"),
]


def audit(board_json):
    blob = json.dumps(board_json).lower()
    print("\nspec audit — properties referenced anywhere in the board JSON:")
    missing = []
    for prop, why in EXPECTED:
        present = prop.lower() in blob
        print(f" {'✓' if present else '✗'} {prop:<26} {why}")
        if not present:
            missing.append(prop)
    if missing:
        print(f"\n{len(missing)} not referenced: {', '.join(missing)}")
        print("Cross-check against docs/analytics/rendering-perf-board.md before "
              "concluding a card is missing — a card may compute one of these "
              "indirectly, and this check is substring-based.")
    else:
        print("\nAll expected properties are referenced somewhere. Presence is not "
              "correctness — confirm the board-level filters actually apply to all "
              "cards, and that card 9 overrides the tab_hidden filter.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--board", type=int, default=BOARD_ID)
    ap.add_argument("--report", type=int,
                    help="query ONE saved report by bookmark id (documented endpoint)")
    ap.add_argument("--raw", help="write the raw JSON here for inspection")
    args = ap.parse_args()

    user, secret = load_env_pair()
    if not user or not secret:
        sys.exit(
            "No service-account credentials found.\n"
            "  Mixpanel → Settings → Project settings → Service accounts →\n"
            "  + Add service account (the secret is shown ONCE), then add to\n"
            "  .env.mixpanel (gitignored):\n"
            "      MIXPANEL_SA_USER=<username>\n"
            "      MIXPANEL_SA_SECRET=<secret>\n"
            "  or export MIXPANEL_SA_USER / MIXPANEL_SA_SECRET."
        )
    auth = base64.b64encode(f"{user}:{secret}".encode()).decode()
    print(f"service account: {user.split('.')[0]}…  project {PROJECT_ID} "
          f"workspace {WORKSPACE_ID}")

    if not validate(auth):
        sys.exit(1)

    if args.report:
        url = (f"https://mixpanel.com/api/query/insights?project_id={PROJECT_ID}"
               f"&workspace_id={WORKSPACE_ID}&bookmark_id={args.report}")
        status, body = get(url, auth)
        print(f"\nreport {args.report} → {status}")
        print(json.dumps(body, indent=2)[:6000])
        if args.raw:
            with open(args.raw, "w") as f:
                json.dump(body, f, indent=2)
            print(f"\nwrote {args.raw}")
        return

    hit = find_board(auth, args.board)
    if not hit:
        print("\nNo board endpoint returned 2xx.")
        print("If every one is 401 while the query endpoint above succeeded, the")
        print("service account authenticates but lacks board access — raise its")
        print("project role, or fall back to per-card --report ids (documented and")
        print("known to work).")
        sys.exit(2)

    url, body = hit
    print(f"\nboard read OK via {url}")
    if args.raw:
        with open(args.raw, "w") as f:
            json.dump(body, f, indent=2)
        print(f"wrote raw JSON → {args.raw}")

    cards = list(walk_cards(body))
    print(f"\ncard-like objects found: {len(cards)}")
    for path, c in cards[:40]:
        name = c.get("name") or c.get("title") or c.get("label") or "(unnamed)"
        kind = c.get("type") or c.get("chart_type") or c.get("display") or "?"
        print(f"  · {str(name)[:60]:<60} [{kind}]  {path}")

    audit(body)


if __name__ == "__main__":
    main()
