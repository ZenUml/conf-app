# pr-panel agent plugin

Claude Code plugin that connects your session to the ZenUML PR Agent Panel
(the browser extension on GitHub pull-request pages).

| Part | What it does |
|---|---|
| `.mcp.json` | Starts the `pr-panel` MCP server: `node ../hub/dist/cli.mjs` (the Hub's stdio shim). The shim starts the shared Hub on first use. |
| `hooks/hooks.json` | Runs `clients/shared/lifecycle.mjs` on `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd`. The script asks the Hub for messages queued in the panel and returns them as `additionalContext`, or as a Stop-hook `block` reason once per turn. |
| `skills/review-pr` | The current round workflow: `start_review_group` → investigate selected PRs → `publish_review_group`. It also documents single-item refresh and action confirmation. |

## Use

Build the Hub first (the plugin runs the built shim from `../hub/dist`):

```bash
pnpm --filter @zenuml/pr-panel-hub build
claude --plugin-dir "$PWD/packages/pr-agent-panel/agent-plugin"
```

Then enable MCP access in the extension options and ask Claude to prepare a
finite PR review round. Open a selected PR on github.com to see its left list
and evidence notice, or use the extension popup to continue the round.

Claude Code names the tools `mcp__plugin_pr-panel_pr-panel__<tool>`. To skip the
permission prompt per call, allow the whole server, for example
`--allowedTools mcp__plugin_pr-panel_pr-panel` (a `mcp__*` wildcard does not match).

## Notes

- The lifecycle hooks and legacy panel message tools remain for compatibility.
  The request-scoped left list is driven by the Hub's latest review group.
- `.mcp.json` points at `../hub/dist`, so the plugin works from this repo
  (`--plugin-dir`). A marketplace install would copy the plugin without the Hub
  and needs a published `pr-panel-mcp` package instead.

- The hook script has no dependencies and always exits 0 within 1.5 s. With
  no Hub running it prints nothing.
- Subagent hook calls (`agent_id` / `subagent_id` present) are ignored.
- `PR_PANEL_RUNTIME_DIR` overrides the Hub's runtime directory for both the
  shim and the hook script.
- Codex has no hook channel: register only the MCP server
  (`node <repo>/packages/pr-agent-panel/hub/dist/cli.mjs`) and use
  `list_panel_messages` / `wait_for_panel_messages`.
- The lifecycle script is adapted from TemPad Dev (MIT); see
  `../THIRD_PARTY_NOTICES.md`.
