# GitHub PR Agent Panel

A Chrome extension for github.com pull-request pages plus a local Hub that
connects the page to the agent session the user already has open (Claude Code
or Codex). It lives in its own workspace, `packages/pr-agent-panel/`, and runs
nothing inside the Confluence app; the only shared code is a type-only import
of the analytics catalog.

Source of truth for architecture, message channels, security and privacy:
[packages/pr-agent-panel/README.md](../../packages/pr-agent-panel/README.md).

## Decisions (2026-10-23)

| Decision | Choice | Why |
|---|---|---|
| Agent runtime | The user's own interactive Claude Code / Codex session; the Hub never starts a model | Keeps the user's subscription login and permissions; no second session on the quota |
| Extension ↔ Hub transport | Loopback WebSocket on `127.0.0.1`, port probe + fixed subprotocol (TemPad Dev's design, MIT) | Chrome ≥116 keeps the MV3 service worker alive while a WebSocket is active; native messaging needs a per-profile host manifest and caps host→extension messages at 1 MB |
| Hub access check | TemPad default: Origin `chrome-extension://<32 letters>`, path `/`, subprotocol; no pairing token, no fixed extension ID | Same-user processes can read any token file anyway; optional exact allowlist via `PR_PANEL_ALLOWED_EXTENSION_ORIGINS` |
| User → agent push | Hooks (`additionalContext` mid-turn, `Stop` `decision: block` at turn end, prompt context on the next prompt) plus a `wait_for_panel_messages` long-poll tool | MCP is pull-only; Claude Code has no other inbound channel. Idle sessions receive nothing until their next turn |
| Review storage | JSON files under the OS temp dir, latest completed run per PR | No native dependencies; the left list needs only completed runs |
| Analytics | Hub emits `pr_panel_*` events (`feature_area: pr_agent_panel`, `surface: github_pr`) to Mixpanel, off without `PR_PANEL_MIXPANEL_TOKEN` | Counts and outcomes only; never a repo name, PR title, diff or review text |

## Left list rule

Only PRs of the current repository that have a *completed* AI review appear,
latest run per PR. A row whose reviewed head no longer matches the PR's head
keeps its verdict and is marked stale. No all-PR heading and no count.
