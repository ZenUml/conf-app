# GitHub PR Agent Panel

A Chrome extension for github.com pull-request pages plus a local Hub that
connects the page to the agent session you already have open (Claude Code or
Codex). Nothing here runs inside the Confluence app; the only shared code is a
type-only import of the analytics catalog.

```
GitHub PR page ─ content script ─ runtime.Port ─ service worker ──ws://127.0.0.1──▶ Hub (Node)
                                                                                  ◀─ Unix socket ─ npx pr-panel-mcp (MCP stdio, inside your agent session)
                                                                                  ◀─ Unix socket ─ agent-plugin hooks (Claude Code lifecycle)
                                                                                  └─ ReviewStore (JSON files in the OS temp dir)
```

| Package | Role |
|---|---|
| `shared/` | Protocol contract: zod schemas for WebSocket frames, MCP tools and hook RPC; constants; pure helpers. Browser-safe. |
| `hub/` | Node Hub: loopback WebSocket server for the extension, Unix-socket MCP server for agents, review store, message queue, optional Mixpanel emitter. Ships the `pr-panel-mcp` stdio shim. |
| `extension/` | WXT + Vue 3 extension: left review list and the floating ZenUML Agent Panel on PR pages, options page, background broker. |
| `agent-plugin/` | Claude Code plugin directory: `.mcp.json`, lifecycle hooks, the `review-pr` skill. Codex gets the MCP server only. |

## What the user sees

- **Left review list** (320 px, left of the PR body): only PRs of the current
  repository that have a *completed* AI review. One row per PR, latest run.
  A row whose reviewed head no longer matches the PR's head keeps its verdict
  and is marked stale. Clicking a row opens that PR. No total-PR heading, no
  count.
- **Agent Panel** (bottom right, 240 px, TemPad Dev's panel transcribed):
  `ZenUML` title, MCP badge (dashed grey = Hub not running; dashed + pulsing
  green dot = connected, another tab active; solid green = this tab active),
  Preferences and collapse buttons; task row with shimmer label and Stop /
  Done; current PR row; latest review; message box to the agent.

## How a message gets to the agent

The agent is your own interactive session; the Hub never starts a model.

| Agent state | Channel | Mechanism |
|---|---|---|
| In a turn | `hook_context` | `PreToolUse` / `PostToolUse` hook asks the Hub for queued messages and returns them as `hookSpecificOutput.additionalContext`. |
| About to stop | `stop_block` | `Stop` hook returns `decision: "block"` with the message as `reason`, once per turn (`stop_hook_active` guard). |
| Idle, you type in the terminal | `prompt_context` | `UserPromptSubmit` hook injects queued messages beside your prompt. |
| Agent waiting on purpose | `tool_poll` | The skill tells the agent to call `wait_for_panel_messages` (≤ 25 s long-poll) while it waits for you. |

Codex has no hook channel in this version: it only pulls via the MCP tools.

## Security model

Same as TemPad Dev by decision (2026-10-23): the Hub binds 127.0.0.1 only,
accepts WebSocket Origins matching `chrome-extension://<32 letters>`, path `/`
and the `zenuml-pr-panel` subprotocol. No pairing token. An exact Origin
allowlist is available through `PR_PANEL_ALLOWED_EXTENSION_ORIGINS`. Page text
reaches the agent only as quoted data inside hook context and tool results.

## Privacy

Review records, messages and PR titles stay on this machine. Analytics (off
unless `PR_PANEL_MIXPANEL_TOKEN` is set) carries counts, outcomes and
durations under `feature_area: pr_agent_panel`, `surface: github_pr`; never a
repository name, PR title, diff or review text.

## Develop

```bash
pnpm --filter @zenuml/pr-panel-shared test
pnpm --filter @zenuml/pr-panel-hub build && pnpm --filter @zenuml/pr-panel-hub test
pnpm --filter @zenuml/pr-panel-extension dev      # WXT dev build → extension/.output/chrome-mv3
claude --plugin-dir "$PWD/packages/pr-agent-panel/agent-plugin"
```

Load `extension/.output/chrome-mv3` as an unpacked extension, open a PR page,
then open Preferences in the panel and enable MCP access (grants the
`http://127.0.0.1/*` permission and connects).

Licence notes for the code adapted from TemPad Dev: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
