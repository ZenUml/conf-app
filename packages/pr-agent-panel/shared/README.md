# GitHub PR Agent Panel

A Chrome extension for a finite, request-scoped PR review round. The user asks
an existing Claude Code or Codex session to prepare a round; the Agent selects
PRs and verifies evidence. The local Hub stores the latest round and connects
the Agent to the extension. It never starts a model or grants merge authority.

~~~text
Agent ── MCP stdio ── Unix socket ── Hub ── loopback WebSocket ── extension
                                    │                         ├─ popup: Continue this round
                                    │                         └─ GitHub member PR: left list
                                    ├─ latest round (atomic JSON)
                                    └─ selected PR bodies (marked evidence)
~~~

| Package | Role |
|---|---|
| shared | Browser-safe schemas for rounds, PRs, MCP tools, WebSocket frames, and hooks. |
| hub | Local Hub, MCP shim, persistent round, GitHub reads and marked body writes, confirmation polling, optional analytics. |
| extension | WXT/Vue extension: member-only left list, popup, material/result notices, and one background Hub connection. |
| agent-plugin | Claude Code MCP registration, lifecycle hooks, and review workflow skill. Codex uses the MCP server directly. |

## Review round

**start_review_group** begins a new preparation. The previous round stays visible
until **publish_review_group** has verified every selected head and written the
selected PR evidence. The latest request wins; a failed preparation keeps the
previous round, and a zero-result round clears the list. A question or refresh
of one member does not start another round.

Only a member PR shows the left list. Each row has a decision title and current
CI state; the current row is highlighted. The detailed evidence is placed at
the top of that PR's body inside zenuml-pr-review markers, preserving the
original body. A changed head marks the material stale; an unreadable head is
unconfirmed. The popup resumes the latest round, including from its local
cache while the Hub is offline. There is no permanent right-side panel.

The Hub removes an item only after GitHub confirms merge or close. A native
action shows Next / Stay on its originating tab and advances after three
seconds unless the user interacts. An Agent action advances only a review tab
owned by the extension and still displaying that item. An action elsewhere
updates the round without navigating a tab.

## Communication and storage

The extension asks for optional local HTTP permission before probing the Hub.
The Hub accepts WebSocket connections on 127.0.0.1 from Chrome extension
origins with the zenuml-pr-panel subprotocol. WebSocket handshake protocol
version 2 rejects older clients. Agents reach the Hub through its MCP stdio
shim and a local Unix socket. Claude Code hooks can still deliver legacy panel
messages; they do not drive round membership. See
[the architecture](../ARCHITECTURE.zh-CN.md) for the models and frame flow.

The latest round is atomic JSON under ~/.zenuml-pr-panel/store/; setting
PR_PANEL_RUNTIME_DIR isolates a test Hub and its store. The extension caches
the most recent round in Chrome local storage. Only the selected GitHub PR
bodies receive evidence writes. Analytics is off unless
PR_PANEL_MIXPANEL_TOKEN is set; its allowlist excludes repository names, PR
titles, bodies, diff text, and commit SHAs.

## Build and use

~~~bash
pnpm --filter @zenuml/pr-panel-shared test
pnpm --filter @zenuml/pr-panel-hub build
pnpm --filter @zenuml/pr-panel-hub test
pnpm --filter @zenuml/pr-panel-extension build
~~~

Load extension/.output/chrome-mv3 through chrome://extensions → **Load
unpacked**, then enable MCP access in the extension's options. For Agent setup
and the review workflow, see [the user guide](../USER_GUIDE.zh-CN.md).

Code adapted from TemPad Dev is credited in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
