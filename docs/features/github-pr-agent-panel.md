# GitHub PR Agent Panel

A local Chrome extension and Hub connect an existing Claude Code or Codex
session to a finite, explicitly requested PR review round. The latest round
has selected PRs, a product, an optional focus, and progress. Only a pending
member PR shows the left list; detailed decision material sits above the
original PR body. The extension popup can resume the round after a tab closes.

The code is isolated under `packages/pr-agent-panel/`. It does not run in
the Confluence app. See the [architecture](../../packages/pr-agent-panel/ARCHITECTURE.zh-CN.md)
for components, models, communication and completion rules, and the
[user guide](../../packages/pr-agent-panel/USER_GUIDE.zh-CN.md) for setup.

## Current decisions

| Area | Decision |
|---|---|
| Agent | The user's existing interactive Claude Code or Codex session; the Hub never starts a model. |
| Transport | Extension ↔ Hub over a loopback WebSocket with an extension Origin check, fixed subprotocol and protocol-version handshake; MCP shim ↔ Hub over a local socket. |
| Access | MCP access is an optional browser permission and is off by default. The Hub accepts only local connections. |
| Group storage | Latest group in an atomic local JSON file; extension caches it for offline reading. Historical local review runs remain for compatibility but do not feed the left list. |
| GitHub writes | Only an explicit group preparation or single-member material refresh writes marked evidence to selected PR bodies. The original body is preserved. |
| Completion | A merge or close removes a pending item only after a remote GitHub read confirms it. Native, Agent and external sources have distinct navigation rules. |
| Analytics | Optional Hub events carry counts and outcomes, excluding PR identity, title, body, diff and SHA. |

The original 2026-10-23 permanent-list and right-panel design was superseded
by the request-scoped review-round design.
