---
name: mixpanel-agent-browser
description: Use agent-browser with the persistent Mixpanel login to inspect or edit Mixpanel boards and saved reports when the connector cannot perform the required UI mutation. Use the regular mixpanel skill/MCP for facts and queries; use this skill for UI-only work such as changing an existing report in place.
---

# Mixpanel Agent Browser

Use the dedicated local profile at `~/.agent-browser/profiles/mixpanel`. It contains
Mixpanel-domain browser state only; never commit, print, inspect, or copy its cookie
values into the repository.

## Routing

- For event semantics, properties, query results, or creating connector-supported
  reports, use the `mixpanel` skill and Mixpanel MCP first.
- Use this skill only when UI interaction remains necessary: editing an existing
  saved report in place, manipulating a board card, or verifying visible report state.
- A read-only request does not authorize saving. Click Mixpanel's `Save` only when
  the user asked for a change.

## Start a session

Resolve the real binary because the Volta shim is unreliable in non-interactive runs:

```bash
AB_BIN=$(readlink /usr/local/bin/agent-browser)
MP_PROFILE="$HOME/.agent-browser/profiles/mixpanel"
MP_SESSION="mixpanel-ui"
A() { "$AB_BIN" --session "$MP_SESSION" --profile "$MP_PROFILE" "$@"; }
```

Check that the profile exists, then open the exact user-supplied URL:

```bash
test -d "$MP_PROFILE"
A open '<mixpanel-url>'
A wait 2000
A get url
A get title
```

If the URL contains `/request_access` or the page says the user is not logged in,
stop normal UI work. Refresh the profile with `scripts/refresh-profile.sh` only when
the user asked to create or repair the persistent profile. The script imports only
`mixpanel.com` state and never prints cookie values.

## Work with the UI

Use compact snapshots for discovery and filter them before returning large output:

```bash
A snapshot -c | rg -n -C 2 'Report title|Save|Saved|target metric'
```

Use the `@eNNN` refs from the current snapshot for clicks and fills. Re-run the
snapshot after every state-changing action; refs belong to that snapshot and may
change. Prefer visible labels and nearby context over guessing refs.

Before saving, confirm the intended report title, metrics, formula, filters, and date
range in the current snapshot. After clicking `Save`, require visible `Saved` state.
When available, also call Mixpanel `Get_Report` using the saved report ID to verify
the persisted name and result series rather than trusting the UI alone.

For a reversible connectivity check, change a report control without saving, verify
that `Save` appears, restore the original value, and require `Saved` to reappear.

## Finish

Close the agent-owned browser so the persistent profile is not left locked:

```bash
A close
```

Only one live session may use this profile. If it is locked, find and close the
agent-browser session that already owns it; do not fall back to copying a Chrome
profile or deleting profile data.
