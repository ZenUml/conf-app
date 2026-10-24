---
name: atlassian-developer-console
description: Use agent-browser with the dedicated support@zenuml.com Atlassian Developer Console profile for console workflows that lack an API, including definitive feature-flag inventory and UI-only flag changes. Use for developer.atlassian.com Console inspection or mutation; for feature flags, pair with the forge-feature-flag skill.
---

# Atlassian Developer Console

Use the persistent, domain-scoped agent-browser profile at:

```text
~/.agent-browser/profiles/atlassian-developer-console
```

It is authenticated as `support@zenuml.com`. It contains only `*.atlassian.com`
browser state; it deliberately excludes Confluence tenant cookies under
`*.atlassian.net`.

## Route the task first

Prefer an API or CLI when it supports the requested operation. Use the Console UI
only when the operation is unsupported, when the UI is the authoritative source,
or when the user explicitly requests browser execution.

For feature-flag work, also use the `forge-feature-flag` skill. That skill owns app
identity, environment, rule ordering, flag semantics, Activity-tab confirmation,
and runtime verification. This skill owns the authenticated browser mechanics.

Read-only requests do not authorize writes. Before a mutation, resolve the exact
app, environment, flag or setting, and intended scope. Do not change adjacent
settings.

## Start and verify the account

Resolve the locally patched binary and use a unique session:

```bash
AB_BIN=$(readlink /usr/local/bin/agent-browser)
DEVCON_PROFILE="$HOME/.agent-browser/profiles/atlassian-developer-console"
DEVCON_SESSION="atlassian-dev-console-$$"

"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" \
  open 'https://developer.atlassian.com/console/myapps/'
"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" wait 2500
"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" snapshot -c
```

The page must show the Developer Console app list. Open the account menu from the
current snapshot and verify that it visibly shows `support@zenuml.com` before any
write. If the page redirects to login or shows another account, stop. Do not switch
accounts or attempt password or OTP entry automatically.

Snapshot refs are per snapshot and frame. Re-snapshot after navigation, opening a
menu, or any state change before using another ref.

## Operate the Console

Use the normal agent-browser commands with both `--session` and `--profile` on
every call:

```bash
"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" snapshot -c
"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" click '@e1'
"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" fill '@e2' 'value'
```

For unsupported Console writes:

1. Capture the current UI state and confirm the exact target.
2. Apply only the requested change.
3. Re-snapshot the resulting state.
4. Use the authoritative confirmation surface for that feature. For feature flags,
   this is the Activity tab, not merely a chip or header.
5. Reload or open a fresh tab to prove persistence.
6. Perform runtime verification when the setting affects deployed behavior.

Never claim success from a click alone. Preserve a snapshot, screenshot, or other
visible UI evidence for claims that require UI verification.

Close the session when finished:

```bash
"$AB_BIN" --session "$DEVCON_SESSION" --profile "$DEVCON_PROFILE" close
```

## Refresh an expired profile

First sign in to Developer Console as `support@zenuml.com` in the source Chrome
profile. Then run:

```bash
.claude/skills/atlassian-developer-console/scripts/refresh-profile.sh 'Profile 8'
```

The script verifies the visible source and destination accounts, copies only
`*.atlassian.com` cookies and origins, and does not print cookie values. If source
account verification fails, it stops before updating the profile.
