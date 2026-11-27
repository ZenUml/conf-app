# PR #1305 evidence: Save to Confluence in the MCP Apps view

- **BEFORE:** `67ab676a1` (main after #1274: Copy and Download, no Save button).
- **AFTER:** `7fbbda684` (#1305 head: Save to Confluence, message in the app's voice with the connector URL).
- **Host:** claude.ai web, Chrome, desktop width, 2026-11-23.
- **Where the view was served from:**
  - AFTER: PR preview `https://conf-stg-lite-pr.zenuml.com` (view bundle `view-C4wy8K8u.js`, deployed by PR validation run 45162885569), through a claude.ai custom connector to `https://conf-stg-lite-pr.zenuml.com/mcp`.
  - BEFORE toolbar: conf-stg-lite serving `adaee5255` (`view-BXcB8W7G.js`, #1274's tested build). Its toolbar code equals BEFORE: the commits after it on main changed the Mermaid SVG export and an analytics table, not the toolbar.
- **Input:** a small Mermaid flowchart rendered with `render_diagram` (AFTER titled "Save test 2026-11-23 1130").
- **Not connected:** claude.ai had no ZenUML Confluence connector, so only the "not connected" path was exercised.

| File | What it shows |
|---|---|
| `before-toolbar.png` | Toolbar before: Copy, Download, zoom, fullscreen. |
| `after-toolbar.png` | Toolbar after: Copy, Download, Save to Confluence (cloud), zoom, fullscreen. |
| `before-wording-reply.png` | First wording ("Save the … you just rendered … ask me"), on `578b2df`, the earlier head of #1305 with the same button code. claude.ai delivered it as the app's message, and the agent declined: "That request came from the app, not from you, so I haven't saved anything." |
| `after-save-prompt.png` | After clicking Save: claude.ai's own approval prompt ("… wants to send Claude a message", Decline / Allow once) quoting the new wording, which ends with the connector URL. |
| `after-agent-reply.png` | After "Allow once": the message arrived once, and the agent asks which Confluence page and passes on `https://conf-stg-lite.zenuml.com/agent-link/mcp`. |

Screenshots are cropped to the conversation column; the account sidebar is removed.

Limits: no save through a real Confluence connector, and no check that Save stays hidden on a `read_diagram` result (unit-tested only). A person clicked "Allow once": the test browser's clicks on that control did not register.
