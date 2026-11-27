# PR #1333 evidence: a plain wheel scrolls the chat over an inline diagram

- **AFTER:** `66f16b36e` (#1333 head), served from the PR preview `https://conf-stg-lite-pr.zenuml.com` (bundle `view-D2m4Fcw8.js`, live 2026-11-27 09:18 UTC) through a claude.ai connector to its `/mcp`.
- **BEFORE:** `6f5880c91` (main). The 100% → 20% drop on a plain wheel was observed in the #1306 test (`pr-1306/openapi-no-button.png`, with the test's 10-tick scroll at the diagram's position in its transcript).
- **Host:** claude.ai web, Chrome, desktop width. A ZenUML sequence diagram and a Mermaid flowchart rendered in one chat, so the chat could scroll.

| File | What it shows |
|---|---|
| `before-wheel-100pct.png` | First view at 100% before scrolling. |
| `after-10-down-chat-scrolled.png` | After 10 plain-wheel ticks down with the pointer over the diagram: the chat scrolled to the end. |
| `after-10-up-still-100pct.png` | After 10 ticks back up, pointer over the diagram: the chat is back at the top and the label still reads 100%. |
| `fullscreen-wheel-zooms.png` | In fullscreen (claude.ai's side pane), 2 plain-wheel ticks up zoomed from 191% to 230%. |

Cropped to the conversation or pane; the account sidebar is removed.

Limits: Ctrl/Cmd + wheel inline was not observed. The test browser's scroll action sends no modifier key, so this is covered by unit tests only. In fullscreen at 230%, the toolbar overlaps the top edge of the diagram; this is a pre-existing layout point, not from this PR.
