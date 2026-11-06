# Claude Desktop: Remote Control vs Local sessions

Verified 2026-11-02 by inspecting two sessions with the `ccd_session_mgmt` and `ccd_settings`
tools and by toggling Remote Control on each. Source for every row is the tool output named in
the Evidence column; anything not listed there is not verified.

## Summary

Both session kinds run on the user's own computer (`isRemote: false`). Remote Control is a
**link to the user's claude.ai account** that lets the phone and claude.ai/code follow and steer
the session. It is not a third place to run code (that is Cloud, a container).

```
Local              : desktop app -> local Claude Code -> local files
                     Remote Control = switch you can turn on and off
Remote Control mode: desktop app -> local Claude Code -> local files
                     Remote Control = on from creation, cannot be turned off
Cloud (not this doc): any device -> cloud container -> cloned repo
```

## Observed differences

| Item | "Local testing" | "Remote control testing" | Evidence |
|---|---|---|---|
| Runs on | user's Mac | user's Mac | `get_session`: `isRemote: false` on both |
| Remote Control state | on | on | `get_session`: `remoteControlState: "on"` on both |
| Mode marker | absent | `startedViaRemoteControl: true` | `get_session` |
| Turn Remote Control off | **works** (`off`) | **refused** | `set_remote_control enabled:false` |
| Working directory | git worktree + new branch from `main` | primary checkout, no branch | `get_session`: `worktreePath`, `sourceBranch` present only on the first |
| Phone: view, reply, receive files | works | works | user report, same day |

Refusal text for the second row:
`Remote Control for that session was left as it is. Remote Control was started from your phone or
claude.ai and stays on for this session. To end it, end the session.`

## Caveats

- Both test sessions were started from the **desktop app** (user statement). The refusal text says
  "phone or claude.ai", which does not match; treat the `startedViaRemoteControl` marker, not the
  message, as the real condition. This reading is an inference.
- Whether the worktree/branch difference is caused by the mode, or by options chosen at creation,
  is **not verified**.
- A session that already carries the marker cannot be switched to a plain Local session. To drop
  Remote Control, end the session.

## Setting

`connect_new_sessions_to_remote_control` (Code tab preference, readable and settable through
`ccd_settings`): whether sessions started on this computer connect to Remote Control
automatically. It was unset (default applies) and was set to **On** on 2026-11-02.
`settings_remote_control_at_startup` is the terminal CLI's own flag; the app switch wins when set.

## How to re-check

```text
mcp__ccd_session_mgmt__list_sessions      # remoteControlActive per session
mcp__ccd_session_mgmt__get_session        # remoteControlState, startedViaRemoteControl, isRemote
mcp__ccd_settings__get_settings           # connect_new_sessions_to_remote_control
```
