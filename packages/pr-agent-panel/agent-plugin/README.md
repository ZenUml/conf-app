# pr-panel agent plugin

Claude Code plugin that connects your session to the ZenUML PR Agent Panel
(the browser extension on GitHub pull-request pages).

| Part | What it does |
|---|---|
| `.mcp.json` | Starts the `pr-panel` MCP server: `node ../hub/dist/cli.mjs` (the Hub's stdio shim). The shim starts the shared Hub on first use. |
| `hooks/hooks.json` | Runs `clients/shared/lifecycle.mjs` on `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd`. The script asks the Hub for messages queued in the panel and returns them as `additionalContext`, or as a Stop-hook `block` reason once per turn. |
| `skills/review-pr` | The review workflow: `get_active_pr` → `begin_task` → read with `gh` → `report_progress` → `publish_review` → `complete_task`. |

## Use

Build the Hub first (the plugin runs the built shim from `../hub/dist`):

```bash
pnpm --filter @zenuml/pr-panel-hub build
claude --plugin-dir "$PWD/packages/pr-agent-panel/agent-plugin"
```

Then open a PR on github.com with the extension loaded, turn on MCP access in
the panel's Preferences, and ask Claude to "review the PR in the panel".

## Notes

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
